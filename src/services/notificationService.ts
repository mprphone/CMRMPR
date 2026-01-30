
import { Client, Task, AppNotification, Staff, TaskArea, TurnoverBracket } from '../types';
import { calculateClientProfitability } from './calculator';
import { DEFAULT_TURNOVER_BRACKETS } from '../constants'; // Fallback

export const generateNotifications = (
  clients: Client[], 
  tasks: Task[],
  areaCosts: Record<string, number>,
  staff: Staff[],
  turnoverBrackets: TurnoverBracket[] = DEFAULT_TURNOVER_BRACKETS
): AppNotification[] => {
  const notifications: AppNotification[] = [];
  const today = new Date();
  
  // 1. Profitability & Fair Value Alerts
  clients.forEach(client => {
    const stats = calculateClientProfitability(client, tasks, areaCosts as Record<TaskArea, number>, staff, turnoverBrackets);
    
    // Low Margin
    if (stats.profitability < 15) {
      notifications.push({
        id: `prof-${client.id}`,
        type: 'critical',
        title: 'Rentabilidade Crítica',
        message: `O cliente ${client.name} tem uma margem de ${stats.profitability.toFixed(1)}%.`,
        date: today.toISOString().split('T')[0],
        clientId: client.id,
        actionLabel: 'Ver Detalhes'
      });
    }

    // Underpriced based on Turnover
    if (stats.turnoverAnalysis && stats.turnoverAnalysis.status === 'Subavaliado') {
      notifications.push({
        id: `fair-${client.id}`,
        type: 'warning',
        title: 'Avença Desajustada',
        message: `${client.name} paga ${client.monthlyFee}€, mas o volume de negócios sugere mín. ${stats.turnoverAnalysis.minRecommendedFee.toFixed(0)}€.`,
        date: today.toISOString().split('T')[0],
        clientId: client.id,
        actionLabel: 'Ver Análise'
      });
    }
  });

  // 2. Contract Renewal Alerts (Next 60 days)
  clients.forEach(client => {
    const renewalDate = new Date(client.contractRenewalDate);
    const diffTime = renewalDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

    if (diffDays > 0 && diffDays <= 60) {
      notifications.push({
        id: `renew-${client.id}`,
        type: 'info',
        title: 'Renovação de Avença',
        message: `O contrato de ${client.name} renova em ${diffDays} dias (${client.contractRenewalDate}).`,
        date: today.toISOString().split('T')[0],
        clientId: client.id,
        actionLabel: 'Preparar Proposta'
      });
    } else if (diffDays <= 0 && diffDays > -30) {
      notifications.push({
        id: `expired-${client.id}`,
        type: 'warning',
        title: 'Contrato Vencido',
        message: `O contrato de ${client.name} venceu em ${client.contractRenewalDate}.`,
        date: today.toISOString().split('T')[0],
        clientId: client.id
      });
    }
  });

  // 3. Fiscal/Task Deadlines (Simulation based on current month)
  const currentDay = today.getDate();
  
  if (currentDay < 20) {
    notifications.push({
      id: 'deadline-iva',
      type: 'warning',
      title: 'Prazo IVA Aproxima-se',
      message: 'Entrega das Declarações Periódicas do IVA e pagamento até dia 20.',
      date: today.toISOString().split('T')[0]
    });
  }

  if (currentDay < 23) {
    notifications.push({
      id: 'deadline-ss',
      type: 'info',
      title: 'Segurança Social',
      message: 'Pagamento das contribuições para a Segurança Social até dia 20/23.',
      date: today.toISOString().split('T')[0]
    });
  }
  
  // Specific Task Volume Warning (Simulation)
  clients.forEach(client => {
    if (client.documentCount > 50 && client.monthlyFee < 300) {
       notifications.push({
        id: `vol-${client.id}`,
        type: 'warning',
        title: 'Volume vs Faturação',
        message: `${client.name} tem volume ALTO (${client.documentCount} docs) mas avença inferior a 300€.`,
        date: today.toISOString().split('T')[0],
        clientId: client.id
      });
    }
  });

  return notifications;
};