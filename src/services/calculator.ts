
import { Client, Task, AnalysisResult, Staff, StaffStats, TaskArea, TurnoverBracket } from '../types';

export function calculateClientProfitability(
  client: Client, 
  allTasks: Task[], 
  areaCosts: Record<TaskArea, number>,
  staffList: Staff[] = [],
  turnoverBrackets: TurnoverBracket[] = []
): AnalysisResult {
  let totalCost = 0;
  let totalMinutes = 0;

  // Base Responsible Staff (Fallback)
  const clientManager = staffList.find(s => s.name === client.responsibleStaff);
  const defaultAreaCost = areaCosts[TaskArea.CONTABILIDADE] || 25;
  const managerHourlyRate = clientManager ? clientManager.hourlyCost : defaultAreaCost;

  // 1. Calculate Cost per Task (Considering specific assignments)
  client.tasks.forEach(ct => {
    const taskDef = allTasks.find(t => t.id === ct.taskId);
    if (taskDef) {
      // Determines who does this task: Specific override -> Client Manager -> Area Default
      let taskHourlyCost = managerHourlyRate;
      
      if (ct.assignedStaffId) {
        const specificStaff = staffList.find(s => s.id === ct.assignedStaffId);
        if (specificStaff) taskHourlyCost = specificStaff.hourlyCost;
      } else if (!clientManager) {
        // Fallback to area cost if no manager and no specific staff
        taskHourlyCost = areaCosts[taskDef.area] || 25;
      }

      const minutesPerOccurrence = taskDef.defaultTimeMinutes * ct.multiplier;
      const annualMinutes = minutesPerOccurrence * ct.frequencyPerYear;
      
      totalMinutes += annualMinutes;
      totalCost += (annualMinutes / 60) * taskHourlyCost;
    }
  });

  // 2. Operational Costs (Calls & Travels)
  // Assumption: Calls are handled by Client Manager or Admin. Using Manager Rate.
  if (client.callTimeBalance > 0) {
    const annualCallMinutes = client.callTimeBalance * 12;
    totalMinutes += annualCallMinutes;
    totalCost += (annualCallMinutes / 60) * managerHourlyRate;
  }

  // Assumption: Travel takes avg 60 mins. 
  if (client.travelCount > 0) {
    const travelTimeMinutes = client.travelCount * 60;
    totalMinutes += travelTimeMinutes;
    // For travel, we might add a fuel cost component, but keeping it simple to hourly labor cost for now
    totalCost += (travelTimeMinutes / 60) * managerHourlyRate; 
  }

  const totalAnnualHours = totalMinutes / 60;
  const totalAnnualRevenue = client.monthlyFee * 12; 
  
  const profit = totalAnnualRevenue - totalCost;
  const profitability = totalAnnualRevenue > 0 ? (profit / totalAnnualRevenue) * 100 : 0;
  const hourlyReturn = totalAnnualHours > 0 ? totalAnnualRevenue / totalAnnualHours : 0;

  let suggestion = "";
  if (profitability < 10) {
    suggestion = "CRÍTICO: Avença abaixo do custo ou margem mínima. Necessário renegociar urgente ou otimizar processos.";
  } else if (profitability < 30) {
    suggestion = "ATENÇÃO: Margem baixa. Monitorizar horas extras e considerar pequeno ajuste anual.";
  } else {
    suggestion = "SAUDÁVEL: Cliente rentável. Manter nível de serviço.";
  }

  // Turnover Analysis (Fair Value)
  let turnoverAnalysis = undefined;
  if (turnoverBrackets && turnoverBrackets.length > 0) {
    const bracket = turnoverBrackets.find(b => 
      client.turnover >= b.minTurnover && client.turnover <= b.maxTurnover
    );

    if (bracket) {
      const minAnnualFee = client.turnover * (bracket.minPercent / 100);
      const maxAnnualFee = client.turnover * (bracket.maxPercent / 100);
      
      const minMonthly = minAnnualFee / 12;
      const maxMonthly = maxAnnualFee / 12;

      let status: 'Subavaliado' | 'Ajustado' | 'Acima da Média' = 'Ajustado';
      
      if (client.monthlyFee < minMonthly) status = 'Subavaliado';
      else if (client.monthlyFee > maxMonthly) status = 'Acima da Média';

      turnoverAnalysis = {
        minRecommendedFee: minMonthly,
        maxRecommendedFee: maxMonthly,
        status,
        bracketPercentUsed: bracket.minPercent // Using min as reference
      };
    }
  }

  return {
    totalAnnualHours,
    totalAnnualCost: totalCost,
    totalAnnualRevenue,
    profitability,
    hourlyReturn,
    suggestion,
    usedHourlyRate: managerHourlyRate, // Displaying base rate, though actual cost varies by task mix
    turnoverAnalysis
  };
}

export function calculateStaffStats(
  staff: Staff,
  clients: Client[],
  tasks: Task[]
): StaffStats {
  
  let totalMinutesAnnually = 0;
  let totalRevenueAttrib = 0; // Approximate revenue attribution
  // A client is this staff's responsibility if the ID matches.
  // Also check by name for backward compatibility with older data structures.
  const staffClients = clients.filter(c => c.responsibleStaff === staff.id || c.responsibleStaff === staff.name);
  const staffClientsCount = staffClients.length;

  clients.forEach(client => {
    let clientMinutesForThisStaff = 0;
    
    // Check assignments on tasks
    client.tasks.forEach(ct => {
      const taskDef = tasks.find(t => t.id === ct.taskId);
      if (taskDef) {
        let isAssigned = false;
        
        // 1. Direct Assignment (Specific Task Override)
        if (ct.assignedStaffId === staff.id) {
            isAssigned = true;
        } 
        // 2. Client Manager Assignment (Fallback if no specific override exists)
        else if (!ct.assignedStaffId && (client.responsibleStaff === staff.id || client.responsibleStaff === staff.name)) {
            isAssigned = true;
        }

        if (isAssigned) {
           const minutes = taskDef.defaultTimeMinutes * ct.multiplier * ct.frequencyPerYear;
           clientMinutesForThisStaff += minutes;
        }
      }
    });

    // Operational time attribution (Calls/Travel) - Assign to Client Manager Default
    // Note: Future improvement could be assigning Calls/Travel to specific staff too
    if (client.responsibleStaff === staff.id || client.responsibleStaff === staff.name) {
       clientMinutesForThisStaff += (client.callTimeBalance * 12);
       clientMinutesForThisStaff += (client.travelCount * 60);
    }

    totalMinutesAnnually += clientMinutesForThisStaff;
    
    // Revenue attribution is proportional to the workload carried by this staff member
    if (clientMinutesForThisStaff > 0) {
        // Simplified Logic: If they are the main manager, they get the full revenue credit for profitability view.
        // A more complex model would split revenue by task hour % but that gets complex for simple views.
        if (client.responsibleStaff === staff.id || client.responsibleStaff === staff.name) {
            totalRevenueAttrib += (client.monthlyFee * 12);
        }
    }
  });

  const totalHoursAnnually = totalMinutesAnnually / 60;
  const allocatedHoursMonth = totalHoursAnnually / 12;
  const capacityUtilization = staff.capacityHoursPerMonth > 0 
    ? (allocatedHoursMonth / staff.capacityHoursPerMonth) * 100 
    : 0;

  const totalCost = totalHoursAnnually * staff.hourlyCost;
  
  // Profitability of the Staff member (Revenue they manage vs their cost)
  const profit = totalRevenueAttrib - totalCost;
  const profitability = totalRevenueAttrib > 0 ? (profit / totalRevenueAttrib) * 100 : 0;

  return {
    staffName: staff.name,
    clientCount: staffClientsCount,
    allocatedHoursMonth,
    capacityUtilization,
    totalRevenue: totalRevenueAttrib,
    totalCost,
    profitability
  };
}
