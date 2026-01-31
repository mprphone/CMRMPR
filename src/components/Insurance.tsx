import React, { useState, useMemo } from 'react';
import { InsurancePolicy, Client } from '../types';
import { insuranceService } from '../services/supabase';
import { Shield, Plus, X, Save, RefreshCcw, Trash2, Edit2, Search, Filter, CheckCircle, Circle, FileCheck, FileClock, Paperclip } from 'lucide-react';

interface InsuranceProps {
  policies: InsurancePolicy[];
  setPolicies: (policies: InsurancePolicy[]) => void;
  clients: Client[];
}

const Insurance: React.FC<InsuranceProps> = ({ policies, setPolicies, clients }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<Partial<InsurancePolicy> | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [providerFilter, setProviderFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [policyStatusFilter, setPolicyStatusFilter] = useState('all');

  const uniqueProviders = useMemo(() => {
    const providers = new Set(policies.map(p => p.insuranceProvider).filter(Boolean));
    return Array.from(providers) as string[];
  }, [policies]);

  const sortedClients = useMemo(() => {
    return [...clients].sort((a, b) => a.name.localeCompare(b.name));
  }, [clients]);

  const filteredPolicies = useMemo(() => {
    return policies.filter(p => {
      const searchMatch = searchTerm === '' ||
        p.clientName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        p.policyNumber?.toLowerCase().includes(searchTerm.toLowerCase());
      
      const providerMatch = providerFilter === 'all' || p.insuranceProvider === providerFilter;
      
      const statusMatch = statusFilter === 'all' ||
        (statusFilter === 'paid' && p.commissionPaid) ||
        (statusFilter === 'pending' && !p.commissionPaid);
      
      const policyStatusMatch = policyStatusFilter === 'all' || p.status === policyStatusFilter;

      return searchMatch && providerMatch && statusMatch && policyStatusMatch;
    });
  }, [policies, searchTerm, providerFilter, statusFilter, policyStatusFilter]);

  const totals = useMemo(() => {
    let pending = 0;
    let paid = 0;
    // Only calculate totals for accepted policies
    const acceptedPolicies = policies.filter(p => p.status === 'Aceite');
    acceptedPolicies.forEach(p => {
      const commissionValue = (p.premiumValue * p.commissionRate) / 100;
      if (p.commissionPaid) {
        paid += commissionValue;
      } else {
        pending += commissionValue;
      }
    });
    return { pending, paid };
  }, [policies]);

  const handleOpenModal = (policy?: InsurancePolicy) => {
    setEditingPolicy(policy || {
      policyDate: new Date().toISOString().split('T')[0],
      paymentFrequency: 'Anual',
      status: 'Proposta',
      commissionPaid: false,
      commissionRate: 10,
      premiumValue: 0,
    });
    setSelectedFile(null);
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPolicy || !editingPolicy.clientId || !editingPolicy.policyType) {
      alert("Cliente e Tipo de Seguro são obrigatórios.");
      return;
    }
    setIsSaving(true);
    try {
      const policyId = editingPolicy.id || crypto.randomUUID();
      let attachmentUrl = editingPolicy.attachment_url;

      if (selectedFile) {
        attachmentUrl = await insuranceService.uploadAttachment(selectedFile, policyId);
      }

      const policyToSave = { ...editingPolicy, id: policyId, attachment_url: attachmentUrl };

      const savedPolicy = await insuranceService.upsert(policyToSave);
      
      if (editingPolicy.id) {
        setPolicies(policies.map(p => p.id === savedPolicy.id ? savedPolicy : p));
      } else {
        setPolicies([savedPolicy, ...policies]);
      }
      setIsModalOpen(false);
    } catch (err: any) {
      alert("Erro ao salvar a apólice: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm("Tem a certeza que deseja apagar esta apólice?")) {
      try {
        await insuranceService.delete(id);
        setPolicies(policies.filter(p => p.id !== id));
      } catch (err: any) {
        alert("Erro ao apagar a apólice: " + err.message);
      }
    }
  };

  const toggleCommissionStatus = async (policy: InsurancePolicy) => {
    const updatedPolicy = { ...policy, commissionPaid: !policy.commissionPaid };
    // Optimistic update
    setPolicies(policies.map(p => p.id === policy.id ? updatedPolicy : p));
    try {
      await insuranceService.upsert(updatedPolicy);
    } catch (err: any) {
      alert("Erro ao atualizar o estado da comissão.");
      // Revert on failure
      setPolicies(policies.map(p => p.id === policy.id ? policy : p));
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Gestão de Seguros</h2>
          <p className="text-sm text-slate-500">Controle as apólices e comissões dos seus clientes.</p>
        </div>
        <button onClick={() => handleOpenModal()} className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 font-bold shadow-sm">
          <Plus size={18}/> Adicionar Seguro
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <p className="text-sm font-medium text-amber-600">Comissões Pendentes</p>
          <h3 className="text-2xl font-bold text-slate-800 mt-1">{totals.pending.toFixed(2)}€</h3>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <p className="text-sm font-medium text-green-600">Comissões Recebidas (Total)</p>
          <h3 className="text-2xl font-bold text-slate-800 mt-1">{totals.paid.toFixed(2)}€</h3>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-4 border-b grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={16} />
                <input type="text" placeholder="Pesquisar cliente ou apólice..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm" />
            </div>
            <select value={providerFilter} onChange={e => setProviderFilter(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
                <option value="all">Todas as Seguradoras</option>
                {uniqueProviders.map(p => <option key={p} value={p}>{p}</option>)}
            </select>
            <select value={policyStatusFilter} onChange={e => setPolicyStatusFilter(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
                <option value="all">Todos os Estados da Apólice</option>
                <option value="Proposta">Proposta</option>
                <option value="Aceite">Aceite</option>
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
                <option value="all">Todos os Estados</option>
                <option value="paid">Paga</option>
                <option value="pending">Pendente</option>
            </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50">
              <tr>
                <th className="px-4 py-3">Cliente / Apólice</th>
                <th className="px-4 py-3 text-center">Estado</th>
                <th className="px-4 py-3">Tipo de Seguro</th>
                <th className="px-4 py-3">Seguradora</th>
                <th className="px-4 py-3 text-right">Prémio</th>
                <th className="px-4 py-3 text-right">Comissão</th>
                <th className="px-4 py-3 text-center">Estado Comissão</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {filteredPolicies.map(p => {
                const commissionValue = (p.premiumValue * p.commissionRate) / 100;
                return (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-800">{p.clientName}</div>
                      <div className="text-xs text-slate-400 font-mono">{p.policyNumber}</div>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${p.status === 'Aceite' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {p.status === 'Aceite' ? <FileCheck size={14}/> : <FileClock size={14}/>}
                        {p.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-medium">{p.policyType}</td>
                    <td className="px-4 py-3 text-xs">{p.insuranceProvider}</td>
                    <td className="px-4 py-3 text-right font-medium">{p.premiumValue.toFixed(2)}€</td>
                    <td className="px-4 py-3 text-right font-bold text-blue-600">{commissionValue.toFixed(2)}€</td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => toggleCommissionStatus(p)} className={`flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${p.commissionPaid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                        {p.commissionPaid ? <CheckCircle size={14}/> : <Circle size={14}/>}
                        {p.commissionPaid ? 'Paga' : 'Pendente'}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-right">
                      {p.attachment_url && (
                        <a href={p.attachment_url} target="_blank" rel="noopener noreferrer" title="Ver Anexo" className="p-2 text-slate-400 hover:text-blue-600 inline-block">
                          <Paperclip size={14}/>
                        </a>
                      )}
                      <button onClick={() => handleOpenModal(p)} className="p-2 text-slate-400 hover:text-blue-600"><Edit2 size={14}/></button>
                      <button onClick={() => handleDelete(p.id)} className="p-2 text-slate-400 hover:text-red-600"><Trash2 size={14}/></button>
                    </td>
                  </tr>
                );
              })}
              {filteredPolicies.length === 0 && (<tr><td colSpan={8} className="text-center italic text-slate-400 py-10">Nenhuma apólice encontrada.</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {isModalOpen && editingPolicy && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form onSubmit={handleSave} className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 space-y-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">{editingPolicy.id ? 'Editar Apólice' : 'Nova Apólice de Seguro'}</h3>
              <button type="button" onClick={() => setIsModalOpen(false)}><X size={20} /></button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Cliente*</label>
                <select required value={editingPolicy.clientId || ''} onChange={e => setEditingPolicy({...editingPolicy, clientId: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
                  <option value="" disabled>Selecione um cliente</option>
                  {sortedClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Data da Apólice*</label>
                <input type="date" required value={editingPolicy.policyDate} onChange={e => setEditingPolicy({...editingPolicy, policyDate: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Nº da Apólice</label>
                <input type="text" value={editingPolicy.policyNumber || ''} onChange={e => setEditingPolicy({...editingPolicy, policyNumber: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Seguradora</label>
                <input type="text" list="providers" value={editingPolicy.insuranceProvider || ''} onChange={e => setEditingPolicy({...editingPolicy, insuranceProvider: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm" />
                <datalist id="providers">
                  <option value="Finiconde" />
                  <option value="Neo Seguros" />
                  <option value="Outras" />
                  {uniqueProviders.map(p => <option key={p} value={p} />)}
                </datalist>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Estado da Apólice*</label>
                <select required value={editingPolicy.status || 'Proposta'} onChange={e => setEditingPolicy({...editingPolicy, status: e.target.value as any})} className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
                  <option value="Proposta">Proposta</option>
                  <option value="Aceite">Aceite</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Tipo de Seguro*</label>
                <input type="text" required value={editingPolicy.policyType || ''} onChange={e => setEditingPolicy({...editingPolicy, policyType: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Ex: Acidentes de Trabalho"/>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Pagamento</label>
                <select value={editingPolicy.paymentFrequency} onChange={e => setEditingPolicy({...editingPolicy, paymentFrequency: e.target.value as any})} className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
                  <option>Anual</option>
                  <option>Semestral</option>
                  <option>Trimestral</option>
                  <option>Mensal</option>
                </select>
              </div>
              <div className="md:col-span-2 grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">Valor do Prémio (€)</label>
                  <input type="number" step="0.01" value={editingPolicy.premiumValue} onChange={e => setEditingPolicy({...editingPolicy, premiumValue: parseFloat(e.target.value) || 0})} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">Taxa de Comissão (%)</label>
                  <input type="number" step="0.1" value={editingPolicy.commissionRate} onChange={e => setEditingPolicy({...editingPolicy, commissionRate: parseFloat(e.target.value) || 0})} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-slate-500 mb-1">Tipo de Comunicação</label>
                <input type="text" value={editingPolicy.communicationType || ''} onChange={e => setEditingPolicy({...editingPolicy, communicationType: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Ex: Via Mediador"/>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-slate-500 mb-1">Anexo (Apólice)</label>
                <input
                  type="file"
                  onChange={(e) => setSelectedFile(e.target.files ? e.target.files[0] : null)}
                  className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                {editingPolicy.attachment_url && !selectedFile && (
                  <div className="mt-2 text-xs">
                    Ficheiro atual: <a href={editingPolicy.attachment_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{editingPolicy.attachment_url.split('/').pop()}</a>
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

export default Insurance;