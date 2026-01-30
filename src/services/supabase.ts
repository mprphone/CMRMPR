import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { Client, Staff, FeeGroup, GlobalSettings, EmailTemplate, CampaignHistory, TurnoverBracket, QuoteHistory } from '../types';

export let importClient: SupabaseClient | null = null;
export let storeClient: SupabaseClient | null = null;

export const initSupabase = (settings: GlobalSettings) => {
  const iUrl = import.meta.env.VITE_SUPABASE_URL_IMPORT || settings.supabaseImportUrl;
  const iKey = import.meta.env.VITE_SUPABASE_KEY_IMPORT || settings.supabaseImportKey;
  const sUrl = import.meta.env.VITE_SUPABASE_URL_CMR || settings.supabaseStoreUrl;
  const sKey = import.meta.env.VITE_SUPABASE_KEY_CMR || settings.supabaseStoreKey;

  if (iUrl && iKey && iUrl.startsWith('http')) {
    importClient = createClient(iUrl, iKey);
  }
  if (sUrl && sKey && sUrl.startsWith('http')) {
    storeClient = createClient(sUrl, sKey);
  }
};

// --- MAPEAMENTOS ---
const mapDbToClient = (db: any): Client => ({
  id: db.id,
  name: db.nome || db.name || 'Sem Nome',
  email: db.email || '',
  phone: db.phone || db.telefone || '',
  address: db.morada || db.address || '',
  nif: db.nif || '',
  sector: db.sector || db.cae_principal || 'Geral',
  entityType: db.tipo_entidade || db.entity_type || 'SOCIEDADE',
  responsibleStaff: db.responsavel_interno_id || db.responsavel || '',
  status: db.estado || db.status || 'Ativo',
  monthlyFee: Number(db.monthly_fee || 0),
  employeeCount: Number(db.employee_count || 0),
  turnover: Number(db.turnover || 0),
  documentCount: Number(db.numero_documentos || db.document_count || 0),
  establishments: Number(db.establishments || 1),
  banks: Number(db.banks || 1),
  callTimeBalance: Number(db.call_time_balance || 0),
  travelCount: Number(db.travel_count || 0),
  tasks: db.tasks || [],
  contractRenewalDate: db.contract_renewal_date || '',
  aiAnalysisCache: db.ai_analysis_cache || null
});

const mapClientToDb = (c: Client) => ({
  id: c.id,
  name: c.name, nome: c.name,
  nif: c.nif,
  address: c.address, morada: c.address,
  email: c.email,
  phone: c.phone, telefone: c.phone,
  entity_type: c.entityType, tipo_entidade: c.entityType,
  status: c.status, estado: c.status,
  sector: c.sector,
  responsavel_interno_id: (c.responsibleStaff && c.responsibleStaff.includes('-')) ? c.responsibleStaff : null,
  monthly_fee: c.monthlyFee,
  employee_count: c.employeeCount,
  establishments: c.establishments,
  banks: c.banks,
  turnover: c.turnover,
  document_count: c.documentCount, numero_documentos: c.documentCount,
  call_time_balance: c.callTimeBalance,
  travel_count: c.travelCount,
  tasks: c.tasks,
  contract_renewal_date: c.contractRenewalDate,
  ai_analysis_cache: c.aiAnalysisCache
});

const mapDbToStaff = (s: any): Staff => ({
  id: s.id,
  name: s.nome || s.name || 'Sem Nome',
  email: s.email || '',
  phone: s.phone || s.telefone || '',
  role: s.role || 'Colaborador',
  baseSalary: Number(s.base_salary || 0),
  socialChargesPercent: Number(s.social_charges_percent || 23.75),
  mealAllowance: Number(s.meal_allowance || 0),
  otherMonthlyCosts: Number(s.other_monthly_costs || 0),
  capacityHoursPerMonth: Number(s.capacity_hours_per_month || 160),
  hourlyCost: Number(s.hourly_cost || 0),
  assignedAreas: s.assigned_areas || []
});

const mapStaffToDb = (s: Staff) => ({
  id: s.id,
  name: s.name, nome: s.name,
  email: s.email,
  phone: s.phone, telefone: s.phone,
  role: s.role,
  base_salary: s.baseSalary,
  social_charges_percent: s.socialChargesPercent,
  meal_allowance: s.mealAllowance,
  other_monthly_costs: s.otherMonthlyCosts,
  capacity_hours_per_month: s.capacityHoursPerMonth,
  hourly_cost: s.hourlyCost,
  assigned_areas: s.assignedAreas
});

export const clientService = {
  async getAll(): Promise<Client[]> {
    if (!storeClient) return [];
    const { data, error } = await storeClient.from('clients').select('*');
    if (error) throw error;
    return (data || []).map(mapDbToClient);
  },
  async importExternalClients(): Promise<Client[]> {
    if (!importClient) throw new Error("Origem não configurada.");
    const { data, error } = await importClient.from('clientes').select('*');
    if (error) throw error;
    return (data || []).map(mapDbToClient);
  },
  async bulkUpsert(clients: Client[]): Promise<void> {
    if (!storeClient) return;
    // During sync, we only want to update core identification fields, not financial/operational data.
    const clientsToUpsert = clients.map(c => ({
      nif: c.nif, // Conflict key
      name: c.name, nome: c.name,
      email: c.email,
      phone: c.phone, telefone: c.phone,
      address: c.address, morada: c.address,
      entity_type: c.entityType, tipo_entidade: c.entityType,
      sector: c.sector,
      // By omitting other fields, upsert will not overwrite them on existing records.
    }));
    const { error } = await storeClient.from('clients').upsert(clientsToUpsert, { onConflict: 'nif' });
    if (error) throw error;
  },
  async upsert(client: Client): Promise<Client> {
    if (!storeClient) throw new Error("Servidor de Gestão não configurado.");
    const { data, error } = await storeClient.from('clients').upsert(mapClientToDb(client)).select().single();
    if (error) throw error;
    return mapDbToClient(data);
  }
};

export const staffService = {
  async getAll(): Promise<Staff[]> {
    if (!storeClient) return [];
    const { data, error } = await storeClient.from('staff').select('*');
    if (error) throw error;
    return (data || []).map(mapDbToStaff);
  },
  async importExternalStaff(): Promise<Staff[]> {
    if (!importClient) throw new Error("Origem não configurada.");
    const { data, error } = await importClient.from('funcionarios').select('*');
    if (error) throw error;
    // Import only identifying info, set defaults for financial data
    return (data || []).map(s => (mapDbToStaff(s)));
  },
  async bulkUpsert(members: Staff[]): Promise<void> {
    if (!storeClient) return;
    // During sync, we only want to update core identification fields.
    const staffToUpsert = members.map(s => ({
      id: s.id, // Conflict key
      name: s.name, nome: s.name,
      email: s.email,
      phone: s.phone, telefone: s.phone,
      role: s.role,
      // Financial data is managed inside the app, so we don't overwrite it during sync.
    }));
    const { error } = await storeClient.from('staff').upsert(staffToUpsert, { onConflict: 'id' });
    if (error) throw error;
  },
  async upsert(member: Staff): Promise<Staff> {
    if (!storeClient) throw new Error("Servidor de Gestão não configurado.");
    const { data, error } = await storeClient.from('staff').upsert(mapStaffToDb(member)).select().single();
    if (error) throw error;
    return mapDbToStaff(data);
  }
};

export const groupService = {
  async getAll(): Promise<FeeGroup[]> {
    if (!storeClient) return [];
    const { data, error } = await storeClient.from('fee_groups').select('*');
    if (error) throw error;
    return (data || []).map(g => ({ id: g.id, name: g.name, description: g.description, clientIds: g.client_ids || [] }));
  },
  async upsert(group: FeeGroup): Promise<FeeGroup> {
    if (!storeClient) throw new Error("Servidor de Gestão não configurado.");
    const groupToSave = { id: group.id, name: group.name, description: group.description, client_ids: group.clientIds };
    const { data, error } = await storeClient.from('fee_groups').upsert(groupToSave).select().single();
    if (error) throw error;
    // Map back from DB schema to app schema
    return { id: data.id, name: data.name, description: data.description, clientIds: data.client_ids || [] };
  }
};

export const templateService = {
  async getAll(): Promise<EmailTemplate[]> {
    if (!storeClient) return [];
    const { data, error } = await storeClient.from('email_templates').select('*').order('name');
    if (error) throw error;
    return data || [];
  },
  async upsert(template: Partial<EmailTemplate>): Promise<EmailTemplate> {
    if (!storeClient) throw new Error("Servidor de Gestão não configurado.");
    const { data, error } = await storeClient.from('email_templates').upsert(template).select().single();
    if (error) throw error;
    return data;
  },
  async delete(id: string): Promise<void> {
    if (!storeClient) throw new Error("Servidor de Gestão não configurado.");
    const { error } = await storeClient.from('email_templates').delete().match({ id });
    if (error) throw error;
  }
};

export const campaignHistoryService = {
  async getAll(): Promise<CampaignHistory[]> {
    if (!storeClient) return [];
    const { data, error } = await storeClient
      .from('email_campaign_history')
      .select('*')
      .order('sent_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },
  async create(campaign: Partial<CampaignHistory>): Promise<CampaignHistory> {
    if (!storeClient) throw new Error("Servidor de Gestão não configurado.");
    const { data, error } = await storeClient.from('email_campaign_history').insert(campaign).select().single();
    if (error) throw error;
    return data;
  }
};

const mapDbToTurnoverBracket = (db: any): TurnoverBracket => ({
  id: db.id,
  minTurnover: db.min_turnover,
  maxTurnover: db.max_turnover,
  minPercent: db.min_percent,
  maxPercent: db.max_percent,
});

const mapTurnoverBracketToDb = (b: TurnoverBracket) => ({
  id: b.id,
  min_turnover: b.minTurnover,
  max_turnover: b.maxTurnover,
  min_percent: b.minPercent,
  max_percent: b.maxPercent,
});

export const turnoverBracketService = {
  async getAll(): Promise<TurnoverBracket[]> {
    if (!storeClient) return [];
    const { data, error } = await storeClient.from('turnover_brackets').select('*').order('min_turnover');
    if (error) throw error;
    return (data || []).map(mapDbToTurnoverBracket);
  },
  async replaceAll(brackets: TurnoverBracket[]): Promise<void> { // This function is more robust
    if (!storeClient) throw new Error("Servidor de Gestão não configurado.");
    
    // Get all existing IDs from the DB to determine which ones to delete
    const { data: existingBrackets, error: fetchError } = await storeClient.from('turnover_brackets').select('id');
    if (fetchError) throw fetchError;
    const existingIds = existingBrackets.map(b => b.id);
    const newIds = brackets.map(b => b.id);

    // Find and delete brackets that are no longer in the UI list
    const idsToDelete = existingIds.filter(id => !newIds.includes(id));
    if (idsToDelete.length > 0) {
        const { error: deleteError } = await storeClient.from('turnover_brackets').delete().in('id', idsToDelete);
        if (deleteError) throw deleteError;
    }

    if (brackets.length === 0) return;
    // Upsert all current brackets. This will update existing ones and insert new ones.
    const { error: upsertError } = await storeClient.from('turnover_brackets').upsert(brackets.map(mapTurnoverBracketToDb));
    if (upsertError) throw upsertError;
  }
};

const mapDbToQuoteHistory = (db: any): QuoteHistory => ({
  id: db.id,
  created_at: db.created_at,
  client_name: db.client_name,
  client_nif: db.client_nif,
  client_volume: db.client_volume,
  items: db.items,
  target_margin: db.target_margin,
  recommended_monthly_fee: db.recommended_monthly_fee,
  total_annual_cost: db.total_annual_cost,
  total_annual_hours: db.total_annual_hours,
});

const mapQuoteHistoryToDb = (q: Partial<QuoteHistory>) => ({
  id: q.id,
  client_name: q.client_name,
  client_nif: q.client_nif,
  client_volume: q.client_volume,
  items: q.items,
  target_margin: q.target_margin,
  recommended_monthly_fee: q.recommended_monthly_fee,
  total_annual_cost: q.total_annual_cost,
  total_annual_hours: q.total_annual_hours,
});

export const quoteHistoryService = {
  async getAll(): Promise<QuoteHistory[]> {
    if (!storeClient) return [];
    const { data, error } = await storeClient
      .from('quote_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data || []).map(mapDbToQuoteHistory);
  },
  async create(quote: Partial<QuoteHistory>): Promise<QuoteHistory> {
    if (!storeClient) throw new Error("Servidor de Gestão não configurado.");
    const { data, error } = await storeClient.from('quote_history').insert(mapQuoteHistoryToDb(quote)).select().single();
    if (error) throw error;
    return mapDbToQuoteHistory(data);
  }
};