import React from 'react';
import { AlertTriangle } from 'lucide-react';
import { ConfirmState } from '../../hooks/useConfirm';

interface ConfirmModalProps {
  state: ConfirmState | null;
  onClose: (result: boolean) => void;
}

const ConfirmModal: React.FC<ConfirmModalProps> = ({ state, onClose }) => {
  if (!state) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
        {state.variant === 'danger' && (
          <div className="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-4">
            <AlertTriangle size={22} className="text-red-600" />
          </div>
        )}
        <h3 className="font-bold text-slate-800 text-lg mb-2">{state.title}</h3>
        <p className="text-slate-600 text-sm">{state.message}</p>
        {state.detail && <p className="text-slate-400 text-xs mt-1">{state.detail}</p>}
        <div className="flex gap-3 justify-end mt-6">
          <button
            onClick={() => onClose(false)}
            className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50"
          >
            {state.cancelLabel}
          </button>
          <button
            onClick={() => onClose(true)}
            className={`px-4 py-2 rounded-lg font-semibold text-sm text-white ${
              state.variant === 'danger' ? 'bg-red-600 hover:bg-red-700' : 'bg-slate-900 hover:bg-black'
            }`}
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmModal;
