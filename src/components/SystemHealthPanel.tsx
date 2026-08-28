import React, { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Database, HardDrive, RefreshCcw, RotateCw } from 'lucide-react';
import { SystemHealth, systemHealthService } from '../services';

const formatDate = (value: string | null) => {
  if (!value) return 'Sem registo';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Sem registo' : date.toLocaleString('pt-PT');
};

const StatusIcon = ({ ok }: { ok: boolean }) => ok
  ? <CheckCircle2 size={18} className="text-green-600" />
  : <AlertTriangle size={18} className="text-amber-600" />;

const SystemHealthPanel: React.FC = () => {
  const [health, setHealth] = useState<SystemHealth | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    setLoading(true);
    setError(null);
    try {
      setHealth(await systemHealthService.get());
    } catch (err: any) {
      setError(err?.message || 'Não foi possível verificar o sistema.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 5 * 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-800 flex items-center gap-2"><HardDrive size={18} /> Estado e proteção dos dados</h3>
          <p className="text-xs text-slate-500 mt-1">Base local, ligação WAPRO e backup automático.</p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="text-xs font-bold px-3 py-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 disabled:opacity-50 flex items-center gap-2"
        >
          <RefreshCcw size={14} className={loading ? 'animate-spin' : ''} /> Verificar
        </button>
      </div>

      {error && <div className="rounded-lg px-4 py-3 text-sm bg-red-50 text-red-700 border border-red-100">{error}</div>}

      {health && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <div className="border rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-slate-700 flex items-center gap-2"><Database size={16} /> PostgreSQL local</span>
                <StatusIcon ok={health.database.ok} />
              </div>
              <p className="text-xs text-slate-500">{health.database.clients} clientes ({health.database.syncedClients} WAPRO)</p>
              <p className="text-xs text-slate-500">{health.database.staff} colaboradores ({health.database.syncedStaff} WAPRO)</p>
            </div>
            <div className="border rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-slate-700 flex items-center gap-2"><RotateCw size={16} /> WAPRO → CMR</span>
                <StatusIcon ok={health.sync.ok} />
              </div>
              <p className="text-xs text-slate-500">Último sucesso: {formatDate(health.sync.lastSuccessAt)}</p>
              <p className="text-xs text-slate-500">Fila: {health.sync.pending} pendente(s), {health.sync.failed} falha(s)</p>
            </div>
            <div className="border rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-bold text-sm text-slate-700 flex items-center gap-2"><HardDrive size={16} /> Backup diário</span>
                <StatusIcon ok={health.backup.ok} />
              </div>
              <p className="text-xs text-slate-500">Última verificação: {formatDate(health.backup.lastCheckedAt)}</p>
              <p className="text-xs text-slate-500">Cópia: {health.backup.backupId || 'Sem registo'}</p>
            </div>
          </div>

          {health.warnings.length > 0 ? (
            <div className="rounded-lg px-4 py-3 bg-amber-50 text-amber-800 border border-amber-100">
              <p className="text-xs font-bold mb-1">Atenção necessária</p>
              <ul className="text-xs list-disc pl-4 space-y-1">
                {health.warnings.map(warning => <li key={warning}>{warning}</li>)}
              </ul>
            </div>
          ) : (
            <div className="rounded-lg px-4 py-3 bg-green-50 text-green-700 border border-green-100 text-sm flex items-center gap-2">
              <CheckCircle2 size={17} /> Base, sincronização e backup estão operacionais.
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default SystemHealthPanel;

