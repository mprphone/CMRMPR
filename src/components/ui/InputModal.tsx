import React from 'react';
import { InputModalState } from '../../hooks/useInputModal';

interface InputModalProps {
  state: InputModalState | null;
  value: string;
  onChange: (value: string) => void;
  onClose: (result: string | null) => void;
}

const InputModal: React.FC<InputModalProps> = ({ state, value, onChange, onClose }) => {
  if (!state) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl p-6 max-w-sm w-full mx-4">
        <h3 className="font-bold text-slate-800 text-lg mb-4">{state.title}</h3>
        <label className="block text-sm text-slate-600 mb-2">{state.label}</label>
        <input
          autoFocus
          type="text"
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') onClose(value);
            if (e.key === 'Escape') onClose(null);
          }}
          className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <div className="flex gap-3 justify-end mt-5">
          <button
            onClick={() => onClose(null)}
            className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 font-semibold text-sm hover:bg-slate-50"
          >
            {state.cancelLabel}
          </button>
          <button
            onClick={() => onClose(value)}
            className="px-4 py-2 rounded-lg bg-blue-600 text-white font-semibold text-sm hover:bg-blue-700"
          >
            {state.confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default InputModal;
