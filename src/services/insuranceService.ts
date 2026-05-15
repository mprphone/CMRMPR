import { InsurancePolicy, InsuranceCommissionSettlement } from '../types';
import { ensureStoreClient } from './supabaseClient';

const mapDbToInsurancePolicy = (p: any): InsurancePolicy => ({
  id: p.id,
  clientId: p.client_id,
  clientName: p.clients?.name || p.policy_holder || 'Cliente Desconhecido',
  policyHolder: p.policy_holder || p.clients?.name || '',
  agent: (p.agent || undefined) as InsurancePolicy['agent'],
  policyDate: p.policy_date,
  renewalDate: p.renewal_date || p.policy_date,
  policyNumber: p.policy_number,
  company: p.company || p.insurance_provider,
  branch: p.branch || p.policy_type,
  insuranceProvider: p.company || p.insurance_provider,
  paymentFrequency: p.payment_frequency,
  policyType: p.branch || p.policy_type,
  premiumValue: Number(p.premium_value ?? p.net_premium_value ?? 0),
  netPremiumValue: Number(p.net_premium_value ?? p.premium_value ?? 0),
  commissionRate: p.commission_rate,
  commissionPaid: p.commission_paid,
  status: p.status || 'Proposta',
  attachment_url: p.attachment_url,
  communicationType: p.communication_type,
  notes: p.notes || '',
  policyTier: p.policy_tier,
  documentChecklist: p.document_checklist && typeof p.document_checklist === 'object' ? p.document_checklist : {},
});

const mapInsurancePolicyToDb = (p: Partial<InsurancePolicy>) => ({
  id: p.id,
  client_id: p.clientId ?? null,
  policy_holder: p.policyHolder || null,
  agent: p.agent || null,
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
  status: p.status,
  attachment_url: p.attachment_url,
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
    const payload = mapInsurancePolicyToDb(policy);
    let { data, error } = await storeClient
      .from('insurance_policies')
      .upsert(payload)
      .select('*, clients (id, name)')
      .single();

    if (error) {
      const schemaError = /column .*document_checklist.* does not exist|column .*policy_holder.* does not exist|column .*agent.* does not exist|column .*renewal_date.* does not exist|column .*company.* does not exist|column .*branch.* does not exist|column .*net_premium_value.* does not exist|column .*notes.* does not exist|schema cache/i;
      if (schemaError.test(error.message || '')) {
        const fallbackPayload = { ...payload } as any;
        delete fallbackPayload.document_checklist;
        delete fallbackPayload.policy_holder;
        delete fallbackPayload.agent;
        delete fallbackPayload.renewal_date;
        delete fallbackPayload.company;
        delete fallbackPayload.branch;
        delete fallbackPayload.net_premium_value;
        delete fallbackPayload.notes;

        const retry = await storeClient
          .from('insurance_policies')
          .upsert(fallbackPayload)
          .select('*, clients (id, name)')
          .single();

        data = retry.data;
        error = retry.error;
      }
    }

    if (error) throw error;
    return mapDbToInsurancePolicy(data);
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
