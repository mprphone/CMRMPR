import React, { useEffect, useState } from 'react';
import { KeyRound, LogOut, RefreshCcw, ShieldCheck } from 'lucide-react';
import { ensureStoreClient } from '../services';

interface MfaChallengeProps {
  onVerified: () => void;
}

const MfaChallenge: React.FC<MfaChallengeProps> = ({ onVerified }) => {
  const [factorId, setFactorId] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const client = ensureStoreClient();
        const { data, error: factorsError } = await client.auth.mfa.listFactors();
        if (factorsError) throw factorsError;
        const factor = data.totp.find(item => item.status === 'verified');
        if (!factor) throw new Error('Não existe um autenticador verificado para esta conta.');
        if (active) setFactorId(factor.id);
      } catch (err: any) {
        if (active) setError(err?.message || 'Não foi possível carregar a autenticação em dois passos.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => { active = false; };
  }, []);

  const verify = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!factorId || !/^\d{6}$/.test(code)) return;
    setLoading(true);
    setError(null);
    try {
      const client = ensureStoreClient();
      const { error: verifyError } = await client.auth.mfa.challengeAndVerify({ factorId, code });
      if (verifyError) throw verifyError;
      onVerified();
    } catch (err: any) {
      setError(err?.message || 'Código inválido ou expirado.');
      setCode('');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-screen bg-slate-100 p-4">
      <div className="w-full max-w-md p-8 space-y-6 bg-white rounded-xl shadow-lg">
        <div className="text-center">
          <ShieldCheck size={42} className="mx-auto text-blue-600 mb-3" />
          <h2 className="text-2xl font-bold text-slate-800">Verificação de segurança</h2>
          <p className="text-sm text-slate-500 mt-2">Introduza o código de 6 dígitos da aplicação autenticadora.</p>
        </div>
        <form onSubmit={verify} className="space-y-4">
          <input
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            value={code}
            onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
            className="w-full p-3 border border-slate-300 rounded-lg text-center text-2xl tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-blue-500"
            aria-label="Código do autenticador"
            autoFocus
            required
          />
          {error && <p className="text-red-600 text-xs">{error}</p>}
          <button
            type="submit"
            disabled={loading || !factorId || code.length !== 6}
            className="w-full bg-blue-600 text-white font-bold py-3 rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading ? <RefreshCcw size={18} className="animate-spin" /> : <KeyRound size={18} />}
            Confirmar código
          </button>
        </form>
        <button
          type="button"
          onClick={() => void ensureStoreClient().auth.signOut()}
          className="w-full text-sm text-slate-500 hover:text-slate-800 flex items-center justify-center gap-2"
        >
          <LogOut size={15} /> Terminar sessão
        </button>
      </div>
    </div>
  );
};

export default MfaChallenge;

