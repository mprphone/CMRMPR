
import React, { useState } from 'react';
import { Staff, Client, Task, TaskArea } from '../types';
import { calculateStaffStats } from '../services/calculator';
import { staffService } from '../services/supabase';
import { Plus, Trash2, Save, X, Calculator, DownloadCloud, RefreshCcw, Activity } from 'lucide-react';

interface StaffTeamProps {
  staff: Staff[];
  setStaff: (staff: Staff[]) => void;
  clients: Client[];
  tasks: Task[];
  onSelectStaff: (staff: Staff) => void;
  areaCosts: Record<string, number>;
  onSyncRequest?: () => void;
}

const StaffTeam: React.FC<StaffTeamProps> = ({ staff, setStaff, clients, tasks, onSelectStaff, onSyncRequest }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<Staff | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Form State
  const [formData, setFormData] = useState<Partial<Staff>>({});

  const handleOpenModal = (member?: Staff) => {
    if (member) {
      setEditingStaff(member);
      setFormData({ ...member });
    } else {
      setEditingStaff(null);
      setFormData({
        name: '', 
        role: '', 
        baseSalary: 0,
        socialChargesPercent: 23.75,
        mealAllowance: 0,
        otherMonthlyCosts: 0,
        capacityHoursPerMonth: 160,
        hourlyCost: 0,
        assignedAreas: []
      });
    }
    setIsModalOpen(true);
  };

  const handleCalculateCost = () => {
    const salary = Number(formData.baseSalary) || 0;
    const taxes = (salary * (Number(formData.socialChargesPercent) || 0)) / 100;
    const meal = Number(formData.mealAllowance) || 0;
    const other = Number(formData.otherMonthlyCosts) || 0;
    const hours = Number(formData.capacityHoursPerMonth) || 160;

    const totalMonthlyCost = salary + taxes + meal + other;
    const hourly = hours > 0 ? totalMonthlyCost / hours : 0;

    setFormData(prev => ({
      ...prev,
      hourlyCost: Number(hourly.toFixed(2))
    }));
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    
    try {
      const memberToSave: Staff = {
        ...formData,
        id: editingStaff?.id || crypto.randomUUID(),
      } as Staff;

      const saved = await staffService.upsert(memberToSave);
      
      if (editingStaff) {
        setStaff(staff.map(s => s.id === saved.id ? saved : s));
      } else {
        setStaff([...staff, saved]);
      }
      setIsModalOpen(false);
    } catch (err: any) {
      alert("Erro ao gravar funcionário no Supabase: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = (id: string) => {
    if (confirm('Tem a certeza que deseja remover este funcionário da base de dados?')) {
      // Nota: Idealmente aqui chamaríamos staffService.delete(id)
      setStaff(staff.filter(s => s.id !== id));
    }
  };

  const toggleArea = (area: TaskArea) => {
    const currentAreas = formData.assignedAreas || [];
    if (currentAreas.includes(area)) {
      setFormData({ ...formData, assignedAreas: currentAreas.filter(a => a !== area) });
    } else {
      setFormData({ ...formData, assignedAreas: [...currentAreas, area] });
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex justify-between items-center">
         <div>
           <h2 className="text-2xl font-bold text-slate-800">Gestão da Equipa</h2>
           <p className="text-sm text-slate-500">Monitorize custos, capacidades e rentabilidade</p>
         </div>
         <div className="flex gap-3">
           {onSyncRequest && (
             <button 
               onClick={onSyncRequest}
               className="bg-blue-50 text-blue-600 px-4 py-2 rounded-lg text-sm font-bold hover:bg-blue-100 flex items-center gap-2 border border-blue-100 transition-all"
             >
               <DownloadCloud size={16}/> Sincronizar da Origem
             </button>
           )}
           <button 
             onClick={() => handleOpenModal()}
             className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2 shadow-sm"
           >
             <Plus size={16}/> Novo Colaborador
           </button>
         </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-slate-600">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50 font-bold">
              <tr>
                <th className="px-6 py-3">Colaborador</th>
                <th className="px-6 py-3 text-center">Custo/Hora</th>
                <th className="px-6 py-3 text-center">Clientes</th>
                <th className="px-6 py-3 text-center">Utilização</th>
                <th className="px-6 py-3 text-center">Rentabilidade</th>
                <th className="px-6 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {staff.map(member => {
                const stats = calculateStaffStats(member, clients, tasks);
                return (
                  <tr key={member.id} className="hover:bg-slate-50/80">
                    <td className="px-6 py-4">
                      <div className="font-bold text-slate-800">{member.name}</div>
                      <div className="text-xs text-slate-400">{member.role}</div>
                    </td>
                    <td className="px-6 py-4 text-center font-mono text-blue-600 font-bold">{member.hourlyCost.toFixed(2)}€</td>
                    <td className="px-6 py-4 text-center font-medium">{stats.clientCount}</td>
                    <td className="px-6 py-4 text-center font-medium">{stats.capacityUtilization.toFixed(0)}%</td>
                    <td className={`px-6 py-4 text-center font-bold ${stats.profitability < 20 ? 'text-red-500' : 'text-green-600'}`}>{stats.profitability.toFixed(0)}%</td>
                    <td className="px-6 py-4 text-right">
                      <button onClick={() => onSelectStaff(member)} className="text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded text-xs font-bold border border-blue-100 flex items-center gap-1">
                        <Activity size={14} /> Detalhes
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal Edição/Novo */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 animate-fade-in max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-center mb-6 border-b border-slate-100 pb-4">
              <h3 className="text-xl font-bold text-slate-800">
                {editingStaff ? 'Ficha de Colaborador' : 'Novo Colaborador'}
              </h3>
              <div className="flex items-center gap-2">
                {editingStaff && (
                  <button onClick={() => handleDelete(editingStaff.id)} className="text-red-500 hover:bg-red-50 p-2 rounded transition-colors mr-2">
                    <Trash2 size={18} />
                  </button>
                )}
                <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                  <X size={20} />
                </button>
              </div>
            </div>

            <form onSubmit={handleSave} className="space-y-6">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Nome Completo</label>
                  <input type="text" required value={formData.name || ''} onChange={e => setFormData({...formData, name: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Função / Cargo</label>
                  <input type="text" required value={formData.role || ''} onChange={e => setFormData({...formData, role: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div className="md:col-span-2">
                  <label className="block text-xs font-medium text-slate-500 mb-1">Email (Chave de Sincronização)</label>
                  <input type="email" value={formData.email || ''} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
              </div>

              <div className="bg-slate-50 p-4 rounded-lg border border-slate-100">
                <div className="flex justify-between items-center mb-4">
                   <h4 className="font-bold text-slate-700 text-sm flex items-center gap-2">
                     <Calculator size={16}/> Calculadora de Custo Hora
                   </h4>
                   <button 
                     type="button" 
                     onClick={handleCalculateCost}
                     className="text-xs bg-blue-100 text-blue-700 px-3 py-1 rounded hover:bg-blue-200 font-medium transition-colors"
                   >
                     Calcular Agora
                   </button>
                </div>
                
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-4">
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Salário Base (€)</label>
                    <input type="number" value={formData.baseSalary || 0} onChange={e => setFormData({...formData, baseSalary: parseFloat(e.target.value)})} className="w-full px-3 py-2 border rounded-lg text-sm bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Encargos TSU (%)</label>
                    <input type="number" value={formData.socialChargesPercent || 23.75} onChange={e => setFormData({...formData, socialChargesPercent: parseFloat(e.target.value)})} className="w-full px-3 py-2 border rounded-lg text-sm bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Sub. Alim./Seguro (€)</label>
                    <input type="number" value={formData.mealAllowance || 0} onChange={e => setFormData({...formData, mealAllowance: parseFloat(e.target.value)})} className="w-full px-3 py-2 border rounded-lg text-sm bg-white" />
                  </div>
                   <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Outros Custos (€)</label>
                    <input type="number" value={formData.otherMonthlyCosts || 0} onChange={e => setFormData({...formData, otherMonthlyCosts: parseFloat(e.target.value)})} className="w-full px-3 py-2 border rounded-lg text-sm bg-white" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-500 mb-1">Horas Trab. / Mês</label>
                    <input type="number" value={formData.capacityHoursPerMonth || 160} onChange={e => setFormData({...formData, capacityHoursPerMonth: parseFloat(e.target.value)})} className="w-full px-3 py-2 border rounded-lg text-sm bg-white" />
                  </div>
                  <div className="bg-white p-2 rounded border border-blue-200">
                    <label className="block text-xs font-bold text-blue-600 mb-1">Custo Hora Final (€)</label>
                    <input 
                      type="number" 
                      value={formData.hourlyCost || 0} 
                      readOnly
                      className="w-full px-3 py-1 border-none bg-transparent text-lg font-bold text-slate-800 focus:ring-0" 
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-500 mb-2">Áreas de Atividade</label>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                  {Object.values(TaskArea).map(area => (
                    <label key={area} className={`
                      flex items-center gap-2 p-2 rounded border text-sm cursor-pointer transition-colors
                      ${(formData.assignedAreas || []).includes(area) ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-white border-slate-200 text-slate-600'}
                    `}>
                      <input 
                        type="checkbox" 
                        checked={(formData.assignedAreas || []).includes(area)}
                        onChange={() => toggleArea(area)}
                        className="rounded text-blue-600 focus:ring-blue-500"
                      />
                      {area}
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-4 border-t border-slate-100">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">Cancelar</button>
                <button type="submit" disabled={isSaving} className="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2">
                  {isSaving ? <RefreshCcw size={16} className="animate-spin"/> : <Save size={16} />} 
                  {isSaving ? 'Gravando...' : 'Salvar no Supabase'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default StaffTeam;
