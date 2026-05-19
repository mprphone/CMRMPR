import React from 'react';
import { Check, AlertTriangle, Banknote, CreditCard, DollarSign } from 'lucide-react';

export interface CloseRegisterSummary {
  numerarioTotal: number;
  mbWayTotal: number;
  numerarioCount: number;
  mbWayCount: number;
  sessionExpensesTotal: number;
  deposit: number;
  mbWayDeposit: number;
  adjustment: number;
  hasBalanceMismatch: boolean;
}

interface CloseRegisterModalProps {
  summary: CloseRegisterSummary | null;
  onConfirm: () => void;
  onCancel: () => void;
}

const CloseRegisterModal: React.FC<CloseRegisterModalProps> = ({ summary, onConfirm, onCancel }) => {
  if (!summary) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-md w-full mx-4">
        <h3 className="font-bold text-slate-800 text-lg mb-1">Fechar Caixa</h3>
        <p className="text-slate-400 text-xs mb-5">Confirme o resumo antes de finalizar. Esta ação é irreversível.</p>

        <div className="space-y-3 mb-5">
          <div className="bg-slate-50 rounded-xl p-4 space-y-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Recebimentos a Processar</p>
            <div className="flex justify-between text-sm">
              <span className="flex items-center gap-2 text-slate-600"><Banknote size={14} /> Numerário ({summary.numerarioCount} pag.)</span>
              <span className="font-bold text-slate-800">{summary.numerarioTotal.toFixed(2)} €</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="flex items-center gap-2 text-slate-600"><CreditCard size={14} /> MB Way ({summary.mbWayCount} pag.)</span>
              <span className="font-bold text-slate-800">{summary.mbWayTotal.toFixed(2)} €</span>
            </div>
            {summary.sessionExpensesTotal > 0 && (
              <div className="flex justify-between text-sm border-t border-slate-200 pt-2 mt-2">
                <span className="flex items-center gap-2 text-slate-600"><DollarSign size={14} /> Saídas de Caixa</span>
                <span className="font-bold text-orange-600">-{summary.sessionExpensesTotal.toFixed(2)} €</span>
              </div>
            )}
          </div>

          <div className="bg-slate-50 rounded-xl p-4 space-y-2">
            <p className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-2">Depósitos Declarados</p>
            <div className="flex justify-between text-sm">
              <span className="text-slate-600">Depósito Numerário</span>
              <span className="font-bold text-slate-800">{summary.deposit.toFixed(2)} €</span>
            </div>
            {summary.mbWayDeposit > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Depósito MB Way</span>
                <span className="font-bold text-slate-800">{summary.mbWayDeposit.toFixed(2)} €</span>
              </div>
            )}
            {summary.adjustment !== 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-slate-600">Acerto</span>
                <span className="font-bold text-slate-800">{summary.adjustment > 0 ? '+' : ''}{summary.adjustment.toFixed(2)} €</span>
              </div>
            )}
          </div>

          {summary.hasBalanceMismatch && (
            <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-xl p-3">
              <AlertTriangle size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
              <p className="text-xs text-amber-700 font-medium">
                Atenção: O total de numerário recebido não coincide com depósito + gastos + acertos. Pode confirmar mesmo assim.
              </p>
            </div>
          )}
        </div>

        <div className="flex gap-3 justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 rounded-lg bg-slate-900 text-white font-semibold text-sm hover:bg-black flex items-center gap-2"
          >
            <Check size={16} /> Confirmar e Fechar
          </button>
        </div>
      </div>
    </div>
  );
};

export default CloseRegisterModal;
