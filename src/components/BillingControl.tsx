import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, CircleDollarSign, Pencil, RefreshCcw, Save, Search, ShieldCheck, X } from 'lucide-react';
import { Client } from '../types';
import { PrimaveraBillingLine, PrimaveraPendingBalance, primaveraBillingService } from '../services/primaveraBillingService';
import { clientService, saftAvencaService, SaftAvencaSyncRun } from '../services';

type BillingStatus = 'correct' | 'missing' | 'different' | 'duplicate' | 'unconfigured';

interface BillingRow {
  client: Client;
  expected: number;
  actual: number;
  difference: number;
  debt: number;
  status: BillingStatus;
  documents: Array<{ ref: string; date: string; type: string; net: number; descriptions: string[] }>;
}

const money = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
const normalize = (value: unknown) => String(value ?? '').trim().toLocaleUpperCase('pt-PT');
const cleanNif = (value: unknown) => String(value ?? '').replace(/\D/g, '');
const isSubscriptionClient = (client: Client) => (
  ['SOCIEDADE', 'INDEPENDENTE'].includes(normalize(client.entityType))
  && ['ATIVO', 'ATIVA', 'ACTIVA'].includes(normalize(client.status))
);

const monthBounds = (month: string) => {
  const [year, monthNumber] = month.split('-').map(Number);
  const lastDay = new Date(Date.UTC(year, monthNumber, 0)).getUTCDate();
  return { dateFrom: `${month}-01`, dateTo: `${month}-${String(lastDay).padStart(2, '0')}` };
};
const ENTITY_TYPE_OPTIONS = ['SOCIEDADE', 'INDEPENDENTE', 'PARTICULAR'];

const aggregateDocuments = (lines: PrimaveraBillingLine[]) => {
  const documents = new Map<string, { ref: string; date: string; type: string; nif: string; customerName: string; net: number; descriptions: Set<string> }>();
  for (const line of lines) {
    const nif = cleanNif(line.customerTaxId);
    const key = `${nif}|${line.documentDate}|${line.invoiceRef}`;
    const current = documents.get(key) || {
      ref: line.invoiceRef,
      date: line.documentDate,
      type: line.documentType,
      nif,
      customerName: line.customerName || '',
      net: 0,
      descriptions: new Set<string>(),
    };
    current.net += Number(line.netValue || 0);
    if (line.articleDescription?.trim()) current.descriptions.add(line.articleDescription.trim());
    documents.set(key, current);
  }
  return [...documents.values()].map(item => ({ ...item, descriptions: [...item.descriptions] }));
};

const statusMeta: Record<BillingStatus, { label: string; classes: string }> = {
  correct: { label: 'Correto', classes: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
  missing: { label: 'Não faturado', classes: 'bg-red-50 text-red-700 border-red-200' },
  different: { label: 'Valor diferente', classes: 'bg-amber-50 text-amber-700 border-amber-200' },
  duplicate: { label: 'Possível duplicado', classes: 'bg-purple-50 text-purple-700 border-purple-200' },
  unconfigured: { label: 'Avença por configurar', classes: 'bg-slate-100 text-slate-600 border-slate-200' },
};

interface BillingControlProps {
  clients: Client[];
  setClients: React.Dispatch<React.SetStateAction<Client[]>>;
}

const BillingControl: React.FC<BillingControlProps> = ({ clients, setClients }) => {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [lines, setLines] = useState<PrimaveraBillingLine[]>([]);
  const [source, setSource] = useState<{ database: string; syncedAt: string; documents: number } | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | BillingStatus>('all');
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [editForm, setEditForm] = useState<{ monthlyFee: string; entityType: string }>({ monthlyFee: '', entityType: '' });
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [editError, setEditError] = useState('');

  // Dívida acumulada real (saldo pendente no Primavera) — fonte e ação
  // totalmente separadas da verificação mensal de faturação acima. Não
  // altera nem substitui a lógica de "Em falta este mês".
  const [pendingBalances, setPendingBalances] = useState<Map<string, PrimaveraPendingBalance>>(new Map());
  const [isSyncingDebt, setIsSyncingDebt] = useState(false);
  const [debtError, setDebtError] = useState('');
  const [debtSyncedAt, setDebtSyncedAt] = useState<string | null>(null);
  const [avencaRun, setAvencaRun] = useState<SaftAvencaSyncRun | null>(null);
  const [avencaError, setAvencaError] = useState('');
  const [showAvencaReport, setShowAvencaReport] = useState(false);

  const eligibleClients = useMemo(() => clients.filter(isSubscriptionClient), [clients]);

  const { rows, unmatchedDocuments, missingClients } = useMemo(() => {
    const documents = aggregateDocuments(lines);
    const byNif = new Map<string, typeof documents>();
    for (const document of documents) {
      if (!document.nif) continue;
      const current = byNif.get(document.nif) || [];
      current.push(document);
      byNif.set(document.nif, current);
    }
    const eligibleNifs = new Set(eligibleClients.map(client => cleanNif(client.nif)));
    // Todos os clientes do CMR (não só os elegíveis para avença) — para
    // distinguir "não é população de avença" de "nem existe cá o cliente".
    const allCmrNifs = new Set(clients.map(client => cleanNif(client.nif)));
    const result: BillingRow[] = eligibleClients.map(client => {
      const expected = Number(client.monthlyFee || 0);
      const clientDocuments = byNif.get(cleanNif(client.nif)) || [];
      const actual = clientDocuments.reduce((sum, document) => sum + document.net, 0);
      const difference = actual - expected;
      // Valor ainda em falta este mês (nunca negativo: faturação a mais não é "dívida").
      // Nota: isto NÃO é a dívida real acumulada do cliente (essa vem dos
      // pendentes do Primavera, não desta comparação mês a mês) — ver conversa.
      const debt = expected > 0 ? Math.max(0, expected - actual) : 0;
      let status: BillingStatus = 'different';
      if (expected <= 0) status = 'unconfigured';
      else if (Math.abs(actual) < 0.005) status = 'missing';
      else if (Math.abs(difference) <= 0.02) status = 'correct';
      else if (clientDocuments.length > 1 && Math.abs(actual - expected * 2) <= 0.02) status = 'duplicate';
      return { client, expected, actual, difference, debt, status, documents: clientDocuments };
    });
    const order: Record<BillingStatus, number> = { missing: 0, duplicate: 1, different: 2, unconfigured: 3, correct: 4 };
    result.sort((left, right) => order[left.status] - order[right.status] || left.client.name.localeCompare(right.client.name, 'pt-PT'));

    const unmatched = documents.filter(document => document.nif && !eligibleNifs.has(document.nif));
    const missingByNif = new Map<string, { nif: string; customerName: string; net: number; refs: string[] }>();
    const explained: typeof unmatched = [];
    for (const document of unmatched) {
      if (allCmrNifs.has(document.nif)) {
        explained.push(document); // existe no CMR, só não é população de avença
        continue;
      }
      const current = missingByNif.get(document.nif) || { nif: document.nif, customerName: document.customerName, net: 0, refs: [] };
      current.net += document.net;
      current.refs.push(document.ref);
      if (!current.customerName && document.customerName) current.customerName = document.customerName;
      missingByNif.set(document.nif, current);
    }

    return {
      rows: result,
      unmatchedDocuments: explained,
      missingClients: [...missingByNif.values()].sort((a, b) => b.net - a.net),
    };
  }, [eligibleClients, clients, lines]);

  const visibleRows = useMemo(() => {
    const term = search.trim().toLocaleLowerCase('pt-PT');
    return rows.filter(row => {
      if (statusFilter !== 'all' && row.status !== statusFilter) return false;
      return !term || [row.client.name, row.client.nif].some(value => String(value).toLocaleLowerCase('pt-PT').includes(term));
    });
  }, [rows, search, statusFilter]);

  const counts = useMemo(() => Object.fromEntries(
    (['correct', 'missing', 'different', 'duplicate', 'unconfigured'] as BillingStatus[])
      .map(status => [status, rows.filter(row => row.status === status).length]),
  ) as Record<BillingStatus, number>, [rows]);

  // Somas da lista visível (respeita pesquisa/filtro de estado), para
  // confrontar diretamente com os totais do Primavera.
  const visibleTotals = useMemo(() => visibleRows.reduce((acc, row) => {
    acc.expected += row.expected;
    acc.actual += row.actual;
    acc.difference += row.difference;
    acc.debt += row.debt;
    acc.pendingBalance += pendingBalances.get(cleanNif(row.client.nif))?.totalPendente || 0;
    return acc;
  }, { expected: 0, actual: 0, difference: 0, debt: 0, pendingBalance: 0 }), [visibleRows, pendingBalances]);

  const buildBalanceMap = (balances: PrimaveraPendingBalance[]) => {
    const byNif = new Map<string, PrimaveraPendingBalance>();
    for (const balance of balances) {
      const nif = cleanNif(balance.nif);
      if (!nif) continue;
      const current = byNif.get(nif);
      if (!current) {
        byNif.set(nif, { ...balance, nif });
      } else {
        // O Primavera pode devolver mais do que uma linha por NIF (ex.: mais
        // do que um código de entidade associado ao mesmo contribuinte) —
        // soma-se para dar o saldo pendente total desse NIF.
        current.totalPendente += balance.totalPendente;
        current.numDocumentos += balance.numDocumentos;
        if (balance.dataVencMaisAntiga && (!current.dataVencMaisAntiga || balance.dataVencMaisAntiga < current.dataVencMaisAntiga)) {
          current.dataVencMaisAntiga = balance.dataVencMaisAntiga;
        }
      }
    }
    return byNif;
  };

  // Ao abrir o ecrã (ou mudar de mês), carrega sempre o que já está
  // guardado do lado do servidor — última sincronização de faturação
  // guardada para este mês, e o espelho da dívida acumulada (já mantido
  // atualizado sozinho a cada 5 min). Só volta a ir ao Primavera quando o
  // utilizador clicar "Sincronizar Primavera".
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snapshot = await primaveraBillingService.loadBillingSnapshot(month);
        if (cancelled || !snapshot) return;
        setLines(snapshot.data.lines);
        setSource({ database: snapshot.source.database, syncedAt: snapshot.data.syncedAt, documents: snapshot.data.documents });
      } catch {
        // Sem snapshot guardado ainda, ou falha a ler — o ecrã fica vazio até sincronizar manualmente.
      }
    })();
    return () => { cancelled = true; };
  }, [month]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const result = await primaveraBillingService.readPendingBalances();
        if (cancelled) return;
        setPendingBalances(buildBalanceMap(result.data.balances));
        setDebtSyncedAt(result.data.syncedAt);
      } catch {
        // Falha silenciosa — o utilizador ainda pode sincronizar manualmente.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const syncBilling = async () => {
    setIsSyncing(true);
    setError('');
    try {
      const bounds = monthBounds(month);
      const result = await primaveraBillingService.sync(bounds.dateFrom, bounds.dateTo);
      setLines(Array.isArray(result.data.lines) ? result.data.lines : []);
      setSource({ database: result.source.database, syncedAt: result.data.syncedAt, documents: result.data.documents });
      await primaveraBillingService.saveBillingSnapshot(month, result);
    } catch (err: any) {
      setError(err?.message || 'Falha ao consultar a faturação.');
    } finally {
      setIsSyncing(false);
    }
  };

  const syncDebt = async () => {
    setIsSyncingDebt(true);
    setDebtError('');
    try {
      const result = await primaveraBillingService.getPendingBalances();
      setPendingBalances(buildBalanceMap(result.data.balances));
      setDebtSyncedAt(result.data.syncedAt);
    } catch (err: any) {
      setDebtError(err?.message || 'Falha ao consultar a dívida acumulada.');
    } finally {
      setIsSyncingDebt(false);
    }
  };

  // Um só botão para o utilizador: "Sincronizar Primavera" atualiza a
  // faturação mensal e a dívida acumulada em simultâneo — duas fontes
  // distintas do lado do servidor, mas não há razão para obrigar a dois
  // cliques separados.
  const synchronize = () => {
    void syncBilling();
    void syncDebt();
  };
  const isSyncingAny = isSyncing || isSyncingDebt;

  const syncSaftAvenca = async () => {
    setAvencaError('');
    try {
      const { runId } = await saftAvencaService.trigger();
      const run = await saftAvencaService.getRun(runId);
      setAvencaRun(run);
    } catch (err: any) {
      setAvencaError(err?.message || 'Falha ao iniciar a atualização de avenças no SAFTonline.');
      setShowAvencaReport(true);
    }
  };

  // Ao abrir o ecrã, verifica se já há uma sincronização em curso ou o
  // resultado da última — não é preciso ter estado nesta sessão para a ver.
  useEffect(() => {
    saftAvencaService.getLastRun().then((run) => { if (run) setAvencaRun(run); }).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!avencaRun || avencaRun.status !== 'running') return;
    const timer = window.setInterval(async () => {
      try {
        const run = await saftAvencaService.getRun(avencaRun.id);
        if (run) setAvencaRun(run);
      } catch {
        // silenciosamente tenta novamente no próximo ciclo
      }
    }, 3000);
    return () => window.clearInterval(timer);
  }, [avencaRun?.id, avencaRun?.status]);

  const openEditModal = (client: Client) => {
    setEditingClient(client);
    setEditForm({ monthlyFee: String(client.monthlyFee ?? 0), entityType: client.entityType || 'SOCIEDADE' });
    setEditError('');
  };

  const closeEditModal = () => {
    setEditingClient(null);
    setEditError('');
  };

  const saveEdit = async () => {
    if (!editingClient) return;
    const monthlyFee = Number(editForm.monthlyFee.replace(',', '.'));
    if (!Number.isFinite(monthlyFee) || monthlyFee < 0) {
      setEditError('Indique uma avença válida.');
      return;
    }
    setIsSavingEdit(true);
    setEditError('');
    try {
      const saved = await clientService.upsert({
        ...editingClient,
        monthlyFee,
        entityType: editForm.entityType,
      });
      setClients(current => current.map(item => (item.id === saved.id ? saved : item)));
      setEditingClient(null);
    } catch (err: any) {
      setEditError(err?.message || 'Não foi possível gravar as alterações.');
    } finally {
      setIsSavingEdit(false);
    }
  };

  return (
    <div className="space-y-4 animate-fade-in">
      <section className="rounded-2xl border border-slate-700/20 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-900 p-3 text-white shadow-sm md:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold md:text-2xl">Controlo de Faturação</h1>
              <span className="inline-flex items-center gap-1 rounded-full border border-white/15 bg-white/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-200">
                <ShieldCheck size={11} /> Primavera só leitura
              </span>
            </div>
            <p className="mt-1 text-xs text-slate-200 md:text-sm">Reconciliação de avenças, dívida acumulada e sincronização com o Primavera.</p>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            <label className="text-[10px] font-bold uppercase text-indigo-200">
              Mês
              <input type="month" value={month} onChange={event => setMonth(event.target.value)} className="mt-1 block rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-sm font-medium text-white [color-scheme:dark]" />
            </label>
            <button type="button" onClick={synchronize} disabled={isSyncingAny} className="inline-flex h-10 items-center gap-2 rounded-lg bg-emerald-500 px-4 text-sm font-bold text-white shadow-sm hover:bg-emerald-400 disabled:opacity-60">
              <RefreshCcw size={15} className={isSyncingAny ? 'animate-spin' : ''} /> {isSyncingAny ? 'A sincronizar…' : 'Sincronizar Primavera'}
            </button>
            <button
              type="button"
              onClick={() => void syncSaftAvenca()}
              disabled={Boolean(avencaRun && avencaRun.status === 'running')}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-white px-4 text-sm font-bold text-indigo-900 shadow-sm hover:bg-indigo-50 disabled:opacity-60"
            >
              <RefreshCcw size={15} className={avencaRun?.status === 'running' ? 'animate-spin' : ''} />
              Atualizar Avenças SAFTonline
            </button>
            {avencaRun && (
              <button
                type="button"
                onClick={() => setShowAvencaReport(true)}
                className={`inline-flex h-10 items-center gap-2 rounded-lg border px-3 text-xs font-bold ${avencaRun.status === 'running' ? 'border-indigo-300/30 bg-indigo-400/10 text-indigo-100' : avencaRun.status === 'failed' || avencaRun.failed_count > 0 ? 'border-amber-300/30 bg-amber-400/10 text-amber-200' : 'border-emerald-300/30 bg-emerald-400/10 text-emerald-200'}`}
              >
                {avencaRun.status === 'running'
                  ? <><RefreshCcw size={13} className="animate-spin" /> SAFTonline a decorrer…</>
                  : <>SAFTonline: {avencaRun.updated_count}/{avencaRun.total} atualizados{avencaRun.failed_count > 0 ? `, ${avencaRun.failed_count} falhas` : ''} · Ver relatório</>}
              </button>
            )}
          </div>
        </div>
        {error && <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-300/30 bg-red-400/10 px-3 py-2 text-xs font-medium text-red-200"><AlertTriangle size={14} /> {error}</div>}
        {debtError && <div className="mt-3 flex items-center gap-2 rounded-lg border border-red-300/30 bg-red-400/10 px-3 py-2 text-xs font-medium text-red-200"><AlertTriangle size={14} /> {debtError}</div>}
      </section>

      {showAvencaReport && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/60 p-4" role="dialog" aria-modal="true" aria-label="Atualização de avenças SAFTonline">
          <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b p-5">
              <div>
                <h3 className="text-lg font-bold">Atualização de Avenças no SAFTonline</h3>
                <p className="text-sm text-slate-500">Envia a avença (com IVA) de cada cliente elegível para o campo "Avença" no SAFTonline.</p>
              </div>
              <button onClick={() => setShowAvencaReport(false)}><X size={20} /></button>
            </div>
            <div className="flex-1 overflow-auto p-5">
              {avencaError && (
                <div className="mb-4 flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
                  <AlertTriangle size={14} /> {avencaError}
                </div>
              )}
              {!avencaRun && !avencaError && <p className="text-sm text-slate-400">A iniciar…</p>}
              {avencaRun && (
                <>
                  <div className="mb-4 grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-bold uppercase text-slate-400">Total</p><p className="text-2xl font-bold">{avencaRun.total}</p></div>
                    <div className="rounded-xl bg-emerald-50 p-3"><p className="text-xs font-bold uppercase text-emerald-600">Atualizados</p><p className="text-2xl font-bold text-emerald-700">{avencaRun.updated_count}</p></div>
                    <div className="rounded-xl bg-red-50 p-3"><p className="text-xs font-bold uppercase text-red-600">Falharam</p><p className="text-2xl font-bold text-red-700">{avencaRun.failed_count}</p></div>
                  </div>
                  {avencaRun.status === 'running' && <p className="text-sm text-slate-500">A processar no SAFTonline — isto pode demorar alguns minutos para muitos clientes…</p>}
                  {avencaRun.status !== 'running' && Array.isArray(avencaRun.details) && avencaRun.details.some((d) => !d.ok) && (
                    <div className="mt-3">
                      <p className="mb-2 text-xs font-bold uppercase text-slate-400">Falhas</p>
                      <div className="divide-y rounded-lg border text-sm">
                        {avencaRun.details.filter((d) => !d.ok).map((d) => (
                          <div key={d.nif} className="flex justify-between gap-3 px-3 py-2">
                            <span className="font-mono text-xs">{d.nif}</span>
                            <span className="text-right text-xs text-red-700">{d.error}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>
            <div className="flex justify-end gap-2 border-t p-4">
              <button onClick={() => setShowAvencaReport(false)} className="rounded-lg bg-slate-900 px-5 py-2 font-bold text-white">Fechar</button>
            </div>
          </div>
        </div>
      )}

      <section className="grid grid-cols-2 gap-2 md:grid-cols-3 xl:grid-cols-6">
        {[
          ['Avenças elegíveis', eligibleClients.length, 'text-slate-900'],
          ['Corretas', counts.correct, 'text-emerald-700'],
          ['Não faturadas', counts.missing, 'text-red-700'],
          ['Valor diferente', counts.different, 'text-amber-700'],
          ['Possível duplicado', counts.duplicate, 'text-purple-700'],
          ['Sem valor configurado', counts.unconfigured, 'text-slate-600'],
        ].map(([label, value, color]) => (
          <div key={String(label)} className="rounded-xl border border-slate-200 bg-white px-3 py-3 shadow-sm">
            <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">{label}</p>
            <p className={`mt-1 text-xl font-black ${color}`}>{value}</p>
          </div>
        ))}
      </section>

      <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-2 border-b border-slate-200 p-3 md:flex-row">
          <label className="relative flex-1">
            <Search size={15} className="absolute left-3 top-2.5 text-slate-400" />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Pesquisar nome ou NIF…" className="w-full rounded-lg border border-slate-200 py-2 pl-9 pr-3 text-sm" />
          </label>
          <select value={statusFilter} onChange={event => setStatusFilter(event.target.value as typeof statusFilter)} className="rounded-lg border border-slate-200 px-3 py-2 text-sm">
            <option value="all">Todos os estados</option>
            {(Object.keys(statusMeta) as BillingStatus[]).map(status => <option key={status} value={status}>{statusMeta[status].label}</option>)}
          </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-xs">
            <thead className="bg-slate-50 text-[10px] uppercase tracking-wide text-slate-500">
              <tr><th className="px-4 py-3">NIF</th><th className="px-3 py-3">Cliente</th><th className="px-3 py-3">Tipo</th><th className="px-3 py-3 text-right">Mensalidade</th><th className="px-3 py-3 text-right">Faturado</th><th className="px-3 py-3 text-right">Diferença</th><th className="px-3 py-3 text-right">Em falta este mês</th><th className="px-3 py-3 text-right">Dívida Acumulada</th><th className="px-3 py-3">Documentos</th><th className="px-4 py-3">Estado</th><th className="px-3 py-3">Ações</th></tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleRows.map(row => (
                <tr key={row.client.id} className="hover:bg-slate-50/70">
                  <td className="px-4 py-1.5 font-mono text-[10px] text-slate-400">{row.client.nif}</td>
                  <td className="px-3 py-1.5 font-bold text-slate-900">{row.client.name}</td>
                  <td className="px-3 py-1.5 text-slate-600">{row.client.entityType}</td>
                  <td className="px-3 py-1.5 text-right font-semibold text-slate-700">{row.expected > 0 ? money.format(row.expected) : '—'}</td>
                  <td className="px-3 py-1.5 text-right font-bold text-slate-900">{money.format(row.actual)}</td>
                  <td className={`px-3 py-1.5 text-right font-bold ${Math.abs(row.difference) <= 0.02 ? 'text-emerald-700' : 'text-amber-700'}`}>{row.expected > 0 ? money.format(row.difference) : '—'}</td>
                  <td className={`px-3 py-1.5 text-right font-bold ${row.debt > 0.02 ? 'text-red-700' : 'text-slate-400'}`}>{row.expected > 0 ? (row.debt > 0.02 ? money.format(row.debt) : '—') : '—'}</td>
                  <td className="px-3 py-1.5 text-right">
                    {(() => {
                      const balance = pendingBalances.get(cleanNif(row.client.nif));
                      if (!debtSyncedAt) return <span className="text-slate-300">·</span>;
                      if (!balance || Math.abs(balance.totalPendente) < 0.005) return <span className="font-bold text-slate-400">—</span>;
                      return (
                        <span className={`font-bold ${balance.totalPendente > 0 ? 'text-red-700' : 'text-slate-500'}`} title={`${balance.numDocumentos} documento(s) pendente(s)${balance.dataVencMaisAntiga ? ` · vencimento mais antigo em ${balance.dataVencMaisAntiga}` : ''}`}>
                          {money.format(balance.totalPendente)}
                        </span>
                      );
                    })()}
                  </td>
                  <td className="max-w-[260px] px-3 py-1.5 text-slate-500">{row.documents.length ? row.documents.map(document => document.ref).join(', ') : 'Sem documento'}</td>
                  <td className="px-4 py-1.5"><span className={`inline-flex rounded-full border px-2 py-1 text-[10px] font-bold ${statusMeta[row.status].classes}`}>{statusMeta[row.status].label}</span></td>
                  <td className="px-3 py-1.5">
                    <button
                      type="button"
                      onClick={() => openEditModal(row.client)}
                      title="Editar"
                      aria-label="Editar"
                      className="inline-flex items-center justify-center rounded-lg border border-slate-200 p-1.5 text-slate-600 hover:bg-slate-50"
                    >
                      <Pencil size={13} />
                    </button>
                  </td>
                </tr>
              ))}
              {!visibleRows.length && <tr><td colSpan={11} className="px-4 py-10 text-center text-slate-400">{source ? 'Nenhum cliente neste filtro.' : 'Escolha o mês e sincronize com o Primavera.'}</td></tr>}
            </tbody>
            {visibleRows.length > 0 && (
              <tfoot className="border-t-2 border-slate-200 bg-slate-50 text-xs font-bold text-slate-900">
                <tr>
                  <td className="px-4 py-1.5" colSpan={3}>Total ({visibleRows.length} cliente{visibleRows.length === 1 ? '' : 's'})</td>
                  <td className="px-3 py-1.5 text-right">{money.format(visibleTotals.expected)}</td>
                  <td className="px-3 py-1.5 text-right">{money.format(visibleTotals.actual)}</td>
                  <td className={`px-3 py-1.5 text-right ${Math.abs(visibleTotals.difference) <= 0.02 ? 'text-emerald-700' : 'text-amber-700'}`}>{money.format(visibleTotals.difference)}</td>
                  <td className={`px-3 py-1.5 text-right ${visibleTotals.debt > 0.02 ? 'text-red-700' : 'text-slate-400'}`}>{money.format(visibleTotals.debt)}</td>
                  <td className={`px-3 py-1.5 text-right ${visibleTotals.pendingBalance > 0.02 ? 'text-red-700' : 'text-slate-400'}`}>{money.format(visibleTotals.pendingBalance)}</td>
                  <td colSpan={3}></td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </section>

      {source && missingClients.length > 0 && (
        <section className="rounded-xl border border-red-200 bg-red-50 p-4 text-xs text-red-800">
          <div className="flex items-start gap-3">
            <AlertTriangle size={18} className="mt-0.5 shrink-0" />
            <div>
              <p className="font-bold">{missingClients.length} NIF(s) faturado(s) no Primavera sem cliente correspondente no CMR</p>
              <p className="mt-1 text-red-700">Estes clientes foram faturados este mês mas não têm ficha no CMR — pode faltar criá-los ou o NIF pode estar diferente.</p>
            </div>
          </div>
          <div className="mt-3 divide-y divide-red-100 rounded-lg border border-red-100 bg-white">
            {missingClients.map(item => (
              <div key={item.nif} className="flex items-center justify-between gap-3 px-3 py-2">
                <div className="min-w-0">
                  <p className="truncate font-bold text-slate-800">{item.customerName || 'Nome desconhecido'}</p>
                  <p className="font-mono text-[10px] text-slate-400">{item.nif} · {item.refs.join(', ')}</p>
                </div>
                <span className="shrink-0 font-bold text-red-700">{money.format(item.net)}</span>
              </div>
            ))}
          </div>
        </section>
      )}
      {source && unmatchedDocuments.length > 0 && (
        <section className="flex items-start gap-3 rounded-xl border border-blue-200 bg-blue-50 p-4 text-xs text-blue-800">
          <CircleDollarSign size={18} className="mt-0.5 shrink-0" />
          <div><p className="font-bold">{unmatchedDocuments.length} documento(s) fora da população de avenças</p><p className="mt-1 text-blue-700">Inclui particulares ou empresas de outros tipos já existentes no CMR. Não são tratados como falhas de faturação.</p></div>
        </section>
      )}
      {source && counts.correct === eligibleClients.length && <div className="flex items-center gap-2 text-xs font-semibold text-emerald-700"><CheckCircle2 size={15} /> Todas as avenças configuradas coincidem com a faturação.</div>}

      {editingClient && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
          <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <h3 className="text-lg font-bold text-slate-900">Editar {editingClient.name}</h3>
              <button type="button" onClick={closeEditModal}><X size={18} /></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-500">Avença Mensal (EUR)</label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={editForm.monthlyFee}
                  onChange={event => setEditForm({ ...editForm, monthlyFee: event.target.value })}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-bold text-slate-500">Tipo de Entidade</label>
                <select
                  value={editForm.entityType}
                  onChange={event => setEditForm({ ...editForm, entityType: event.target.value })}
                  className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  {ENTITY_TYPE_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                </select>
                <p className="mt-1 text-[10px] text-slate-400">
                  Esta correção fica só no CMR. A próxima sincronização WAMPR → CMR volta a trazer o tipo do WAMPR — corrija lá também se estiver errado na origem.
                </p>
              </div>
              {editError && <p className="text-xs font-semibold text-red-600">{editError}</p>}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button type="button" onClick={closeEditModal} className="rounded-lg px-4 py-2 text-sm text-slate-600 hover:bg-slate-100">Cancelar</button>
              <button
                type="button"
                onClick={() => void saveEdit()}
                disabled={isSavingEdit}
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 px-4 py-2 text-sm font-bold text-white hover:bg-blue-700 disabled:opacity-50"
              >
                {isSavingEdit ? <RefreshCcw size={14} className="animate-spin" /> : <Save size={14} />} Guardar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BillingControl;
