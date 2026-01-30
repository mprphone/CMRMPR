
import React, { useState, useMemo } from 'react';
import { FeeGroup, Client, Task, Staff } from '../types';
import { calculateClientProfitability } from '../services/calculator';
import { clientService, groupService } from '../services/supabase';
import { analyzeClientWithAI } from '../services/geminiService';
import { 
  Plus, Users, FolderOpen, Trash2, ChevronRight, Save,
  ArrowLeft, BrainCircuit, RefreshCcw, XCircle, Activity, UserPlus, Search, X, Filter
} from 'lucide-react';

interface FeeGroupsProps {
  groups: FeeGroup[];
  setGroups: (groups: FeeGroup[]) => void;
  clients: Client[];
  setClients: (clients: Client[]) => void;
  onSelectClient: (client: Client) => void;
  tasks: Task[];
  staff: Staff[];
  areaCosts: Record<string, number>;
}

const FeeGroups: React.FC<FeeGroupsProps> = ({ 
  groups, setGroups, clients, setClients, onSelectClient, tasks, staff, areaCosts 
}) => {
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [newGroupName, setNewGroupName] = useState('');
  const [isAdding, setIsAdding] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [analyzingClientId, setAnalyzingClientId] = useState<string | null>(null);
  const [newFees, setNewFees] = useState<Record<string, number>>({});
  const [isAddClientModalOpen, setIsAddClientModalOpen] = useState(false);
  const [clientsToAdd, setClientsToAdd] = useState<string[]>([]);
  const [addClientSearch, setAddClientSearch] = useState('');
  const [addClientStaffFilter, setAddClientStaffFilter] = useState('all');
  const [addClientEntityTypeFilter, setAddClientEntityTypeFilter] = useState('all');

  const selectedGroup = groups.find(g => g.id === selectedGroupId);
  const groupClients = useMemo(() => selectedGroup ? clients.filter(c => selectedGroup.clientIds.includes(c.id)) : [], [clients, selectedGroup]);

  const uniqueEntityTypes = useMemo(() => {
    const types = new Set(clients.map(c => c.entityType).filter(Boolean));
    return Array.from(types) as string[];
  }, [clients]);

  const handleAddGroup = async () => {
    if (!newGroupName) return;
    const group: FeeGroup = {
      id: crypto.randomUUID(),
      name: newGroupName,
      description: 'Grupo de clientes para análise estratégica',
      clientIds: []
    };

    // Optimistic UI update
    setGroups(prev => [...prev, group]);
    setNewGroupName('');
    setIsAdding(false);

    try {
      await groupService.upsert(group);
    } catch (err: any) {
      alert("Erro ao gravar o novo grupo. Por favor, tente novamente.\nDetalhes: " + err.message);
      setGroups(prev => prev.filter(g => g.id !== group.id)); // Revert on failure
    }
  };

  const handleAddMultipleClientsToGroup = async () => {
    if (!selectedGroupId || clientsToAdd.length === 0) return;
    
    const originalClients = [...clients];
    const originalGroups = [...groups];
    const groupToUpdate = originalGroups.find(g => g.id === selectedGroupId);
    if (!groupToUpdate) return;

    const updatedGroup = { ...groupToUpdate, clientIds: [...new Set([...groupToUpdate.clientIds, ...clientsToAdd])] };
    const updatedGroups = originalGroups.map(g => g.id === selectedGroupId ? updatedGroup : g);

    setGroups(updatedGroups);

    // Close modal immediately for better UX
    setClientsToAdd([]);
    setAddClientSearch('');
    setIsAddClientModalOpen(false);

    // Persist changes to DB
    try {
      await groupService.upsert(updatedGroup);
    } catch (err: any) {
      alert("Erro ao adicionar clientes ao grupo: " + err.message);
      // Revert UI on failure
      setGroups(originalGroups);
    }
  };

  const handleRemoveClientFromGroup = async (clientId: string) => {
    const originalClients = [...clients];
    const originalGroups = [...groups];
    const clientToUpdate = originalClients.find(c => c.id === clientId);
    if (!clientToUpdate || !selectedGroup) return;

    const groupToUpdate = originalGroups.find(g => g.id === selectedGroup.id);

    // Optimistic UI update
    const updatedGroup = groupToUpdate ? { ...groupToUpdate, clientIds: groupToUpdate.clientIds.filter(id => id !== clientId) } : null;
    const updatedGroups = updatedGroup ? originalGroups.map(g => g.id === updatedGroup.id ? updatedGroup : g) : originalGroups;

    setGroups(updatedGroups);

    // Persist
    try {
      if (updatedGroup) await groupService.upsert(updatedGroup);
    } catch(err: any) {
      alert("Erro ao remover cliente do grupo: " + err.message);
      setGroups(originalGroups);
    }
  };

  const runAiAnalysis = async (client: Client) => {
    setAnalyzingClientId(client.id);
    const stats = calculateClientProfitability(client, tasks, areaCosts, staff);
    const analysisResult = await analyzeClientWithAI(client, stats);
    const updatedClients = clients.map(c => 
      c.id === client.id ? { ...c, aiAnalysisCache: analysisResult } : c
    );
    setClients(updatedClients);
    setAnalyzingClientId(null);
  };

  const handleNewFeeChange = (clientId: string, value: string) => {
    setNewFees(prev => ({ ...prev, [clientId]: parseFloat(value) || 0 }));
  };

  const handleSaveFees = async () => {
    setIsSaving(true);
    const clientsToUpdate = groupClients.filter(c => newFees[c.id] !== undefined && newFees[c.id] > 0);
    
    try {
      for (const client of clientsToUpdate) {
        await clientService.upsert({ ...client, monthlyFee: newFees[c.id] });
      }
      const updatedClients = clients.map(c => newFees[c.id] ? { ...c, monthlyFee: newFees[c.id] } : c);
      setClients(updatedClients);
      setNewFees({});
      alert(`${clientsToUpdate.length} avenças foram atualizadas com sucesso!`);
    } catch (err: any) {
      alert("Falha ao gravar as alterações: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const availableClientsForModal = clients.filter(c => {
    // Show clients that are not already in the currently selected group
    const inThisGroup = selectedGroup?.clientIds.includes(c.id);
    if (inThisGroup) return false;

    const searchMatch = (c.name.toLowerCase().includes(addClientSearch.toLowerCase()) || c.nif.includes(addClientSearch));
    
    const staffFilterSelection = staff.find(s => s.id === addClientStaffFilter);
    const staffMatch = addClientStaffFilter === 'all' 
      || (staffFilterSelection && (c.responsibleStaff === staffFilterSelection.id || c.responsibleStaff === staffFilterSelection.name));

    const entityTypeMatch = addClientEntityTypeFilter === 'all' || c.entityType === addClientEntityTypeFilter;
    return searchMatch && staffMatch && entityTypeMatch;
  });

  // View 1: List of Groups
  if (!selectedGroupId) {
    return (
      <div className="space-y-6 animate-fade-in pb-20">
        <div className="flex justify-between items-center">
          <div>
            <h2 className="text-2xl font-bold text-slate-800">Grupos de Avenças</h2>
            <p className="text-sm text-slate-500">Analise a rentabilidade por tipologia de negócio</p>
          </div>
          <div className="flex gap-2">
            {isAdding ? (
              <div className="flex gap-2 bg-white p-2 border rounded-xl shadow-sm">
                <input 
                  type="text" 
                  value={newGroupName} 
                  onChange={e => setNewGroupName(e.target.value)}
                  placeholder="Ex: Restauração"
                  className="px-3 py-1.5 text-sm outline-none"
                  autoFocus
                />
                <button onClick={handleAddGroup} className="bg-blue-600 text-white px-3 py-1.5 rounded-lg font-bold text-xs uppercase">Criar</button>
                <button onClick={() => setIsAdding(false)} className="text-slate-400 px-2 text-xs">X</button>
              </div>
            ) : (
              <button onClick={() => setIsAdding(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 font-bold shadow-sm">
                <Plus size={18}/> Novo Grupo
              </button>
            )}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {groups.map(group => {
            const gClients = clients.filter(c => c.groupId === group.id);
            const totalRev = gClients.reduce((acc, c) => acc + c.monthlyFee, 0);
            return (
              <div 
                key={group.id} 
                onClick={() => setSelectedGroupId(group.id)}
                className="bg-white rounded-2xl shadow-sm border border-slate-100 overflow-hidden hover:shadow-lg transition-all cursor-pointer group/card border-b-4 border-b-blue-500"
              >
                <div className="p-5 border-b border-slate-50 bg-slate-50/50 flex justify-between items-center">
                  <div className="flex items-center gap-3">
                    <div className="p-2 bg-blue-100 rounded-lg text-blue-600">
                      <FolderOpen size={20}/>
                    </div>
                    <h3 className="font-bold text-slate-800">{group.name}</h3>
                  </div>
                  <ChevronRight size={18} className="text-slate-300 group-hover/card:translate-x-1 transition-transform" />
                </div>
                <div className="p-5">
                  <div className="grid grid-cols-2 gap-4">
                    <div className="p-3 bg-slate-50 rounded-xl text-center">
                      <p className="text-[10px] font-bold text-slate-400 uppercase">Clientes</p>
                      <p className="text-xl font-black text-slate-700">{gClients.length}</p>
                    </div>
                    <div className="p-3 bg-blue-50 rounded-xl text-center">
                      <p className="text-[10px] font-bold text-blue-400 uppercase">Receita</p>
                      <p className="text-xl font-black text-blue-600">{totalRev.toFixed(0)}€</p>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const isAvençasGroup = selectedGroup?.name.toLowerCase().includes('avenças');
  // View 2: Group Workspace (Detail)
  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <div className="flex items-center justify-between sticky top-0 bg-slate-50 py-4 z-10 border-b border-slate-200">
        <div className="flex items-center gap-4">
          <button onClick={() => setSelectedGroupId(null)} className="p-2 hover:bg-slate-200 rounded-full transition-colors">
            <ArrowLeft size={20} className="text-slate-600" />
          </button>
          <div>
            <h2 className="text-2xl font-bold text-slate-800">Workspace: {selectedGroup?.name}</h2>
            <p className="text-sm text-slate-500">Gestão de Rentabilidade e Otimização de Avenças</p>
          </div>
        </div>
        
        <div className="flex items-center gap-3">
          <button onClick={() => setIsAddClientModalOpen(true)} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2">
            <UserPlus size={16} /> Adicionar Clientes
          </button>
        </div>
      </div>

      {isAvençasGroup ? (
        <>
          <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-[10px] text-slate-400 uppercase bg-slate-50 font-black tracking-widest">
                  <tr>
                    <th className="px-6 py-4">Cliente (NIF, Nome)</th>
                    <th className="px-4 py-4">Email / Telefone</th>
                    <th className="px-4 py-4 text-center">Avença Atual (€)</th>
                    <th className="px-4 py-4 text-center">Avença Sugerida IA (€)</th>
                    <th className="px-4 py-4 text-center">Nova Avença (€)</th>
                    <th className="px-6 py-4 text-right">Ações</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-50">
                  {groupClients.length === 0 ? (
                    <tr><td colSpan={6} className="px-6 py-20 text-center text-slate-400 italic">Nenhum cliente neste grupo.</td></tr>
                  ) : (
                    groupClients.map(client => (
                      <tr key={client.id} className="hover:bg-slate-50/80 transition-colors">
                        <td className="px-6 py-4">
                          <div className="font-bold text-slate-800 truncate max-w-[180px]">{client.name}</div>
                          <div className="text-[10px] text-slate-400 font-medium">{client.nif}</div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="text-slate-600 text-xs">{client.email}</div>
                          <div className="text-[10px] text-slate-400">{client.phone}</div>
                        </td>
                        <td className="px-4 py-4 text-center font-bold text-slate-700">{client.monthlyFee.toFixed(2)}€</td>
                        <td className="px-4 py-4 text-center">
                          {client.aiAnalysisCache ? (
                            <span className="font-bold text-indigo-600">{client.aiAnalysisCache.avenca_sugerida.toFixed(0)}€</span>
                          ) : (
                            <button onClick={() => runAiAnalysis(client)} disabled={analyzingClientId === client.id} className="text-indigo-600 bg-indigo-50 px-2 py-1 rounded-md text-[10px] font-bold hover:bg-indigo-100">
                              {analyzingClientId === client.id ? <RefreshCcw size={12} className="animate-spin mx-auto"/> : 'Analisar'}
                            </button>
                          )}
                        </td>
                        <td className="px-4 py-4 text-center">
                          <input type="number" placeholder={client.monthlyFee.toFixed(0)} value={newFees[client.id] || ''} onChange={(e) => handleNewFeeChange(client.id, e.target.value)} className="w-24 text-center border-slate-200 rounded-lg py-1 font-bold text-blue-600 focus:ring-blue-500" />
                        </td>
                        <td className="px-6 py-4 text-right">
                           <button onClick={() => onSelectClient(client)} className="text-slate-400 hover:text-blue-600 p-1" title="Ver Detalhes do Cliente"><Activity size={16}/></button>
                           <button onClick={() => handleRemoveClientFromGroup(client.id)} className="text-slate-300 hover:text-red-500 p-1" title="Remover do grupo"><XCircle size={16}/></button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
          <div className="flex justify-end gap-3">
            <button onClick={handleSaveFees} disabled={isSaving || Object.keys(newFees).length === 0} className="bg-slate-900 text-white px-8 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-black transition-all shadow-lg disabled:opacity-50 disabled:cursor-not-allowed">
              {isSaving ? <RefreshCcw size={18} className="animate-spin"/> : <Save size={18}/>} Gravar Novas Avenças
            </button>
          </div>
        </>
      ) : (
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-500 uppercase bg-slate-50 font-bold">
                <tr>
                  <th className="px-6 py-3">NIF</th>
                  <th className="px-6 py-3">Nome</th>
                  <th className="px-6 py-3">Email / Telefone</th>
                  <th className="px-6 py-3">Tipo</th>
                  <th className="px-6 py-3">Responsável</th>
                  <th className="px-6 py-3 text-right">Ações</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {groupClients.length === 0 ? (
                  <tr><td colSpan={6} className="px-6 py-20 text-center text-slate-400 italic">Nenhum cliente neste grupo.</td></tr>
                ) : (
                  groupClients.map(client => {
                    let responsibleName = 'Não atribuído';
                    if (client.responsibleStaff) {
                      // Check if it's a UUID (contains hyphen) or a name
                      if (client.responsibleStaff.includes('-')) {
                        const staffMember = staff.find(s => s.id === client.responsibleStaff);
                        responsibleName = staffMember ? staffMember.name : 'Desconhecido';
                      } else {
                        responsibleName = client.responsibleStaff;
                      }
                    }
                    return (
                      <tr key={client.id} className="hover:bg-slate-50/80">
                        <td className="px-6 py-4 font-mono text-xs">{client.nif}</td>
                        <td className="px-6 py-4 font-bold text-slate-800">{client.name}</td>
                        <td className="px-6 py-4">
                          <div className="text-slate-600 text-xs">{client.email}</div>
                          <div className="text-[10px] text-slate-400">{client.phone}</div>
                        </td>
                        <td className="px-6 py-4 text-xs uppercase">{client.entityType}</td>
                        <td className="px-6 py-4 text-xs">{responsibleName}</td>
                        <td className="px-6 py-4 text-right">
                          <button onClick={() => handleRemoveClientFromGroup(client.id)} className="text-slate-300 hover:text-red-500 p-1" title="Remover do grupo">
                            <XCircle size={16}/>
                          </button>
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Modal to Add Clients */}
      {isAddClientModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl flex flex-col max-h-[90vh]">
            <div className="p-6 border-b flex justify-between items-start">
              <div>
                <h3 className="text-xl font-bold">Adicionar Clientes ao Grupo: {selectedGroup?.name}</h3>
                <p className="text-sm text-slate-500">Selecione os clientes que deseja incluir neste grupo.</p>
              </div>
              <button onClick={() => setIsAddClientModalOpen(false)} className="text-slate-400 hover:text-slate-600"><X size={20}/></button>
            </div>
            
            <div className="p-4 border-b grid grid-cols-1 md:grid-cols-3 gap-3">
              <div className="relative md:col-span-1">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={16} />
                <input type="text" placeholder="Filtrar por nome ou NIF..." value={addClientSearch} onChange={e => setAddClientSearch(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm" />
              </div>
              <div className="relative md:col-span-2 flex gap-3">
                <Filter size={16} className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" />
                <select 
                  value={addClientStaffFilter} 
                  onChange={e => setAddClientStaffFilter(e.target.value)}
                  className="w-full pl-8 pr-4 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                >
                  <option value="all">Todos os Responsáveis</option>
                  {staff.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
                <select 
                  value={addClientEntityTypeFilter} 
                  onChange={e => setAddClientEntityTypeFilter(e.target.value)}
                  className="w-full pl-8 pr-4 py-2 border border-slate-200 rounded-lg text-sm bg-white"
                >
                  <option value="all">Todos os Tipos</option>
                  {uniqueEntityTypes.map(type => <option key={type} value={type}>{type}</option>)}
                </select>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0">
                  <tr>
                    <th className="px-4 py-3 w-12">
                      <input 
                        type="checkbox"
                        className="rounded"
                        onChange={() => {
                          if (clientsToAdd.length === availableClientsForModal.length) {
                            setClientsToAdd([]);
                          } else {
                            setClientsToAdd(availableClientsForModal.map(c => c.id));
                          }
                        }}
                        checked={availableClientsForModal.length > 0 && clientsToAdd.length === availableClientsForModal.length}
                      />
                    </th>
                    <th className="px-4 py-3">NIF</th>
                    <th className="px-4 py-3">Nome</th>
                    <th className="px-4 py-3">Email / Telefone</th>
                    <th className="px-4 py-3">Tipo</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {availableClientsForModal.map(client => (
                    <tr key={client.id} className="hover:bg-slate-50">
                      <td className="px-4 py-3"><input type="checkbox" className="rounded" checked={clientsToAdd.includes(client.id)} onChange={() => { setClientsToAdd(prev => prev.includes(client.id) ? prev.filter(id => id !== client.id) : [...prev, client.id]); }} /></td>
                      <td className="px-4 py-3 font-mono text-xs">{client.nif}</td>
                      <td className="px-4 py-3 font-bold text-slate-800">{client.name}</td>
                      <td className="px-4 py-3"><div className="text-slate-600 text-xs">{client.email}</div><div className="text-[10px] text-slate-400">{client.phone}</div></td>
                      <td className="px-4 py-3 text-xs uppercase">{client.entityType}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {availableClientsForModal.length === 0 && <p className="text-center text-slate-400 italic py-10">Nenhum cliente disponível para adicionar.</p>}
            </div>

            <div className="p-6 border-t flex justify-between items-center">
              <span className="text-sm font-medium text-slate-600">{clientsToAdd.length} cliente(s) selecionado(s)</span>
              <div className="flex gap-3"><button onClick={() => setIsAddClientModalOpen(false)} className="px-4 py-2 text-slate-500">Cancelar</button><button onClick={handleAddMultipleClientsToGroup} disabled={clientsToAdd.length === 0} className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold disabled:opacity-50">Adicionar Selecionados</button></div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default FeeGroups;
