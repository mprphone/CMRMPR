
import React, { useMemo, useState } from 'react';
import { Staff, Client, Task, TaskArea } from '../types';
import { calculateStaffStats } from '../services/calculator';
import { staffService } from '../services';
import { Plus, Trash2, Save, X, Calculator, DownloadCloud, RefreshCcw, Activity, Search } from 'lucide-react';

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
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'Ativo' | 'Inativo' | 'all'>('Ativo');

  // Form State
  const [formData, setFormData] = useState<Partial<Staff>>({});

  const visibleStaff = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-PT');
    return staff.filter(member => {
      if (statusFilter !== 'all' && (member.status || 'Ativo') !== statusFilter) return false;
      return !term || member.name.toLocaleLowerCase('pt-PT').includes(term) || (member.role || '').toLocaleLowerCase('pt-PT').includes(term);
    });
  }, [staff, search, statusFilter]);

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
        assignedAreas: [],
        status: 'Ativo'
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
      alert("Erro ao gravar funcionário no servidor local: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Tem a certeza que deseja remover este funcionário da base de dados?')) {
      try {
        await staffService.delete(id);
        setStaff(staff.filter(s => s.id !== id));
        setIsModalOpen(false);
      } catch (err: any) {
        alert('Erro ao remover o funcionário do servidor local: ' + (err?.message || 'erro desconhecido'));
      }
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
    <div className="space-y-4 animate-fade-in">
      <section className="rounded-2xl border border-slate-700/20 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-900 p-4 text-white shadow-sm md:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="text-xl font-bold md:text-2xl">Gestão da Equipa</h1>
            <p className="mt-1 text-xs text-slate-200 md:text-sm">Monitorize custos, capacidades e rentabilidade.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {onSyncRequest && (
              <button
                onClick={onSyncRequest}
                className="inline-flex h-10 items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-4 text-sm font-bold text-white hover:bg-white/20"
              >
                <DownloadCloud size={16} /> Sincronizar da Origem
              </button>
            )}
            <button
              onClick={() => handleOpenModal()}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-white px-4 text-sm font-bold text-indigo-900 shadow-sm hover:bg-indigo-50"
            >
              <Plus size={16} /> Novo Colaborador
            </button>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-200 p-3 md:flex-row">
          <label className="relative flex-1">
            <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Pesquisar nome ou função…" className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm" />
          </label>
          <select value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="Ativo">Ativos</option>
            <option value="Inativo">Inativos</option>
            <option value="all">Todos os estados</option>
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-slate-600">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-6 py-3">Colaborador</th>
                <th className="px-6 py-3 text-center">Custo/Hora</th>
                <th className="px-6 py-3 text-center">Clientes</th>
                <th className="px-6 py-3 text-center">Utilização</th>
                <th className="px-6 py-3 text-center">Rentabilidade</th>
                <th className="px-6 py-3">Estado</th>
                <th className="px-6 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleStaff.map(member => {
                const stats = calculateStaffStats(member, clients, tasks);
                const isInactive = (member.status || 'Ativo') === 'Inativo';
                return (
                  <tr key={member.id} className={`hover:bg-slate-50/70 ${isInactive ? 'opacity-60' : ''}`}>
                    <td className="px-6 py-4">
                      <div className="font-bold text-slate-800">{member.name}</div>
                      <div className="text-xs text-slate-400">{member.role}</div>
                    </td>
                    <td className="px-6 py-4 text-center font-mono text-blue-600 font-bold">{member.hourlyCost.toFixed(2)}€</td>
                    <td className="px-6 py-4 text-center font-medium">{stats.clientCount}</td>
                    <td className="px-6 py-4 text-center font-medium">{stats.capacityUtilization.toFixed(0)}%</td>
                    <td className={`px-6 py-4 text-center font-bold ${stats.profitability < 20 ? 'text-red-500' : 'text-green-600'}`}>{stats.profitability.toFixed(0)}%</td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-bold ${isInactive ? 'border-slate-200 bg-slate-100 text-slate-500' : 'border-emerald-200 bg-emerald-50 text-emerald-700'}`}>
                        {isInactive ? 'Inativo' : 'Ativo'}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-right">
                      <button onClick={() => onSelectStaff(member)} className="text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded text-xs font-bold border border-blue-100 flex items-center gap-1">
                        <Activity size={14} /> Detalhes
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!visibleStaff.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-slate-400">Nenhum colaborador neste filtro.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

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
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Email (Chave de Sincronização)</label>
                  <input type="email" value={formData.email || ''} onChange={e => setFormData({...formData, email: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Estado</label>
                  <select value={formData.status || 'Ativo'} onChange={e => setFormData({...formData, status: e.target.value as Staff['status']})} className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
                    <option value="Ativo">Ativo</option>
                    <option value="Inativo">Inativo</option>
                  </select>
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
