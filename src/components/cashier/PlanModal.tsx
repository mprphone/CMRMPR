import React from 'react';
import { RefreshCcw, Save, X } from 'lucide-react';
import { Client } from '../../types';
import { ClientPaymentPlan, PlanFormState } from '../../types/cashier';

interface PlanModalProps {
  isOpen: boolean;
  selectedPlanClient: Client | null;
  selectedClientPlan: ClientPaymentPlan | null;
  displayedStatus: 'Ativo' | 'Anulado' | 'Concluido' | null;
  openDebt: number;
  groupClients: Client[];
  planForm: PlanFormState;
  months: string[];
  isSavingPlan: boolean;
  onClose: () => void;
  onClientChange: (clientId: string) => void;
  onPlanFormChange: React.Dispatch<React.SetStateAction<PlanFormState>>;
  onRemove: () => void;
  onSave: () => void;
}

const PlanModal: React.FC<PlanModalProps> = ({
  isOpen,
  selectedPlanClient,
  selectedClientPlan,
  displayedStatus,
  openDebt,
  groupClients,
  planForm,
  months,
  isSavingPlan,
  onClose,
  onClientChange,
  onPlanFormChange,
  onRemove,
  onSave,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6">
        <div className="flex justify-between items-center mb-4">
          <div>
            <h3 className="text-xl font-bold">Acordo de Pagamento e Notas</h3>
            <p className="text-xs text-slate-500">{selectedPlanClient ? selectedPlanClient.name : 'Selecionar cliente'}</p>
            {selectedClientPlan && selectedPlanClient && displayedStatus && (
              <p className="text-xs text-slate-500">
                Estado: {displayedStatus} | Dívida em aberto: {openDebt.toFixed(2)} EUR
              </p>
            )}
          </div>
          <button type="button" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="mb-4">
          <label className="block text-xs font-bold text-slate-500 mb-1">Cliente</label>
          <select value={selectedPlanClient?.id || ''} onChange={event => onClientChange(event.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
            <option value="">Selecionar cliente</option>
            {groupClients.map(client => <option key={client.id} value={client.id}>{client.name}</option>)}
          </select>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">Valor mensal do acordo (EUR)</label>
            <input type="number" min="0" step="0.01" value={planForm.monthlyAmount} onChange={event => onPlanFormChange(prev => ({ ...prev, monthlyAmount: event.target.value }))} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="0.00" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">Valor da dívida do acordo (EUR)</label>
            <input type="number" min="0" step="0.01" value={planForm.debtAmount} onChange={event => onPlanFormChange(prev => ({ ...prev, debtAmount: event.target.value }))} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="0.00" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">Acordo até ao mês</label>
            <select value={planForm.payUntilMonth} onChange={event => onPlanFormChange(prev => ({ ...prev, payUntilMonth: Number(event.target.value) }))} className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
              {months.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">Acordo até ao ano</label>
            <input type="number" min="2000" max="3000" step="1" value={planForm.payUntilYear} onChange={event => onPlanFormChange(prev => ({ ...prev, payUntilYear: Number(event.target.value) }))} className="w-full px-3 py-2 border rounded-lg text-sm" />
          </div>
        </div>

        <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={planForm.called} onChange={event => onPlanFormChange(prev => ({ ...prev, called: event.target.checked }))} />
            Ligámos ao cliente
          </label>
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={planForm.letterSent} onChange={event => onPlanFormChange(prev => ({ ...prev, letterSent: event.target.checked }))} />
            Carta enviada
          </label>
        </div>

        <div className="mt-4">
          <label className="block text-xs font-bold text-slate-500 mb-1">Notas</label>
          <textarea value={planForm.notes} onChange={event => onPlanFormChange(prev => ({ ...prev, notes: event.target.value }))} className="w-full min-h-[110px] px-3 py-2 border rounded-lg text-sm" placeholder="Ex: ligação em 05/02, cliente pediu nova chamada na próxima semana..." />
        </div>

        <div className="flex justify-between items-center pt-6">
          <div>
            {selectedClientPlan && (
              <button type="button" onClick={onRemove} disabled={isSavingPlan} className="px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg font-bold">
                {isSavingPlan ? 'A remover...' : 'Remover acordo'}
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button type="button" onClick={onClose} disabled={isSavingPlan} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">Cancelar</button>
            <button type="button" onClick={onSave} disabled={isSavingPlan} className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 disabled:opacity-50">
              {isSavingPlan ? <RefreshCcw size={16} className="animate-spin" /> : <Save size={16} />}
              {isSavingPlan ? 'A guardar...' : 'Guardar acordo'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default PlanModal;
