import { createClient, SupabaseClient, SupabaseClientOptions } from '@supabase/supabase-js';
import { GlobalSettings } from '../types';

export let importClient: SupabaseClient | null = null;
export let storeClient: SupabaseClient | null = null;

export const initSupabase = (settings: GlobalSettings) => {
  const importDisabled = String(import.meta.env.VITE_DISABLE_SUPABASE_IMPORT || '').toLowerCase() === 'true';
  const iUrl = importDisabled ? '' : (import.meta.env.VITE_SUPABASE_URL_IMPORT || settings.supabaseImportUrl);
  const iKey = importDisabled ? '' : (import.meta.env.VITE_SUPABASE_KEY_IMPORT || settings.supabaseImportKey);
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
      try {
        const savedSettings = JSON.parse(savedSettingsRaw);
        initSupabase(savedSettings);
      } catch (error) {
        console.error('Configurações locais inválidas; a ignorar cache corrompida:', error);
      }
    }
  }
  if (!storeClient) {
    throw new Error("Servidor de Gestão não configurado. Verifique as configurações e recarregue a página.");
  }
  return storeClient;
};

export const atomicSyncImportedData = async (
  staffData: Array<Record<string, unknown>>,
  clientsData: Array<Record<string, unknown>>
): Promise<void> => {
  const client = ensureStoreClient();
  const { error } = await client.rpc('sync_imported_staff_and_clients_atomic', {
    staff_data: staffData,
    clients_data: clientsData,
  });
  if (error) throw error;
};

export const syncWamprData = async (): Promise<{
  snapshotId?: string;
  counts?: { clients?: number; staff?: number };
}> => {
  const client = ensureStoreClient();
  const { data, error } = await client.functions.invoke('sync-wampr', {
    body: { mode: 'pull', reason: 'manual_ui' },
  });
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Falha ao sincronizar dados do WAMPR.');
  return data;
};
