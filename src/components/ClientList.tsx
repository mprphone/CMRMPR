import React, { useEffect, useMemo, useState } from 'react';
import { Client, Staff, Task, FeeGroup } from '../types';
import { clientService } from '../services/supabase';
import { Search, Plus, X, CloudCheck, RefreshCcw, ChevronUp, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';

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

type SortableKeys = 'nif' | 'name' | 'email' | 'phone' | 'entityType' | 'employeeCount' | 'documentCount' | 'monthlyFee' | 'status';

type FormErrorMap = Partial<Record<'name' | 'nif' | 'email' | 'phone', string>>;

const normalizeNif = (value: string) => value.replace(/\D/g, '');

const isValidPortugueseNif = (nif: string) => {
  const digits = normalizeNif(nif);
  if (!/^\d{9}$/.test(digits)) return false;

  const first = Number(digits[0]);
  if (![1, 2, 3, 5, 6, 8, 9].includes(first)) return false;

  let total = 0;
  for (let index = 0; index < 8; index += 1) {
    total += Number(digits[index]) * (9 - index);
  }

  let checkDigit = 11 - (total % 11);
  if (checkDigit >= 10) checkDigit = 0;
  return checkDigit === Number(digits[8]);
};

const normalizePhoneDigits = (value: string) => value.replace(/[^\d+]/g, '');

const isValidPortuguesePhone = (phone: string) => {
  const cleaned = normalizePhoneDigits(phone).trim();
  if (!cleaned) return false;

  let digitsOnly = cleaned.replace(/\D/g, '');
  if (cleaned.startsWith('+351')) {
    digitsOnly = cleaned.slice(4).replace(/\D/g, '');
  } else if (cleaned.startsWith('00351')) {
    digitsOnly = cleaned.slice(5).replace(/\D/g, '');
  }

  if (digitsOnly.length !== 9) return false;
  return /^[29]\d{8}$/.test(digitsOnly);
};

const isValidEmail = (email: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i.test(email.trim());

const todayIso = () => new Date().toISOString().split('T')[0];

const ClientList: React.FC<ClientListProps> = ({ clients, setClients, staff, onSelectClient, groups, onSyncClientsRequest }) => {
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [groupFilter, setGroupFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState<'all' | Client['status']>('all');
  const [entityTypeFilter, setEntityTypeFilter] = useState<string>('all');
  const [responsibleFilter, setResponsibleFilter] = useState<string>('all');

  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [formData, setFormData] = useState<Partial<Client>>({});
  const [formErrors, setFormErrors] = useState<FormErrorMap>({});

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [totalClients, setTotalClients] = useState(0);
  const [isLoadingPage, setIsLoadingPage] = useState(false);
  const [pageError, setPageError] = useState<string | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const [pagedClients, setPagedClients] = useState<Client[]>([]);

  const [sortConfig, setSortConfig] = useState<{ key: SortableKeys; direction: 'ascending' | 'descending' }>({
    key: 'name',
    direction: 'ascending',
  });

  const selectedGroup = useMemo(
    () => groups.find(g => g.id === groupFilter),
    [groups, groupFilter]
  );

  const uniqueEntityTypes = useMemo(() => {
    const values = new Set<string>();
    clients.forEach(client => {
      if (client.entityType) values.add(client.entityType);
    });
    return Array.from(values).sort((a, b) => a.localeCompare(b));
  }, [clients]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearchTerm(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  useEffect(() => {
    setPage(1);
  }, [groupFilter, statusFilter, entityTypeFilter, responsibleFilter, pageSize, sortConfig.key, sortConfig.direction]);

  const buildLocalFallbackPage = () => {
    const groupClientIds = groupFilter === 'all' ? null : (selectedGroup?.clientIds || []);
    let filtered = clients.filter(client => {
      if (groupClientIds && !groupClientIds.includes(client.id)) return false;
      if (statusFilter !== 'all' && client.status !== statusFilter) return false;
      if (entityTypeFilter !== 'all' && client.entityType !== entityTypeFilter) return false;
      if (responsibleFilter !== 'all' && client.responsibleStaff !== responsibleFilter) return false;
      if (!searchTerm) return true;

      const haystack = [
        client.name,
        client.nif,
        client.email,
        client.phone,
      ].join(' ').toLowerCase();

      return haystack.includes(searchTerm.toLowerCase());
    });

    filtered = filtered.sort((a, b) => {
      const aValue = (a as any)[sortConfig.key];
      const bValue = (b as any)[sortConfig.key];
      if (aValue < bValue) return sortConfig.direction === 'ascending' ? -1 : 1;
      if (aValue > bValue) return sortConfig.direction === 'ascending' ? 1 : -1;
      return 0;
    });

    const from = (page - 1) * pageSize;
    const to = from + pageSize;
    return {
      clients: filtered.slice(from, to),
      total: filtered.length,
    };
  };

  useEffect(() => {
    let isMounted = true;
    const loadClientsPage = async () => {
      setIsLoadingPage(true);
      setPageError(null);

      try {
        const result = await clientService.getPaged({
          page,
          pageSize,
          searchTerm,
          status: statusFilter,
          entityType: entityTypeFilter,
          responsibleStaffId: responsibleFilter,
          groupClientIds: groupFilter === 'all' ? undefined : (selectedGroup?.clientIds || []),
          sortKey: sortConfig.key,
          sortDirection: sortConfig.direction,
        });

        if (!isMounted) return;
        setPagedClients(result.clients);
        setTotalClients(result.total);
      } catch (err: any) {
        if (!isMounted) return;
        const fallback = buildLocalFallbackPage();
        setPagedClients(fallback.clients);
        setTotalClients(fallback.total);
        setPageError(`Paginação remota indisponível: ${err?.message || 'erro desconhecido'}`);
      } finally {
        if (isMounted) setIsLoadingPage(false);
      }
    };

    loadClientsPage();
    return () => {
      isMounted = false;
    };
  }, [
    clients,
    groupFilter,
    selectedGroup,
    searchTerm,
    statusFilter,
    entityTypeFilter,
    responsibleFilter,
    page,
    pageSize,
    sortConfig,
    refreshTick,
  ]);

  const totalPages = Math.max(1, Math.ceil(totalClients / pageSize));

  useEffect(() => {
    if (page > totalPages) {
      setPage(totalPages);
    }
  }, [page, totalPages]);

  const processedClients = useMemo(() => {
    return pagedClients.map(client => {
      const staffMember = staff.find(member => member.id === client.responsibleStaff);
      return {
        ...client,
        responsibleStaffName: staffMember ? staffMember.name : (client.responsibleStaff || 'Não Atribuído'),
      };
    });
  }, [pagedClients, staff]);

  const requestSort = (key: SortableKeys) => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  const openNewClientModal = () => {
    setEditingClient(null);
    setFormErrors({});
    setFormData({
      name: '',
      nif: '',
      email: '',
      phone: '',
      address: '',
      entityType: 'SOCIEDADE',
      sector: 'Geral',
      status: 'Ativo',
      responsibleStaff: '',
      monthlyFee: 0,
      contractRenewalDate: todayIso(),
    });
    setIsModalOpen(true);
  };

  const validateForm = (data: Partial<Client>): FormErrorMap => {
    const errors: FormErrorMap = {};
    const name = (data.name || '').trim();
    const nif = normalizeNif(data.nif || '');
    const email = (data.email || '').trim();
    const phone = (data.phone || '').trim();

    if (!name || name.length < 3) {
      errors.name = 'Nome deve ter pelo menos 3 caracteres.';
    }

    if (!isValidPortugueseNif(nif)) {
      errors.nif = 'NIF inválido (9 dígitos com controlo válido).';
    } else {
      const duplicated = clients.find(client => client.nif === nif && client.id !== editingClient?.id);
      if (duplicated) {
        errors.nif = 'Já existe um cliente com este NIF.';
      }
    }

    if (!isValidEmail(email)) {
      errors.email = 'Email inválido.';
    }

    if (!isValidPortuguesePhone(phone)) {
      errors.phone = 'Telefone inválido (formato PT: 9 dígitos, opcional +351).';
    }

    return errors;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors = validateForm(formData);
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) return;

    setIsSaving(true);
    try {
      const id = editingClient?.id || crypto.randomUUID();
      const baseClient: Client = editingClient || {
        id,
        name: '',
        email: '',
        phone: '',
        address: '',
        nif: '',
        sector: 'Geral',
        entityType: 'SOCIEDADE',
        responsibleStaff: '',
        monthlyFee: 0,
        employeeCount: 0,
        turnover: 0,
        documentCount: 0,
        establishments: 1,
        banks: 1,
        callTimeBalance: 0,
        travelCount: 0,
        deliversOrganizedDocs: true,
        vatRefunds: false,
        hasIneReport: false,
        hasCostCenters: false,
        hasInternationalOps: false,
        hasManagementReports: false,
        supplierCount: 0,
        customerCount: 0,
        communicationCount: 0,
        meetingCount: 0,
        previousYearProfit: 0,
        tasks: [],
        status: 'Ativo',
        contractRenewalDate: todayIso(),
      };

      const clientToSave: Client = {
        ...baseClient,
        ...formData,
        id,
        name: (formData.name || '').trim(),
        nif: normalizeNif(formData.nif || ''),
        email: (formData.email || '').trim().toLowerCase(),
        phone: (formData.phone || '').trim(),
        address: (formData.address || '').trim(),
        entityType: (formData.entityType || 'SOCIEDADE').trim(),
        sector: formData.sector || baseClient.sector || 'Geral',
        responsibleStaff: formData.responsibleStaff || '',
        status: formData.status || 'Ativo',
        monthlyFee: Number(formData.monthlyFee || 0),
        contractRenewalDate: formData.contractRenewalDate || baseClient.contractRenewalDate || todayIso(),
      };

      const savedClient = await clientService.upsert(clientToSave);
      setClients(editingClient ? clients.map(c => c.id === savedClient.id ? savedClient : c) : [savedClient, ...clients]);
      setIsModalOpen(false);
      setRefreshTick(value => value + 1);
    } catch (err: any) {
      alert('Erro ao sincronizar cliente com Supabase: ' + (err?.message || 'erro desconhecido'));
    } finally {
      setIsSaving(false);
    }
  };

  const SortableHeader = ({ children, sortKey }: { children: React.ReactNode; sortKey: SortableKeys }) => {
    const isSorted = sortConfig.key === sortKey;
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
        <div className="p-6 border-b border-slate-100 flex flex-col gap-4">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4">
            <div className="flex items-center gap-3">
              <h2 className="text-xl font-bold text-slate-800">Carteira de Clientes</h2>
              <div className="flex items-center gap-1 text-[10px] text-blue-600 font-bold bg-blue-50 px-2 py-0.5 rounded-full border border-blue-100">
                <CloudCheck size={12} /> SUPABASE SYNC
              </div>
            </div>

            <div className="flex gap-3 w-full sm:w-auto">
              <button onClick={onSyncClientsRequest} className="bg-green-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-green-700 flex items-center gap-2">
                <RefreshCcw size={16} /> <span className="hidden sm:inline">Sincronizar</span>
              </button>
              <button onClick={openNewClientModal} className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2">
                <Plus size={16} /> <span className="hidden sm:inline">Novo</span>
              </button>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-5 gap-3">
            <div className="relative lg:col-span-2">
              <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={18} />
              <input
                type="text"
                placeholder="Pesquisar por nome, NIF, email, telefone..."
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
              />
            </div>

            <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-xs font-medium bg-white">
              <option value="all">Todos os Grupos</option>
              {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>

            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="px-3 py-2 border border-slate-200 rounded-lg text-xs font-medium bg-white">
              <option value="all">Todos os Estados</option>
              <option value="Ativo">Ativo</option>
              <option value="Em Análise">Em Análise</option>
              <option value="Risco">Risco</option>
              <option value="Cancelado">Cancelado</option>
            </select>

            <select value={responsibleFilter} onChange={e => setResponsibleFilter(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-xs font-medium bg-white">
              <option value="all">Todos os Responsáveis</option>
              {staff.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <select value={entityTypeFilter} onChange={e => setEntityTypeFilter(e.target.value)} className="px-3 py-2 border border-slate-200 rounded-lg text-xs font-medium bg-white">
              <option value="all">Todos os Tipos</option>
              {uniqueEntityTypes.map(type => <option key={type} value={type}>{type}</option>)}
            </select>

            <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} className="px-3 py-2 border border-slate-200 rounded-lg text-xs font-medium bg-white">
              <option value={10}>10 por página</option>
              <option value={25}>25 por página</option>
              <option value={50}>50 por página</option>
              <option value={100}>100 por página</option>
            </select>

            <div className="flex items-center justify-end text-xs text-slate-500">
              {isLoadingPage ? 'A carregar página...' : `${totalClients} cliente(s) encontrados`}
            </div>
          </div>
        </div>

        {pageError && (
          <div className="mx-6 mt-4 mb-0 p-3 bg-amber-50 border border-amber-200 text-amber-700 rounded-lg text-xs font-medium">
            {pageError}
          </div>
        )}

        <div className="overflow-x-auto mt-4">
          <table className="w-full text-sm text-left text-slate-600">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50 font-bold">
              <tr>
                <SortableHeader sortKey="nif">NIF</SortableHeader>
                <SortableHeader sortKey="name">Nome</SortableHeader>
                <th className="px-4 py-3">Email / Telefone</th>
                <SortableHeader sortKey="entityType">Tipo</SortableHeader>
                <SortableHeader sortKey="employeeCount">Nº Func.</SortableHeader>
                <SortableHeader sortKey="documentCount">Nº Docs</SortableHeader>
                <th className="px-4 py-3">Responsável</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {processedClients.map(client => (
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
                  <td className="px-4 py-4 text-xs">{(client as any).responsibleStaffName}</td>
                  <td className="px-4 py-4 text-right">
                    <button onClick={() => onSelectClient(client)} className="text-blue-600 hover:bg-blue-50 px-3 py-1.5 rounded text-xs font-bold border border-blue-100 transition-colors">
                      Detalhes
                    </button>
                  </td>
                </tr>
              ))}
              {!isLoadingPage && processedClients.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-slate-400 italic">Nenhum cliente encontrado para os filtros selecionados.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="p-4 border-t border-slate-100 flex items-center justify-between">
          <div className="text-xs text-slate-500">
            Página {page} de {totalPages}
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(prev => Math.max(1, prev - 1))}
              disabled={page <= 1 || isLoadingPage}
              className="px-3 py-1.5 text-xs border rounded-lg bg-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              <ChevronLeft size={14} /> Anterior
            </button>
            <button
              onClick={() => setPage(prev => Math.min(totalPages, prev + 1))}
              disabled={page >= totalPages || isLoadingPage}
              className="px-3 py-1.5 text-xs border rounded-lg bg-white disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
            >
              Seguinte <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 overflow-y-auto max-h-[90vh]">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-xl font-bold">{editingClient ? 'Editar Cliente' : 'Novo Cliente'}</h3>
              <button onClick={() => setIsModalOpen(false)}><X size={20} /></button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="text-xs font-bold text-slate-400">Nome</label>
                  <input
                    required
                    className={`w-full p-2 border rounded ${formErrors.name ? 'border-red-400' : 'border-slate-200'}`}
                    value={formData.name || ''}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                  />
                  {formErrors.name && <p className="text-[11px] text-red-500 mt-1">{formErrors.name}</p>}
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-400">NIF</label>
                  <input
                    required
                    maxLength={9}
                    className={`w-full p-2 border rounded ${formErrors.nif ? 'border-red-400' : 'border-slate-200'}`}
                    value={formData.nif || ''}
                    onChange={e => setFormData({ ...formData, nif: normalizeNif(e.target.value) })}
                  />
                  {formErrors.nif && <p className="text-[11px] text-red-500 mt-1">{formErrors.nif}</p>}
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-400">Email</label>
                  <input
                    required
                    type="email"
                    className={`w-full p-2 border rounded ${formErrors.email ? 'border-red-400' : 'border-slate-200'}`}
                    value={formData.email || ''}
                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                  />
                  {formErrors.email && <p className="text-[11px] text-red-500 mt-1">{formErrors.email}</p>}
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-400">Telefone</label>
                  <input
                    required
                    className={`w-full p-2 border rounded ${formErrors.phone ? 'border-red-400' : 'border-slate-200'}`}
                    value={formData.phone || ''}
                    onChange={e => setFormData({ ...formData, phone: e.target.value })}
                    placeholder="+351 9XXXXXXXX"
                  />
                  {formErrors.phone && <p className="text-[11px] text-red-500 mt-1">{formErrors.phone}</p>}
                </div>

                <div className="md:col-span-2">
                  <label className="text-xs font-bold text-slate-400">Morada</label>
                  <input
                    className="w-full p-2 border rounded border-slate-200"
                    value={formData.address || ''}
                    onChange={e => setFormData({ ...formData, address: e.target.value })}
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-400">Tipo de Entidade</label>
                  <input
                    className="w-full p-2 border rounded border-slate-200 bg-slate-50"
                    value={formData.entityType || ''}
                    onChange={e => setFormData({ ...formData, entityType: e.target.value })}
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-400">Avença Mensal</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full p-2 border rounded border-slate-200"
                    value={formData.monthlyFee || 0}
                    onChange={e => setFormData({ ...formData, monthlyFee: parseFloat(e.target.value) || 0 })}
                  />
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-400">Responsável</label>
                  <select
                    className="w-full p-2 border rounded border-slate-200 bg-white"
                    value={formData.responsibleStaff || ''}
                    onChange={e => setFormData({ ...formData, responsibleStaff: e.target.value })}
                  >
                    <option value="">Não Atribuído</option>
                    {staff.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-400">Estado</label>
                  <select
                    className="w-full p-2 border rounded border-slate-200 bg-white"
                    value={formData.status || 'Ativo'}
                    onChange={e => setFormData({ ...formData, status: e.target.value as Client['status'] })}
                  >
                    <option value="Ativo">Ativo</option>
                    <option value="Em Análise">Em Análise</option>
                    <option value="Risco">Risco</option>
                    <option value="Cancelado">Cancelado</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-slate-500">Cancelar</button>
                <button type="submit" disabled={isSaving} className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold disabled:opacity-50">
                  {isSaving ? <RefreshCcw className="animate-spin" size={16} /> : 'Salvar no Supabase'}
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
