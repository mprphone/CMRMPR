import React, { useState, useMemo } from 'react';
import { InsurancePolicy, Client } from '../types';
import { insuranceService } from '../services/supabase';
import { Shield, Plus, X, Save, RefreshCcw, Trash2, Edit2, Search, Filter, CheckCircle, Circle, FileCheck, FileClock, Paperclip, ChevronUp, ChevronDown, PieChart } from 'lucide-react';

interface InsuranceProps {
  policies: InsurancePolicy[];
  setPolicies: (policies: InsurancePolicy[]) => void;
  clients: Client[];
}

type SortableKeys = 'clientName' | 'agent' | 'renewalDate' | 'company' | 'branch' | 'netPremiumValue';

const getCompany = (policy: Partial<InsurancePolicy>) => policy.company || policy.insuranceProvider || '';
const getBranch = (policy: Partial<InsurancePolicy>) => policy.branch || policy.policyType || '';
const getNetPremium = (policy: Partial<InsurancePolicy>) => Number(policy.netPremiumValue ?? policy.premiumValue ?? 0);

const getSortValue = (policy: InsurancePolicy, sortKey: SortableKeys): string | number => {
  switch (sortKey) {
    case 'clientName':
      return policy.clientName || '';
    case 'agent':
      return policy.agent || '';
    case 'renewalDate':
      return policy.renewalDate || '';
    case 'company':
      return getCompany(policy);
    case 'branch':
      return getBranch(policy);
    case 'netPremiumValue':
      return getNetPremium(policy);
    default:
      return '';
  }
};

const Insurance: React.FC<InsuranceProps> = ({ policies, setPolicies, clients }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<Partial<InsurancePolicy> | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [companyFilter, setCompanyFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [policyStatusFilter, setPolicyStatusFilter] = useState('all');
  const [sortConfig, setSortConfig] = useState<{ key: SortableKeys; direction: 'ascending' | 'descending' }>({ key: 'renewalDate', direction: 'ascending' });
  const [isQuarterlyModalOpen, setIsQuarterlyModalOpen] = useState(false);

  const uniqueCompanies = useMemo(() => {
    const companies = new Set(policies.map(policy => getCompany(policy)).filter(Boolean));
    return Array.from(companies) as string[];
  }, [policies]);

  const sortedClients = useMemo(() => {
    return [...clients].sort((a, b) => a.name.localeCompare(b.name));
  }, [clients]);

  const sortedPolicies = useMemo(() => {
    let filtered = policies.filter(p => {
      const search = searchTerm.toLowerCase();
      const searchMatch = searchTerm === '' ||
        p.clientName?.toLowerCase().includes(search) ||
        p.policyNumber?.toLowerCase().includes(search) ||
        getCompany(p).toLowerCase().includes(search) ||
        getBranch(p).toLowerCase().includes(search) ||
        (p.agent || '').toLowerCase().includes(search);
      
      const companyMatch = companyFilter === 'all' || getCompany(p) === companyFilter;
      
      const statusMatch = statusFilter === 'all' ||
        (statusFilter === 'paid' && p.commissionPaid) ||
        (statusFilter === 'pending' && !p.commissionPaid);
      
      const policyStatusMatch = policyStatusFilter === 'all' || p.status === policyStatusFilter;

      return searchMatch && companyMatch && statusMatch && policyStatusMatch;
    });

    if (sortConfig !== null) {
      filtered.sort((a, b) => {
        const aValue = getSortValue(a, sortConfig.key);
        const bValue = getSortValue(b, sortConfig.key);
        if (aValue < bValue) {
          return sortConfig.direction === 'ascending' ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortConfig.direction === 'ascending' ? 1 : -1;
        }
        return 0;
      });
    }
    return filtered;
  }, [policies, searchTerm, companyFilter, statusFilter, policyStatusFilter, sortConfig]);

  const totals = useMemo(() => {
    let pending = 0;
    let paid = 0;
    let totalPremium = 0;
    // Only calculate totals for accepted policies
    const acceptedPolicies = policies.filter(p => p.status === 'Aceite');
    acceptedPolicies.forEach(p => {
      const netPremium = getNetPremium(p);
      const commissionValue = (netPremium * p.commissionRate) / 100;
      if (p.commissionPaid) {
        paid += commissionValue;
      } else {
        pending += commissionValue;
      }
      totalPremium += netPremium;
    });
    return { pending, paid, totalPremium };
  }, [policies]);

  const quarterlyPremiums = useMemo(() => {
    const quarters: Record<string, number> = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
    const acceptedPolicies = policies.filter(p => p.status === 'Aceite');
    acceptedPolicies.forEach(p => {
      const month = new Date(p.policyDate).getMonth();
      const netPremium = getNetPremium(p);
      if (month < 3) quarters.Q1 += netPremium;
      else if (month < 6) quarters.Q2 += netPremium;
      else if (month < 9) quarters.Q3 += netPremium;
      else quarters.Q4 += netPremium;
    });
    return quarters;
  }, [policies]);

  const handleOpenModal = (policy?: InsurancePolicy) => {
    setEditingPolicy(policy ? {
      ...policy,
      agent: policy.agent || 'MPR',
      renewalDate: policy.renewalDate || policy.policyDate,
      company: getCompany(policy),
      branch: getBranch(policy),
      netPremiumValue: getNetPremium(policy),
      premiumValue: getNetPremium(policy),
      insuranceProvider: getCompany(policy),
      policyType: getBranch(policy),
    } : {
      policyDate: new Date().toISOString().split('T')[0],
      renewalDate: new Date().toISOString().split('T')[0],
      paymentFrequency: 'Anual',
      status: 'Proposta',
      policyTier: 'Base',
      commissionPaid: false,
      commissionRate: 10,
      premiumValue: 0,
      netPremiumValue: 0,
      agent: 'MPR',
      company: '',
      branch: '',
      insuranceProvider: '',
      policyType: '',
    });
    setSelectedFile(null);
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPolicy || !editingPolicy.clientId || !editingPolicy.company || !editingPolicy.branch) {
      alert("Cliente, Companhia e Ramo são obrigatórios.");
      return;
    }
    setIsSaving(true);
    try {
      const policyId = editingPolicy.id || crypto.randomUUID();
      let attachmentUrl = editingPolicy.attachment_url;

      if (selectedFile) {
        attachmentUrl = await insuranceService.uploadAttachment(selectedFile, policyId);
      }

      const netPremium = getNetPremium(editingPolicy);

      const policyToSave = {
        ...editingPolicy,
        id: policyId,
        attachment_url: attachmentUrl,
        renewalDate: editingPolicy.renewalDate || editingPolicy.policyDate,
        company: editingPolicy.company,
        branch: editingPolicy.branch,
        insuranceProvider: editingPolicy.company,
        policyType: editingPolicy.branch,
        netPremiumValue: netPremium,
        premiumValue: netPremium,
      };

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

  const requestSort = (key: SortableKeys) => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  const SortableHeader = ({ children, sortKey }: { children: React.ReactNode, sortKey: SortableKeys }) => (
    <th className="px-4 py-3 cursor-pointer hover:bg-slate-100" onClick={() => requestSort(sortKey)}>
      <div className="flex items-center gap-1">
        {children}
        {sortConfig?.key === sortKey ? (sortConfig.direction === 'ascending' ? <ChevronUp size={14} /> : <ChevronDown size={14} />) : <ChevronUp size={14} className="text-slate-300" />}
      </div>
    </th>
  );

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Gestão de Seguros</h2>
          <p className="text-sm text-slate-500">Com colunas de agente, renovação, companhia, ramo e prémio líquido.</p>
        </div>
        <button onClick={() => handleOpenModal()} className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 font-bold shadow-sm">
          <Plus size={18}/> Adicionar Seguro
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <p className="text-sm font-medium text-amber-600">Comissões Pendentes</p>
          <h3 className="text-2xl font-bold text-slate-800 mt-1">{totals.pending.toFixed(2)}€</h3>
        </div>
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <p className="text-sm font-medium text-green-600">Comissões Recebidas (Total)</p>
          <h3 className="text-2xl font-bold text-slate-800 mt-1">{totals.paid.toFixed(2)}€</h3>
        </div>
        <div onClick={() => setIsQuarterlyModalOpen(true)} className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 cursor-pointer hover:bg-slate-50">
          <p className="text-sm font-medium text-blue-600 flex items-center gap-1">Total Prémios Líquidos (Aceites) <PieChart size={14}/></p>
          <h3 className="text-2xl font-bold text-slate-800 mt-1">{totals.totalPremium.toFixed(2)}€</h3>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-4 border-b grid grid-cols-1 md:grid-cols-4 gap-3">
            <div className="relative">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={16} />
                <input type="text" placeholder="Pesquisar cliente, companhia, ramo ou apólice..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm" />
            </div>
            <select value={companyFilter} onChange={e => setCompanyFilter(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
                <option value="all">Todas as Companhias</option>
                {uniqueCompanies.map(company => <option key={company} value={company}>{company}</option>)}
            </select>
            <select value={policyStatusFilter} onChange={e => setPolicyStatusFilter(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
                <option value="all">Todos os Estados da Apólice</option>
                <option value="Proposta">Proposta</option>
                <option value="Aceite">Aceite</option>
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
                <option value="all">Todos os Estados de Comissão</option>
                <option value="paid">Paga</option>
                <option value="pending">Pendente</option>
            </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50">
              <tr>
                <SortableHeader sortKey="clientName">Cliente / Apólice</SortableHeader>
                <SortableHeader sortKey="agent">Agente</SortableHeader>
                <SortableHeader sortKey="renewalDate">Data Renovação</SortableHeader>
                <SortableHeader sortKey="company">Companhia</SortableHeader>
                <SortableHeader sortKey="branch">Ramo</SortableHeader>
                <SortableHeader sortKey="netPremiumValue">Prémio Líquido</SortableHeader>
                <th className="px-4 py-3 text-center">Comissão</th>
                <th className="px-4 py-3 text-center">Estado</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {sortedPolicies.map(p => {
                const company = getCompany(p);
                const branch = getBranch(p);
                const netPremium = getNetPremium(p);
                return (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-bold text-slate-800">{p.clientName}</div>
                      <div className="text-xs text-slate-400 font-mono">{p.policyNumber}</div>
                    </td>
                    <td className="px-4 py-3 text-xs font-bold text-slate-700">{p.agent || '-'}</td>
                    <td className="px-4 py-3 text-xs">{p.renewalDate ? new Date(p.renewalDate).toLocaleDateString('pt-PT') : '-'}</td>
                    <td className="px-4 py-3 text-xs">{company || '-'}</td>
                    <td className="px-4 py-3 text-xs">{branch || '-'}</td>
                    <td className="px-4 py-3 text-right font-bold text-slate-800">{netPremium.toFixed(2)}€</td>
                    <td className="px-4 py-3 text-center text-xs font-bold">{Number(p.commissionRate || 0).toFixed(1)}%</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${p.status === 'Aceite' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>
                        {p.status === 'Aceite' ? <FileCheck size={14}/> : <FileClock size={14}/>}
                        {p.status}
                      </span>
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
              {sortedPolicies.length === 0 && (<tr><td colSpan={9} className="text-center italic text-slate-400 py-10">Nenhuma apólice encontrada.</td></tr>)}
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
                <label className="block text-xs font-bold text-slate-500 mb-1">Agente*</label>
                <select value={editingPolicy.agent || 'MPR'} onChange={e => setEditingPolicy({...editingPolicy, agent: e.target.value as InsurancePolicy['agent']})} className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
                  <option value="MPR">MPR</option>
                  <option value="Paula">Paula</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Data da Apólice*</label>
                <input type="date" required value={editingPolicy.policyDate} onChange={e => setEditingPolicy({...editingPolicy, policyDate: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Data de Renovação*</label>
                <input type="date" required value={editingPolicy.renewalDate || ''} onChange={e => setEditingPolicy({...editingPolicy, renewalDate: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Nº da Apólice</label>
                <input type="text" value={editingPolicy.policyNumber || ''} onChange={e => setEditingPolicy({...editingPolicy, policyNumber: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Companhia*</label>
                <input type="text" list="companies" required value={editingPolicy.company || ''} onChange={e => setEditingPolicy({...editingPolicy, company: e.target.value, insuranceProvider: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm" />
                <datalist id="companies">
                  {uniqueCompanies.map(company => <option key={company} value={company} />)}
                </datalist>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Ramo*</label>
                <input type="text" required value={editingPolicy.branch || ''} onChange={e => setEditingPolicy({...editingPolicy, branch: e.target.value, policyType: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Ex: Acidentes de Trabalho"/>
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
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Estado da Apólice*</label>
                <select required value={editingPolicy.status || 'Proposta'} onChange={e => setEditingPolicy({...editingPolicy, status: e.target.value as any})} className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
                  <option value="Proposta">Proposta</option>
                  <option value="Aceite">Aceite</option>
                </select>
              </div>
              <div className="md:col-span-2 grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">Prémio Líquido (€)</label>
                  <input type="number" step="0.01" value={getNetPremium(editingPolicy)} onChange={e => { const value = parseFloat(e.target.value) || 0; setEditingPolicy({...editingPolicy, netPremiumValue: value, premiumValue: value}); }} className="w-full px-3 py-2 border rounded-lg text-sm" />
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

      {/* Quarterly Breakdown Modal */}
      {isQuarterlyModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setIsQuarterlyModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Prémios Líquidos por Trimestre</h3>
              <button type="button" onClick={() => setIsQuarterlyModalOpen(false)}><X size={20} /></button>
            </div>
            <div className="space-y-3">
              {Object.entries(quarterlyPremiums).map(([quarter, value]) => (
                <div key={quarter} className="flex justify-between items-center bg-slate-50 p-3 rounded-lg">
                  <span className="font-bold text-slate-600">{quarter}</span>
                  <span className="font-bold text-blue-600 text-lg">{value.toFixed(2)}€</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Insurance;
