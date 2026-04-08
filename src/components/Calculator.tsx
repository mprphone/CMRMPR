import React, { useState, useMemo, useEffect } from 'react';
import { Task, TaskArea, TaskType, TurnoverBracket, GlobalSettings, QuoteItem, QuoteHistory } from '../types';
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

const createQuoteItemId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `item-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const normalizeItem = (item: QuoteItem): QuoteItem => ({
  ...item,
  id: item.id || createQuoteItemId(),
  quantity: item.quantity > 0 ? item.quantity : 1,
  frequency: item.frequency > 0 ? item.frequency : 1,
});

const PDF_PUBLIC_LOGO_CANDIDATES = ['/logo-mpr.png', '/logo.png', '/mpr-logo.png'];
const MPR_OFFICIAL_ADDRESS = 'Rua Nossa Senhora da Ajuda 107F, 4815-364 Moreira de Cónegos';
const MPR_OFFICIAL_EMAIL = 'mpr@mpr.pt';
const MPR_OFFICIAL_PHONE = '253089591';

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
  const [finalMonthlyFee, setFinalMonthlyFee] = useState(0);
  const [manualFinalFee, setManualFinalFee] = useState(false);
  const [pdfLogoTryIndex, setPdfLogoTryIndex] = useState(0);

  useEffect(() => {
    if (tasks.length === 0 || items.length > 0) return;
    const mandatoryTasks = tasks.filter(t => t.type === TaskType.OBRIGACAO);
    const initialItems = mandatoryTasks.map(task => ({
      id: createQuoteItemId(),
      taskId: task.id,
      quantity: 1,
      frequency: task.defaultFrequencyPerYear,
    }));
    setItems(initialItems);
  }, [tasks, items.length]);

  useEffect(() => {
    setItems(currentItems =>
      currentItems.map(item => {
        if (!item.taskId) return item;
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
        if (!item.taskId) return item;
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
        if (!item.taskId) return item;
        const task = tasks.find(t => t.id === item.taskId);
        if (task?.multiplierLogic === 'banks') return { ...item, quantity: banks > 0 ? banks : 1 };
        if (task?.multiplierLogic === 'establishments') return { ...item, quantity: establishments > 0 ? establishments : 1 };
        return item;
      })
    );
  }, [banks, establishments, tasks]);

  const addItem = (taskId: string) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task || items.some(i => i.taskId === taskId)) return;

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

    setItems([...items, { id: createQuoteItemId(), taskId, quantity, frequency: task.defaultFrequencyPerYear }]);
  };

  const addCustomItem = () => {
    setItems([
      ...items,
      {
        id: createQuoteItemId(),
        quantity: 1,
        frequency: 12,
        customName: 'Nova tarefa personalizada',
        customArea: TaskArea.CONSULTORIA,
        customTimeMinutes: 30,
        customHourlyCost: areaCosts[TaskArea.CONSULTORIA] || 25,
      },
    ]);
  };

  const removeItem = (itemId: string) => {
    setItems(items.filter(i => i.id !== itemId));
  };

  const removeByTask = (taskId: string) => {
    setItems(items.filter(i => i.taskId !== taskId));
  };

  const updateItemNumber = (itemId: string, field: keyof QuoteItem, value: number) => {
    setItems(items.map(i => (i.id === itemId ? { ...i, [field]: value } : i)));
  };

  const updateItemText = (itemId: string, field: keyof QuoteItem, value: string) => {
    setItems(items.map(i => (i.id === itemId ? { ...i, [field]: value } : i)));
  };

  const { totalAnnualHours, totalAnnualCost } = useMemo(() => {
    let totalMinutes = 0;
    let totalCost = 0;

    items.forEach(item => {
      if (item.taskId) {
        const task = tasks.find(t => t.id === item.taskId);
        if (!task) return;

        const annualMinutes = (task.defaultTimeMinutes || 0) * item.quantity * item.frequency;
        const annualHours = annualMinutes / 60;
        const hourlyCost = areaCosts[task.area] || 25;

        totalMinutes += annualMinutes;
        totalCost += annualHours * hourlyCost;
        return;
      }

      const customTimeMinutes = item.customTimeMinutes || 0;
      const annualMinutes = customTimeMinutes * item.quantity * item.frequency;
      const annualHours = annualMinutes / 60;
      const areaBasedCost = item.customArea ? areaCosts[String(item.customArea)] : undefined;
      const hourlyCost = item.customHourlyCost || areaBasedCost || 25;

      totalMinutes += annualMinutes;
      totalCost += annualHours * hourlyCost;
    });

    return { totalAnnualHours: totalMinutes / 60, totalAnnualCost: totalCost };
  }, [items, tasks, areaCosts]);

  const suggestedRevenue = totalAnnualCost / (1 - targetMargin / 100);
  const suggestedMonthlyFee = suggestedRevenue / 12;

  useEffect(() => {
    if (manualFinalFee) return;
    setFinalMonthlyFee(Number.isFinite(suggestedMonthlyFee) ? suggestedMonthlyFee : 0);
  }, [suggestedMonthlyFee, manualFinalFee]);

  useEffect(() => {
    if (!showPreview) return;
    setPdfLogoTryIndex(0);
  }, [showPreview]);

  const fairValue = useMemo(() => {
    const bracket = turnoverBrackets.find(b => clientVolume >= b.minTurnover && clientVolume <= b.maxTurnover);
    if (!bracket) return null;
    return {
      min: (clientVolume * (bracket.minPercent / 100)) / 12,
      max: (clientVolume * (bracket.maxPercent / 100)) / 12,
    };
  }, [clientVolume, turnoverBrackets]);

  const proposalScope = useMemo(() => {
    const selectedAreas = new Set<string>();
    let hasPayrollContext = false;
    let hasManagementContext = false;

    items.forEach(item => {
      const task = item.taskId ? tasks.find(t => t.id === item.taskId) : null;
      const area = task?.area || item.customArea;
      if (area) selectedAreas.add(String(area));

      const taskName = (task?.name || item.customName || '').toLowerCase();
      if (/sal|venc|rh|funcion|seguran/.test(taskName)) hasPayrollContext = true;
      if (/gest|consult|anal|relat|orc/.test(taskName)) hasManagementContext = true;
    });

    const includesPayroll = selectedAreas.has(TaskArea.RH) || hasPayrollContext;
    const includesManagement =
      selectedAreas.has(TaskArea.CONSULTORIA) ||
      selectedAreas.has(TaskArea.GESTAO) ||
      hasManagementContext;
    const includesAdministrative = selectedAreas.has(TaskArea.ADMINISTRATIVO);
    const includesFiscal = selectedAreas.has(TaskArea.FISCALIDADE);

    const groupedIncludedServices: Array<{ title: string; items: string[] }> = [
      {
        title: 'Contabilidade',
        items: [
          'Organização e tratamento da documentação contabilística.',
          'Registos contabilísticos, conferências e reconciliações.',
          'Preparação de informação para fecho mensal e anual.',
        ],
      },
      {
        title: 'Fiscalidade',
        items: ['Cumprimento das obrigações fiscais e declarativas.'],
      },
    ];

    if (includesPayroll) {
      groupedIncludedServices.push({
        title: 'Processamento salarial',
        items: ['Processamento salarial e cumprimento das obrigações laborais.'],
      });
    }
    if (includesManagement) {
      groupedIncludedServices.push({
        title: 'Apoio à gestão',
        items: ['Apoio à gestão, acompanhamento de indicadores e suporte à decisão.'],
      });
    }
    if (includesAdministrative) {
      groupedIncludedServices.push({
        title: 'Apoio administrativo',
        items: ['Apoio administrativo e acompanhamento documental contínuo.'],
      });
    }
    if (includesFiscal && !groupedIncludedServices.some(group => group.title === 'Fiscalidade')) {
      groupedIncludedServices.push({
        title: 'Fiscalidade',
        items: ['Cumprimento das obrigações fiscais e declarativas.'],
      });
    }

    const excludedServices: string[] = [
      'Recuperação de contabilidade em atraso.',
      'Representação em inspeções, contencioso ou procedimentos especiais.',
      'Candidaturas, estudos económico-financeiros e projetos.',
      'Outros trabalhos extraordinários não abrangidos pela avença mensal.',
    ];

    if (!includesPayroll) {
      excludedServices.splice(1, 0, 'Processamento salarial e obrigações laborais.');
    }

    return {
      groupedIncludedServices: groupedIncludedServices.slice(0, 5),
      excludedServices: excludedServices.slice(0, 5),
      includesPayroll,
      includesManagement,
    };
  }, [items, tasks]);

  const handleSaveProposal = async () => {
    if (items.length === 0) {
      alert('Adicione pelo menos um serviço para salvar a proposta.');
      return;
    }

    setIsSaving(true);
    const newProposal: Partial<QuoteHistory> = {
      client_name: quoteClientName,
      client_nif: quoteClientNif,
      client_volume: clientVolume,
      employee_count: employeeCount,
      document_count: documentCount,
      establishments,
      banks,
      items,
      target_margin: targetMargin,
      recommended_monthly_fee: finalMonthlyFee,
      total_annual_cost: totalAnnualCost,
      total_annual_hours: totalAnnualHours,
    };

    try {
      const savedProposal = await quoteHistoryService.create(newProposal);
      setQuoteHistory([savedProposal, ...quoteHistory]);
      setShowPreview(true);
    } catch (err: any) {
      alert('Erro ao salvar a proposta: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleLoadProposal = (proposal: QuoteHistory) => {
    if (!confirm('Deseja carregar esta proposta? As alterações atuais serão perdidas.')) return;

    setQuoteClientName(proposal.client_name);
    setQuoteClientNif(proposal.client_nif);
    setClientVolume(proposal.client_volume);
    setEmployeeCount(proposal.employee_count || 0);
    setDocumentCount(proposal.document_count || 0);
    setEstablishments(proposal.establishments || 1);
    setBanks(proposal.banks || 1);
    setItems((proposal.items || []).map(normalizeItem));
    setTargetMargin(proposal.target_margin);
    setFinalMonthlyFee(proposal.recommended_monthly_fee || 0);
    setManualFinalFee(true);
  };

  const handleDeleteProposal = async (id: string) => {
    if (!confirm('Tem a certeza que deseja apagar esta proposta do histórico?')) return;

    try {
      await quoteHistoryService.delete(id);
      setQuoteHistory(quoteHistory.filter(q => q.id !== id));
    } catch (err: any) {
      alert('Erro ao apagar a proposta: ' + err.message);
    }
  };

  if (showPreview) {
    const hasUploadedLogo = Boolean(logo);
    const maxLogoTries = PDF_PUBLIC_LOGO_CANDIDATES.length + (hasUploadedLogo ? 1 : 0);
    const currentPdfLogoSrc =
      pdfLogoTryIndex < PDF_PUBLIC_LOGO_CANDIDATES.length
        ? PDF_PUBLIC_LOGO_CANDIDATES[pdfLogoTryIndex]
        : (pdfLogoTryIndex === PDF_PUBLIC_LOGO_CANDIDATES.length && hasUploadedLogo ? logo : '');

    const finalMonthlyFeeLabel = finalMonthlyFee.toLocaleString('pt-PT', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

    const groupedLeft = proposalScope.groupedIncludedServices.slice(0, Math.ceil(proposalScope.groupedIncludedServices.length / 2));
    const groupedRight = proposalScope.groupedIncludedServices.slice(Math.ceil(proposalScope.groupedIncludedServices.length / 2));

    return (
      <div className="animate-fade-in bg-white min-h-screen absolute top-0 left-0 w-full z-50 p-4 print:p-0">
        <style>{`
          @page { size: A4; margin: 8mm; }
          @media print {
            .no-print { display: none !important; }
            .print-reset { box-shadow: none !important; border: none !important; }
            .print-fit { transform: scale(0.9); transform-origin: top left; width: 111.2%; }
            body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          }
        `}</style>

        <div className="max-w-4xl mx-auto flex justify-between items-center mb-4 no-print border-b pb-3">
          <button onClick={() => setShowPreview(false)} className="flex items-center gap-2 text-slate-500 hover:text-slate-800">
            <ArrowLeft size={20} /> Voltar ao Simulador
          </button>
          <button onClick={() => window.print()} className="bg-slate-800 text-white px-6 py-2 rounded-lg flex items-center gap-2 hover:bg-slate-900 font-bold shadow-sm">
            <Printer size={20} /> Guardar PDF
          </button>
        </div>

        <div className="print-fit max-w-4xl mx-auto bg-white p-7 border border-slate-200/80 rounded-3xl print-reset print:rounded-none print:p-2">
          <div className="flex items-start justify-between gap-6">
            <div className="pt-1">
              {currentPdfLogoSrc ? (
                <img
                  src={currentPdfLogoSrc}
                  alt="Logo MPR"
                  className="h-14 w-auto object-contain"
                  onError={() => {
                    if (pdfLogoTryIndex < maxLogoTries) setPdfLogoTryIndex(pdfLogoTryIndex + 1);
                  }}
                />
              ) : (
                <div className="h-12 px-4 rounded-md border border-emerald-200 bg-emerald-50 flex items-center font-black text-emerald-800 tracking-widest">
                  MPR
                </div>
              )}
            </div>

            <div className="text-[10px] text-slate-500 text-right leading-relaxed">
              <div><span className="font-semibold text-slate-700">Ref.:</span> {`MPR-${new Date().getFullYear()}-${String(Date.now()).slice(-4)}`}</div>
              <div><span className="font-semibold text-slate-700">Data:</span> {new Date().toLocaleDateString('pt-PT')}</div>
              <div><span className="font-semibold text-slate-700">Validade:</span> 30 dias</div>
            </div>
          </div>

          <div className="mt-5 pb-4 border-b border-slate-200">
            <h2 className="text-[21px] font-semibold tracking-[0.02em] text-slate-900 uppercase">
              Proposta de Serviços de Contabilidade
            </h2>
            <p className="mt-1 text-[10px] text-slate-500">
              Proposta de prestação de serviços de contabilidade e apoio à gestão
            </p>
          </div>

          <div className="mt-4 grid grid-cols-12 gap-4 items-start">
            <div className="col-span-8 space-y-3">
              <div className="rounded-2xl border border-slate-200/80 p-4">
                <p className="text-[10px] uppercase font-semibold tracking-[0.08em] text-slate-400 mb-1">Destinatário</p>
                <p className="text-[17px] font-semibold text-slate-900 leading-tight">{quoteClientName || 'Exmo(a). Senhor(a)'}</p>
                <div className="mt-2 text-[10.5px] text-slate-600">
                  <span className="text-slate-500">NIF:</span> <span className="font-medium text-slate-700">{quoteClientNif || '---'}</span>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200/80 p-4">
                <div className="text-[10px] font-semibold text-slate-700 uppercase tracking-[0.08em] mb-1">Enquadramento da Entidade</div>
                <p className="text-[10px] leading-snug text-slate-700">
                  Considerando a natureza e exigências de uma instituição social, a presente proposta visa assegurar o cumprimento contabilístico, fiscal e laboral, bem como disponibilizar informação de apoio à gestão e acompanhamento regular.
                </p>
              </div>

              <div className="rounded-2xl border border-emerald-100 bg-emerald-50/40 p-4">
                <div className="text-[10px] font-semibold text-emerald-800 uppercase tracking-[0.08em] mb-1">Sobre a MPR</div>
                <p className="text-[10px] leading-snug text-slate-700">
                  A MPR Negócios assegura acompanhamento por responsável dedicado, resposta célere e reporte regular, combinando rigor técnico com proximidade operacional para garantir previsibilidade e confiança na gestão diária.
                </p>
              </div>

              <div className="rounded-2xl border border-slate-200/80 p-3.5">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-[11px] font-semibold text-slate-900 uppercase tracking-[0.07em]">Serviços incluídos</h3>
                  <div className="text-[9px] text-slate-400">Âmbito da proposta</div>
                </div>

                <div className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-[7.8px] text-slate-700 leading-tight">
                  <div className="space-y-1.5">
                    {groupedLeft.map((group, index) => (
                      <div key={`left-${index}`}>
                        <div className="text-[7.5px] font-semibold text-slate-800 uppercase tracking-[0.05em]">{group.title}</div>
                        <div className="space-y-0.5 mt-0.5">
                          {group.items.map((item, idx) => (
                            <div key={`left-item-${index}-${idx}`} className="leading-snug">• {item}</div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="space-y-1.5">
                    {groupedRight.map((group, index) => (
                      <div key={`right-${index}`}>
                        <div className="text-[7.5px] font-semibold text-slate-800 uppercase tracking-[0.05em]">{group.title}</div>
                        <div className="space-y-0.5 mt-0.5">
                          {group.items.map((item, idx) => (
                            <div key={`right-item-${index}-${idx}`} className="leading-snug">• {item}</div>
                          ))}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            <div className="col-span-4 space-y-3">
              <div className="rounded-2xl border border-slate-200/80 p-4">
                <p className="text-[10px] uppercase font-semibold tracking-[0.07em] text-slate-400">Honorários Mensais</p>
                <div className="mt-2 text-[22px] font-semibold text-slate-900 leading-tight">{finalMonthlyFeeLabel} € + IVA</div>
                <p className="mt-2 text-[9px] text-slate-500 leading-snug">
                  O valor mensal pressupõe o volume corrente de atividade atualmente conhecido. Alterações relevantes na estrutura operacional, número de colaboradores ou volume documental poderão determinar revisão da avença.
                </p>

                <div className="mt-4 border-t border-slate-200 pt-3 text-[10px] text-slate-600 space-y-1">
                  <div className="flex justify-between gap-3"><span>Periodicidade</span><span className="font-medium text-slate-700">Mensal</span></div>
                  <div className="flex justify-between gap-3"><span>Pagamento</span><span className="font-medium text-slate-700">Até dia 8</span></div>
                </div>
              </div>

              <div className="rounded-xl border border-emerald-100 bg-emerald-50/40 p-3">
                <p className="text-[9px] font-semibold uppercase tracking-[0.07em] text-emerald-800 mb-1">Proposta apresentada por</p>
                <p className="text-[12px] font-semibold text-slate-900">{(globalSettings as any)?.companyName || (globalSettings as any)?.company_name || 'MPR Negócios'}</p>
                <p className="mt-1 text-[9px] text-slate-600 leading-snug">
                  {MPR_OFFICIAL_ADDRESS}
                  <br />
                  {(globalSettings as any)?.companyEmail || (globalSettings as any)?.company_email || MPR_OFFICIAL_EMAIL}
                  <br />
                  {(globalSettings as any)?.companyPhone || (globalSettings as any)?.company_phone || MPR_OFFICIAL_PHONE}
                </p>
              </div>
            </div>
          </div>

          <div className="mt-2.5 grid grid-cols-12 gap-3">
            <div className="col-span-7 space-y-2">
              <div className="rounded-xl border border-slate-200/80 p-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-slate-700 mb-1">Serviços não incluídos</div>
                <div className="text-[7.2px] text-slate-600 space-y-0.5 leading-tight">
                  {proposalScope.excludedServices.map((item, index) => (
                    <div key={`ex-${index}`}>• {item}</div>
                  ))}
                </div>
              </div>

              <div className="rounded-xl border border-slate-200/80 p-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-slate-700 mb-1">Condições</div>
                <div className="text-[8px] text-slate-600 space-y-0.5 leading-tight">
                  <div>• Valores acrescidos de IVA à taxa legal em vigor.</div>
                  <div>• Confidencialidade e proteção de dados asseguradas nos termos legais aplicáveis.</div>
                  <div>• A proposta é válida por 30 dias.</div>
                </div>
              </div>

              <div className="rounded-xl border border-slate-200/80 p-2.5">
                <div className="text-[10px] font-semibold text-slate-700">Com os melhores cumprimentos,</div>
                <div className="text-[11px] font-semibold text-slate-900 mt-1">MPR Negócios</div>
                <p className="mt-1.5 text-[8px] text-slate-600 leading-snug">
                  Permanecemos inteiramente disponíveis para esclarecer qualquer ponto e ajustar a proposta às necessidades específicas da instituição.
                </p>
              </div>
            </div>

            <div className="col-span-5 space-y-2">

              <div className="rounded-xl border border-slate-200/80 p-2.5">
                <div className="text-[10px] font-semibold uppercase tracking-[0.07em] text-slate-700 mb-1">Aceitação da proposta</div>
                <p className="text-[8px] text-slate-600 leading-snug mb-1.5">
                  Em nome de {quoteClientName || '________________________________'}, declara-se a aceitação da presente proposta de prestação de serviços.
                </p>
                <div className="text-[8px] text-slate-700 space-y-1.5">
                  <div>Local e data: ______________________________</div>
                  <div>Nome: ___________________________________</div>
                  <div>Cargo: ___________________________________</div>
                  <div>Assinatura: _______________________________</div>
                </div>
              </div>
            </div>
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
              <BadgeEuro size={20} className="text-blue-600" /> 1. Dados do Futuro Cliente
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
                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">N Docs</label>
                <input type="number" value={documentCount} onChange={(e) => setDocumentCount(parseInt(e.target.value, 10) || 0)} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">N Func.</label>
                <input type="number" value={employeeCount} onChange={(e) => setEmployeeCount(parseInt(e.target.value, 10) || 0)} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">N Bancos</label>
                <input type="number" value={banks} onChange={(e) => setBanks(parseInt(e.target.value, 10) || 1)} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1 uppercase">N Estab.</label>
                <input type="number" value={establishments} onChange={(e) => setEstablishments(parseInt(e.target.value, 10) || 1)} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
            <div className="flex items-center justify-between mb-4 gap-3">
              <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                <FileText size={20} className="text-indigo-600" /> 2. Seleção de Serviços Contratados
              </h2>
              <button onClick={addCustomItem} className="inline-flex items-center gap-2 px-3 py-2 bg-indigo-600 text-white text-xs font-bold rounded-lg hover:bg-indigo-700">
                <Plus size={14} /> Acrescentar Outra Tarefa
              </button>
            </div>

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
                          onClick={() => (isSelected ? removeByTask(task.id) : addItem(task.id))}
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
              <CalcIcon className="text-blue-600" size={24} />
              <h3 className="text-lg font-bold text-slate-800 uppercase tracking-tighter">Simulação de Valor</h3>
            </div>

            <div className="space-y-3 max-h-96 overflow-y-auto pr-2 custom-scrollbar">
              {items.map(item => {
                const task = item.taskId ? tasks.find(t => t.id === item.taskId) : null;
                const title = task?.name || item.customName || 'Tarefa personalizada';
                const itemId = item.id || createQuoteItemId();

                return (
                  <div key={itemId} className="bg-slate-50 p-3 rounded-lg border border-slate-100 relative group">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-[11px] font-bold text-slate-700 truncate w-4/5">{title}</span>
                      <button onClick={() => removeItem(itemId)} className="text-slate-300 hover:text-red-500"><Trash2 size={12} /></button>
                    </div>

                    {!task && (
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <div className="col-span-2">
                          <label className="text-[9px] font-bold text-slate-400 uppercase">Nome tarefa</label>
                          <input
                            type="text"
                            value={item.customName || ''}
                            onChange={(e) => updateItemText(itemId, 'customName', e.target.value)}
                            className="w-full border rounded px-2 py-1 text-[11px]"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-bold text-slate-400 uppercase">Min/ocorrencia</label>
                          <input
                            type="number"
                            min="1"
                            value={item.customTimeMinutes || 30}
                            onChange={(e) => updateItemNumber(itemId, 'customTimeMinutes', parseInt(e.target.value, 10) || 1)}
                            className="w-full border rounded px-2 py-1 text-[11px]"
                          />
                        </div>
                        <div>
                          <label className="text-[9px] font-bold text-slate-400 uppercase">Custo/hora (€)</label>
                          <input
                            type="number"
                            min="1"
                            value={item.customHourlyCost || 25}
                            onChange={(e) => updateItemNumber(itemId, 'customHourlyCost', parseFloat(e.target.value) || 1)}
                            className="w-full border rounded px-2 py-1 text-[11px]"
                          />
                        </div>
                      </div>
                    )}

                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <label className="text-[9px] font-bold text-slate-400 uppercase">Multiplicador</label>
                        <input
                          type="number"
                          min="1"
                          value={item.quantity}
                          onChange={(e) => updateItemNumber(itemId, 'quantity', parseInt(e.target.value, 10) || 1)}
                          className="w-full border rounded px-2 py-1 text-[11px]"
                        />
                      </div>
                      <div>
                        <label className="text-[9px] font-bold text-slate-400 uppercase">Freq. Anual</label>
                        <input
                          type="number"
                          min="1"
                          value={item.frequency}
                          onChange={(e) => updateItemNumber(itemId, 'frequency', parseInt(e.target.value, 10) || 1)}
                          className="w-full border rounded px-2 py-1 text-[11px]"
                        />
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="space-y-4 pt-4 border-t">
              <div className="p-3 bg-indigo-50/50 rounded-lg border border-indigo-100">
                <label className="block text-[10px] font-bold text-indigo-500 uppercase mb-2">Margem de Lucro Alvo: {targetMargin}%</label>
                <input type="range" min="10" max="80" value={targetMargin} onChange={(e) => setTargetMargin(parseInt(e.target.value, 10))} className="w-full h-1.5 bg-indigo-200 rounded-lg appearance-none cursor-pointer" />
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
                <p className="text-4xl font-black text-white">{suggestedMonthlyFee.toFixed(2)}€</p>
                <p className="text-[10px] text-blue-200 mt-1">+ IVA / MÊS</p>
              </div>

              <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-[10px] font-bold text-amber-700 uppercase">Valor Final (editavel)</label>
                  <button
                    type="button"
                    onClick={() => {
                      setFinalMonthlyFee(suggestedMonthlyFee);
                      setManualFinalFee(false);
                    }}
                    className="text-[10px] font-bold text-amber-800 hover:underline"
                  >
                    Usar sugerido
                  </button>
                </div>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={finalMonthlyFee.toFixed(2)}
                  onChange={(e) => {
                    setFinalMonthlyFee(parseFloat(e.target.value) || 0);
                    setManualFinalFee(true);
                  }}
                  className="w-full border rounded px-3 py-2 text-sm font-bold text-amber-800"
                />
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
                <th className="px-4 py-3 text-right">Avença Final</th>
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
                      <button onClick={() => handleDeleteProposal(item.id)} className="p-1 text-slate-400 hover:text-red-600"><Trash2 size={14} /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {quoteHistory.length === 0 && (<tr><td colSpan={4} className="text-center italic text-slate-400 py-10">Nenhuma proposta salva ainda.</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Calculator;
