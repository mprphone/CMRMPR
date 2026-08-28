import React, { useEffect, useState } from 'react';
import { KeyRound, RefreshCcw, ShieldCheck, ShieldOff } from 'lucide-react';
import { ensureStoreClient } from '../services';

type Factor = { id: string; status: string; friendly_name?: string };

const MfaSecurity: React.FC = () => {
  const [verifiedFactor, setVerifiedFactor] = useState<Factor | null>(null);
  const [enrollment, setEnrollment] = useState<{ id: string; qrCode: string; secret: string } | null>(null);
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isConfirmingDisable, setIsConfirmingDisable] = useState(false);
  const [disableCode, setDisableCode] = useState('');

  const loadFactors = async () => {
    setLoading(true);
    try {
      const client = ensureStoreClient();
      const { data, error } = await client.auth.mfa.listFactors();
      if (error) throw error;
      setVerifiedFactor(data.totp.find(item => item.status === 'verified') || null);
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Não foi possível consultar o MFA.' });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void loadFactors(); }, []);

  const startEnrollment = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const client = ensureStoreClient();
      const { data: existing, error: listError } = await client.auth.mfa.listFactors();
      if (listError) throw listError;
      for (const factor of existing.totp.filter(item => item.status !== 'verified')) {
        const { error } = await client.auth.mfa.unenroll({ factorId: factor.id });
        if (error) throw error;
      }
      const { data, error } = await client.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'CMR MPR',
      });
      if (error) throw error;
      setEnrollment({ id: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
      setCode('');
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Não foi possível iniciar o MFA.' });
    } finally {
      setLoading(false);
    }
  };

  const verifyEnrollment = async () => {
    if (!enrollment || !/^\d{6}$/.test(code)) return;
    setLoading(true);
    setMessage(null);
    try {
      const client = ensureStoreClient();
      const { error } = await client.auth.mfa.challengeAndVerify({ factorId: enrollment.id, code });
      if (error) throw error;
      setEnrollment(null);
      setCode('');
      await loadFactors();
      setMessage({ type: 'success', text: 'Autenticação em dois passos ativada. Os próximos acessos exigirão o código.' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Código inválido ou expirado.' });
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  const disableMfa = async () => {
    if (!verifiedFactor || !/^\d{6}$/.test(disableCode)) return;
    setLoading(true);
    setMessage(null);
    try {
      const client = ensureStoreClient();
      // Exige um código TOTP fresco (prova de posse do autenticador) antes de
      // desativar o 2º fator, mesmo que a sessão já esteja verificada (aal2) —
      // protege contra um browser partilhado/sessão esquecida aberta.
      const { error: verifyError } = await client.auth.mfa.challengeAndVerify({
        factorId: verifiedFactor.id,
        code: disableCode,
      });
      if (verifyError) throw verifyError;
      const { error } = await client.auth.mfa.unenroll({ factorId: verifiedFactor.id });
      if (error) throw error;
      setVerifiedFactor(null);
      setIsConfirmingDisable(false);
      setDisableCode('');
      setMessage({ type: 'success', text: 'Autenticação em dois passos desativada.' });
    } catch (err: any) {
      setMessage({ type: 'error', text: err?.message || 'Código inválido. O MFA não foi desativado.' });
      setDisableCode('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-800 flex items-center gap-2"><ShieldCheck size={18} /> Segurança da sua conta</h3>
          <p className="text-xs text-slate-500 mt-1">MFA protege o acesso mesmo que alguém descubra a palavra-passe.</p>
        </div>
        {verifiedFactor ? (
          <span className="text-xs font-bold rounded-full px-3 py-1 bg-green-100 text-green-700">MFA ativo</span>
        ) : (
          <span className="text-xs font-bold rounded-full px-3 py-1 bg-amber-100 text-amber-700">MFA por ativar</span>
        )}
      </div>

      {message && (
        <div className={`rounded-lg px-4 py-3 text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {enrollment ? (
        <div className="grid grid-cols-1 md:grid-cols-[190px_1fr] gap-5 items-center rounded-xl border border-blue-200 bg-blue-50 p-4">
          <img src={enrollment.qrCode} alt="Código QR para configurar MFA" className="w-44 h-44 bg-white p-2 rounded-lg border mx-auto" />
          <div className="space-y-3 min-w-0">
            <p className="text-sm text-slate-700">Leia o QR code no Microsoft Authenticator, Google Authenticator ou aplicação compatível.</p>
            <details className="text-xs text-slate-600">
              <summary className="cursor-pointer font-bold">Introduzir chave manualmente</summary>
              <code className="block break-all bg-white border rounded p-2 mt-2 select-all">{enrollment.secret}</code>
            </details>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={code}
                onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Código de 6 dígitos"
                className="flex-1 px-3 py-2 border rounded-lg text-sm bg-white"
              />
              <button
                type="button"
                onClick={() => void verifyEnrollment()}
                disabled={loading || code.length !== 6}
                className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? <RefreshCcw size={15} className="animate-spin" /> : <KeyRound size={15} />} Confirmar
              </button>
            </div>
          </div>
        </div>
      ) : verifiedFactor ? (
        isConfirmingDisable ? (
          <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3">
            <p className="text-sm text-red-800">
              Para desativar o MFA, confirme com um código atual da sua aplicação de autenticação.
            </p>
            <div className="flex flex-col sm:flex-row gap-2">
              <input
                inputMode="numeric"
                autoComplete="one-time-code"
                value={disableCode}
                onChange={event => setDisableCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                placeholder="Código de 6 dígitos"
                className="flex-1 px-3 py-2 border rounded-lg text-sm bg-white"
              />
              <button
                type="button"
                onClick={() => void disableMfa()}
                disabled={loading || disableCode.length !== 6}
                className="px-4 py-2 rounded-lg bg-red-600 text-white text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {loading ? <RefreshCcw size={15} className="animate-spin" /> : <ShieldOff size={15} />} Confirmar e desativar
              </button>
              <button
                type="button"
                onClick={() => { setIsConfirmingDisable(false); setDisableCode(''); }}
                disabled={loading}
                className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 text-sm font-bold hover:bg-slate-50"
              >
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setIsConfirmingDisable(true)}
            disabled={loading}
            className="px-4 py-2 rounded-lg border border-red-200 text-red-700 text-sm font-bold hover:bg-red-50 disabled:opacity-50 flex items-center gap-2"
          >
            <ShieldOff size={16} /> Desativar MFA
          </button>
        )
      ) : (
        <button
          type="button"
          onClick={() => void startEnrollment()}
          disabled={loading}
          className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
        >
          {loading ? <RefreshCcw size={16} className="animate-spin" /> : <ShieldCheck size={16} />} Ativar MFA
        </button>
      )}
    </div>
  );
};

export default MfaSecurity;

