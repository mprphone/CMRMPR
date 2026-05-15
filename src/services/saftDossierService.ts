import { SaftDossierAttachment, SaftDossierData } from '../types';
import { ensureStoreClient } from './supabaseClient';

const mapDbToSaftDossierData = (db: any): SaftDossierData => ({
  attachments: Array.isArray(db.attachments) ? (db.attachments as SaftDossierAttachment[]) : [],
  clientNif: db.client_nif,
  clientName: db.client_name || '',
  sourceDetailUrl: db.source_detail_url || '',
  atStatus: db.at_status || '',
  atCollectedAt: db.at_collected_at || null,
  ssStatus: db.ss_status || '',
  ssCollectedAt: db.ss_collected_at || null,
  certidaoAtStatus: db.certidao_at_status || '',
  certidaoSsStatus: db.certidao_ss_status || '',
  certidaoPermanenteStatus: db.certidao_permanente_status || '',
  certidaoPermanenteCode: db.certidao_permanente_code || '',
  rawList: db.raw_list && typeof db.raw_list === 'object' ? db.raw_list : {},
  rawDetail: db.raw_detail && typeof db.raw_detail === 'object' ? db.raw_detail : {},
  syncedAt: db.synced_at || '',
  updatedAt: db.updated_at || '',
});

export const saftDossierService = {
  async getByClientNif(clientNif: string): Promise<SaftDossierData | null> {
    const normalizedNif = (clientNif || '').replace(/\D/g, '');
    if (!normalizedNif) return null;

    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient
      .from('saft_dossier_data')
      .select('*')
      .eq('client_nif', normalizedNif)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    return mapDbToSaftDossierData(data);
  },
  async getStatusByClientNifs(clientNifs: string[]): Promise<Record<string, { hasData: boolean; syncedAt: string }>> {
    const normalized = Array.from(
      new Set(
        clientNifs
          .map(nif => (nif || '').replace(/\D/g, ''))
          .filter(nif => nif.length === 9)
      )
    );

    if (normalized.length === 0) return {};

    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient
      .from('saft_dossier_data')
      .select('client_nif, synced_at')
      .in('client_nif', normalized);

    if (error) throw error;

    return (data || []).reduce((acc, row: any) => {
      const nif = (row.client_nif || '').replace(/\D/g, '');
      if (!nif) return acc;
      acc[nif] = {
        hasData: true,
        syncedAt: row.synced_at || '',
      };
      return acc;
    }, {} as Record<string, { hasData: boolean; syncedAt: string }>);
  },
  async getAttachmentCountsByClientNifs(clientNifs: string[]): Promise<Record<string, number>> {
    const normalized = Array.from(
      new Set(
        clientNifs
          .map(nif => (nif || '').replace(/\D/g, ''))
          .filter(nif => nif.length === 9)
      )
    );

    if (normalized.length === 0) return {};

    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient
      .from('saft_dossier_data')
      .select('client_nif, attachments')
      .in('client_nif', normalized);

    if (error) throw error;

    return (data || []).reduce((acc, row: any) => {
      const nif = (row.client_nif || '').replace(/\D/g, '');
      if (!nif) return acc;
      acc[nif] = Array.isArray(row.attachments) ? row.attachments.length : 0;
      return acc;
    }, {} as Record<string, number>);
  },
  async enqueueSyncRequests(clientNifs: string[], requestedBy?: string): Promise<number> {
    const normalized = Array.from(
      new Set(
        clientNifs
          .map(nif => (nif || '').replace(/\D/g, ''))
          .filter(nif => nif.length === 9)
      )
    );

    if (normalized.length === 0) return 0;

    const nowIso = new Date().toISOString();
    const payload = normalized.map(nif => ({
      client_nif: nif,
      status: 'pending',
      requested_at: nowIso,
      started_at: null,
      finished_at: null,
      last_error: null,
      requested_by: requestedBy || null,
    }));

    const storeClient = ensureStoreClient();
    const { error } = await storeClient
      .from('saft_sync_queue')
      .upsert(payload, { onConflict: 'client_nif' });

    if (error) throw error;
    return normalized.length;
  },
};
