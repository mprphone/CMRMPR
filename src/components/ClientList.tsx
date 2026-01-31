import React, { useState, useMemo } from 'react';
import { Client, Staff, Task, FeeGroup } from '../types';
import { clientService } from '../services/supabase';
import { Search, Plus, X, CloudCheck, RefreshCcw, ChevronUp, ChevronDown } from 'lucide-react';

interface ClientListProps {
  clients: Client[];
  setClients: (clients: Client[]) => void;
  tasks: Task[];
  areaCosts: Record<string, number>;
  staff: Staff[];
  onSelectClient: (client: Client) => void;
  groups: FeeGroup[];
  onSyncClientsRequest: () => Promise<void>;
}

const ClientList: React.FC<ClientListProps> = ({ clients, setClients, tasks, areaCosts, staff, onSelectClient, groups, onSyncClientsRequest }) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<Partial<Client>>({});
  
  type SortableKeys = keyof Client | 'responsibleStaffName';
  const [sortConfig, setSortConfig] = useState<{ key: SortableKeys; direction: 'ascending' | 'descending' }>({ key: 'name', direction: 'ascending' });

  const processedClients = useMemo(() => {
    const clientsWithStaffNames = clients.map(client => {
      const staffMember = staff.find(s => s.id === client.responsibleStaff);
      return {
        ...client,
        responsibleStaffName: staffMember ? staffMember.name : (client.responsibleStaff || 'Não Atribuído')
      };
    });

    let filtered = clientsWithStaffNames.filter(c => {
      const group = groups.find(g => g.id === groupFilter);
      const matchesSearch = c.name.toLowerCase().includes(searchTerm.toLowerCase()) || c.nif.includes(searchTerm);
      const matchesGroup = groupFilter === 'all' || (group ? group.clientIds.includes(c.id) : false);
      return matchesSearch && matchesGroup;
    });

    if (sortConfig !== null) {
      filtered.sort((a, b) => {
        const aValue = a[sortConfig.key as keyof typeof a];
        const bValue = b[sortConfig.key as keyof typeof b];
        if (aValue < bValue) return sortConfig.direction === 'ascending' ? -1 : 1;
        if (aValue > bValue) return sortConfig.direction === 'ascending' ? 1 : -1;
        return 0;
      });
    }
    
    return filtered;
  }, [clients, staff, searchTerm, groupFilter, sortConfig, groups]);

  const requestSort = (key: SortableKeys) => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    try {
      const clientToSave = {
        ...formData,
        id: editingClient?.id || crypto.randomUUID(),
        status: formData.status || 'Ativo',
        tasks: formData.tasks || [],
        contractRenewalDate: formData.contractRenewalDate || new Date().toISOString().split('T')[0]
      } as Client;
      
      const saved = await clientService.upsert(clientToSave);
      setClients(editingClient ? clients.map(c => c.id === saved.id ? saved : c) : [...clients, saved]);
      setIsModalOpen(false);
    } catch (err) { alert("Erro ao sincronizar com Supabase."); }
    finally { setIsSaving(false); }
  };

  const SortableHeader = ({ children, sortKey }: { children: React.ReactNode, sortKey: SortableKeys }) => {
    const isSorted = sortConfig?.key === sortKey;
    return (
        <th className="px-4 py-3 cursor-pointer hover:bg-slate-100 transition-colors" onClick={() => requestSort(sortKey)}>
            <div className="flex items-center gap-1">
                {children}
                {isSorted ? (
                    sortConfig.direction === 'ascending' ? <ChevronUp size={14} /> : <ChevronDown size={14} />
                ) : (
                    <ChevronUp size={14} className="text-slate-300" />
                )}
            </div>
        </th>
    );
  };

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-6 border-b border-slate-100 flex flex-col sm:flex-row justify-between items-center gap-4">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-bold text-slate-800">Carteira de Clientes</h2>
            <div className="flex items-center gap-1 text-[10px] text-blue-600 font-bold bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">
               <CloudCheck size={12} /> SUPABASE SYNC
            </div>
          </div>
          <div className="flex gap-3 w-full sm:w-auto">
            <select 
              value={groupFilter} 
              onChange={e => setGroupFilter(e.target.value)}
              className="px-3 py-2 border border-slate-200 rounded-lg text-xs font-medium focus:ring-2 focus:ring-blue-500 outline-none"
            >
              <option value="all">Todos os Grupos</option>
              {groups.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
            <div className="relative flex-1 sm:w-64">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={18} />
              <input 
                type="text" placeholder="Nome ou NIF..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>
            <button onClick={onSyncClientsRequest} className="bg-green-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-green-700 flex items-center gap-2">
              <RefreshCcw size={16} /> <span className="hidden sm:inline">Sincronizar</span>
            </button>
            <button onClick={() => { setEditingClient(null); setFormData({}); setIsModalOpen(true); }} className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2">
              <Plus size={16} /> <span className="hidden sm:inline">Novo</span>
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left text-slate-600">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50 font-bold">
              <tr>
                <SortableHeader sortKey="nif">NIF</SortableHeader>
                <SortableHeader sortKey="name">Nome</SortableHeader>
                <th className="px-4 py-3">Email / Telefone</th>
                <SortableHeader sortKey="entityType">Tipo</SortableHeader>
                <SortableHeader sortKey="employeeCount">Nº Func.</SortableHeader>
                <SortableHeader sortKey="documentCount">Nº Docs</SortableHeader>
                <SortableHeader sortKey="responsibleStaffName">Responsável</SortableHeader>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {processedClients.map((client) => (
                <tr key={client.id} className="border-b border-slate-50 hover:bg-slate-50/80 transition-colors">
                  <td className="px-4 py-4 font-mono text-xs">{client.nif}</td>
                  <td className="px-4 py-4 font-bold text-slate-800">{client.name}</td>
                  <td className="px-4 py-4">
                    <div className="text-slate-600">{client.email}</div>
                    <div className="text-xs text-slate-400">{client.phone}</div>
                  </td>
                  <td className="px-4 py-4 text-xs uppercase">{client.entityType}</td>
                  <td className="px-4 py-4 text-center font-medium">{client.employeeCount}</td>
                  <td className="px-4 py-4 text-center font-medium">{client.documentCount}</td>
                  <td className="px-4 py-4 text-xs">{client.responsibleStaffName}</td>
                  <td className="px-4 py-4 text-right">
                    <button onClick={() => onSelectClient(client)} className="text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded text-xs font-bold border border-blue-100 transition-colors">
                      Detalhes
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal permanece igual */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 overflow-y-auto max-h-[90vh]">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold">{editingClient ? 'Editar Cliente' : 'Novo Cliente'}</h3>
              <button onClick={() => setIsModalOpen(false)}><X size={20} /></button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div><label className="text-xs font-bold text-slate-400">Nome</label><input required className="w-full p-2 border rounded" value={formData.name || ''} onChange={e => setFormData({...formData, name: e.target.value})} /></div>
                <div><label className="text-xs font-bold text-slate-400">NIF</label><input required className="w-full p-2 border rounded" value={formData.nif || ''} onChange={e => setFormData({...formData, nif: e.target.value})} /></div>
                <div className="col-span-2"><label className="text-xs font-bold text-slate-400">Morada</label><input className="w-full p-2 border rounded" value={formData.address || ''} onChange={e => setFormData({...formData, address: e.target.value})} /></div>
                <div><label className="text-xs font-bold text-slate-400">Tipo de Entidade</label><input className="w-full p-2 border rounded bg-slate-50" value={formData.entityType || ''} onChange={e => setFormData({...formData, entityType: e.target.value})} /></div>
                <div><label className="text-xs font-bold text-slate-400">Avença Mensal</label><input type="number" className="w-full p-2 border rounded" value={formData.monthlyFee || 0} onChange={e => setFormData({...formData, monthlyFee: parseFloat(e.target.value)})} /></div>
              </div>
              <div className="flex justify-end gap-2 pt-4">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-slate-500">Cancelar</button>
                <button type="submit" className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold">
                  {isSaving ? <RefreshCcw className="animate-spin" /> : 'Salvar no Supabase'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default ClientList;