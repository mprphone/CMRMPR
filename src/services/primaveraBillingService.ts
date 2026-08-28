import { ensureStoreClient } from './supabaseClient';

export interface PrimaveraBillingLine {
  documentDate: string;
  documentType: string;
  documentSeries?: string | null;
  documentNumber?: string | null;
  invoiceRef: string;
  customerCode?: string | null;
  customerName?: string | null;
  customerTaxId?: string | null;
  articleCode?: string | null;
  articleDescription?: string | null;
  netValue: number;
  grossValue: number;
  taxValue: number;
}

export interface PrimaveraBillingResult {
  source: { database: string; companyCode: string; readOnly: boolean };
  data: {
    lines: PrimaveraBillingLine[];
    documents: number;
    documentTypes: Record<string, number>;
    requestedDocumentTypes: string[];
    warnings?: string[];
    syncedAt: string;
  };
}

const endpoint = import.meta.env.VITE_PRIMAVERA_BILLING_URL
  || 'https://pri.mpr.pt/api/integrations/cmr/primavera/billing';
const pendingBalancesSyncNowEndpoint = import.meta.env.VITE_PRIMAVERA_PENDING_BALANCES_SYNC_NOW_URL
  || 'https://pri.mpr.pt/api/integrations/cmr/primavera/pending-balances/sync-now';

export interface PrimaveraPendingBalance {
  nif: string;
  tipoEntidade: string | null;
  modulo: string | null;
  entidade: string | null;
  totalPendente: number;
  numDocumentos: number;
  dataVencMaisAntiga: string | null;
}

export interface PrimaveraPendingBalancesResult {
  source: { database: string; companyCode: string; readOnly: boolean };
  data: {
    balances: PrimaveraPendingBalance[];
    syncedAt: string;
  };
}

export const primaveraBillingService = {
  async sync(dateFrom: string, dateTo: string): Promise<PrimaveraBillingResult> {
    const client = ensureStoreClient();
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData.session?.access_token) {
      throw new Error('Sessão CMR inválida ou expirada.');
    }

    const controller = new AbortController();
    // Um período longo é dividido em vários troços de 62 dias do lado do
    // servidor, cada um correndo sequencialmente (uma consulta SQL de cada
    // vez no PC do cliente) — por isso o limite tem de acomodar vários
    // pedidos em série, não só um.
    const timeout = window.setTimeout(() => controller.abort(), 240_000);
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${sessionData.session.access_token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ dateFrom, dateTo }),
        signal: controller.signal,
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload?.success !== true || !payload?.data) {
        throw new Error(payload?.message || 'Não foi possível consultar a faturação no Primavera.');
      }
      return payload as PrimaveraBillingResult;
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw new Error('A consulta Primavera ultrapassou 4 minutos. Tente um período mais curto.');
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
    }
  },

  // Guarda o resultado de uma sincronização mensal, para o ecrã não
  // depender de refazer o pedido ao Primavera sempre que é aberto — só é
  // preciso sincronizar de novo quando o utilizador pedir explicitamente.
  async saveBillingSnapshot(month: string, result: PrimaveraBillingResult): Promise<void> {
    const client = ensureStoreClient();
    const { error } = await client.rpc('save_primavera_billing_snapshot', {
      p_month: month,
      p_lines: result.data.lines,
      p_documents: result.data.documents,
      p_source_database: result.source.database,
    });
    if (error) throw error;
  },

  // Lê o último resultado guardado para o mês (ou null se nunca foi
  // sincronizado). Usado ao abrir o ecrã / mudar de mês, antes de o
  // utilizador pedir uma sincronização nova.
  async loadBillingSnapshot(month: string): Promise<PrimaveraBillingResult | null> {
    const client = ensureStoreClient();
    const { data, error } = await client.rpc('get_primavera_billing_snapshot', { p_month: month });
    if (error) throw error;
    const row = data as { month: string; lines: PrimaveraBillingLine[]; documents: number; source_database: string | null; synced_at: string } | null;
    if (!row || !row.month) return null;
    return {
      source: { database: row.source_database || '', companyCode: 'mpr-negocios-lda', readOnly: true },
      data: {
        lines: Array.isArray(row.lines) ? row.lines : [],
        documents: Number(row.documents || 0),
        documentTypes: {},
        requestedDocumentTypes: [],
        warnings: [],
        syncedAt: row.synced_at,
      },
    };
  },

  // Dívida acumulada real por cliente (saldo em aberto no Primavera, não
  // derivado da verificação mensal de faturação acima). Lê sempre do espelho
  // local (get_visible_primavera_pending_balances) — nunca ao vivo — para
  // não depender da ligação ao Primavera estar ativa neste preciso instante.
  // O pri.mpr.pt sincroniza esse espelho sozinho a cada 5 min; este método só
  // pede, em complemento (melhor esforço, sem bloquear a leitura), um ciclo
  // extra imediato antes de ler.
  async getPendingBalances(): Promise<PrimaveraPendingBalancesResult> {
    const client = ensureStoreClient();
    const { data: sessionData, error: sessionError } = await client.auth.getSession();
    if (sessionError || !sessionData.session?.access_token) {
      throw new Error('Sessão CMR inválida ou expirada.');
    }
    const accessToken = sessionData.session.access_token;

    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 30_000);
    try {
      await fetch(pendingBalancesSyncNowEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
        signal: controller.signal,
      }).catch(() => undefined);
    } finally {
      window.clearTimeout(timeout);
    }

    return primaveraBillingService.readPendingBalances();
  },

  // Só lê o espelho local (sem pedir um ciclo extra ao pri.mpr.pt) — usado
  // ao abrir o ecrã, já que o espelho é atualizado sozinho a cada 5 min do
  // lado do servidor e não vale a pena disparar um pedido de rede extra só
  // por abrir a página.
  async readPendingBalances(): Promise<PrimaveraPendingBalancesResult> {
    const client = ensureStoreClient();
    const { data, error } = await client.rpc('get_visible_primavera_pending_balances');
    if (error) throw error;
    const rows = (data ?? []) as Array<{
      nif: string;
      tipo_entidade: string | null;
      modulo: string | null;
      entidade: string | null;
      total_pendente: number;
      num_documentos: number;
      data_venc_mais_antiga: string | null;
      synced_at: string;
    }>;

    const balances: PrimaveraPendingBalance[] = rows.map(row => ({
      nif: row.nif,
      tipoEntidade: row.tipo_entidade,
      modulo: row.modulo,
      entidade: row.entidade,
      totalPendente: Number(row.total_pendente ?? 0),
      numDocumentos: Number(row.num_documentos ?? 0),
      dataVencMaisAntiga: row.data_venc_mais_antiga,
    }));
    const syncedAt = rows.reduce((latest, row) => (row.synced_at > latest ? row.synced_at : latest), '') || new Date().toISOString();

    return {
      source: { database: 'espelho local', companyCode: 'mpr-negocios-lda', readOnly: true },
      data: { balances, syncedAt },
    };
  },
};
