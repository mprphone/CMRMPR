import React from 'react';
import { Check } from 'lucide-react';
import { Client, FeeGroup } from '../../types';
import { IrsControlRecord } from './useIrsControl';

interface IrsControlSectionProps {
  currentYear: number;
  setCurrentYear: React.Dispatch<React.SetStateAction<number>>;
  irsGroup?: FeeGroup;
  irsGroupClients: Client[];
  irsControlMap: Map<string, IrsControlRecord>;
  onToggleDelivered: (clientId: string) => void;
  onTogglePaid: (clientId: string) => void;
  onAmountChange: (clientId: string, value: string) => void;
  onNotesChange: (clientId: string, notes: string) => void;
}

const IrsControlSection: React.FC<IrsControlSectionProps> = ({
  currentYear,
  setCurrentYear,
  irsGroup,
  irsGroupClients,
  irsControlMap,
  onToggleDelivered,
  onTogglePaid,
  onAmountChange,
  onNotesChange,
}) => {
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
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50">
              <tr>
                <th className="px-3 py-2 text-left">Cliente</th>
                <th className="px-3 py-2 text-left">NIF</th>
                <th className="px-3 py-2 text-center">Entregue</th>
                <th className="px-3 py-2 text-center">Pago</th>
                <th className="px-3 py-2 text-right">Valor (EUR)</th>
                <th className="px-3 py-2 text-left">Obs (oferta/motivo)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {irsGroupClients.map(client => {
                const record = irsControlMap.get(`${client.id}-${currentYear}`);
                const delivered = Boolean(record?.delivered);
                const paid = Boolean(record?.paid);
                const amount = record?.amount ?? 0;
                const notes = record?.notes ?? '';

                return (
                  <tr key={`${client.id}-${currentYear}`} className="hover:bg-slate-50">
                    <td className="px-3 py-2 font-medium text-slate-700">{client.name}</td>
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
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={amount > 0 ? amount.toString() : ''}
                        disabled={!paid}
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
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default IrsControlSection;

