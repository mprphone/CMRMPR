
import React, { useState, useMemo, useEffect } from 'react';
import { Task, TaskArea, TaskType, TurnoverBracket, GlobalSettings, QuoteItem, QuoteHistory, MultiplierLogic } from '../types';
import { Plus, Trash2, FileText, Check, Printer, ArrowLeft, BadgeEuro, Calculator as CalcIcon, Save, RefreshCcw, History } from 'lucide-react';
import { quoteHistoryService } from '../services/supabase';

interface CalculatorProps {
  tasks: Task[];
  areaCosts: Record<string, number>;
  logo: string;
  turnoverBrackets: TurnoverBracket[];
  globalSettings: GlobalSettings;
  quoteHistory: QuoteHistory[];
  setQuoteHistory: (history: QuoteHistory[]) => void;
}

const Calculator: React.FC<CalculatorProps> = ({ tasks, areaCosts, logo, turnoverBrackets, globalSettings, quoteHistory, setQuoteHistory }) => {
  const [items, setItems] = useState<QuoteItem[]>([]);
  const [targetMargin, setTargetMargin] = useState(30);
  const [clientVolume, setClientVolume] = useState<number>(0);
  const [quoteClientName, setQuoteClientName] = useState('');
  const [quoteClientNif, setQuoteClientNif] = useState('');
  const [employeeCount, setEmployeeCount] = useState(0);
  const [documentCount, setDocumentCount] = useState(0);
  const [establishments, setEstablishments] = useState(1);
  const [banks, setBanks] = useState(1);
  const [showPreview, setShowPreview] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    // Pre-select mandatory tasks on initial load
    const mandatoryTasks = tasks.filter(t => t.type === TaskType.OBRIGACAO);
    const initialItems = mandatoryTasks.map(task => ({
      taskId: task.id,
      quantity: 1, // Start with a default quantity of 1
      frequency: task.defaultFrequencyPerYear
    }));
    setItems(initialItems);
  }, []); // Empty dependency array ensures this runs only once on mount

  // Reactive updates for logic-based multipliers
  useEffect(() => {
    setItems(currentItems => 
      currentItems.map(item => {
        const task = tasks.find(t => t.id === item.taskId);
        if (task?.multiplierLogic === 'employeeCount') {
          return { ...item, quantity: employeeCount > 0 ? employeeCount : 1 };
        }
        return item;
      })
    );
  }, [employeeCount, tasks]);

  useEffect(() => {
    setItems(currentItems => 
      currentItems.map(item => {
        const task = tasks.find(t => t.id === item.taskId);
        if (task?.multiplierLogic === 'documentCount') {
          return { ...item, quantity: documentCount > 0 ? documentCount : 1 };
        }
        return item;
      })
    );
  }, [documentCount, tasks]);

  useEffect(() => {
    setItems(currentItems => 
      currentItems.map(item => {
        const task = tasks.find(t => t.id === item.taskId);
        if (task?.multiplierLogic === 'banks') return { ...item, quantity: banks > 0 ? banks : 1 };
        if (task?.multiplierLogic === 'establishments') return { ...item, quantity: establishments > 0 ? establishments : 1 };
        return item;
      })
    );
  }, [banks, establishments, tasks]);

  const addItem = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (task && !items.find(i => i.taskId === taskId)) {
      let quantity = 1;
      switch (task.multiplierLogic) {
        case 'employeeCount':
          quantity = employeeCount > 0 ? employeeCount : 1;
          break;
        case 'documentCount':
          quantity = documentCount > 0 ? documentCount : 1;
          break;
        case 'establishments':
          quantity = establishments > 0 ? establishments : 1;
          break;
        case 'banks':
          quantity = banks > 0 ? banks : 1;
          break;
        default:
          quantity = 1;
      }
      setItems([...items, { taskId, quantity, frequency: task.defaultFrequencyPerYear }]);
    }
  };

  const removeItem = (taskId: string) => {
    setItems(items.filter(i => i.taskId !== taskId));
  };

  const updateItem = (taskId: string, field: keyof QuoteItem, value: number) => {
    setItems(items.map(i => i.taskId === taskId ? { ...i, [field]: value } : i));
  };

  const { totalAnnualHours, totalAnnualCost } = useMemo(() => {
    let totalMinutes = 0;
    let totalCost = 0;

    items.forEach(item => {
      const task = tasks.find(t => t.id === item.taskId);
      if (!task) return;

      const annualMinutes = (task.defaultTimeMinutes || 0) * item.quantity * item.frequency;
      const annualHours = annualMinutes / 60;
      
      // Use the specific cost for the task's area, with a fallback
      const hourlyCost = areaCosts[task.area] || 25;

      totalMinutes += annualMinutes;
      totalCost += annualHours * hourlyCost;
    });

    return { totalAnnualHours: totalMinutes / 60, totalAnnualCost: totalCost };
  }, [items, tasks, areaCosts]);
  
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
      employee_count: employeeCount,
      document_count: documentCount,
      establishments: establishments,
      banks: banks,
      items: items,
      target_margin: targetMargin,
      recommended_monthly_fee: recommendedMonthlyFee,
      total_annual_cost: totalAnnualCost,
      total_annual_hours: totalAnnualHours,
    };

    try {
      const savedProposal = await quoteHistoryService.create(newProposal);
      setQuoteHistory([savedProposal, ...quoteHistory]);
      setShowPreview(true);
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
    setEmployeeCount(proposal.employee_count || 0);
    setDocumentCount(proposal.document_count || 0);
    setEstablishments(proposal.establishments || 1);
    setBanks(proposal.banks || 1);
    setItems(proposal.items);
    setTargetMargin(proposal.target_margin);
  };

  const handleDeleteProposal = async (id: string) => {
    if (!confirm("Tem a certeza que deseja apagar esta proposta do histórico?")) return;

    try {
      await quoteHistoryService.delete(id);
      setQuoteHistory(quoteHistory.filter(q => q.id !== id));
    } catch (err: any) {
      alert("Erro ao apagar a proposta: " + err.message);
    }
  };


  if (showPreview) {
    const monthlyLabel = `Avença mensal proposta`;
    return (
      <div className="animate-fade-in bg-white min-h-screen absolute top-0 left-0 w-full z-50 p-6 print:p-0">
        {/* Print helpers */}
        <style>{`
          @page { size: A4; margin: 12mm; }
          @media print {
            .no-print { display: none !important; }
            .print-reset { box-shadow: none !important; border: none !important; }
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
        `}</style>

        <div className="max-w-4xl mx-auto flex justify-between items-center mb-6 no-print border-b pb-4">
          <button onClick={() => setShowPreview(false)} className="flex items-center gap-2 text-slate-500 hover:text-slate-800">
            <ArrowLeft size={20}/> Voltar ao Simulador
          </button>
          <button onClick={() => window.print()} className="bg-blue-600 text-white px-6 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 font-bold shadow-sm">
            <Printer size={20}/> Guardar PDF
          </button>
        </div>

        <div className="max-w-4xl mx-auto bg-white p-10 border border-slate-100 rounded-2xl print-reset print:rounded-none print:p-0">
          {/* Espaço para folha timbrada */}
          <div className="h-20 print:h-24">
            <div className="no-print h-full rounded-xl border-2 border-dashed border-slate-200 flex items-center justify-center text-slate-400 text-xs">
              Espaço reservado para a sua folha timbrada (cabeçalho / logo)
            </div>
          </div>

          <div className="flex justify-between items-end mt-4 pb-4 border-b border-slate-200">
            <div>
              <h2 className="text-lg font-extrabold text-slate-800 uppercase tracking-tight">Proposta de Serviços de Contabilidade</h2>
              <p className="text-[11px] text-slate-500 mt-1">Data: {new Date().toLocaleDateString('pt-PT')}</p>
            </div>
            {/* Opcional: mostrar logo no ecrã (não obrigatório para folha timbrada) */}
            {logo && (
              <img
                src={logo}
                alt="Logo"
                className="h-10 w-auto object-contain no-print opacity-90"
              />
            )}
          </div>

                    {/* Layout principal */}
          <div className="mt-4 grid grid-cols-12 gap-6">
            {/* Conteúdo */}
            <div className="col-span-8">
              {/* Destinatário */}
              <div className="border border-slate-200 rounded-xl p-4">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] uppercase font-extrabold text-slate-400 mb-1">Destinatário</p>
                    <p className="text-base font-extrabold text-slate-800 leading-snug">{quoteClientName || 'Exmo(a). Senhor(a)'}</p>
                    <div className="mt-1 text-[11px] text-slate-600 leading-tight space-y-0.5">
                      <div><span className="font-bold text-slate-700">NIF:</span> {quoteClientNif || '---'}</div>
                      <div><span className="font-bold text-slate-700">Volume de negócios (base):</span> {clientVolume ? `${clientVolume.toLocaleString()}€ / ano` : '---'}</div>
                      {(employeeCount || documentCount) ? (
                        <div className="text-[10px] text-slate-500">
                          {employeeCount ? `Colaboradores: ${employeeCount}` : null}
                          {employeeCount && documentCount ? ' • ' : null}
                          {documentCount ? `Docs/mês: ${documentCount}` : null}
                        </div>
                      ) : null}
                    </div>
                  </div>

                  <div className="text-right">
                    <p className="text-[10px] uppercase font-extrabold text-slate-400 mb-1">Proposta</p>
                    <div className="text-[11px] text-slate-700 leading-tight">
                      <div><span className="font-bold">Data:</span> {new Date().toLocaleDateString('pt-PT')}</div>
                      <div><span className="font-bold">Ref.:</span> MPR-{new Date().getFullYear()}-{String(new Date().getTime()).slice(-4)}</div>
                      <div className="text-slate-500 mt-1">Validade: 30 dias</div>
                    </div>
                  </div>
                </div>

                {/* Introdução curta */}
                <div className="mt-3 rounded-lg bg-slate-50 border border-slate-100 p-3">
                  <p className="text-[11px] text-slate-700 leading-snug">
                    Na sequência do seu pedido, apresentamos a nossa proposta de prestação de serviços de contabilidade e apoio fiscal.
                    A <span className="font-bold">MPR</span> é um gabinete com <span className="font-bold">mais de 20 anos de experiência</span>,
                    focado em rigor, proximidade e acompanhamento contínuo.
                  </p>
                </div>
              </div>

              {/* Serviços */}
              <div className="mt-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-[11px] font-extrabold text-slate-800 uppercase tracking-wide border-l-4 border-blue-600 pl-2">
                    Serviços incluídos
                  </h3>
                  <div className="text-[10px] text-slate-500">Lista resumida • conforme seleção</div>
                </div>

                <div className="mt-2 border border-slate-200 rounded-xl p-4">
                  {/* Lista em duas colunas para caber em 1 página */}
                  <div className="columns-2 gap-7 text-[10.5px] leading-tight">
                    {items.map((item, idx) => {
                      const task = tasks.find(t => t.id === item.taskId);
                      const meta = [
                        task?.area ? `${task.area}` : null,
                        item.frequency ? `${item.frequency}x/ano` : null,
                        item.quantity ? `multiplicador ${item.quantity}` : null
                      ].filter(Boolean).join(' • ');
                      return (
                        <div key={idx} className="break-inside-avoid mb-2">
                          <div className="text-slate-900 font-semibold">{task?.name}</div>
                          <div className="text-[9.5px] text-slate-500">{meta}</div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Condições compactas */}
              <div className="mt-4 text-[10px] text-slate-600 leading-snug">
                <div className="font-extrabold text-slate-700 uppercase tracking-wide text-[10px] mb-1">Condições</div>
                <div>• Valores sujeitos a IVA à taxa legal em vigor.</div>
                <div>• Ajustes podem ocorrer mediante alteração de volume/complexidade e serviços adicionais.</div>
                <div>• Início do serviço mediante aceitação da proposta e receção da documentação necessária.</div>
              </div>
            </div>

            {/* Resumo */}
            <div className="col-span-4">
              <div className="border border-slate-200 rounded-xl p-4">
                <p className="text-[10px] uppercase font-extrabold text-slate-400">{monthlyLabel}</p>
                <div className="mt-2 text-4xl font-black text-slate-900 leading-none">
                  {recommendedMonthlyFee.toFixed(2)}€
                </div>
                <div className="text-[10px] text-slate-500 mt-1">+ IVA / mês</div>

                <div className="mt-4 border-t border-slate-200 pt-3 text-[10px] text-slate-600 leading-snug space-y-1">
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">Periodicidade</span>
                    <span className="font-bold text-slate-700">Mensal</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">Pagamento</span>
                    <span className="font-bold text-slate-700">Até dia 8</span>
                  </div>
                  <div className="flex justify-between gap-3">
                    <span className="text-slate-500">Suporte</span>
                    <span className="font-bold text-slate-700">Email + Reuniões</span>
                  </div>
                </div>

                <div className="mt-4 rounded-lg bg-slate-50 border border-slate-100 p-3">
                  <p className="text-[10px] font-extrabold text-slate-700 uppercase tracking-wide mb-1">Emitido por</p>
                  <p className="text-[11px] font-extrabold text-slate-800 leading-tight">
                    {(globalSettings as any)?.companyName || (globalSettings as any)?.company_name || 'MPR'}
                  </p>
                  <p className="text-[10px] text-slate-500 leading-snug mt-1">
                    {(globalSettings as any)?.companyAddress || (globalSettings as any)?.company_address || '(morada)'}
                    <br />
                    {(globalSettings as any)?.companyEmail || (globalSettings as any)?.company_email || '(email)'} • {(globalSettings as any)?.companyPhone || (globalSettings as any)?.company_phone || '(telefone)'}
                  </p>
                </div>

                <div className="mt-4 text-[10px] text-slate-600 leading-snug">
                  <div className="font-extrabold text-slate-700 uppercase tracking-wide text-[10px] mb-1">Aceitação</div>
                  <div>Para aceitar, responda por email com “Aceito” e a data.</div>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 text-[9px] text-slate-400 leading-relaxed text-center">
            Documento gerado automaticamente pelo sistema AccounTech CRM.
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
             <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                 <div className="md:col-span-2">
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
                 <div>
                     <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Nº Docs</label>
                     <input type="number" value={documentCount} onChange={(e) => setDocumentCount(parseInt(e.target.value) || 0)} className="w-full px-3 py-2 border rounded-lg text-sm" />
                 </div>
                 <div>
                     <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Nº Func.</label>
                     <input type="number" value={employeeCount} onChange={(e) => setEmployeeCount(parseInt(e.target.value) || 0)} className="w-full px-3 py-2 border rounded-lg text-sm" />
                 </div>
                 <div>
                     <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Nº Bancos</label>
                     <input type="number" value={banks} onChange={(e) => setBanks(parseInt(e.target.value) || 1)} className="w-full px-3 py-2 border rounded-lg text-sm" />
                 </div>
                 <div>
                     <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">Nº Estab.</label>
                     <input type="number" value={establishments} onChange={(e) => setEstablishments(parseInt(e.target.value) || 1)} className="w-full px-3 py-2 border rounded-lg text-sm" />
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
                  {isSaving ? <RefreshCcw size={18} className="animate-spin" /> : <Save size={18} />} Salvar e Ver
                </button>
                <button 
                  onClick={() => setShowPreview(true)}
                  disabled={items.length === 0}
                  className="w-full bg-slate-200 text-slate-800 py-3 rounded-xl font-bold hover:bg-slate-300 transition-all flex justify-center items-center gap-2 disabled:opacity-50"
                >
                  <FileText size={18} /> Pré-visualizar
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
                    <div className="flex items-center justify-end gap-2">
                      <button onClick={() => handleLoadProposal(item)} className="text-xs text-blue-600 hover:underline">Carregar</button>
                      <button onClick={() => handleDeleteProposal(item.id)} className="p-1 text-slate-400 hover:text-red-600"><Trash2 size={14}/></button>
                    </div>
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
