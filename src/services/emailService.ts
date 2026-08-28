import {
  CampaignHistory,
  CampaignRecipientResult,
  EmailAutomation,
  EmailAutomationRun,
  EmailSuppression,
  EmailTemplate,
} from '../types';
import { ensureStoreClient } from './supabaseClient';

const CAMPAIGN_SUMMARY_COLUMNS = [
  'id', 'sent_at', 'subject', 'body', 'recipient_count', 'recipient_ids', 'group_name', 'status',
  'scheduled_at', 'send_delay', 'template_id', 'delivery_status', 'campaign_type', 'preheader',
  'from_name', 'from_email', 'reply_to', 'created_by', 'updated_at', 'started_at', 'completed_at',
  'eligible_count', 'excluded_count', 'success_count', 'failure_count', 'bounce_count', 'last_error',
].join(',');

const parseFunctionError = async (error: any): Promise<Error> => {
  let message = error?.message || 'Erro desconhecido.';
  if (error?.context && typeof error.context.json === 'function') {
    const payload = await error.context.json().catch(() => null);
    message = payload?.error || payload?.message || message;
  }
  return new Error(message);
};

export const templateService = {
  async getAll(): Promise<EmailTemplate[]> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient
      .from('email_templates')
      .select('*')
      .neq('approval_status', 'archived')
      .order('category')
      .order('name');
    if (error) throw error;
    return data || [];
  },

  async upsert(template: Partial<EmailTemplate>): Promise<EmailTemplate> {
    const storeClient = ensureStoreClient();
    const payload = {
      ...template,
      name: String(template.name || '').trim(),
      subject: String(template.subject || '').trim(),
      body: String(template.body || ''),
      preheader: String(template.preheader || ''),
      category: String(template.category || 'Geral').trim() || 'Geral',
      approval_status: template.approval_status || 'draft',
      version: Math.max(1, Number(template.version || 1)),
    };
    const { data, error } = await storeClient.from('email_templates').upsert(payload).select().single();
    if (error) throw error;
    return data;
  },

  async delete(id: string): Promise<void> {
    const storeClient = ensureStoreClient();
    const { error } = await storeClient.from('email_templates').update({ approval_status: 'archived' }).eq('id', id);
    if (error) throw error;
  },
};

export interface QueueCampaignInput {
  subject: string;
  body: string;
  groupName: string;
  campaignType: 'service' | 'marketing';
  preheader?: string;
  signatureHtml?: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string;
  scheduledAt?: string;
  templateId?: string | null;
  idempotencyKey: string;
  requiresApproval?: boolean;
  recipients: Array<{
    clientId: string;
    name: string;
    email: string;
    subject: string;
    html: string;
    metadata?: Record<string, unknown>;
  }>;
}

export const campaignHistoryService = {
  async getAll(limit = 100): Promise<CampaignHistory[]> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient
      .from('email_campaign_history')
      .select(CAMPAIGN_SUMMARY_COLUMNS)
      .order('sent_at', { ascending: false })
      .limit(Math.min(Math.max(limit, 1), 250));
    if (error) throw error;
    return (data || []) as unknown as CampaignHistory[];
  },

  async getPage(page: number, pageSize = 25): Promise<{ campaigns: CampaignHistory[]; total: number }> {
    const storeClient = ensureStoreClient();
    const safePage = Math.max(1, page);
    const safeSize = Math.min(Math.max(pageSize, 5), 100);
    const from = (safePage - 1) * safeSize;
    const { data, count, error } = await storeClient
      .from('email_campaign_history')
      .select(CAMPAIGN_SUMMARY_COLUMNS, { count: 'exact' })
      .order('sent_at', { ascending: false })
      .range(from, from + safeSize - 1);
    if (error) throw error;
    return { campaigns: (data || []) as unknown as CampaignHistory[], total: count || 0 };
  },

  async queue(input: QueueCampaignInput): Promise<CampaignHistory> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.functions.invoke('queue-email-campaign', { body: input });
    if (error) throw await parseFunctionError(error);
    if (!data?.campaign) throw new Error(data?.error || 'A campanha não foi criada.');
    return data.campaign as CampaignHistory;
  },

  async processQueue(campaignId?: string, batchSize = 50): Promise<{ processed: number; accepted: number; failed: number; retried: number; suppressed?: number }> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.functions.invoke('process-email-queue', {
      body: { campaignId: campaignId || null, batchSize },
    });
    if (error) throw await parseFunctionError(error);
    return data;
  },

  async getRecipients(campaignId: string): Promise<CampaignRecipientResult[]> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient
      .from('email_campaign_recipients')
      .select('id,client_id,recipient_name,email,status,exclusion_reason,attempts,max_attempts,provider_message_id,last_error,updated_at')
      .eq('campaign_id', campaignId)
      .order('created_at');
    if (error) throw error;
    if (data?.length) {
      return data.map((row: any) => ({
        id: row.id,
        client_id: row.client_id,
        name: row.recipient_name,
        email: row.email,
        status: row.status,
        error: row.last_error || undefined,
        exclusion_reason: row.exclusion_reason,
        attempts: row.attempts,
        max_attempts: row.max_attempts,
        provider_message_id: row.provider_message_id,
        updated_at: row.updated_at,
      }));
    }

    const { data: legacy, error: legacyError } = await storeClient
      .from('email_campaign_history')
      .select('recipient_results')
      .eq('id', campaignId)
      .maybeSingle();
    if (legacyError) throw legacyError;
    return Array.isArray(legacy?.recipient_results) ? legacy.recipient_results : [];
  },

  async control(campaignId: string, action: 'cancel' | 'approve' | 'reschedule', scheduledAt?: string): Promise<CampaignHistory> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.rpc('control_email_campaign', {
      p_campaign_id: campaignId,
      p_action: action,
      p_scheduled_at: scheduledAt || null,
    });
    if (error) throw error;
    return data as CampaignHistory;
  },

  async create(campaign: Partial<CampaignHistory>): Promise<CampaignHistory> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.from('email_campaign_history').insert(campaign).select().single();
    if (error) throw error;
    return data as CampaignHistory;
  },
};

export const emailSuppressionService = {
  async getAll(): Promise<EmailSuppression[]> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient
      .from('email_suppressions')
      .select('*')
      .is('lifted_at', null)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async add(email: string, notes = ''): Promise<EmailSuppression> {
    const storeClient = ensureStoreClient();
    const { data: userData } = await storeClient.auth.getUser();
    const normalized = email.trim().toLowerCase();
    const { data, error } = await storeClient.from('email_suppressions').insert({
      email: email.trim(),
      email_normalized: normalized,
      reason: 'manual',
      source: 'app',
      notes: notes.trim() || null,
      created_by: userData.user?.id || null,
    }).select().single();
    if (error) throw error;
    return data;
  },

  async lift(id: string): Promise<void> {
    const storeClient = ensureStoreClient();
    const { data: userData } = await storeClient.auth.getUser();
    const { error } = await storeClient.from('email_suppressions').update({
      lifted_at: new Date().toISOString(),
      lifted_by: userData.user?.id || null,
    }).eq('id', id);
    if (error) throw error;
  },
};

export const emailAutomationService = {
  async getAll(): Promise<EmailAutomation[]> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.from('email_automations').select('*').order('name');
    if (error) throw error;
    return data || [];
  },

  async upsert(automation: Partial<EmailAutomation>): Promise<EmailAutomation> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.from('email_automations').upsert(automation).select().single();
    if (error) throw error;
    return data;
  },

  async remove(id: string): Promise<void> {
    const storeClient = ensureStoreClient();
    const { error } = await storeClient.from('email_automations').delete().eq('id', id);
    if (error) throw error;
  },

  async getRuns(limit = 30): Promise<EmailAutomationRun[]> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient
      .from('email_automation_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(limit);
    if (error) throw error;
    return data || [];
  },

  async runNow(automationId: string): Promise<Record<string, unknown>> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.functions.invoke('monthly-obligations', {
      body: { automation_id: automationId, force: true },
    });
    if (error) throw await parseFunctionError(error);
    return data;
  },
};

