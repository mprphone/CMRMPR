import { EmailTemplate, CampaignHistory } from '../types';
import { ensureStoreClient } from './supabaseClient';

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

    // Backward compatibility for DBs where optional history columns do not exist yet.
    const schemaColumnError = /could not find .* column .* in the schema cache|column .* does not exist/i;
    if (error && campaign && schemaColumnError.test(error.message || '')) {
      const fallbackPayload: any = { ...campaign };
      delete fallbackPayload.recipient_results;
      delete fallbackPayload.recipient_ids;
      delete fallbackPayload.scheduled_at;
      delete fallbackPayload.send_delay;
      delete fallbackPayload.template_id;

      const retry = await storeClient.from('email_campaign_history').insert(fallbackPayload).select().single();
      data = retry.data;
      error = retry.error;
    }

    if (error) throw error;
    return data as CampaignHistory;
  }
};
