
import React, { useState, useMemo } from 'react';
import { Task, TaskArea, TaskType, TurnoverBracket, GlobalSettings, QuoteItem, QuoteHistory } from '../types';
import { Plus, Trash2, FileText, Check, Printer, ArrowLeft, BadgeEuro, Calculator as CalcIcon, Save, RefreshCcw, History } from 'lucide-react';
import { quoteHistoryService } from '../services/supabase';

interface CalculatorProps {
  tasks: Task[];
  firmHourlyCost: number;
  logo: string;
  turnoverBrackets: TurnoverBracket[];
  globalSettings: GlobalSettings;
  quoteHistory: QuoteHistory[];
  setQuoteHistory: (history: QuoteHistory[]) => void;
}

const Calculator: React.FC<CalculatorProps> = ({ tasks, firmHourlyCost, logo, turnoverBrackets, globalSettings, quoteHistory, setQuoteHistory }) => {
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [targetMargin, setTargetMargin] = useState(30);
  const [clientVolume, setClientVolume] = useState<number>(0);
  const [quoteClientName, setQuoteClientName] = useState('');
  const [quoteClientNif, setQuoteClientNif] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const addItem = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (task && !items.find(i => i.taskId === taskId)) {
      setItems([...items, { taskId, quantity: 1, frequency: task.defaultFrequencyPerYear }]);
    }
  };

  const removeItem = (taskId: string) => {
    setItems(items.filter(i => i.taskId !== taskId));
  };

  const updateItem = (taskId: string, field: keyof QuoteItem, value: number) => {
    setItems(items.map(i => i.taskId === taskId ? { ...i, [field]: value } : i));
  };

  // Base labor calculations
  const totalAnnualMinutes = items.reduce((acc, item) => {
    const task = tasks.find(t => t.id === item.taskId);
    return acc + ((task?.defaultTimeMinutes || 0) * item.quantity * item.frequency);
  }, 0);

  const totalAnnualHours = totalAnnualMinutes / 60;
  
  // Specific unit costs from settings
  const payrollItems = items.filter(i => {
    const t = tasks.find(tk => tk.id === i.taskId);
    return t?.area === TaskArea.RH;
  });
  const payrollCost = payrollItems.reduce((acc, i) => acc + (i.quantity * i.frequency * globalSettings.payrollUnitCost), 0);
  
  const accountingItems = items.filter(i => {
    const t = tasks.find(tk => tk.id === i.taskId);
    return t?.name.toLowerCase().includes('lançar') || t?.area === TaskArea.CONTABILIDADE;
  });
  // Note: Only applying unit cost to items with "multiplier" logic like documents
  const documentsCost = accountingItems.reduce((acc, i) => acc + (i.quantity * i.frequency * globalSettings.documentUnitCost), 0);

  const baseLaborCost = totalAnnualHours * firmHourlyCost;
  const totalAnnualCost = baseLaborCost + payrollCost + documentsCost;
  
  const recommendedRevenue = totalAnnualCost / (1 - (targetMargin / 100));
  const recommendedMonthlyFee = recommendedRevenue / 12;

  // Turnover Fair Value Logic
  const fairValue = useMemo(() => {
    const bracket = turnoverBrackets.find(b => clientVolume >= b.minTurnover && clientVolume <= b.maxTurnover);
    if (!bracket) return null;
    return {
      min: (clientVolume * (bracket.minPercent / 100)) / 12,
      max: (clientVolume * (bracket.maxPercent / 100)) / 12
    };
  }, [clientVolume, turnoverBrackets]);

  const handleSaveProposal = async () => {
    if (items.length === 0) {
      alert("Adicione pelo menos um serviço para salvar a proposta.");
      return;
    }
    setIsSaving(true);
    const newProposal: Partial<QuoteHistory> = {
      client_name: quoteClientName,
      client_nif: quoteClientNif,
      client_volume: clientVolume,
      items: items,
      target_margin: targetMargin,
      recommended_monthly_fee: recommendedMonthlyFee,
      total_annual_cost: totalAnnualCost,
      total_annual_hours: totalAnnualHours,
    };

    try {
      const savedProposal = await quoteHistoryService.create(newProposal);
      setQuoteHistory([savedProposal, ...quoteHistory]);
      alert("Proposta salva com sucesso!");
    } catch (err: any) {
      alert("Erro ao salvar a proposta: " + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoadProposal = (proposal: QuoteHistory) => {
    if (!confirm("Deseja carregar esta proposta? As alterações atuais serão perdidas.")) return;
    setQuoteClientName(proposal.client_name);
    setQuoteClientNif(proposal.client_nif);
    setClientVolume(proposal.client_volume);
    setItems(proposal.items);
    setTargetMargin(proposal.target_margin);
  };


  if (showPreview) {
    return (
      <div className="animate-fade-in bg-white min-h-screen absolute top-0 left-0 w-full z-50 p-8">
        <div className="max-w-4xl mx-auto flex justify-between items-center mb-8 no-print border-b pb-4">
            <button onClick={() => setShowPreview(false)} className="flex items-center gap-2 text-slate-500 hover:text-slate-800">
                <ArrowLeft size={20}/> Voltar ao Simulador
            </button>
            <button onClick={() => window.print()} className="bg-blue-600 text-white px-6 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 font-bold shadow-sm">
                <Printer size={20}/> Guardar PDF
            </button>
        </div>
        <div className="max-w-4xl mx-auto bg-white p-12 border border-slate-100 print:border-none print:p-0">
            <div className="flex justify-between items-start border-b-2 border-slate-800 pb-6 mb-8">
                {logo && <img src={logo} alt="Logo" className="h-16 w-auto object-contain" />}
                <div className="text-right">
                    <h2 className="text-xl font-bold text-slate-700 uppercase tracking-tighter">Proposta de Gestão Contabilística</h2>
                    <p className="text-slate-500 text-sm mt-1">Data: {new Date().toLocaleDateString('pt-PT')}</p>
                </div>
            </div>
            <div className="grid grid-cols-2 gap-8 mb-8">
                <div className="bg-slate-50 p-4 rounded-lg">
                    <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Entidade</p>
                    <p className="font-bold text-slate-800">{quoteClientName || 'Exmo(a). Senhor(a)'}</p>
                    <p className="text-sm text-slate-500">NIF: {quoteClientNif || '---'}</p>
                </div>
                <div className="bg-slate-50 p-4 rounded-lg">
                    <p className="text-[10px] uppercase font-bold text-slate-400 mb-1">Vol. Negócios Base</p>
                    <p className="font-bold text-slate-800">{clientVolume.toLocaleString()}€ / ano</p>
                </div>
            </div>
            <div className="mb-10">
                <h3 className="text-sm font-bold text-slate-800 uppercase mb-4 border-l-4 border-blue-600 pl-3">Serviços e Obrigações Contratadas</h3>
                <table className="w-full text-xs text-left border-collapse">
                    <thead className="bg-slate-50 text-slate-500">
                        <tr>
                            <th className="p-3">Área / Serviço</th>
                            <th className="p-3 text-center">Frequência</th>
                            <th className="p-3 text-right">Escopo Estimado</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 border-b border-slate-100">
                        {items.map((item, idx) => {
                            const task = tasks.find(t => t.id === item.taskId);
                            return (
                                <tr key={idx}>
                                    <td className="p-3">
                                        <div className="font-bold">{task?.name}</div>
                                        <div className="text-[10px] text-slate-400 uppercase">{task?.area}</div>
                                    </td>
                                    <td className="p-3 text-center">{item.frequency}x Ano</td>
                                    <td className="p-3 text-right text-slate-500">Até {item.quantity} un./mês</td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
            <div className="bg-blue-600 text-white p-8 rounded-xl flex justify-between items-center print:bg-slate-900">
                <div>
                    <h4 className="text-lg font-bold">Investimento Mensal Proposto</h4>
                    <p className="text-blue-100 text-xs">Sujeito a IVA à taxa legal em vigor</p>
                </div>
                <div className="text-right">
                    <p className="text-4xl font-black">{recommendedMonthlyFee.toFixed(2)}€</p>
                    <p className="text-xs text-blue-200 mt-1">Válido por 30 dias</p>
                </div>
            </div>
            <div className="mt-12 text-[10px] text-slate-400 leading-relaxed italic text-center">
                Documento gerado automaticamente pelo sistema de gestão de rentabilidade AccounTech CRM.
            </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-fade-in pb-20">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
      <div className="lg:col-span-2 space-y-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
             <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
               <BadgeEuro size={20} className="text-blue-600"/> 1. Dados do Futuro Cliente
             </h2>
             <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                 <div className="md:col-span-1">
                     <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Nome Empresa</label>
                     <input type="text" value={quoteClientName} onChange={(e) => setQuoteClientName(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
                 </div>
                 <div>
                     <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">NIF</label>
                     <input type="text" value={quoteClientNif} onChange={(e) => setQuoteClientNif(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
                 </div>
                 <div>
                     <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Volume Negócios Anual (€)</label>
                     <input type="number" value={clientVolume} onChange={(e) => setClientVolume(parseFloat(e.target.value) || 0)} className="w-full px-3 py-2 border rounded-lg text-sm font-bold text-blue-600" />
                 </div>
             </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h2 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
            <FileText size={20} className="text-indigo-600"/> 2. Seleção de Serviços Contratados
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {Object.values(TaskArea).map(area => (
              <div key={area} className="space-y-2">
                <h3 className="text-[10px] font-black text-slate-400 uppercase tracking-widest">{area}</h3>
                <div className="flex flex-col gap-1">
                  {tasks.filter(t => t.area === area).map(task => {
                    const isSelected = items.some(i => i.taskId === task.id);
                    return (
                      <button
                        key={task.id}
                        onClick={() => isSelected ? removeItem(task.id) : addItem(task.id)}
                        className={`text-left px-3 py-2 rounded-lg border text-xs transition-all flex justify-between items-center ${
                          isSelected ? 'bg-indigo-50 border-indigo-300 text-indigo-700 font-bold' : 'bg-white border-slate-200 text-slate-600 hover:border-indigo-200'
                        }`}
                      >
                        <span className="truncate">{task.name}</span>
                        {isSelected && <Check size={14} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="lg:col-span-1">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 sticky top-6 space-y-6">
          <div className="flex items-center gap-2 border-b pb-4">
            <CalcIcon className="text-blue-600" size={24}/>
            <h3 className="text-lg font-bold text-slate-800 uppercase tracking-tighter">Simulação de Valor</h3>
          </div>
          
          <div className="space-y-3 max-h-80 overflow-y-auto pr-2 custom-scrollbar">
            {items.map(item => {
              const task = tasks.find(t => t.id === item.taskId);
              return (
                <div key={item.taskId} className="bg-slate-50 p-3 rounded-lg border border-slate-100 relative group">
                  <div className="flex justify-between items-start mb-2">
                    <span className="text-[11px] font-bold text-slate-700 truncate w-4/5">{task?.name}</span>
                    <button onClick={() => removeItem(item.taskId)} className="text-slate-300 hover:text-red-500"><Trash2 size={12}/></button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="text-[9px] font-bold text-slate-400 uppercase">Multiplicador</label>
                      <input type="number" min="1" value={item.quantity} onChange={(e) => updateItem(item.taskId, 'quantity', parseInt(e.target.value) || 1)} className="w-full border rounded px-2 py-1 text-[11px]" />
                    </div>
                    <div>
                      <label className="text-[9px] font-bold text-slate-400 uppercase">Freq. Anual</label>
                      <input type="number" min="1" value={item.frequency} onChange={(e) => updateItem(item.taskId, 'frequency', parseInt(e.target.value) || 1)} className="w-full border rounded px-2 py-1 text-[11px]" />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="space-y-4 pt-4 border-t">
             <div className="p-3 bg-indigo-50/50 rounded-lg border border-indigo-100">
                <label className="block text-[10px] font-bold text-indigo-500 uppercase mb-2">Margem de Lucro Alvo: {targetMargin}%</label>
                <input type="range" min="10" max="80" value={targetMargin} onChange={(e) => setTargetMargin(parseInt(e.target.value))} className="w-full h-1.5 bg-indigo-200 rounded-lg appearance-none cursor-pointer" />
             </div>

             {fairValue && (
               <div className="p-3 bg-green-50 rounded-lg border border-green-100">
                 <p className="text-[10px] font-bold text-green-600 uppercase mb-1">Intervalo de Referência (Fair Value)</p>
                 <p className="text-sm font-bold text-green-800">{fairValue.min.toFixed(0)}€ - {fairValue.max.toFixed(0)}€</p>
                 <p className="text-[9px] text-green-500 mt-1">Baseado no Volume de Negócios e Patamares definidos.</p>
               </div>
             )}

             <div className="bg-blue-600 p-5 rounded-xl text-center shadow-lg shadow-blue-100">
                <p className="text-[10px] text-blue-100 uppercase font-black tracking-widest mb-1">Avença Mensal Sugerida</p>
                <p className="text-4xl font-black text-white">{recommendedMonthlyFee.toFixed(2)}€</p>
                <p className="text-[10px] text-blue-200 mt-1">+ IVA / MÊS</p>
             </div>

             <div className="flex gap-2">
                <button 
                  onClick={handleSaveProposal}
                  disabled={items.length === 0 || isSaving}
                  className="w-full bg-green-600 text-white py-3 rounded-xl font-bold hover:bg-green-700 transition-all flex justify-center items-center gap-2 disabled:opacity-50"
                >
                  {isSaving ? <RefreshCcw size={18} className="animate-spin" /> : <Save size={18} />} Salvar
                </button>
                <button 
                  onClick={() => setShowPreview(true)}
                  disabled={items.length === 0}
                  className="w-full bg-slate-900 text-white py-3 rounded-xl font-bold hover:bg-black transition-all flex justify-center items-center gap-2 disabled:opacity-50"
                >
                  <FileText size={18} /> Proposta
                </button>
             </div>
          </div>
        </div>
      </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2">
          <History size={18} /> Histórico de Propostas Salvas
        </h3>
        <div className="overflow-x-auto max-h-96 custom-scrollbar">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50 sticky top-0">
              <tr>
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Cliente</th>
                <th className="px-4 py-3 text-right">Avença Sugerida</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {quoteHistory.map(item => (
                <tr key={item.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-xs text-slate-500">{new Date(item.created_at).toLocaleDateString('pt-PT')}</td>
                  <td className="px-4 py-3 font-medium text-slate-700">{item.client_name || 'Sem nome'}</td>
                  <td className="px-4 py-3 text-right font-bold text-blue-600">{item.recommended_monthly_fee.toFixed(2)}€</td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleLoadProposal(item)} className="text-xs text-blue-600 hover:underline">Carregar</button>
                  </td>
                </tr>
              ))}
              {quoteHistory.length === 0 && ( <tr><td colSpan={4} className="text-center italic text-slate-400 py-10">Nenhuma proposta salva ainda.</td></tr> )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Calculator;
