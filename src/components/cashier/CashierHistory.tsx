import React from 'react';
import { ArrowLeft } from 'lucide-react';
import { CashOperation } from '../../types';

interface CashierHistoryProps {
  operations: CashOperation[];
  onBack: () => void;
  onSelectReport: (operation: CashOperation) => void;
}

const CashierHistory: React.FC<CashierHistoryProps> = ({ operations, onBack, onSelectReport }) => (
  <div className="space-y-6 animate-fade-in">
    <div className="flex justify-between items-center">
      <div><h2 className="text-2xl font-bold text-slate-800">Histórico de Operações de Caixa</h2></div>
      <button onClick={onBack} className="flex items-center gap-2 text-slate-500 hover:text-slate-800 text-sm">
        <ArrowLeft size={16}/> Voltar
      </button>
    </div>
    <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
      <table className="w-full text-sm text-left">
        <thead className="text-xs text-slate-500 uppercase bg-slate-50">
          <tr>
            <th className="px-4 py-3">Data</th>
            <th className="px-4 py-3 text-right">Valor Depositado</th>
            <th className="px-4 py-3 text-right">Valor Gasto</th>
            <th className="px-4 py-3">Descrição Gastos</th>
            <th className="px-4 py-3 text-right">Ações</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-50">
          {operations.map(operation => (
            <tr key={operation.id} className="hover:bg-slate-50">
              <td className="px-4 py-3 text-xs">{new Date(operation.createdAt).toLocaleString('pt-PT')}</td>
              <td className="px-4 py-3 text-right font-bold text-blue-600">{operation.depositedAmount.toFixed(2)}€</td>
              <td className="px-4 py-3 text-right font-bold text-orange-600">{operation.spentAmount.toFixed(2)}€</td>
              <td className="px-4 py-3 text-xs italic">{operation.spentDescription}</td>
              <td className="px-4 py-3 text-right">
                <button onClick={() => onSelectReport(operation)} className="text-xs font-bold text-blue-600 hover:underline">
                  Ver Relatório
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

export default CashierHistory;
