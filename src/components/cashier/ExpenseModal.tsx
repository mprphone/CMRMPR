import React from 'react';
import { Save, X } from 'lucide-react';

interface ExpenseModalProps {
  isOpen: boolean;
  amount: string;
  description: string;
  onClose: () => void;
  onAmountChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onAdd: () => void;
}

const ExpenseModal: React.FC<ExpenseModalProps> = ({
  isOpen,
  amount,
  description,
  onClose,
  onAmountChange,
  onDescriptionChange,
  onAdd,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <div className="flex justify-between items-center mb-4">
          <h3 className="text-xl font-bold">Nova Saída de Caixa</h3>
          <button type="button" onClick={onClose}><X size={20} /></button>
        </div>
        <div className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">Valor (€)</label>
            <input type="number" value={amount} onChange={event => onAmountChange(event.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="0.00" autoFocus />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">Descrição</label>
            <input type="text" value={description} onChange={event => onDescriptionChange(event.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Ex: Material de escritório" />
          </div>
        </div>
        <div className="flex justify-end gap-3 pt-6">
          <button type="button" onClick={onClose} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">Cancelar</button>
          <button onClick={onAdd} className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2">
            <Save size={16} /> Adicionar
          </button>
        </div>
      </div>
    </div>
  );
};

export default ExpenseModal;
