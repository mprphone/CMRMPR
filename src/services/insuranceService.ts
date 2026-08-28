import { InsurancePolicy, InsuranceCommissionSettlement } from '../types';
import { ensureStoreClient } from './supabaseClient';
import { createSignedAttachmentUrl, getAttachmentStoragePath, validateAttachmentFile } from './storageAttachmentService';

const LEGACY_MEDIATOR_PARTNERS = ['Finiconde', 'Nepseguros', 'Neoseguros'];

const normalizeMediatorPartner = (value?: string | null) => {
  if (!value) return undefined;
  return value === 'Nepseguros' ? 'Neoseguros' : value;
};

const isLegacyMediatorPartner = (value?: string | null) =>
  Boolean(value && LEGACY_MEDIATOR_PARTNERS.includes(value));

const mapDbToInsurancePolicy = (p: any): InsurancePolicy => ({
  id: p.id,
  clientId: p.client_id,
  clientName: p.clients?.name || p.policy_holder || 'Cliente Desconhecido',
  policyHolder: p.policy_holder || p.clients?.name || '',
  agent: (p.internal_responsible || p.agent || undefined) as InsurancePolicy['agent'],
  mediatorPartner: p.mediator_partner || normalizeMediatorPartner(isLegacyMediatorPartner(p.company) ? p.company : p.insurance_provider),
  internalResponsible: (p.internal_responsible || p.agent || undefined) as InsurancePolicy['internalResponsible'],
  policyDate: p.policy_date,
  renewalDate: p.renewal_date || p.policy_date,
  policyNumber: p.policy_number,
  company: isLegacyMediatorPartner(p.company) || isLegacyMediatorPartner(p.insurance_provider) ? undefined : p.company || p.insurance_provider,
  branch: p.branch || p.policy_type,
  insuranceProvider: isLegacyMediatorPartner(p.company) || isLegacyMediatorPartner(p.insurance_provider) ? undefined : p.company || p.insurance_provider,
  paymentFrequency: p.payment_frequency,
  policyType: p.branch || p.policy_type,
  premiumValue: Number(p.premium_value ?? p.net_premium_value ?? 0),
  netPremiumValue: Number(p.net_premium_value ?? p.premium_value ?? 0),
  commissionRate: p.commission_rate,
  commissionPaid: p.commission_paid,
  hasReceipt: Boolean(p.has_receipt),
  status: p.status || 'Proposta',
  attachment_url: getAttachmentStoragePath(p.attachment_url) || null,
  communicationType: p.communication_type,
  notes: p.notes || '',
  policyTier: p.policy_tier,
  documentChecklist: p.document_checklist && typeof p.document_checklist === 'object' ? p.document_checklist : {},
  createdAt: p.created_at,
  updatedAt: p.updated_at,
});

const mapInsurancePolicyToDb = (p: Partial<InsurancePolicy>) => ({
  id: p.id,
  client_id: p.clientId ?? null,
  policy_holder: p.policyHolder || null,
  agent: p.internalResponsible || p.agent || null,
  mediator_partner: p.mediatorPartner || null,
  internal_responsible: p.internalResponsible || p.agent || null,
  policy_date: p.policyDate,
  renewal_date: p.renewalDate || p.policyDate || null,
  policy_number: p.policyNumber,
  company: p.company || p.insuranceProvider || null,
  branch: p.branch || p.policyType || null,
  insurance_provider: p.company || p.insuranceProvider || null,
  payment_frequency: p.paymentFrequency,
  policy_type: p.branch || p.policyType || null,
  premium_value: p.premiumValue ?? p.netPremiumValue ?? 0,
  net_premium_value: p.netPremiumValue ?? p.premiumValue ?? 0,
  commission_rate: p.commissionRate,
  commission_paid: p.commissionPaid,
  has_receipt: p.hasReceipt ?? false,
  status: p.status,
  // Normaliza para o caminho limpo no bucket: evita gravar na BD um URL
  // assinado (com TTL de 15 min) reenviado a partir de uma leitura anterior.
  attachment_url: getAttachmentStoragePath(p.attachment_url) || p.attachment_url || null,
  communication_type: p.communicationType,
  notes: p.notes || null,
  policy_tier: p.policyTier,
  document_checklist: p.documentChecklist || {},
});

const mapDbToInsuranceCommissionSettlement = (row: any): InsuranceCommissionSettlement => ({
  id: row.id,
  policyId: row.policy_id,
  dueDate: row.due_date,
  amount: Number(row.amount ?? 0),
  paidAt: row.paid_at,
  createdAt: row.created_at,
});

const fetchClientNamesByIds = async (
  storeClient: ReturnType<typeof ensureStoreClient>,
  clientIds: Array<string | null | undefined>
): Promise<Map<string, string>> => {
  const uniqueIds = Array.from(new Set(clientIds.filter((id): id is string => Boolean(id))));
  if (uniqueIds.length === 0) return new Map();
  const { data, error } = await storeClient.from('clients').select('id, name').in('id', uniqueIds);
  if (error) throw error;
  return new Map((data || []).map((row: any) => [row.id, row.name]));
};

export const insuranceService = {
  async getAll(): Promise<InsurancePolicy[]> {
    const storeClient = ensureStoreClient();
    // As comissões/prémios são mascarados na origem por get_visible_insurance_policies
    // (RPC) consoante can_view_commissions; um select direto à tabela já não
    // devolve essas colunas (ver migração 20260826142500).
    const { data, error } = await storeClient.rpc('get_visible_insurance_policies');
    if (error) throw error;
    const rows = (data || []) as any[];
    const clientNameById = await fetchClientNamesByIds(storeClient, rows.map(row => row.client_id));
    const sorted = [...rows].sort((a, b) => String(b.policy_date || '').localeCompare(String(a.policy_date || '')));
    return Promise.all(sorted.map(async row => {
      const policy = mapDbToInsurancePolicy({
        ...row,
        clients: row.client_id ? { name: clientNameById.get(row.client_id) } : undefined,
      });
      return {
        ...policy,
        attachment_url: await createSignedAttachmentUrl(policy.attachment_url),
      };
    }));
  },
  async upsert(policy: Partial<InsurancePolicy>): Promise<InsurancePolicy> {
    const storeClient = ensureStoreClient();
    const payload = mapInsurancePolicyToDb(policy);
    // RPC com privilégio elevado — ver o mesmo raciocínio em clientService.upsert
    // (colunas de comissão sem SELECT direto quebram um upsert direto na tabela).
    const { error } = await storeClient.rpc('upsert_insurance_policy', { p_policy: payload });
    if (error) throw error;

    const { data, error: readError } = await storeClient
      .rpc('get_visible_insurance_policy_by_id', { p_policy_id: payload.id })
      .maybeSingle();
    if (readError) throw readError;
    if (!data) {
      throw new Error('A apólice foi gravada, mas deixou de estar visível com o seu nível de acesso atual.');
    }

    const row = data as any;
    const clientNameById = await fetchClientNamesByIds(storeClient, [row?.client_id]);
    const savedPolicy = mapDbToInsurancePolicy({
      ...row,
      clients: row?.client_id ? { name: clientNameById.get(row.client_id) } : undefined,
    });
    return {
      ...savedPolicy,
      attachment_url: await createSignedAttachmentUrl(savedPolicy.attachment_url),
    };
  },
  async getCommissionSettlementsByPeriod(periodStart: string, periodEnd: string): Promise<InsuranceCommissionSettlement[]> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient
      .from('insurance_commission_settlements')
      .select('*')
      .gte('due_date', periodStart)
      .lte('due_date', periodEnd)
      .order('due_date', { ascending: true });

    if (error) {
      const missingTableError = /relation .*insurance_commission_settlements.* does not exist|schema cache|could not find the table/i;
      if (missingTableError.test(error.message || '')) {
        throw new Error('A tabela de comissões ainda não existe. Execute: supabase db push');
      }
      throw error;
    }

    return (data || []).map(mapDbToInsuranceCommissionSettlement);
  },
  async markCommissionSettlementsPaid(
    settlements: Array<{ policyId: string; dueDate: string; amount: number }>
  ): Promise<InsuranceCommissionSettlement[]> {
    if (settlements.length === 0) return [];

    const storeClient = ensureStoreClient();
    const now = new Date().toISOString();
    const payload = settlements.map(item => ({
      policy_id: item.policyId,
      due_date: item.dueDate,
      amount: item.amount,
      paid_at: now,
    }));

    const { data, error } = await storeClient
      .from('insurance_commission_settlements')
      .upsert(payload, { onConflict: 'policy_id,due_date' })
      .select('*');

    if (error) {
      const missingTableError = /relation .*insurance_commission_settlements.* does not exist|schema cache|could not find the table/i;
      if (missingTableError.test(error.message || '')) {
        throw new Error('A tabela de comissões ainda não existe. Execute: supabase db push');
      }
      throw error;
    }

    return (data || []).map(mapDbToInsuranceCommissionSettlement);
  },
  async getCommissionSettlementsHistory(): Promise<InsuranceCommissionSettlement[]> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient
      .from('insurance_commission_settlements')
      .select('*')
      .order('paid_at', { ascending: false })
      .order('due_date', { ascending: false })
      .limit(1000);

    if (error) {
      const missingTableError = /relation .*insurance_commission_settlements.* does not exist|schema cache|could not find the table/i;
      if (missingTableError.test(error.message || '')) {
        throw new Error('A tabela de comissões ainda não existe. Execute: supabase db push');
      }
      throw error;
    }

    return (data || []).map(mapDbToInsuranceCommissionSettlement);
  },
  async delete(id: string): Promise<void> {
    const storeClient = ensureStoreClient();
    const { error } = await storeClient.from('insurance_policies').delete().match({ id });
    if (error) throw error;
  },
  async uploadAttachment(file: File, policyId: string): Promise<string> {
    validateAttachmentFile(file);
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

    return filePath;
  }
};
