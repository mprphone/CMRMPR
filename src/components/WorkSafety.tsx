import React, { useState, useMemo } from 'react';
import { WorkSafetyService, Client } from '../types';
import { workSafetyService } from '../services/supabase';
import { HeartPulse, Plus, X, Save, RefreshCcw, Trash2, Edit2, Search, CheckCircle, Circle, FileCheck, FileClock, FileX, Paperclip } from 'lucide-react';

interface WorkSafetyProps {
  services: WorkSafetyService[];
  setServices: (services: WorkSafetyService[]) => void;
  clients: Client[];
}

const WorkSafety: React.FC<WorkSafetyProps> = ({ services, setServices, clients }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<Partial<WorkSafetyService> | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Get clients with employees, this is our main list
  const clientsWithEmployees = useMemo(() => {
    return clients
      .filter(c => c.employeeCount > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clients]);

  // Create a map of client ID to their latest service for efficient lookup.
  const latestServicesMap = useMemo(() => {
    const map = new Map<string, WorkSafetyService>();
    // Sort services by date descending to easily find the latest
    const sortedServices = [...services].sort((a, b) => new Date(b.serviceDate).getTime() - new Date(a.serviceDate).getTime());
    
    for (const service of sortedServices) {
        if (!map.has(service.clientId)) {
            map.set(service.clientId, service);
        }
    }
    return map;
  }, [services]);

  // Combine clients and their latest service for display
  const displayList = useMemo(() => {
    return clientsWithEmployees.map(client => {
        const service = latestServicesMap.get(client.id);
        return {
            client,
            service // this will be undefined if no service exists
        };
    });
  }, [clientsWithEmployees, latestServicesMap]);

  const filteredDisplayList = useMemo(() => {
    return displayList.filter(item => 
      searchTerm === '' ||
      item.client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.client.nif.includes(searchTerm) ||
      item.service?.provider?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [displayList, searchTerm]);

  const handleOpenModal = (service?: Partial<WorkSafetyService>, clientId?: string) => {
    setEditingService(service || {
      clientId: clientId, // Pre-fill client ID if adding for a specific client
      serviceDate: new Date().toISOString().split('T')[0],
      renewalTerm: 'Anual',
      proposalStatus: 'Não enviada',
      hasCommission: false,
      isCommissionPaid: false,
      totalValue: 0,
    });
    setSelectedFile(null);
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingService || !editingService.clientId || !editingService.provider) {
      alert("Cliente e Fornecedor são obrigatórios.");
      return;
    }
    setIsSaving(true);
    try {
      const serviceId = editingService.id || crypto.randomUUID();
      let attachmentUrl = editingService.attachment_url;

      if (selectedFile) {
        attachmentUrl = await workSafetyService.uploadAttachment(selectedFile, serviceId);
      }

      // When saving, we need to ensure the clientName is populated for the UI
      const client = clients.find(c => c.id === editingService.clientId);
      const serviceToSave = { ...editingService, id: serviceId, attachment_url: attachmentUrl, clientName: client?.name };
      
      const savedService = await workSafetyService.upsert(serviceToSave);
      
      if (editingService.id) {
        setServices(services.map(s => s.id === savedService.id ? savedService : s));
      } else {
        setServices([savedService, ...services]);
      }
      setIsModalOpen(false);
    } catch (err: any) {
      alert("Erro ao salvar o serviço de SHT: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm("Tem a certeza que deseja apagar este registo de SHT?")) {
      try {
        await workSafetyService.delete(id);
        setServices(services.filter(s => s.id !== id));
      } catch (err: any) {
        alert("Erro ao apagar o registo: " + err.message);
      }
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Aceite': return <FileCheck size={14} />;
      case 'Recusada': return <FileX size={14} />;
      case 'Enviada': return <FileClock size={14} />;
      default: return <Circle size={14} />; // 'Não enviada'
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Aceite': return 'bg-green-100 text-green-700';
      case 'Recusada': return 'bg-red-100 text-red-700';
      case 'Enviada': return 'bg-yellow-100 text-yellow-700';
      default: return 'bg-gray-100 text-gray-600'; // 'Não enviada'
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Segurança e Higiene no Trabalho (SHT)</h2>
          <p className="text-sm text-slate-500">Gestão de serviços de SHT para clientes com funcionários.</p>
        </div>
        <button onClick={() => handleOpenModal()} className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 font-bold shadow-sm">
          <Plus size={18}/> Novo Registo SHT
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-4 border-b">
            <div className="relative max-w-sm">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={16} />
                <input type="text" placeholder="Pesquisar cliente, NIF ou fornecedor..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm" />
            </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50">
              <tr>
                <th className="px-4 py-3">Cliente (NIF)</th>
                <th className="px-4 py-3 text-center">Nº Func.</th>
                <th className="px-4 py-3 text-center">Tem SHT?</th>
                <th className="px-4 py-3">Fornecedor</th>
                <th className="px-4 py-3 text-center">Data Serviço</th>
                <th className="px-4 py-3 text-center">Renovação</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3 text-center">Comissão</th>
                <th className="px-4 py-3 text-center">Proposta</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredDisplayList.map(({ client, service }) => (
                <tr key={client.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="font-bold text-slate-800">{client.name}</div>
                    <div className="text-xs text-slate-400 font-mono">{client.nif}</div>
                  </td>
                  <td className="px-4 py-3 text-center font-medium">{client.employeeCount}</td>
                  <td className="px-4 py-3 text-center">
                    {service ? (
                      <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full bg-green-100 text-green-700">
                        <CheckCircle size={14}/> Sim
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full bg-red-100 text-red-700">
                        <X size={14}/> Não
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3">{service?.provider || '-'}</td>
                  <td className="px-4 py-3 text-center text-xs">{service ? new Date(service.serviceDate).toLocaleDateString('pt-PT') : '-'}</td>
                  <td className="px-4 py-3 text-center text-xs">{service?.renewalTerm || '-'}</td>
                  <td className="px-4 py-3 text-right font-medium">{service ? `${service.totalValue.toFixed(2)}€` : '-'}</td>
                  <td className="px-4 py-3 text-center">
                    {service ? (
                      <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${service.isCommissionPaid ? 'bg-green-100 text-green-700' : service.hasCommission ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                        {service.isCommissionPaid ? <CheckCircle size={14}/> : <Circle size={14}/>}
                        {service.hasCommission ? (service.isCommissionPaid ? 'Paga' : 'Pendente') : 'Não'}
                      </span>
                    ) : '-'}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {service ? (
                      <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${getStatusColor(service.proposalStatus)}`}>
                        {getStatusIcon(service.proposalStatus)}
                        {service.proposalStatus}
                      </span>
                    ) : '-'}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {service ? (
                      <>
                        {service.attachment_url && (
                          <a href={service.attachment_url} target="_blank" rel="noopener noreferrer" title="Ver Anexo" className="p-2 text-slate-400 hover:text-blue-600 inline-block">
                            <Paperclip size={14}/>
                          </a>
                        )}
                        <button onClick={() => handleOpenModal(service)} className="p-2 text-slate-400 hover:text-blue-600"><Edit2 size={14}/></button>
                        <button onClick={() => handleDelete(service.id)} className="p-2 text-slate-400 hover:text-red-600"><Trash2 size={14}/></button>
                      </>
                    ) : (
                      <button onClick={() => handleOpenModal(undefined, client.id)} className="text-xs bg-blue-50 text-blue-600 font-bold px-3 py-1 rounded-md hover:bg-blue-100">
                        Adicionar
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {filteredDisplayList.length === 0 && (<tr><td colSpan={10} className="text-center italic text-slate-400 py-10">Nenhum cliente com funcionários encontrado.</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && editingService && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form onSubmit={handleSave} className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 space-y-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">{editingService.id ? 'Editar Registo SHT' : 'Novo Registo SHT'}</h3>
              <button type="button" onClick={() => setIsModalOpen(false)}><X size={20} /></button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Cliente*</label>
                <select required value={editingService.clientId || ''} onChange={e => setEditingService({...editingService, clientId: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
                  <option value="" disabled>Selecione um cliente com funcionários</option>
                  {clientsWithEmployees.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Fornecedor*</label>
                <input type="text" required value={editingService.provider || ''} onChange={e => setEditingService({...editingService, provider: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Data do Serviço*</label>
                <input type="date" required value={editingService.serviceDate} onChange={e => setEditingService({...editingService, serviceDate: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Prazo Renovação</label>
                <select value={editingService.renewalTerm} onChange={e => setEditingService({...editingService, renewalTerm: e.target.value as any})} className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
                  <option>Anual</option>
                  <option>Bi-anual</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Valor Total (€)</label>
                <input type="number" step="0.01" value={editingService.totalValue} onChange={e => setEditingService({...editingService, totalValue: parseFloat(e.target.value) || 0})} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Estado da Proposta</label>
                <select value={editingService.proposalStatus} onChange={e => setEditingService({...editingService, proposalStatus: e.target.value as any})} className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
                  <option>Não enviada</option>
                  <option>Enviada</option>
                  <option>Aceite</option>
                  <option>Recusada</option>
                </select>
              </div>
              <div className="md:col-span-2 flex items-center gap-6 pt-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editingService.hasCommission} onChange={e => setEditingService({...editingService, hasCommission: e.target.checked})} className="rounded" />
                  Recebe Comissão?
                </label>
                {editingService.hasCommission && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={editingService.isCommissionPaid} onChange={e => setEditingService({...editingService, isCommissionPaid: e.target.checked})} className="rounded" />
                    Comissão Paga?
                  </label>
                )}
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-slate-500 mb-1">Anexo (Proposta/Contrato)</label>
                <input
                  type="file"
                  onChange={(e) => setSelectedFile(e.target.files ? e.target.files[0] : null)}
                  className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                {editingService.attachment_url && !selectedFile && (
                  <div className="mt-2 text-xs">
                    Ficheiro atual: <a href={editingService.attachment_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{editingService.attachment_url.split('/').pop()}</a>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">Cancelar</button>
              <button type="submit" disabled={isSaving} className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 disabled:opacity-50">
                {isSaving ? <RefreshCcw size={16} className="animate-spin" /> : <Save size={16} />} Salvar
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};

export default WorkSafety;