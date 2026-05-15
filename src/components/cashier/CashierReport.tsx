import React from 'react';
import { ArrowLeft, Printer } from 'lucide-react';
import { CashOperation } from '../../types';

interface CashierReportProps {
  report: CashOperation;
  onBack: () => void;
}

const CashierReport: React.FC<CashierReportProps> = ({ report, onBack }) => (
  <div className="animate-fade-in bg-white min-h-screen absolute top-0 left-0 w-full z-50 p-6 print:p-0">
    <style>{`@page { size: A4; margin: 1cm; } @media print { .no-print { display: none !important; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
    <div className="max-w-4xl mx-auto flex justify-between items-center mb-6 no-print border-b pb-4">
      <button onClick={onBack} className="flex items-center gap-2 text-slate-500 hover:text-slate-800">
        <ArrowLeft size={20}/> Voltar
      </button>
      <button onClick={() => window.print()} className="bg-blue-600 text-white px-6 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 font-bold">
        <Printer size={20}/> Imprimir Relatório
      </button>
    </div>
    <div className="max-w-4xl mx-auto bg-white p-4 print:p-2">
      <h2 className="text-xl font-bold text-slate-800">Relatório de Caixa</h2>
      <p className="text-sm text-slate-500 mb-6">Operação de {new Date(report.createdAt).toLocaleString('pt-PT')}</p>

      <div className="grid grid-cols-3 gap-2 mb-4 text-center">
        <div className="bg-green-50 p-2 rounded-lg"><p className="text-[10px] font-bold uppercase text-green-700">Recebido (Numerário)</p><p className="text-lg font-bold">{report.reportDetails.filter(d => d.method === 'Numerário').reduce((sum, detail) => sum + detail.total, 0).toFixed(2)}€</p></div>
        <div className="bg-blue-50 p-2 rounded-lg"><p className="text-[10px] font-bold uppercase text-blue-700">Recebido (MB Way)</p><p className="text-lg font-bold">{report.reportDetails.filter(d => d.method === 'MB Way').reduce((sum, detail) => sum + detail.total, 0).toFixed(2)}€</p></div>
        <div className="bg-green-100 p-2 rounded-lg"><p className="text-[10px] font-bold uppercase text-green-800">Depósito (Numerário)</p><p className="text-lg font-bold">{report.depositedAmount.toFixed(2)}€</p></div>
        <div className="bg-orange-50 p-2 rounded-lg"><p className="text-[10px] font-bold uppercase text-orange-700">Gastos de Caixa</p><p className="text-lg font-bold">{report.spentAmount.toFixed(2)}€</p></div>
        <div className="bg-yellow-50 p-2 rounded-lg"><p className="text-[10px] font-bold uppercase text-yellow-700">Acertos</p><p className="text-lg font-bold">{(report.adjustmentAmount || 0).toFixed(2)}€</p></div>
        <div className="bg-blue-100 p-2 rounded-lg"><p className="text-[10px] font-bold uppercase text-blue-800">Depósito (MB Way)</p><p className="text-lg font-bold">{(report.mbWayDepositedAmount || 0).toFixed(2)}€</p></div>
      </div>
      {report.spentDescription && <p className="text-xs italic mb-6"><b>Descrição dos Gastos/Acertos:</b> {report.spentDescription}</p>}

      <h3 className="font-bold text-slate-700 mb-1 text-base">Detalhe dos Recebimentos</h3>
      <table className="w-full text-xs text-left">
        <thead className="text-[10px] text-slate-500 uppercase bg-slate-50">
          <tr>
            <th className="px-2 py-1">Cliente</th>
            <th className="px-2 py-1">Método</th>
            <th className="px-2 py-1">Referência</th>
            <th className="px-2 py-1 text-right">Total (€)</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {report.reportDetails.map((item, index) => (
            <tr key={index}>
              <td className="px-2 py-1 font-medium">{item.clientName}</td>
              <td className={`px-2 py-1 font-bold ${item.method === 'MB Way' ? 'text-blue-600' : 'text-green-600'}`}>{item.method}</td>
              <td className="px-2 py-1">{item.months.join(', ')}</td>
              <td className="px-2 py-1 text-right font-bold">{item.total.toFixed(2)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>
);

export default CashierReport;
