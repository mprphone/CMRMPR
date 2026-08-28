import { ensureStoreClient } from './supabaseClient';

export interface SaftAvencaSyncRun {
  id: string;
  status: 'running' | 'completed' | 'failed';
  total: number;
  updated_count: number;
  failed_count: number;
  started_at: string;
  finished_at?: string | null;
  error?: string | null;
  details: Array<{ nif: string; ok: boolean; valor?: string; error?: string }>;
}

const parseFunctionError = async (error: any): Promise<Error> => {
  let message = error?.message || 'Erro desconhecido.';
  if (error?.context && typeof error.context.json === 'function') {
    const payload = await error.context.json().catch(() => null);
    message = payload?.error || payload?.message || message;
  }
  return new Error(message);
};

export const saftAvencaService = {
  async trigger(): Promise<{ runId: string; total: number }> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.functions.invoke('sync-saft-avenca', { body: {} });
    if (error) throw await parseFunctionError(error);
    if (!data?.runId) throw new Error(data?.error || 'Não foi possível iniciar a sincronização.');
    return { runId: data.runId, total: data.total };
  },

  async getRun(runId: string): Promise<SaftAvencaSyncRun | null> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient
      .from('saft_avenca_sync_runs')
      .select('*')
      .eq('id', runId)
      .maybeSingle();
    if (error) throw error;
    return data as SaftAvencaSyncRun | null;
  },

  async getLastRun(): Promise<SaftAvencaSyncRun | null> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient
      .from('saft_avenca_sync_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data as SaftAvencaSyncRun | null;
  },
};
