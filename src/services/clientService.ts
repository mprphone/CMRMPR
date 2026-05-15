import { Client } from '../types';
import { importClient, ensureStoreClient } from './supabaseClient';

const mapDbToClient = (db: any): Client => ({
  ...db,
  id: db.id,
  name: db.name || db.nome || db.Name || db.Nome || db.cliente || db.Cliente || 'Sem Nome',
  email: db.email || '',
  phone: db.phone || db.telefone || '',
  address: db.address || db.morada || '',
  nif: db.nif || '',
  sector: db.sector || 'Geral',
  entityType: db.entity_type || db.tipo_entidade || 'SOCIEDADE',
  responsibleStaff: db.responsavel_interno_id || db.responsible_staff || db.responsavel || db.Responsavel || db.gestor || db.Gestor || '',
  status: db.status || db.estado || 'Ativo',
  monthlyFee: Number(db.monthly_fee || 0),
  employeeCount: Number(db.employee_count || 0),
  turnover: Number(db.turnover || 0),
  documentCount: Number(db.document_count || db.numero_documentos || 0),
  establishments: Number(db.establishments || 1),
  banks: Number(db.banks || 1),
  callTimeBalance: Number(db.call_time_balance || 0),
  travelCount: Number(db.travel_count || 0),
  deliversOrganizedDocs: db.delivers_organized_docs === null ? true : db.delivers_organized_docs,
  vatRefunds: db.vat_refunds || false,
  hasIneReport: db.has_ine_report || false,
  hasCostCenters: db.has_cost_centers || false,
  hasInternationalOps: db.has_international_ops || false,
  hasManagementReports: db.has_management_reports || false,
  supplierCount: Number(db.supplier_count || 0),
  customerCount: Number(db.customer_count || 0),
  communicationCount: Number(db.communication_count || 0),
  meetingCount: Number(db.meeting_count || 0),
  previousYearProfit: Number(db.previous_year_profit || 0),
  saftCollectEnabled: db.saft_collect_enabled === null || db.saft_collect_enabled === undefined ? true : Boolean(db.saft_collect_enabled),
  tasks: db.tasks || [],
  contractRenewalDate: db.contract_renewal_date || '',
  aiAnalysisCache: db.ai_analysis_cache || null
});

const mapClientToDb = (c: Client) => ({
  id: c.id,
  name: c.name,
  nif: c.nif,
  address: c.address,
  email: c.email,
  phone: c.phone,
  entity_type: c.entityType,
  status: c.status,
  sector: c.sector,
  responsavel_interno_id: (c.responsibleStaff && c.responsibleStaff.includes('-')) ? c.responsibleStaff : null,
monthly_fee: c.monthlyFee,
  employee_count: c.employeeCount,
  establishments: c.establishments,
  banks: c.banks,
  turnover: c.turnover,
  document_count: c.documentCount,
  call_time_balance: c.callTimeBalance,
  travel_count: c.travelCount,
  delivers_organized_docs: c.deliversOrganizedDocs,
  vat_refunds: c.vatRefunds,
  has_ine_report: c.hasIneReport,
  has_cost_centers: c.hasCostCenters,
  has_international_ops: c.hasInternationalOps,
  has_management_reports: c.hasManagementReports,
  supplier_count: c.supplierCount,
  customer_count: c.customerCount,
  communication_count: c.communicationCount,
  meeting_count: c.meetingCount,
  previous_year_profit: c.previousYearProfit,
  saft_collect_enabled: c.saftCollectEnabled === undefined ? true : Boolean(c.saftCollectEnabled),
  tasks: c.tasks,
  contract_renewal_date: c.contractRenewalDate || null,
  ai_analysis_cache: c.aiAnalysisCache
});

export const clientService = {
  async getAll(): Promise<Client[]> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.from('clients').select('*');
    if (error) throw error;
    return (data || []).map(mapDbToClient);
  },
  async getPaged(options: {
    page: number;
    pageSize: number;
    searchTerm?: string;
    status?: 'all' | Client['status'];
    entityType?: 'all' | string;
    responsibleStaffId?: 'all' | string;
    groupClientIds?: string[];
    sortKey?: 'name' | 'nif' | 'email' | 'phone' | 'entityType' | 'employeeCount' | 'documentCount' | 'monthlyFee' | 'status';
    sortDirection?: 'ascending' | 'descending';
  }): Promise<{ clients: Client[]; total: number; page: number; pageSize: number }> {
    const storeClient = ensureStoreClient();
    const page = Math.max(1, options.page || 1);
    const pageSize = Math.min(200, Math.max(5, options.pageSize || 25));
    const from = (page - 1) * pageSize;
    const to = from + pageSize - 1;

    if (Array.isArray(options.groupClientIds) && options.groupClientIds.length === 0) {
      return { clients: [], total: 0, page, pageSize };
    }

    let query = storeClient
      .from('clients')
      .select('*', { count: 'exact' });

    if (options.searchTerm && options.searchTerm.trim().length > 0) {
      const search = options.searchTerm.trim().replace(/[%]/g, '');
      query = query.or([
        `name.ilike.%${search}%`,
        `nif.ilike.%${search}%`,
        `email.ilike.%${search}%`,
        `phone.ilike.%${search}%`,
      ].join(','));
    }

    if (options.status && options.status !== 'all') {
      query = query.eq('status', options.status);
    }

    if (options.entityType && options.entityType !== 'all') {
      query = query.eq('entity_type', options.entityType);
    }

    if (options.responsibleStaffId && options.responsibleStaffId !== 'all') {
      query = query.eq('responsavel_interno_id', options.responsibleStaffId);
    }

    if (Array.isArray(options.groupClientIds) && options.groupClientIds.length > 0) {
      query = query.in('id', options.groupClientIds);
    }

    const sortColumnByKey: Record<NonNullable<typeof options.sortKey>, string> = {
      name: 'name',
      nif: 'nif',
      email: 'email',
      phone: 'phone',
      entityType: 'entity_type',
      employeeCount: 'employee_count',
      documentCount: 'document_count',
      monthlyFee: 'monthly_fee',
      status: 'status',
    };

    const sortKey = options.sortKey || 'name';
    const sortColumn = sortColumnByKey[sortKey] || 'name';
    const ascending = (options.sortDirection || 'ascending') === 'ascending';

    const { data, error, count } = await query
      .order(sortColumn, { ascending, nullsFirst: false })
      .range(from, to);

    if (error) throw error;

    return {
      clients: (data || []).map(mapDbToClient),
      total: count || 0,
      page,
      pageSize,
    };
  },
  async importExternalClients(): Promise<Client[]> {
    if (!importClient) throw new Error("Origem não configurada.");
    const { data, error } = await importClient.from('clientes').select('*');
    if (error) throw error;
    return (data || []).map(mapDbToClient);
  },
  async bulkUpsert(clients: Client[]): Promise<void> {
    const storeClient = ensureStoreClient();
    const clientsToUpsert = clients.map(c => ({
      nif: c.nif,
      name: c.name,
      email: c.email || '',
      phone: c.phone || '',
      address: c.address || '',
      entity_type: c.entityType || 'SOCIEDADE',
      sector: c.sector || 'Geral',
      status: c.status || 'Ativo',
      responsavel_interno_id: (c.responsibleStaff && c.responsibleStaff.includes('-')) ? c.responsibleStaff : null,
      responsavel_action: ((c as any).responsibleStaffAction as string) || 'keep'
    }));

    const { error } = await storeClient.rpc('bulk_upsert_clients_jsonb', { clients_data: clientsToUpsert });
    if (error) throw error;
  },
  async upsert(client: Client): Promise<Client> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.from('clients').upsert(mapClientToDb(client)).select().single();
    if (error) throw error;
    return mapDbToClient(data);
  }
};
