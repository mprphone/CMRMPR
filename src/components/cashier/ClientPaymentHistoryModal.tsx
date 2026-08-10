import React, { useMemo } from 'react';
import { X, Eye } from 'lucide-react';
import { Client, CashOperation } from '../../types';

interface ClientPaymentHistoryModalProps {
  client: Client | null;
  cashOperations: CashOperation[];
  onClose: () => void;
  onSelectReport: (operation: CashOperation) => void;
}

const ClientPaymentHistoryModal: React.FC<ClientPaymentHistoryModalProps> = ({
  client,
  cashOperations,
  onClose,
  onSelectReport,
}) => {
  const entries = useMemo(() => {
    if (!client) return [];
    return cashOperations
      .map(operation => ({
        operation,
        details: operation.reportDetails.filter(detail => detail.clientName === client.name),
      }))
      .filter(entry => entry.details.length > 0)
      .sort((a, b) => new Date(b.operation.createdAt).getTime() - new Date(a.operation.createdAt).getTime());
  }, [client, cashOperations]);

  const totalPaid = useMemo(
    () => entries.reduce((sum, entry) => sum + entry.details.reduce((s, d) => s + d.total, 0), 0),
    [entries]
  );

  if (!client) return null;

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] flex flex-col">
        <div className="flex justify-between items-center p-6 pb-4 border-b">
          <div>
            <h3 className="text-xl font-bold text-slate-800">Pagamentos de {client.name}</h3>
            <p className="text-xs text-slate-500">Histórico por relatório de fecho de caixa</p>
          </div>
          <button type="button" onClick={onClose}><X size={20} /></button>
        </div>

        <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
          {entries.length === 0 ? (
            <p className="text-sm text-slate-400 italic text-center py-8">
              Este cliente ainda não tem pagamentos incluídos em nenhum fecho de caixa.
            </p>
          ) : (
            <div className="space-y-3">
              {entries.map(({ operation, details }) => {
                const operationTotal = details.reduce((sum, d) => sum + d.total, 0);
                return (
                  <div key={operation.id} className="border border-slate-200 rounded-lg p-3">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-xs font-bold text-slate-500">
                        Fecho de {new Date(operation.createdAt).toLocaleString('pt-PT')}
                      </span>
                      <div className="flex items-center gap-3">
                        <span className="font-bold text-slate-800">{operationTotal.toFixed(2)}€</span>
                        <button
                          type="button"
                          onClick={() => onSelectReport(operation)}
                          className="text-xs font-bold text-blue-600 hover:underline flex items-center gap-1"
                        >
                          <Eye size={12} /> Ver Relatório
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      {details.map((detail, index) => (
                        <div key={index} className="flex justify-between items-center text-sm">
                          <span className={`font-bold text-xs ${detail.method === 'MB Way' ? 'text-blue-600' : 'text-green-600'}`}>
                            {detail.method}
                          </span>
                          <span className="text-slate-500 text-xs">{detail.months.join(', ')}</span>
                          <span className="font-medium text-slate-700">{detail.total.toFixed(2)}€</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="p-6 pt-4 border-t flex justify-between items-center">
          <span className="text-sm font-bold text-slate-500">Total pago (fechos):</span>
          <span className="text-xl font-black text-slate-800">{totalPaid.toFixed(2)}€</span>
        </div>
      </div>
    </div>
  );
};

export default ClientPaymentHistoryModal;
