import { ensureStoreClient } from './supabaseClient';

export interface SystemHealth {
  overall: 'healthy' | 'warning';
  checkedAt: string;
  warnings: string[];
  database: { ok: boolean; clients: number; syncedClients: number; staff: number; syncedStaff: number };
  sync: {
    ok: boolean;
    enabled: boolean;
    configured: boolean;
    running: boolean;
    pending: number;
    failed: number;
    lastSuccessAt: string | null;
  };
  backup: {
    ok: boolean;
    status: string;
    lastCheckedAt: string | null;
    backupId: string | null;
    message: string | null;
  };
}

export const systemHealthService = {
  async get(): Promise<SystemHealth> {
    const client = ensureStoreClient();
    const { data, error } = await client.functions.invoke('system-health', { body: {} });
    if (error) throw error;
    if (!data?.success || !data?.health) {
      throw new Error(data?.error || 'Não foi possível verificar o estado do sistema.');
    }
    return data.health as SystemHealth;
  },
};

