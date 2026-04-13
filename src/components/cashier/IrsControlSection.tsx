import React from 'react';
import { Check } from 'lucide-react';
import { Client, FeeGroup } from '../../types';
import { IrsControlRecord, IrsDeliveryClose, IrsSettlementStatus } from './useIrsControl';

interface IrsControlSectionProps {
  currentYear: number;
  setCurrentYear: React.Dispatch<React.SetStateAction<number>>;
  irsGroup?: FeeGroup;
  irsGroupClients: Client[];
  irsControlMap: Map<string, IrsControlRecord>;
  pendingDeliveryTotal: number;
  pendingDeliveryCount: number;
  pendingMbWayTotal: number;
  deliveryHistoryForYear: IrsDeliveryClose[];
  onCloseDelivery: () => void;
  onToggleDelivered: (clientId: string) => void;
  onTogglePaid: (clientId: string) => void;
  onPaymentMethodChange: (clientId: string, method: 'Numerário' | 'MB Way') => void;
  onAmountChange: (clientId: string, value: string) => void;
  onNotesChange: (clientId: string, notes: string) => void;
  onHouseholdInfoChange: (clientId: string, householdInfo: string) => void;
  onFinancasPasswordChange: (clientId: string, password: string) => void;
  onIrsSettlementChange: (clientId: string, settlement: IrsSettlementStatus) => void;
}

const IrsControlSection: React.FC<IrsControlSectionProps> = ({
  currentYear,
  setCurrentYear,
  irsGroup,
  irsGroupClients,
  irsControlMap,
  pendingDeliveryTotal,
  pendingDeliveryCount,
  pendingMbWayTotal,
  deliveryHistoryForYear,
  onCloseDelivery,
  onToggleDelivered,
  onTogglePaid,
  onPaymentMethodChange,
  onAmountChange,
  onNotesChange,
  onHouseholdInfoChange,
  onFinancasPasswordChange,
  onIrsSettlementChange,
}) => {
  const [expandedClientId, setExpandedClientId] = React.useState<string | null>(null);

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-slate-800">Control IRS</h3>
        <div className="flex items-center gap-2 text-xs">
          <span className="font-bold text-slate-500">Ano:</span>
          <button onClick={() => setCurrentYear(y => y - 1)} className="p-1 rounded-full hover:bg-slate-200">{'<'}</button>
          <span className="font-bold text-slate-700 w-14 text-center">{currentYear}</span>
          <button onClick={() => setCurrentYear(y => y + 1)} className="p-1 rounded-full hover:bg-slate-200">{'>'}</button>
        </div>
      </div>

      {!irsGroup ? (
        <p className="text-sm text-slate-400 italic text-center py-4">
          Nenhum grupo IRS encontrado. Crie/renomeie um grupo com "IRS".
        </p>
      ) : (
        <div className="space-y-4">
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-xs font-bold uppercase text-slate-500">Soma pendente (Numerário)</p>
              <p className="text-2xl font-black text-slate-800">{pendingDeliveryTotal.toFixed(2)} EUR</p>
              <p className="text-xs text-slate-500">{pendingDeliveryCount} registo(s) por fechar</p>
              <p className="text-xs text-blue-600 mt-1">MB Way pago: {pendingMbWayTotal.toFixed(2)} EUR</p>
            </div>
            <button
              type="button"
              onClick={onCloseDelivery}
              disabled={pendingDeliveryCount === 0}
              className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-40"
            >
              Fechar Entrega de Dinheiro
            </button>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500 uppercase bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left">Cliente</th>
                  <th className="px-3 py-2 text-left">NIF</th>
                  <th className="px-3 py-2 text-center">Entregue</th>
                  <th className="px-3 py-2 text-center">Pago</th>
                  <th className="px-3 py-2 text-left">Método</th>
                  <th className="px-3 py-2 text-right">Valor (EUR)</th>
                  <th className="px-3 py-2 text-left">Obs (oferta/motivo)</th>
                  <th className="px-3 py-2 text-center">Fecho</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {irsGroupClients.map(client => {
                  const record = irsControlMap.get(`${client.id}-${currentYear}`);
                  const delivered = Boolean(record?.delivered);
                  const paid = Boolean(record?.paid);
                  const amount = record?.amount ?? 0;
                  const paymentMethod = record?.paymentMethod || 'Numerário';
                  const notes = record?.notes ?? '';
                  const householdInfo = record?.householdInfo ?? '';
                  const financasPassword = record?.financasPassword ?? '';
                  const irsSettlement = record?.irsSettlement ?? '';
                  const isClosed = Boolean(record?.deliveryCloseId);
                  const isExpanded = expandedClientId === client.id;

                  return (
                    <React.Fragment key={`${client.id}-${currentYear}`}>
                      <tr className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-700">
                          <button
                            type="button"
                            onClick={() => setExpandedClientId(prev => prev === client.id ? null : client.id)}
                            className="text-left hover:text-blue-600"
                          >
                            <span className="block">{client.name}</span>
                            <span className="block text-[10px] font-normal text-blue-500">{isExpanded ? 'Ocultar detalhes IRS' : 'Ver detalhes IRS'}</span>
                          </button>
                        </td>
                        <td className="px-3 py-2 text-slate-600">{client.nif}</td>
                        <td className="px-3 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => onToggleDelivered(client.id)}
                            className={`w-8 h-8 rounded-md border mx-auto flex items-center justify-center ${delivered ? 'bg-green-500 border-green-500 text-white' : 'bg-white border-slate-300 text-slate-400 hover:bg-green-50'}`}
                          >
                            <Check size={14} />
                          </button>
                        </td>
                        <td className="px-3 py-2 text-center">
                          <button
                            type="button"
                            onClick={() => onTogglePaid(client.id)}
                            className={`w-8 h-8 rounded-md border mx-auto flex items-center justify-center ${paid ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-300 text-slate-400 hover:bg-blue-50'}`}
                          >
                            <Check size={14} />
                          </button>
                        </td>
                        <td className="px-3 py-2">
                          <select
                            value={paymentMethod}
                            disabled={!paid || isClosed}
                            onChange={(e) => onPaymentMethodChange(client.id, e.target.value as 'Numerário' | 'MB Way')}
                            className="w-full px-2 py-1.5 border rounded-lg text-sm disabled:bg-slate-100 disabled:text-slate-400"
                          >
                            <option value="Numerário">Numerário</option>
                            <option value="MB Way">MB Way</option>
                          </select>
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={amount > 0 ? amount.toString() : ''}
                            disabled={!paid || isClosed}
                            onChange={(e) => onAmountChange(client.id, e.target.value)}
                            className="w-full px-3 py-1.5 border rounded-lg text-right disabled:bg-slate-100 disabled:text-slate-400"
                            placeholder={paid ? '0.00' : '-'}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input
                            type="text"
                            value={notes}
                            onChange={(e) => onNotesChange(client.id, e.target.value)}
                            className="w-full px-3 py-1.5 border rounded-lg"
                            placeholder="Ex: oferta, motivo..."
                          />
                        </td>
                        <td className="px-3 py-2 text-center text-xs">
                          {isClosed ? 'Fechado' : 'Aberto'}
                        </td>
                      </tr>
                      {isExpanded && (
                        <tr className="bg-slate-50">
                          <td colSpan={8} className="px-3 py-3">
                            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                              <div>
                                <label className="text-[11px] font-bold text-slate-500 uppercase">Agregado Familiar</label>
                                <textarea
                                  value={householdInfo}
                                  onChange={(e) => onHouseholdInfoChange(client.id, e.target.value)}
                                  className="mt-1 w-full px-3 py-2 border rounded-lg text-sm"
                                  rows={2}
                                  placeholder="Composição do agregado familiar"
                                />
                              </div>
                              <div>
                                <label className="text-[11px] font-bold text-slate-500 uppercase">Senha Finanças</label>
                                <input
                                  type="password"
                                  value={financasPassword}
                                  onChange={(e) => onFinancasPasswordChange(client.id, e.target.value)}
                                  className="mt-1 w-full px-3 py-2 border rounded-lg text-sm"
                                  placeholder="Senha do Portal das Finanças"
                                  autoComplete="off"
                                />
                              </div>
                              <div>
                                <label className="text-[11px] font-bold text-slate-500 uppercase">IRS a Pagar/Receber</label>
                                <select
                                  value={irsSettlement}
                                  onChange={(e) => onIrsSettlementChange(client.id, e.target.value as IrsSettlementStatus)}
                                  className="mt-1 w-full px-3 py-2 border rounded-lg text-sm"
                                >
                                  <option value="">Não definido</option>
                                  <option value="A pagar">A pagar</option>
                                  <option value="A receber">A receber</option>
                                </select>
                              </div>
                            </div>
                          </td>
                        </tr>
                      )}
                    </React.Fragment>
                  );
                })}
              </tbody>
            </table>
          </div>

          <div className="overflow-x-auto">
            <h4 className="text-sm font-bold text-slate-700 mb-2">Histórico de Entregas</h4>
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500 uppercase bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left">Data</th>
                  <th className="px-3 py-2 text-right">Total (EUR)</th>
                  <th className="px-3 py-2 text-right">Registos</th>
                  <th className="px-3 py-2 text-left">Nota</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {deliveryHistoryForYear.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-3 py-3 text-center text-slate-400 italic">
                      Sem fechos de entrega neste ano.
                    </td>
                  </tr>
                ) : deliveryHistoryForYear.map(item => (
                  <tr key={item.id}>
                    <td className="px-3 py-2">{new Date(item.createdAt).toLocaleString('pt-PT')}</td>
                    <td className="px-3 py-2 text-right font-bold">{item.totalAmount.toFixed(2)}</td>
                    <td className="px-3 py-2 text-right">{item.itemCount}</td>
                    <td className="px-3 py-2">{item.note || '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
};

export default IrsControlSection;
