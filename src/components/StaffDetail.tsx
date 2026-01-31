import React, { useState, useEffect, useMemo } from 'react';
import { Staff, Client, Task, TaskArea } from '../types';
import { calculateStaffStats, calculateClientProfitability } from '../services/calculator';
import { ArrowLeft, Save, RefreshCcw, User, Calculator, Layers, Briefcase, DollarSign, TrendingUp, Users } from 'lucide-react';

interface StaffDetailProps {
  staffMember: Staff;
  clients: Client[];
  tasks: Task[];
  staff: Staff[];
  areaCosts: Record<string, number>;
  onBack: () => void;
  onUpdateStaff: (staff: Staff) => Promise<void>;
}

const StaffDetail: React.FC<StaffDetailProps> = ({ staffMember, clients, tasks, staff, areaCosts, onBack, onUpdateStaff }) => {
  const [editedStaff, setEditedStaff] = useState<Staff>(staffMember);
  const [isDirty, setIsDirty] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setEditedStaff(staffMember);
    setIsDirty(false);
  }, [staffMember]);

  const stats = calculateStaffStats(editedStaff, clients, tasks);
  const memberClients = clients.filter(c => c.responsibleStaff === editedStaff.id || c.responsibleStaff === editedStaff.name);

  const portfolioTotals = useMemo(() => {
    return memberClients.reduce((acc, client) => {
      acc.totalEmployees += client.employeeCount || 0;
      acc.totalDocuments += client.documentCount || 0;
      return acc;
    }, { totalEmployees: 0, totalDocuments: 0 });
  }, [memberClients]);

  const handleFieldChange = (field: keyof Staff, value: any) => {
    setEditedStaff(prev => ({ ...prev, [field]: value }));
    setIsDirty(true);
  };

  const handleCalculateCost = () => {
    const salary = Number(editedStaff.baseSalary) || 0;
    const taxes = (salary * (Number(editedStaff.socialChargesPercent) || 0)) / 100;
    const meal = Number(editedStaff.mealAllowance) || 0;
    const other = Number(editedStaff.otherMonthlyCosts) || 0;
    const hours = Number(editedStaff.capacityHoursPerMonth) || 160;

    const totalMonthlyCost = salary + taxes + meal + other;
    const hourly = hours > 0 ? totalMonthlyCost / hours : 0;

    handleFieldChange('hourlyCost', Number(hourly.toFixed(2)));
  };

  const toggleArea = (area: TaskArea) => {
    const currentAreas = editedStaff.assignedAreas || [];
    const newAreas = currentAreas.includes(area)
      ? currentAreas.filter(a => a !== area)
      : [...currentAreas, area];
    handleFieldChange('assignedAreas', newAreas);
  };

  const handleSaveChanges = async () => {
    setIsSaving(true);
    try {
      await onUpdateStaff(editedStaff);
      setIsDirty(false);
      alert('Alterações salvas com sucesso!');
    } catch (error) {
      console.error("Save failed in StaffDetail:", error);
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in pb-10">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={onBack} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
            <ArrowLeft size={20} className="text-slate-600" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-slate-800">{staffMember.name}</h2>
            <p className="text-sm text-slate-500">{staffMember.role}</p>
          </div>
        </div>
        {isDirty && (
          <button
            onClick={handleSaveChanges}
            disabled={isSaving}
            className="bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 flex items-center gap-2 shadow-sm disabled:opacity-50"
          >
            {isSaving ? <RefreshCcw size={18} className="animate-spin" /> : <Save size={18} />}
            {isSaving ? 'Gravando...' : 'Salvar Alterações'}
          </button>
        )}
      </div>

      {/* Main Content */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Edit Form */}
        <div className="lg:col-span-2 space-y-6">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><User size={18} /> Dados Pessoais</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Nome Completo</label>
                <input type="text" required value={editedStaff.name || ''} onChange={e => handleFieldChange('name', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Função / Cargo</label>
                <input type="text" required value={editedStaff.role || ''} onChange={e => handleFieldChange('role', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-medium text-slate-500 mb-1">Email</label>
                <input type="email" value={editedStaff.email || ''} onChange={e => handleFieldChange('email', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
            <div className="flex justify-between items-center mb-4">
              <h3 className="font-bold text-slate-800 flex items-center gap-2"><Calculator size={18} /> Calculadora de Custo Hora</h3>
              <button type="button" onClick={handleCalculateCost} className="text-xs bg-blue-100 text-blue-700 px-3 py-1 rounded hover:bg-blue-200 font-medium">
                Calcular Agora
              </button>
            </div>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Salário Base (€)</label>
                <input type="number" value={editedStaff.baseSalary} onChange={e => handleFieldChange('baseSalary', parseFloat(e.target.value))} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Encargos TSU (%)</label>
                <input type="number" value={editedStaff.socialChargesPercent} onChange={e => handleFieldChange('socialChargesPercent', parseFloat(e.target.value))} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Sub. Alim./Outros (€)</label>
                <input type="number" value={editedStaff.mealAllowance} onChange={e => handleFieldChange('mealAllowance', parseFloat(e.target.value))} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Horas Trab. / Mês</label>
                <input type="number" value={editedStaff.capacityHoursPerMonth} onChange={e => handleFieldChange('capacityHoursPerMonth', parseFloat(e.target.value))} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div className="md:col-span-2 bg-slate-50 p-3 rounded-lg border border-slate-200 flex items-center justify-between">
                <span className="font-bold text-blue-600">Custo Hora Final (€)</span>
                <span className="text-2xl font-bold text-slate-800">{editedStaff.hourlyCost.toFixed(2)}€</span>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><Layers size={18} /> Áreas de Atividade</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
              {Object.values(TaskArea).map(area => (
                <label key={area} className={`flex items-center gap-2 p-2 rounded border text-sm cursor-pointer transition-colors ${(editedStaff.assignedAreas || []).includes(area) ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-600'}`}>
                  <input type="checkbox" checked={(editedStaff.assignedAreas || []).includes(area)} onChange={() => toggleArea(area)} className="rounded text-blue-600 focus:ring-blue-500" />
                  {area}
                </label>
              ))}
            </div>
          </div>
        </div>

        {/* Right Column: Stats and Clients */}
        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
            <h3 className="font-bold text-slate-800 mb-4">Métricas de Desempenho</h3>
            <div className="space-y-3">
              <div className="flex justify-between text-sm"><span className="text-slate-500">Alocado / Capacidade:</span><span className="font-medium text-slate-700">{stats.allocatedHoursMonth.toFixed(0)}h / {editedStaff.capacityHoursPerMonth}h</span></div>
              <div className="flex justify-between text-sm"><span className="text-slate-500">Rentabilidade (Efic.):</span><span className={`font-bold ${stats.profitability < 20 ? 'text-red-500' : 'text-green-600'}`}>{stats.profitability.toFixed(0)}%</span></div>
            </div>
            <div className="mt-4">
              <div className="flex justify-between text-[10px] font-bold text-slate-400 mb-1 uppercase"><span>Utilização</span><span>{stats.capacityUtilization.toFixed(0)}%</span></div>
              <div className="w-full bg-slate-100 rounded-full h-1.5"><div className={`h-1.5 rounded-full ${stats.capacityUtilization > 90 ? 'bg-red-500' : stats.capacityUtilization > 70 ? 'bg-yellow-500' : 'bg-green-500'}`} style={{ width: `${Math.min(stats.capacityUtilization, 100)}%` }}></div></div>
            </div>
          </div>

        </div>
      </div>

      {/* Client Portfolio Section */}
      <div className="mt-8 bg-white rounded-xl shadow-sm border border-slate-100">
        <div className="p-6 border-b border-slate-100">
            <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><Briefcase size={18} /> Resumo da Carteira de Clientes</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4 text-center">
              <div className="p-4 bg-slate-50 rounded-lg">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Nº de Empresas</p>
                <p className="text-2xl font-black text-slate-700">{stats.clientCount}</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Total Docs/Mês</p>
                <p className="text-2xl font-black text-slate-700">{portfolioTotals.totalDocuments}</p>
              </div>
              <div className="p-4 bg-slate-50 rounded-lg">
                <p className="text-[10px] font-bold text-slate-400 uppercase">Total Funcionários</p>
                <p className="text-2xl font-black text-slate-700">{portfolioTotals.totalEmployees}</p>
              </div>
              <div className="p-4 bg-blue-50 rounded-lg">
                <p className="text-[10px] font-bold text-blue-500 uppercase">Total Avenças (Mensal)</p>
                <p className="text-2xl font-black text-blue-700">{(stats.totalRevenue / 12).toFixed(0)}€</p>
              </div>
              <div className="p-4 bg-green-50 rounded-lg">
                <p className="text-[10px] font-bold text-green-500 uppercase">Rentabilidade Carteira</p>
                <p className="text-2xl font-black text-green-700">{stats.profitability.toFixed(0)}%</p>
              </div>
              <div className="p-4 bg-red-50 rounded-lg">
                <p className="text-[10px] font-bold text-red-500 uppercase">Custo Anual</p>
                <p className="text-2xl font-black text-red-700">{(stats.totalCost / 1000).toFixed(1)}k €</p>
              </div>
            </div>
        </div>
        
        <div className="overflow-y-auto">
          <table className="w-full text-xs">
            <thead className="sticky top-0 bg-slate-50">
              <tr className="text-left text-slate-400 font-medium">
                <th className="p-3">Cliente</th>
                <th className="p-3 text-center">Nº Func.</th>
                <th className="p-3 text-center">Nº Docs</th>
                <th className="p-3 text-center">Avença (€)</th>
                <th className="p-3 text-center">Horas/Ano</th>
                <th className="p-3 text-right">Margem</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {memberClients.length > 0 ? (
                memberClients.map(client => {
                  const clientStats = calculateClientProfitability(client, tasks, areaCosts, staff);
                  
                  let clientMinutesForThisStaff = 0;
                  const isResponsibleManager = client.responsibleStaff === editedStaff.id || client.responsibleStaff === editedStaff.name;

                  // Iterate over all possible tasks to apply logic
                  tasks.forEach(taskDef => {
                      const override = client.tasks.find(t => t.taskId === taskDef.id);
                      
                      let multiplier = 0;
                      if (override?.multiplier) {
                          multiplier = override.multiplier;
                      } else if (taskDef.multiplierLogic && taskDef.multiplierLogic !== 'manual') {
                          multiplier = (client[taskDef.multiplierLogic as keyof Client] as number) || 0;
                      }

                      if (multiplier > 0) {
                          const frequency = override?.frequencyPerYear || taskDef.defaultFrequencyPerYear;
                          
                          let isAssignedToThisStaff = false;
                          // 1. Direct assignment
                          if (override?.assignedStaffId === editedStaff.id) {
                              isAssignedToThisStaff = true;
                          } 
                          // 2. No direct assignment, falls back to responsible manager
                          else if (!override?.assignedStaffId && isResponsibleManager) {
                              isAssignedToThisStaff = true;
                          }

                          if (isAssignedToThisStaff) {
                              const annualMinutes = taskDef.defaultTimeMinutes * multiplier * frequency;
                              clientMinutesForThisStaff += annualMinutes;
                          }
                      }
                  });

                  // Operational time
                  if (isResponsibleManager) {
                    clientMinutesForThisStaff += (client.callTimeBalance * 12) + (client.travelCount * 60);
                  }

                  const clientHoursForThisStaff = clientMinutesForThisStaff / 60;
                  return (
                    <tr key={client.id} className="hover:bg-slate-50">
                      <td className="p-3 font-medium text-slate-700 truncate">{client.name}</td>
                      <td className="p-3 text-center font-medium">{client.employeeCount}</td>
                      <td className="p-3 text-center font-medium">{client.documentCount}</td>
                      <td className="p-3 text-center text-blue-600 font-bold">{client.monthlyFee.toFixed(0)}€</td>
                      <td className="p-3 text-center text-slate-600 font-medium">{clientHoursForThisStaff.toFixed(1)}h</td>
                      <td className={`p-3 text-right font-bold ${clientStats.profitability < 15 ? 'text-red-500' : 'text-green-600'}`}>{clientStats.profitability.toFixed(1)}%</td>
                    </tr>
                  );
                })
              ) : (
                <tr><td colSpan={6} className="p-6 text-center text-slate-400 italic">Nenhum cliente atribuído.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default StaffDetail;