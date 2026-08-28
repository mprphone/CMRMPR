import { Client } from '../types';
import { importClient, ensureStoreClient } from './supabaseClient';

const normalizeClientStatus = (rawStatus: unknown): Client['status'] => {
  const value = String(rawStatus || '').trim().toLowerCase();
  if (!value) return 'Ativo';
  if (
    value.includes('inativ')
    || value.includes('inactive')
    || value.includes('encerrad')
    || value.includes('insolvente')
    || value.includes('mudou_de_contabilista')
    || value.includes('mudou de contabilista')
  ) return 'Inativo';
  if (value === 'cancelado') return 'Cancelado';
  if (value === 'risco') return 'Risco';
  if (value === 'em análise' || value === 'em analise') return 'Em Análise';
  if (['ativo', 'ativa', 'activo', 'activa', 'active'].includes(value)) return 'Ativo';
  // Evita estados vindos da origem que não existem nos filtros da aplicação.
  return 'Inativo';
};

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
  status: normalizeClientStatus(db.status || db.estado),
  emailMarketingStatus: db.email_marketing_status || 'unknown',
  emailMarketingConsentAt: db.email_marketing_consent_at || null,
  emailMarketingConsentSource: db.email_marketing_consent_source || null,
  vatRegion: db.vat_region || 'continente',
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
  email_marketing_status: c.emailMarketingStatus || 'unknown',
  email_marketing_consent_at: c.emailMarketingConsentAt || null,
  email_marketing_consent_source: c.emailMarketingConsentSource || null,
  vat_region: c.vatRegion || 'continente',
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
    const { data, error } = await storeClient.rpc('get_visible_clients');
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
    const page = Math.max(1, options.page || 1);
    const pageSize = Math.min(200, Math.max(5, options.pageSize || 25));

    if (Array.isArray(options.groupClientIds) && options.groupClientIds.length === 0) {
      return { clients: [], total: 0, page, pageSize };
    }

    let visibleClients = await this.getAll();

    if (options.searchTerm && options.searchTerm.trim().length > 0) {
      const search = options.searchTerm.trim().toLocaleLowerCase('pt-PT');
      visibleClients = visibleClients.filter(client => [client.name, client.nif, client.email, client.phone]
        .some(value => String(value || '').toLocaleLowerCase('pt-PT').includes(search)));
    }

    if (options.status && options.status !== 'all') {
      visibleClients = visibleClients.filter(client => client.status === options.status);
    }

    if (options.entityType && options.entityType !== 'all') {
      visibleClients = visibleClients.filter(client => client.entityType === options.entityType);
    }

    if (options.responsibleStaffId && options.responsibleStaffId !== 'all') {
      visibleClients = visibleClients.filter(client => client.responsibleStaff === options.responsibleStaffId);
    }

    if (Array.isArray(options.groupClientIds) && options.groupClientIds.length > 0) {
      const allowedIds = new Set(options.groupClientIds);
      visibleClients = visibleClients.filter(client => allowedIds.has(client.id));
    }

    const sortKey = options.sortKey || 'name';
    const direction = (options.sortDirection || 'ascending') === 'ascending' ? 1 : -1;
    const numericSortKeys = new Set(['employeeCount', 'documentCount', 'monthlyFee']);
    visibleClients.sort((left, right) => {
      const leftValue = left[sortKey];
      const rightValue = right[sortKey];
      if (numericSortKeys.has(sortKey)) {
        return (Number(leftValue || 0) - Number(rightValue || 0)) * direction;
      }
      return String(leftValue || '').localeCompare(String(rightValue || ''), 'pt-PT') * direction;
    });

    const total = visibleClients.length;
    const from = (page - 1) * pageSize;

    return {
      clients: visibleClients.slice(from, from + pageSize),
      total,
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
    // RPC com privilégio elevado (não .from('clients').upsert direto): as
    // colunas financeiras já não têm SELECT para "authenticated", e o
    // Postgres exige SELECT sobre qualquer coluna referenciada no SET de um
    // "ON CONFLICT DO UPDATE" — um upsert direto passou a falhar com
    // "permission denied for table clients" para qualquer utilizador,
    // incluindo administradores.
    const { error } = await storeClient.rpc('upsert_client', { p_client: mapClientToDb(client) });
    if (error) throw error;
    // maybeSingle (não single): a gravação já está concluída neste ponto —
    // se a releitura devolver 0 linhas (ex.: mudou entretanto de âmbito de
    // visibilidade), não queremos que um "single()" a rebentar leve o
    // utilizador a pensar que a gravação falhou quando não falhou.
    const { data, error: readError } = await storeClient
      .rpc('get_visible_client_by_id', { p_client_id: client.id })
      .maybeSingle();
    if (readError) throw readError;
    if (!data) {
      throw new Error('O cliente foi gravado, mas deixou de estar visível com o seu nível de acesso atual.');
    }
    return mapDbToClient(data);
  }
};
