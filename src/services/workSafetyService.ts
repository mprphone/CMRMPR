import { WorkSafetyService, WorkSafetyProfileData } from '../types';
import { ensureStoreClient } from './supabaseClient';

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
  documentChecklist: p.document_checklist && typeof p.document_checklist === 'object' ? p.document_checklist : {},
  profileData: p.profile_data && typeof p.profile_data === 'object' ? (p.profile_data as WorkSafetyProfileData) : {},
  aiObligationsSummary: p.ai_obligations_summary || '',
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
  document_checklist: p.documentChecklist || {},
  profile_data: p.profileData || {},
  ai_obligations_summary: p.aiObligationsSummary || null,
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
    const payload = mapWorkSafetyServiceToDb(service);
    let { data, error } = await storeClient
      .from('work_safety_services')
      .upsert(payload)
      .select('*, clients (id, name)')
      .single();

    if (error) {
      const schemaError = /column .*document_checklist.* does not exist|column .*profile_data.* does not exist|column .*ai_obligations_summary.* does not exist|schema cache/i;
      if (schemaError.test(error.message || '')) {
        const fallbackPayload = { ...payload } as any;
        delete fallbackPayload.document_checklist;
        delete fallbackPayload.profile_data;
        delete fallbackPayload.ai_obligations_summary;

        const retry = await storeClient
          .from('work_safety_services')
          .upsert(fallbackPayload)
          .select('*, clients (id, name)')
          .single();

        data = retry.data;
        error = retry.error;
      }
    }

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
