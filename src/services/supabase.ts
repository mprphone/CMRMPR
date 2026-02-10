import { createClient, SupabaseClient, SupabaseClientOptions } from '@supabase/supabase-js';
import { Client, Staff, FeeGroup, GlobalSettings, EmailTemplate, CampaignHistory, TurnoverBracket, QuoteHistory, InsurancePolicy, WorkSafetyService, CashPayment, CashAgreement, CashOperation } from '../types';

export let importClient: SupabaseClient | null = null;
export let storeClient: SupabaseClient | null = null;

export const initSupabase = (settings: GlobalSettings) => {
  const iUrl = import.meta.env.VITE_SUPABASE_URL_IMPORT || settings.supabaseImportUrl;
  const iKey = import.meta.env.VITE_SUPABASE_KEY_IMPORT || settings.supabaseImportKey;
  const sUrl = import.meta.env.VITE_SUPABASE_URL_CMR || settings.supabaseStoreUrl;
  const sKey = import.meta.env.VITE_SUPABASE_KEY_CMR || settings.supabaseStoreKey;

  const supabaseOptions: SupabaseClientOptions<"public"> = {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: true, // Important for OAuth callbacks
    },
  };

  if (iUrl && iKey && iUrl.startsWith('http')) {
    importClient = createClient(iUrl, iKey);
  } else {
    importClient = null;
  }
  if (sUrl && sKey && sUrl.startsWith('http')) {
    storeClient = createClient(sUrl, sKey, supabaseOptions);
  } else {
    storeClient = null;
  }
};

// --- HELPER TO ENSURE CLIENT IS INITIALIZED ---
// This helps prevent issues with HMR (Hot Module Replacement) during development,
// where the client instance might be lost.
export const ensureStoreClient = (): SupabaseClient => {
  if (!storeClient) {
    const savedSettingsRaw = localStorage.getItem('globalSettings');
    if (savedSettingsRaw) {
      const savedSettings = JSON.parse(savedSettingsRaw);
      initSupabase(savedSettings);
    }
  }
  if (!storeClient) {
    throw new Error("Servidor de Gestão não configurado. Verifique as configurações e recarregue a página.");
  }
  return storeClient;
};

// --- MAPEAMENTOS ---
const mapDbToClient = (db: any): Client => ({
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
  tasks: c.tasks,
  contract_renewal_date: c.contractRenewalDate || null,
  ai_analysis_cache: c.aiAnalysisCache
});

const mapDbToStaff = (s: any): Staff => ({
  id: s.id,
  name: s.name || s.nome || s.Name || s.Nome || s.funcionario || s.Funcionario || 'Sem Nome',
  email: s.email || '',
  phone: s.phone || s.telefone || s.Phone || s.Telefone || '',
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
  name: s.name,
  email: s.email,
  phone: s.phone,
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
    const storeClient = ensureStoreClient();
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

export const staffService = {
  async getAll(): Promise<Staff[]> {
    const storeClient = ensureStoreClient();
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
    const storeClient = ensureStoreClient();
    // During sync, we only want to update core identification fields.
    const staffToUpsert = members.map(s => ({
      id: s.id, // Conflict key
      name: s.name,
      email: s.email,
      phone: s.phone,
      role: s.role,
      // Financial data is managed inside the app, so we don't overwrite it during sync.
    }));
    const { error } = await storeClient.from('staff').upsert(staffToUpsert, { onConflict: 'id' });
    if (error) throw error;
  },
  async upsert(member: Staff): Promise<Staff> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.from('staff').upsert(mapStaffToDb(member)).select().single();
    if (error) throw error;
    return mapDbToStaff(data);
  }
};

export const groupService = {
  async getAll(): Promise<FeeGroup[]> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.from('fee_groups').select('*');
    if (error) throw error;
    return (data || []).map(g => ({ id: g.id, name: g.name, description: g.description, clientIds: g.client_ids || [], proposed_fees: g.proposed_fees || {} }));
  },
  async upsert(group: FeeGroup): Promise<FeeGroup> {
    const storeClient = ensureStoreClient();
    const groupToSave = { id: group.id, name: group.name, description: group.description, client_ids: group.clientIds, proposed_fees: group.proposed_fees || {} };
    const { data, error } = await storeClient.from('fee_groups').upsert(groupToSave).select().single();
    if (error) throw error;
    // Map back from DB schema to app schema
    return { id: data.id, name: data.name, description: data.description, clientIds: data.client_ids || [], proposed_fees: data.proposed_fees || {} };
  }
};

export const templateService = {
  async getAll(): Promise<EmailTemplate[]> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.from('email_templates').select('*').order('name');
    if (error) throw error;
    return data || [];
  },
  async upsert(template: Partial<EmailTemplate>): Promise<EmailTemplate> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.from('email_templates').upsert(template).select().single();
    if (error) throw error;
    return data;
  },
  async delete(id: string): Promise<void> {
    const storeClient = ensureStoreClient();
    const { error } = await storeClient.from('email_templates').delete().match({ id });
    if (error) throw error;
  }
};

const mapDbToWorkSafetyService = (p: any): WorkSafetyService => ({
  id: p.id,
  clientId: p.client_id,
  clientName: p.clients?.name || 'Cliente Desconhecido',
  serviceDate: p.service_date,
  renewalTerm: p.renewal_term,
  provider: p.provider,
  totalValue: p.total_value,
  hasCommission: p.has_commission,
  isCommissionPaid: p.is_commission_paid,
  proposalStatus: p.proposal_status,
  attachment_url: p.attachment_url,
});

const mapWorkSafetyServiceToDb = (p: Partial<WorkSafetyService>) => ({
  id: p.id,
  client_id: p.clientId,
  service_date: p.serviceDate,
  renewal_term: p.renewalTerm,
  provider: p.provider,
  total_value: p.totalValue,
  has_commission: p.hasCommission,
  is_commission_paid: p.isCommissionPaid,
  proposal_status: p.proposalStatus,
  attachment_url: p.attachment_url,
});

export const workSafetyService = {
  async getAll(): Promise<WorkSafetyService[]> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.from('work_safety_services').select(`
      *,
      clients (id, name)
    `).order('service_date', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapDbToWorkSafetyService);
  },
  async upsert(service: Partial<WorkSafetyService>): Promise<WorkSafetyService> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient
      .from('work_safety_services')
      .upsert(mapWorkSafetyServiceToDb(service))
      .select('*, clients (id, name)')
      .single();
    if (error) throw error;
    return mapDbToWorkSafetyService(data);
  },
  async delete(id: string): Promise<void> {
    const storeClient = ensureStoreClient();
    const { error } = await storeClient.from('work_safety_services').delete().match({ id });
    if (error) throw error;
  },
  async uploadAttachment(file: File, serviceId: string): Promise<string> {
    const storeClient = ensureStoreClient();
    const filePath = `sht/${serviceId}/${file.name}`;
    
    const { error: uploadError } = await storeClient.storage
      .from('attachments')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true,
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = storeClient.storage
      .from('attachments')
      .getPublicUrl(filePath);

    return data.publicUrl;
  }
};

export const cashPaymentService = {
  async getAll(): Promise<CashPayment[]> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.from('cash_payments').select('*');
    if (error) throw error;
    return data.map(p => ({
      id: p.id,
      clientId: p.client_id,
      paymentYear: p.payment_year,
      paymentMonth: p.payment_month,
      amountPaid: p.amount_paid,
      paidAt: p.paid_at,
      paymentMethod: p.payment_method || 'Numerário',
      cashOperationId: p.cash_operation_id,
    }));
  },
  async bulkUpsert(payments: Partial<CashPayment>[]): Promise<void> {
    const storeClient = ensureStoreClient();
    const toSave = payments.map(p => ({
      id: p.id,
      client_id: p.clientId,
      payment_year: p.paymentYear,
      payment_month: p.paymentMonth,
      amount_paid: p.amountPaid,
      paid_at: p.paidAt,
      payment_method: p.paymentMethod,
    }));
    const { error } = await storeClient.rpc('bulk_upsert_cash_payments', { payments_data: toSave });
    if (error) throw error;
  },
  async deleteMany(ids: string[]): Promise<void> {
    const storeClient = ensureStoreClient();
    const { error } = await storeClient.from('cash_payments').delete().in('id', ids);
    if (error) throw error;
  }
};

export const cashAgreementService = {
  async getAll(): Promise<CashAgreement[]> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient
      .from('cash_payment_agreements')
      .select('*')
      .order('agreement_year', { ascending: false });

    if (error) throw error;

    return (data || []).map(a => ({
      id: a.id,
      clientId: a.client_id,
      agreementYear: a.agreement_year,
      paidUntilMonth: a.paid_until_month,
      monthlyAmount: a.monthly_amount,
      debtAmount: a.debt_amount,
      status: a.status || 'Ativo',
      notes: a.notes || '',
      called: a.called || false,
      letterSent: a.letter_sent || false,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
    }));
  },
  async upsert(agreement: Partial<CashAgreement>): Promise<CashAgreement> {
    const storeClient = ensureStoreClient();

    const payload: any = {
      client_id: agreement.clientId,
      agreement_year: agreement.agreementYear,
      paid_until_month: agreement.paidUntilMonth,
      monthly_amount: agreement.monthlyAmount,
      debt_amount: agreement.debtAmount,
      status: agreement.status || 'Ativo',
      notes: agreement.notes || '',
      called: agreement.called || false,
      letter_sent: agreement.letterSent || false,
    };
    if (agreement.id) payload.id = agreement.id;

    const { data, error } = await storeClient
      .from('cash_payment_agreements')
      .upsert(payload, { onConflict: 'client_id,agreement_year' })
      .select()
      .single();

    if (error) throw error;

    return {
      id: data.id,
      clientId: data.client_id,
      agreementYear: data.agreement_year,
      paidUntilMonth: data.paid_until_month,
      monthlyAmount: data.monthly_amount,
      debtAmount: data.debt_amount,
      status: data.status || 'Ativo',
      notes: data.notes || '',
      called: data.called || false,
      letterSent: data.letter_sent || false,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  },
  async delete(id: string): Promise<void> {
    const storeClient = ensureStoreClient();
    const { error } = await storeClient.from('cash_payment_agreements').delete().match({ id });
    if (error) throw error;
  }
};

export const cashOperationService = {
  async getAll(): Promise<CashOperation[]> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.from('cash_operations').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data.map(op => ({
      id: op.id,
      createdAt: op.created_at,
      depositedAmount: op.deposited_amount,
      spentAmount: op.spent_amount,
      mbWayDepositedAmount: op.mbway_deposited_amount,
      adjustmentAmount: op.adjustment_amount,
      spentDescription: op.spent_description,
      reportDetails: op.report_details,
    }));
  },
  async create(operation: Partial<CashOperation>, paymentIds: string[]): Promise<CashOperation> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.rpc('create_cash_operation', {
      p_deposited_amount: operation.depositedAmount,
      p_spent_amount: operation.spentAmount,
      p_spent_description: operation.spentDescription,
      p_report_details: operation.reportDetails,
      p_payment_ids: paymentIds,
      p_mbway_deposited_amount: operation.mbWayDepositedAmount,
      p_adjustment_amount: operation.adjustmentAmount,
    }).single();

    if (error) throw error;
    
    return {
      id: data.id,
      createdAt: data.created_at,
      depositedAmount: data.deposited_amount,
      spentAmount: data.spent_amount,
      mbWayDepositedAmount: data.mbway_deposited_amount,
      adjustmentAmount: data.adjustment_amount,
      spentDescription: data.spent_description,
      reportDetails: data.report_details,
    };
  }
};

export const campaignHistoryService = {
  async getAll(): Promise<CampaignHistory[]> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient
      .from('email_campaign_history')
      .select('*')
      .order('sent_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },
  async create(campaign: Partial<CampaignHistory>): Promise<CampaignHistory> {
    const storeClient = ensureStoreClient();
    let { data, error } = await storeClient.from('email_campaign_history').insert(campaign).select().single();

    // Backward compatibility for DBs that still don't have recipient_results.
    if (error && campaign && 'recipient_results' in campaign && /recipient_results/i.test(error.message || '')) {
      const { recipient_results, ...fallbackPayload } = campaign as any;
      const retry = await storeClient.from('email_campaign_history').insert(fallbackPayload).select().single();
      data = retry.data;
      error = retry.error;
    }

    if (error) throw error;
    return data as CampaignHistory;
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
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.from('turnover_brackets').select('*').order('min_turnover');
    if (error) throw error;
    return (data || []).map(mapDbToTurnoverBracket);
  },
  async replaceAll(brackets: TurnoverBracket[]): Promise<void> { // This function is more robust
    const storeClient = ensureStoreClient();
    
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
    const { error: upsertError } = await storeClient
      .from('turnover_brackets')
      .upsert(brackets.map(mapTurnoverBracketToDb), { onConflict: 'id' });
    if (upsertError) throw upsertError;
  }
};

const mapDbToQuoteHistory = (db: any): QuoteHistory => ({
  id: db.id,
  created_at: db.created_at,
  client_name: db.client_name,
  client_nif: db.client_nif,
  client_volume: db.client_volume,
  employee_count: db.employee_count || 0,
  document_count: db.document_count || 0,
  establishments: db.establishments || 0,
  banks: db.banks || 0,
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
  employee_count: q.employee_count,
  document_count: q.document_count,
  establishments: q.establishments,
  banks: q.banks,
  items: q.items,
  target_margin: q.target_margin,
  recommended_monthly_fee: q.recommended_monthly_fee,
  total_annual_cost: q.total_annual_cost,
  total_annual_hours: q.total_annual_hours,
});

export const quoteHistoryService = {
  async getAll(): Promise<QuoteHistory[]> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient
      .from('quote_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data || []).map(mapDbToQuoteHistory);
  },
  async create(quote: Partial<QuoteHistory>): Promise<QuoteHistory> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.from('quote_history').insert(mapQuoteHistoryToDb(quote)).select().single();
    if (error) throw error;
    return mapDbToQuoteHistory(data);
  },
  async delete(id: string): Promise<void> {
    const storeClient = ensureStoreClient();
    const { error } = await storeClient.from('quote_history').delete().match({ id });
    if (error) throw error;
  }
};

const mapDbToInsurancePolicy = (p: any): InsurancePolicy => ({
  id: p.id,
  clientId: p.client_id,
  clientName: p.clients?.name || 'Cliente Desconhecido',
  policyDate: p.policy_date,
  policyNumber: p.policy_number,
  insuranceProvider: p.insurance_provider,
  paymentFrequency: p.payment_frequency,
  policyType: p.policy_type,
  premiumValue: p.premium_value,
  commissionRate: p.commission_rate,
  commissionPaid: p.commission_paid,
  status: p.status || 'Proposta',
  attachment_url: p.attachment_url,
  communicationType: p.communication_type,
  policyTier: p.policy_tier,
});

const mapInsurancePolicyToDb = (p: Partial<InsurancePolicy>) => ({
  id: p.id,
  client_id: p.clientId,
  policy_date: p.policyDate,
  policy_number: p.policyNumber,
  insurance_provider: p.insuranceProvider,
  payment_frequency: p.paymentFrequency,
  policy_type: p.policyType,
  premium_value: p.premiumValue,
  commission_rate: p.commissionRate,
  commission_paid: p.commissionPaid,
  status: p.status,
  attachment_url: p.attachment_url,
  communication_type: p.communicationType,
  policy_tier: p.policyTier,
});

export const insuranceService = {
  async getAll(): Promise<InsurancePolicy[]> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.from('insurance_policies').select(`
      *,
      clients (id, name)
    `).order('policy_date', { ascending: false });
    if (error) throw error;
    return (data || []).map(mapDbToInsurancePolicy);
  },
  async upsert(policy: Partial<InsurancePolicy>): Promise<InsurancePolicy> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.from('insurance_policies').upsert(mapInsurancePolicyToDb(policy)).select('*, clients (id, name)').single();
    if (error) throw error;
    return mapDbToInsurancePolicy(data);
  },
  async delete(id: string): Promise<void> {
    const storeClient = ensureStoreClient();
    const { error } = await storeClient.from('insurance_policies').delete().match({ id });
    if (error) throw error;
  },
  async uploadAttachment(file: File, policyId: string): Promise<string> {
    const storeClient = ensureStoreClient();
    const filePath = `policies/${policyId}/${file.name}`;
    
    const { error: uploadError } = await storeClient.storage
      .from('attachments')
      .upload(filePath, file, {
        cacheControl: '3600',
        upsert: true,
      });

    if (uploadError) {
      throw uploadError;
    }

    const { data } = storeClient.storage
      .from('attachments')
      .getPublicUrl(filePath);

    return data.publicUrl;
  }
};
