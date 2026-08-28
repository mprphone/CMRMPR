import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Client, Staff, Task, FeeGroup } from '../types';
import { clientService, saftDossierService } from '../services';
import { Search, Plus, X, CloudCheck, RefreshCcw, ChevronUp, ChevronDown, ChevronLeft, ChevronRight, Eye } from 'lucide-react';

interface ClientListProps {
  clients: Client[];
  setClients: React.Dispatch<React.SetStateAction<Client[]>>;
  tasks: Task[];
  areaCosts: Record<string, number>;
  staff: Staff[];
  onSelectClient: (client: Client) => void;
  groups: FeeGroup[];
  onSyncClientsRequest: () => Promise<void>;
  canSyncWampr: boolean;
  canViewFinancial: boolean;
  canCreateClients: boolean;
  isSyncingClients: boolean;
  /** Colaborador do próprio utilizador, quando o âmbito de dados é "assigned". */
  ownStaffId: string | null;
  /** Quando true, o "Responsável" de um cliente novo/editado tem de ser o próprio utilizador (âmbito "assigned"). */
  isResponsibleStaffLocked: boolean;
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

const ClientList: React.FC<ClientListProps> = ({
  clients, setClients, staff, onSelectClient, groups, onSyncClientsRequest,
  canSyncWampr, canViewFinancial, canCreateClients, isSyncingClients,
  ownStaffId, isResponsibleStaffLocked,
}) => {
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
  const [saftStatusByNif, setSaftStatusByNif] = useState<Record<string, { hasData: boolean; syncedAt: string }>>({});
  const [isQueueingSaftSync, setIsQueueingSaftSync] = useState(false);

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

  const buildLocalFallbackPage = useCallback((): { clients: Client[]; total: number } => {
    const search = searchTerm.trim().toLowerCase();
    const numericKeys: SortableKeys[] = ['employeeCount', 'documentCount', 'monthlyFee'];
    const direction = sortConfig.direction === 'ascending' ? 1 : -1;

    const filtered = clients.filter(client => {
      if (search) {
        const haystack = `${client.name} ${client.nif} ${client.email} ${client.phone}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      if (statusFilter !== 'all' && client.status !== statusFilter) return false;
      if (entityTypeFilter !== 'all' && client.entityType !== entityTypeFilter) return false;
      if (responsibleFilter !== 'all' && client.responsibleStaff !== responsibleFilter) return false;
      if (groupFilter !== 'all' && selectedGroup && !selectedGroup.clientIds.includes(client.id)) return false;
      return true;
    });

    const sorted = [...filtered].sort((a, b) => {
      const key = sortConfig.key;
      if (numericKeys.includes(key)) {
        return (Number(a[key]) - Number(b[key])) * direction;
      }
      return String(a[key] || '').localeCompare(String(b[key] || '')) * direction;
    });

    const start = (page - 1) * pageSize;
    return { clients: sorted.slice(start, start + pageSize), total: sorted.length };
  }, [clients, searchTerm, statusFilter, entityTypeFilter, responsibleFilter, groupFilter, selectedGroup, sortConfig, page, pageSize]);

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

  useEffect(() => {
    let isMounted = true;

    const loadSaftStatus = async () => {
      const nifs = Array.from(
        new Set(
          processedClients
            .map(client => normalizeNif(client.nif || ''))
            .filter(nif => nif.length === 9)
        )
      );

      if (nifs.length === 0) {
        setSaftStatusByNif({});
        return;
      }

      try {
        const statusMap = await saftDossierService.getStatusByClientNifs(nifs);
        if (!isMounted) return;
        setSaftStatusByNif(statusMap);
      } catch (err) {
        console.error('Erro ao carregar estado SAFT da lista:', err);
        if (!isMounted) return;
        setSaftStatusByNif({});
      }
    };

    loadSaftStatus();
    return () => {
      isMounted = false;
    };
  }, [processedClients]);

  const formatDateTime = (value?: string) => {
    if (!value) return '';
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) return value;
    return parsed.toLocaleString('pt-PT');
  };

  const handleToggleSaftCollect = async (client: Client, enabled: boolean) => {
    const previousClients = [...clients];
    const previousPagedClients = [...pagedClients];
    const updatedClient: Client = { ...client, saftCollectEnabled: enabled };

    setClients(current => current.map(item => (item.id === client.id ? updatedClient : item)));
    setPagedClients(current => current.map(item => (item.id === client.id ? updatedClient : item)));

    try {
      const saved = await clientService.upsert(updatedClient);
      setClients(current => current.map(item => (item.id === saved.id ? saved : item)));
      setPagedClients(current => current.map(item => (item.id === saved.id ? saved : item)));
    } catch (err: any) {
      setClients(previousClients);
      setPagedClients(previousPagedClients);
      alert('Falha ao gravar opção de recolha SAFT: ' + (err?.message || 'erro desconhecido'));
    }
  };

  const handleQueueSaftSync = async () => {
    const targetNifs = Array.from(
      new Set(
        clients
          .filter(client => client.saftCollectEnabled !== false)
          .map(client => normalizeNif(client.nif || ''))
          .filter(nif => nif.length === 9)
      )
    );

    if (targetNifs.length === 0) {
      alert('Nenhum cliente está marcado para recolha SAFT.');
      return;
    }

    setIsQueueingSaftSync(true);
    try {
      const queued = await saftDossierService.enqueueSyncRequests(targetNifs, 'client-list');
      alert(`Recolha SAFT agendada para ${queued} cliente(s).`);
    } catch (err: any) {
      alert('Falha ao agendar recolha SAFT: ' + (err?.message || 'erro desconhecido'));
    } finally {
      setIsQueueingSaftSync(false);
    }
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
      emailMarketingStatus: 'unknown',
      responsibleStaff: isResponsibleStaffLocked ? (ownStaffId || '') : '',
      monthlyFee: 0,
      saftCollectEnabled: true,
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
        saftCollectEnabled: true,
        tasks: [],
        status: 'Ativo',
        contractRenewalDate: todayIso(),
      };

      const previousMarketingStatus = baseClient.emailMarketingStatus || 'unknown';
      const nextMarketingStatus = formData.emailMarketingStatus || 'unknown';
      const hasMarketingBasis = nextMarketingStatus === 'consented' || nextMarketingStatus === 'legitimate_interest';

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
        saftCollectEnabled: formData.saftCollectEnabled === undefined
          ? (baseClient.saftCollectEnabled !== false)
          : Boolean(formData.saftCollectEnabled),
        contractRenewalDate: formData.contractRenewalDate || baseClient.contractRenewalDate || todayIso(),
        emailMarketingStatus: nextMarketingStatus,
        emailMarketingConsentAt: hasMarketingBasis
          ? (nextMarketingStatus === previousMarketingStatus && baseClient.emailMarketingConsentAt
            ? baseClient.emailMarketingConsentAt
            : new Date().toISOString())
          : null,
        emailMarketingConsentSource: hasMarketingBasis
          ? (formData.emailMarketingConsentSource || '').trim() || null
          : null,
      };

      const savedClient = await clientService.upsert(clientToSave);
      setClients(current => (editingClient ? current.map(c => c.id === savedClient.id ? savedClient : c) : [savedClient, ...current]));
      setIsModalOpen(false);
      setRefreshTick(value => value + 1);
    } catch (err: any) {
      alert('Erro ao gravar o cliente no servidor local: ' + (err?.message || 'erro desconhecido'));
    } finally {
      setIsSaving(false);
    }
  };

  const SortableHeader = ({ children, sortKey, className = '' }: { children: React.ReactNode; sortKey: SortableKeys; className?: string }) => {
    const isSorted = sortConfig.key === sortKey;
    return (
      <th className={`${className} px-3 py-3 text-left text-[11px] font-semibold uppercase text-slate-600`}>
        <button type="button" className="inline-flex items-center gap-1 hover:text-slate-900" onClick={() => requestSort(sortKey)}>
          {children}
          {isSorted ? (
            sortConfig.direction === 'ascending' ? <ChevronUp size={12} /> : <ChevronDown size={12} />
          ) : (
            <ChevronUp size={12} className="text-slate-300" />
          )}
        </button>
      </th>
    );
  };

  return (
    <div className="space-y-4">
      <section className="rounded-2xl border border-slate-700/20 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-900 p-4 text-white shadow-sm md:p-5">
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold md:text-2xl">Clientes</h1>
              <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-100">
                <CloudCheck size={12} /> CMR · Base local
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-200 md:text-sm">Gestão e análise da carteira de clientes MPR.</p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {canSyncWampr && (
              <button
                type="button"
                onClick={onSyncClientsRequest}
                disabled={isSyncingClients}
                className="inline-flex items-center gap-2 rounded-lg bg-emerald-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50 disabled:cursor-not-allowed md:text-sm"
              >
                <RefreshCcw size={16} className={isSyncingClients ? 'animate-spin' : undefined} />
                {isSyncingClients ? 'A atualizar...' : 'Atualizar do WAPRO'}
              </button>
            )}
            <button
              type="button"
              onClick={handleQueueSaftSync}
              disabled={isQueueingSaftSync}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-700 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-slate-600 disabled:cursor-not-allowed disabled:opacity-60 md:text-sm"
            >
              {isQueueingSaftSync ? <RefreshCcw size={16} className="animate-spin" /> : <CloudCheck size={16} />}
              Recolha SAF-T
            </button>
            {canCreateClients && (
              <button
                type="button"
                onClick={openNewClientModal}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-3 py-2 text-xs font-semibold text-white transition-colors hover:bg-blue-500 md:text-sm"
              >
                <Plus size={16} /> Novo cliente
              </button>
            )}
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="grid grid-cols-1 gap-2 border-b border-slate-200 p-3 md:grid-cols-2 xl:grid-cols-6">
            <div className="relative md:col-span-2">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
              <input
                type="text"
                placeholder="Nome, NIF, email ou telefone..."
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                className="w-full rounded-md border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-sm outline-none transition focus:border-emerald-300 focus:bg-white focus:ring-2 focus:ring-emerald-100"
              />
            </div>

            <select value={groupFilter} onChange={e => setGroupFilter(e.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="all">Todos os Grupos</option>
              {groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
            </select>

            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as any)} className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="all">Todos os Estados</option>
              <option value="Ativo">Ativo</option>
              <option value="Em Análise">Em Análise</option>
              <option value="Risco">Risco</option>
              <option value="Cancelado">Cancelado</option>
              <option value="Inativo">Inativo</option>
            </select>

            <select value={entityTypeFilter} onChange={e => setEntityTypeFilter(e.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="all">Todos os Tipos</option>
              {uniqueEntityTypes.map(type => <option key={type} value={type}>{type}</option>)}
            </select>

            <select value={responsibleFilter} onChange={e => setResponsibleFilter(e.target.value)} className="w-full rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
              <option value="all">Todos os Responsáveis</option>
              {staff.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
            </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-3 py-2 text-xs text-slate-500">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>{isLoadingPage ? 'A carregar clientes...' : `${totalClients} cliente(s)`}</span>
            <span className="font-semibold text-emerald-700">Ligação local ativa</span>
          </div>
          <label className="flex items-center gap-2">
            <span>Mostrar</span>
            <select value={pageSize} onChange={e => setPageSize(Number(e.target.value))} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700">
              <option value={10}>10</option>
              <option value={25}>25</option>
              <option value={50}>50</option>
              <option value={100}>100</option>
            </select>
            <span>por página</span>
          </label>
        </div>

        {pageError && (
          <div className="m-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs font-medium text-amber-700">
            {pageError}
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1220px] table-fixed">
            <thead className="bg-slate-100/80">
              <tr>
                <SortableHeader sortKey="nif" className="w-[8%]">NIF</SortableHeader>
                <SortableHeader sortKey="name" className="w-[23%]">Nome</SortableHeader>
                <th className="w-[17%] px-3 py-3 text-left text-[11px] font-semibold uppercase text-slate-600">Email / Telefone</th>
                <SortableHeader sortKey="entityType" className="w-[10%]">Tipo</SortableHeader>
                <SortableHeader sortKey="employeeCount" className="w-[7%]">Nº Func.</SortableHeader>
                <SortableHeader sortKey="documentCount" className="w-[7%]">Nº Docs</SortableHeader>
                <th className="w-[11%] px-3 py-3 text-left text-[11px] font-semibold uppercase text-slate-600">Responsável</th>
                <th className="w-[7%] px-3 py-3 text-center text-[11px] font-semibold uppercase text-slate-600">Recolha SAF-T</th>
                <th className="w-[7%] px-3 py-3 text-center text-[11px] font-semibold uppercase text-slate-600">Estado SAF-T</th>
                <th className="w-[5%] px-3 py-3 text-right text-[11px] font-semibold uppercase text-slate-600">Ações</th>
              </tr>
            </thead>
            <tbody>
              {processedClients.map(client => {
                const clientNif = normalizeNif(client.nif || '');
                const saftStatus = saftStatusByNif[clientNif];
                const hasSaftData = Boolean(saftStatus?.hasData);

                return (
                  <tr key={client.id} onClick={() => onSelectClient(client)} className="cursor-pointer border-t border-slate-100 transition-colors hover:bg-slate-50">
                    <td className="px-3 py-3 font-mono text-xs text-slate-700">{client.nif || '--'}</td>
                    <td className="px-3 py-3 text-sm text-slate-900">
                      <div className="truncate font-semibold" title={client.name}>{client.name}</div>
                      <div className="truncate text-xs text-slate-500">{client.sector || 'Geral'}</div>
                    </td>
                    <td className="px-3 py-3 text-xs">
                      <div className="truncate text-slate-700" title={client.email || '--'}>{client.email || '--'}</div>
                      <div className="font-mono text-slate-500">{client.phone || '--'}</div>
                    </td>
                    <td className="px-3 py-3">
                      <span className="inline-flex rounded-full bg-blue-100 px-2 py-0.5 text-[11px] font-semibold uppercase text-blue-800">
                        {client.entityType || 'Sem tipo'}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-center text-xs font-semibold text-slate-700">{client.employeeCount}</td>
                    <td className="px-3 py-3 text-center text-xs font-semibold text-slate-700">{client.documentCount}</td>
                    <td className="px-3 py-3 text-xs text-slate-700">{(client as any).responsibleStaffName}</td>
                    <td className="px-3 py-3 text-center" onClick={event => event.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={client.saftCollectEnabled !== false}
                        onChange={event => handleToggleSaftCollect(client, event.target.checked)}
                        className="h-4 w-4 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                        aria-label={`Recolha SAF-T de ${client.name}`}
                      />
                    </td>
                    <td className="px-3 py-3 text-center">
                      {hasSaftData ? (
                        <span
                          className="inline-flex items-center rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700"
                          title={`Última recolha: ${formatDateTime(saftStatus?.syncedAt)}`}
                        >
                          Com dados
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
                          Sem dados
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right" onClick={event => event.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => onSelectClient(client)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400"
                        title="Ver detalhes"
                        aria-label={`Ver detalhes de ${client.name}`}
                      >
                        <Eye size={14} />
                      </button>
                    </td>
                  </tr>
                );
              })}
              {!isLoadingPage && processedClients.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-4 py-10 text-center text-sm text-slate-500">Nenhum cliente encontrado para os filtros atuais.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 px-3 py-2 text-xs text-slate-600">
          <span>
            A mostrar {totalClients === 0 ? 0 : (page - 1) * pageSize + 1}–{Math.min(page * pageSize, totalClients)} de {totalClients}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setPage(prev => Math.max(1, prev - 1))}
              disabled={page <= 1 || isLoadingPage}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 font-semibold hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <ChevronLeft size={14} /> Anterior
            </button>
            <span className="min-w-[90px] text-center font-semibold">Página {page} de {totalPages}</span>
            <button
              type="button"
              onClick={() => setPage(prev => Math.min(totalPages, prev + 1))}
              disabled={page >= totalPages || isLoadingPage}
              className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2 py-1.5 font-semibold hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              Seguinte <ChevronRight size={14} />
            </button>
          </div>
        </div>
      </section>

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

                {canViewFinancial && <div>
                  <label className="text-xs font-bold text-slate-400">Avença Mensal</label>
                  <input
                    type="number"
                    step="0.01"
                    className="w-full p-2 border rounded border-slate-200"
                    value={formData.monthlyFee || 0}
                    onChange={e => setFormData({ ...formData, monthlyFee: parseFloat(e.target.value) || 0 })}
                  />
                </div>}

                <div>
                  <label className="text-xs font-bold text-slate-400">Responsável</label>
                  <select
                    className="w-full p-2 border rounded border-slate-200 bg-white disabled:bg-slate-100 disabled:text-slate-500"
                    value={formData.responsibleStaff || ''}
                    disabled={isResponsibleStaffLocked}
                    onChange={e => setFormData({ ...formData, responsibleStaff: e.target.value })}
                  >
                    <option value="">Não Atribuído</option>
                    {staff.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
                  </select>
                  {isResponsibleStaffLocked && (
                    <p className="text-[11px] text-slate-400 mt-1">
                      O seu nível de acesso só permite criar clientes atribuídos a si próprio.
                    </p>
                  )}
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
                    <option value="Inativo">Inativo</option>
                  </select>
                </div>

                <div>
                  <label className="text-xs font-bold text-slate-400">Consentimento de Marketing</label>
                  <select
                    className="w-full p-2 border rounded border-slate-200 bg-white"
                    value={formData.emailMarketingStatus || 'unknown'}
                    onChange={e => setFormData({ ...formData, emailMarketingStatus: e.target.value as Client['emailMarketingStatus'] })}
                  >
                    <option value="unknown">Desconhecido (não elegível para marketing)</option>
                    <option value="consented">Consentimento registado</option>
                    <option value="legitimate_interest">Interesse legítimo</option>
                    <option value="opted_out">Oposição (não contactar)</option>
                  </select>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Só clientes com consentimento ou interesse legítimo ficam elegíveis para campanhas de marketing. Emails de serviço não são afetados.
                  </p>
                </div>

                {(formData.emailMarketingStatus === 'consented' || formData.emailMarketingStatus === 'legitimate_interest') && (
                  <div className="md:col-span-2">
                    <label className="text-xs font-bold text-slate-400">Base do consentimento</label>
                    <input
                      className="w-full p-2 border rounded border-slate-200"
                      value={formData.emailMarketingConsentSource || ''}
                      onChange={e => setFormData({ ...formData, emailMarketingConsentSource: e.target.value })}
                      placeholder="ex.: formulário assinado em 2026-08-28, consentimento verbal em reunião"
                    />
                    {formData.emailMarketingConsentAt && (
                      <p className="text-[11px] text-slate-400 mt-1">
                        Registado em {new Date(formData.emailMarketingConsentAt).toLocaleString('pt-PT')}.
                      </p>
                    )}
                  </div>
                )}
              </div>

              <div className="flex justify-end gap-2 pt-4">
                <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-slate-500">Cancelar</button>
                <button type="submit" disabled={isSaving} className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold disabled:opacity-50">
                    {isSaving ? <RefreshCcw className="animate-spin" size={16} /> : 'Guardar'}
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
