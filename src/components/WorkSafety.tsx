import React, { useState, useMemo } from 'react';
import { WorkSafetyService, Client } from '../types';
import { workSafetyService } from '../services/supabase';
import { HeartPulse, Plus, X, Save, RefreshCcw, Trash2, Edit2, Search, CheckCircle, Circle, FileCheck, FileClock, FileX, Paperclip, AlertTriangle, BellRing } from 'lucide-react';

interface WorkSafetyProps {
  services: WorkSafetyService[];
  setServices: (services: WorkSafetyService[]) => void;
  clients: Client[];
}

type RenewalAlertLevel = 'D-60' | 'D-30' | 'D-7';

interface RenewalAlertItem {
  serviceId: string;
  clientId: string;
  clientName: string;
  daysUntilRenewal: number;
  nextRenewalIso: string;
  level: RenewalAlertLevel;
}

const REQUIRED_SHT_DOCUMENTS: Array<{ key: string; label: string }> = [
  { key: 'sht_contract', label: 'Contrato SHT' },
  { key: 'medical_clearance', label: 'Fichas de aptidao medica' },
  { key: 'risk_assessment', label: 'Avaliacao de riscos' },
  { key: 'payment_proof', label: 'Comprovativo de pagamento' },
];

const createDefaultChecklist = () =>
  REQUIRED_SHT_DOCUMENTS.reduce<Record<string, boolean>>((acc, doc) => {
    acc[doc.key] = false;
    return acc;
  }, {});

const mergeChecklist = (checklist?: Record<string, boolean>) => ({
  ...createDefaultChecklist(),
  ...(checklist || {}),
});

const getChecklistProgress = (checklist?: Record<string, boolean>) => {
  const merged = mergeChecklist(checklist);
  const done = Object.values(merged).filter(Boolean).length;
  const total = Object.keys(merged).length;
  return { done, total };
};

const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

const addMonths = (date: Date, months: number) => {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
};

const getRenewalMonths = (term: WorkSafetyService['renewalTerm']) => {
  if (term === 'Bi-anual') return 24;
  return 12;
};

const getNextRenewalDate = (serviceDate: string, renewalTerm: WorkSafetyService['renewalTerm']) => {
  const start = startOfDay(new Date(serviceDate));
  const today = startOfDay(new Date());
  if (Number.isNaN(start.getTime())) return null;

  const stepMonths = getRenewalMonths(renewalTerm);
  let next = new Date(start);
  while (next < today) {
    next = addMonths(next, stepMonths);
  }
  return next;
};

const getAlertLevel = (daysUntilRenewal: number): RenewalAlertLevel | null => {
  if (daysUntilRenewal < 0 || daysUntilRenewal > 60) return null;
  if (daysUntilRenewal <= 7) return 'D-7';
  if (daysUntilRenewal <= 30) return 'D-30';
  return 'D-60';
};

const getAlertLevelClass = (level: RenewalAlertLevel) => {
  if (level === 'D-7') return 'bg-red-100 text-red-700';
  if (level === 'D-30') return 'bg-amber-100 text-amber-700';
  return 'bg-blue-100 text-blue-700';
};

const WorkSafety: React.FC<WorkSafetyProps> = ({ services, setServices, clients }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingService, setEditingService] = useState<Partial<WorkSafetyService> | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const clientsWithEmployees = useMemo(() => {
    return clients
      .filter(c => c.employeeCount > 0)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clients]);

  const latestServicesMap = useMemo(() => {
    const map = new Map<string, WorkSafetyService>();
    const sortedServices = [...services].sort((a, b) => new Date(b.serviceDate).getTime() - new Date(a.serviceDate).getTime());

    for (const service of sortedServices) {
      if (!map.has(service.clientId)) {
        map.set(service.clientId, service);
      }
    }
    return map;
  }, [services]);

  const displayList = useMemo(() => {
    return clientsWithEmployees.map(client => {
      const service = latestServicesMap.get(client.id);
      return {
        client,
        service,
      };
    });
  }, [clientsWithEmployees, latestServicesMap]);

  const renewalAlerts = useMemo<RenewalAlertItem[]>(() => {
    const today = startOfDay(new Date());

    return displayList
      .filter(item => Boolean(item.service))
      .map(item => {
        const service = item.service!;
        const nextRenewal = getNextRenewalDate(service.serviceDate, service.renewalTerm);
        if (!nextRenewal) return null;

        const daysUntilRenewal = Math.ceil((nextRenewal.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        const level = getAlertLevel(daysUntilRenewal);
        if (!level) return null;

        return {
          serviceId: service.id,
          clientId: item.client.id,
          clientName: item.client.name,
          daysUntilRenewal,
          nextRenewalIso: nextRenewal.toISOString(),
          level,
        };
      })
      .filter((item): item is RenewalAlertItem => item !== null)
      .sort((a, b) => a.daysUntilRenewal - b.daysUntilRenewal);
  }, [displayList]);

  const renewalAlertMap = useMemo(() => {
    const map = new Map<string, RenewalAlertItem>();
    renewalAlerts.forEach(item => map.set(item.serviceId, item));
    return map;
  }, [renewalAlerts]);

  const renewalSummary = useMemo(() => {
    return renewalAlerts.reduce(
      (acc, item) => {
        acc[item.level] += 1;
        return acc;
      },
      { 'D-60': 0, 'D-30': 0, 'D-7': 0 } as Record<RenewalAlertLevel, number>
    );
  }, [renewalAlerts]);

  const filteredDisplayList = useMemo(() => {
    return displayList.filter(item =>
      searchTerm === '' ||
      item.client.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
      item.client.nif.includes(searchTerm) ||
      item.service?.provider?.toLowerCase().includes(searchTerm.toLowerCase())
    );
  }, [displayList, searchTerm]);

  const handleOpenModal = (service?: Partial<WorkSafetyService>, clientId?: string) => {
    setEditingService(
      service
        ? {
            ...service,
            documentChecklist: mergeChecklist(service.documentChecklist),
          }
        : {
            clientId,
            serviceDate: new Date().toISOString().split('T')[0],
            renewalTerm: 'Anual',
            proposalStatus: 'Não enviada',
            hasCommission: false,
            isCommissionPaid: false,
            totalValue: 0,
            documentChecklist: createDefaultChecklist(),
          }
    );
    setSelectedFile(null);
    setIsModalOpen(true);
  };

  const toggleChecklistDocument = (docKey: string, isChecked: boolean) => {
    setEditingService(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        documentChecklist: {
          ...mergeChecklist(prev.documentChecklist),
          [docKey]: isChecked,
        },
      };
    });
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingService || !editingService.clientId || !editingService.provider) {
      alert('Cliente e Fornecedor sao obrigatorios.');
      return;
    }

    setIsSaving(true);
    try {
      const serviceId = editingService.id || crypto.randomUUID();
      let attachmentUrl = editingService.attachment_url;

      if (selectedFile) {
        attachmentUrl = await workSafetyService.uploadAttachment(selectedFile, serviceId);
      }

      const client = clients.find(c => c.id === editingService.clientId);
      const serviceToSave: Partial<WorkSafetyService> = {
        ...editingService,
        id: serviceId,
        attachment_url: attachmentUrl,
        clientName: client?.name,
        documentChecklist: mergeChecklist(editingService.documentChecklist),
      };

      const savedService = await workSafetyService.upsert(serviceToSave);

      if (editingService.id) {
        setServices(services.map(s => (s.id === savedService.id ? savedService : s)));
      } else {
        setServices([savedService, ...services]);
      }
      setIsModalOpen(false);
    } catch (err: any) {
      alert('Erro ao salvar o servico de SHT: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm('Tem a certeza que deseja apagar este registo de SHT?')) {
      try {
        await workSafetyService.delete(id);
        setServices(services.filter(s => s.id !== id));
      } catch (err: any) {
        alert('Erro ao apagar o registo: ' + err.message);
      }
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'Aceite':
        return <FileCheck size={14} />;
      case 'Recusada':
        return <FileX size={14} />;
      case 'Enviada':
        return <FileClock size={14} />;
      default:
        return <Circle size={14} />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'Aceite':
        return 'bg-green-100 text-green-700';
      case 'Recusada':
        return 'bg-red-100 text-red-700';
      case 'Enviada':
        return 'bg-yellow-100 text-yellow-700';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Seguranca e Higiene no Trabalho (SHT)</h2>
          <p className="text-sm text-slate-500">Gestao de servicos SHT com alertas de renovacao e checklist obrigatoria.</p>
        </div>
        <button onClick={() => handleOpenModal()} className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 font-bold shadow-sm">
          <Plus size={18} /> Novo Registo SHT
        </button>
      </div>

      <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <p className="font-bold text-amber-800 flex items-center gap-2">
              <BellRing size={16} /> Alertas de Renovacao SHT (ate 60 dias)
            </p>
            <p className="text-xs text-amber-700 mt-0.5">Niveis automaticos D-60, D-30 e D-7 por cliente.</p>
          </div>
          <div className="flex items-center gap-2 text-xs font-bold">
            <span className="px-2 py-1 rounded-full bg-blue-100 text-blue-700">D-60: {renewalSummary['D-60']}</span>
            <span className="px-2 py-1 rounded-full bg-amber-100 text-amber-700">D-30: {renewalSummary['D-30']}</span>
            <span className="px-2 py-1 rounded-full bg-red-100 text-red-700">D-7: {renewalSummary['D-7']}</span>
          </div>
        </div>
        {renewalAlerts.length > 0 ? (
          <div className="mt-3 grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2">
            {renewalAlerts.slice(0, 9).map(alert => (
              <div key={alert.serviceId} className="bg-white border border-amber-100 rounded-lg px-3 py-2 text-xs flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-bold text-slate-700 truncate">{alert.clientName}</div>
                  <div className="text-slate-500">Renova a {new Date(alert.nextRenewalIso).toLocaleDateString('pt-PT')}</div>
                </div>
                <span className={`inline-flex items-center gap-1 font-bold px-2 py-1 rounded-full ${getAlertLevelClass(alert.level)}`}>
                  <AlertTriangle size={12} /> {alert.level}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-xs text-amber-700 mt-3 italic">Sem renovacoes de SHT nos proximos 60 dias.</p>
        )}
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
                <th className="px-4 py-3 text-center">N. Func.</th>
                <th className="px-4 py-3 text-center">Tem SHT?</th>
                <th className="px-4 py-3">Fornecedor</th>
                <th className="px-4 py-3 text-center">Data Servico</th>
                <th className="px-4 py-3 text-center">Renovacao</th>
                <th className="px-4 py-3 text-center">Alerta</th>
                <th className="px-4 py-3 text-center">Checklist</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3 text-center">Comissao</th>
                <th className="px-4 py-3 text-center">Proposta</th>
                <th className="px-4 py-3 text-right">Acoes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredDisplayList.map(({ client, service }) => {
                const alert = service ? renewalAlertMap.get(service.id) : undefined;
                const checklistProgress = service ? getChecklistProgress(service.documentChecklist) : { done: 0, total: REQUIRED_SHT_DOCUMENTS.length };

                return (
                  <tr key={client.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-800">{client.name}</div>
                      <div className="text-xs text-slate-400 font-mono">{client.nif}</div>
                    </td>
                    <td className="px-4 py-3 text-center font-medium">{client.employeeCount}</td>
                    <td className="px-4 py-3 text-center">
                      {service ? (
                        <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full bg-green-100 text-green-700">
                          <CheckCircle size={14} /> Sim
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full bg-red-100 text-red-700">
                          <X size={14} /> Nao
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">{service?.provider || '-'}</td>
                    <td className="px-4 py-3 text-center text-xs">{service ? new Date(service.serviceDate).toLocaleDateString('pt-PT') : '-'}</td>
                    <td className="px-4 py-3 text-center text-xs">{service?.renewalTerm || '-'}</td>
                    <td className="px-4 py-3 text-center">
                      {alert ? (
                        <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${getAlertLevelClass(alert.level)}`}>
                          <AlertTriangle size={12} /> {alert.level}
                        </span>
                      ) : (
                        <span className="text-xs text-slate-400">-</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-xs font-bold text-slate-600">
                      {service ? `${checklistProgress.done}/${checklistProgress.total}` : '-'}
                    </td>
                    <td className="px-4 py-3 text-right font-medium">{service ? `${service.totalValue.toFixed(2)}EUR` : '-'}</td>
                    <td className="px-4 py-3 text-center">
                      {service ? (
                        <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${service.isCommissionPaid ? 'bg-green-100 text-green-700' : service.hasCommission ? 'bg-amber-100 text-amber-700' : 'bg-gray-100 text-gray-500'}`}>
                          {service.isCommissionPaid ? <CheckCircle size={14} /> : <Circle size={14} />}
                          {service.hasCommission ? (service.isCommissionPaid ? 'Paga' : 'Pendente') : 'Nao'}
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
                              <Paperclip size={14} />
                            </a>
                          )}
                          <button onClick={() => handleOpenModal(service)} className="p-2 text-slate-400 hover:text-blue-600"><Edit2 size={14} /></button>
                          <button onClick={() => handleDelete(service.id)} className="p-2 text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
                        </>
                      ) : (
                        <button onClick={() => handleOpenModal(undefined, client.id)} className="text-xs bg-blue-50 text-blue-600 font-bold px-3 py-1 rounded-md hover:bg-blue-100">
                          Adicionar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {filteredDisplayList.length === 0 && (<tr><td colSpan={12} className="text-center italic text-slate-400 py-10">Nenhum cliente com funcionarios encontrado.</td></tr>)}
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
                <select required value={editingService.clientId || ''} onChange={e => setEditingService({ ...editingService, clientId: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
                  <option value="" disabled>Selecione um cliente com funcionarios</option>
                  {clientsWithEmployees.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Fornecedor*</label>
                <input type="text" required value={editingService.provider || ''} onChange={e => setEditingService({ ...editingService, provider: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Data do Servico*</label>
                <input type="date" required value={editingService.serviceDate} onChange={e => setEditingService({ ...editingService, serviceDate: e.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Prazo Renovacao</label>
                <select value={editingService.renewalTerm} onChange={e => setEditingService({ ...editingService, renewalTerm: e.target.value as WorkSafetyService['renewalTerm'] })} className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
                  <option>Anual</option>
                  <option>Bi-anual</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Valor Total (EUR)</label>
                <input type="number" step="0.01" value={editingService.totalValue} onChange={e => setEditingService({ ...editingService, totalValue: parseFloat(e.target.value) || 0 })} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Estado da Proposta</label>
                <select value={editingService.proposalStatus} onChange={e => setEditingService({ ...editingService, proposalStatus: e.target.value as WorkSafetyService['proposalStatus'] })} className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
                  <option>Não enviada</option>
                  <option>Enviada</option>
                  <option>Aceite</option>
                  <option>Recusada</option>
                </select>
              </div>
              <div className="md:col-span-2 flex items-center gap-6 pt-2">
                <label className="flex items-center gap-2 text-sm">
                  <input type="checkbox" checked={editingService.hasCommission} onChange={e => setEditingService({ ...editingService, hasCommission: e.target.checked })} className="rounded" />
                  Recebe Comissao?
                </label>
                {editingService.hasCommission && (
                  <label className="flex items-center gap-2 text-sm">
                    <input type="checkbox" checked={editingService.isCommissionPaid} onChange={e => setEditingService({ ...editingService, isCommissionPaid: e.target.checked })} className="rounded" />
                    Comissao Paga?
                  </label>
                )}
              </div>
              <div className="md:col-span-2 border rounded-lg p-3 bg-slate-50">
                <p className="text-xs font-bold text-slate-500 mb-2">Checklist de documentos obrigatorios</p>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  {REQUIRED_SHT_DOCUMENTS.map(doc => (
                    <label key={doc.key} className="flex items-center gap-2 text-sm text-slate-700">
                      <input
                        type="checkbox"
                        checked={Boolean(editingService.documentChecklist?.[doc.key])}
                        onChange={e => toggleChecklistDocument(doc.key, e.target.checked)}
                        className="rounded"
                      />
                      {doc.label}
                    </label>
                  ))}
                </div>
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
