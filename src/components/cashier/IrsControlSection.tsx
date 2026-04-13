
import React from 'react';
import { Check, Copy, Eye, EyeOff, X } from 'lucide-react';
import { Client, FeeGroup } from '../../types';
import type { IrsClientFichaInfo } from '../IrsControl';
import { IrsControlRecord, IrsDeliveryClose } from './useIrsControl';
import { parseIrsPdfNifsWithAI } from '../../services/geminiService';

interface IrsControlSectionProps {
  currentYear: number;
  setCurrentYear: React.Dispatch<React.SetStateAction<number>>;
  irsGroup?: FeeGroup;
  allClients: Client[];
  irsGroupClients: Client[];
  clientFichaInfoMap: Map<string, IrsClientFichaInfo>;
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
  onSettlementAmountChange: (clientId: string, amount: number) => void;
}

interface IrsPdfParseResult {
  subjectANif: string;
  subjectBNif: string;
  dependentNifs: string[];
  firstPageText: string;
  hasBLabel: boolean;
  hasDependentLabel: boolean;
  source: 'local' | 'local+ai';
}

interface IrsPdfValidationResult {
  parsed: IrsPdfParseResult;
  notes: string[];
  suggestions: string[];
}

const normalizeNif = (value: string): string => (value || '').replace(/\D/g, '');
const normalizeSearch = (value: string): string => (
  (value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
);

const resolveMemberNifForCopy = (member: IrsClientFichaInfo['householdMembers'][number]): string => (
  member.nif || member.atUsername || ''
);

const buildMemberLine = (member: IrsClientFichaInfo['householdMembers'][number]): string => (
  `${resolveMemberNifForCopy(member)}\t${member.atPassword || ''}`
);

const buildLinesFromPdfItems = (items: any[]): string[] => {
  const byY = new Map<number, string[]>();
  items.forEach((item) => {
    const raw = String(item?.str || '').trim();
    if (!raw) return;
    const y = Math.round(Number(item?.transform?.[5] || 0));
    if (!byY.has(y)) byY.set(y, []);
    byY.get(y)!.push(raw);
  });

  return Array.from(byY.entries())
    .sort((a, b) => b[0] - a[0])
    .map(([, chunks]) => chunks.join(' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
};

const parseIrsPdfFirstPage = async (file: File): Promise<IrsPdfParseResult> => {
  const pdfjsLib: any = await import('pdfjs-dist');
  const buffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({
    data: new Uint8Array(buffer),
    disableWorker: true,
  });
  const pdf = await loadingTask.promise;
  const page = await pdf.getPage(1);
  const textContent = await page.getTextContent();
  const lines = buildLinesFromPdfItems((textContent?.items || []) as any[]);
  const fullText = lines.join('\n');
  const normalizedFullText = normalizeSearch(fullText);
  const normalizedLines = lines.map((line) => normalizeSearch(line));
  const hasBLabel = normalizedFullText.includes('sujeito passivo b');
  const hasDependentLabel = normalizedFullText.includes('dependente');

  const findFirstByLabel = (labels: string[]): string => {
    for (let index = 0; index < normalizedLines.length; index += 1) {
      const line = normalizedLines[index];
      if (!labels.some((label) => line.includes(label))) continue;
      const candidate = [lines[index], lines[index + 1] || '', lines[index + 2] || ''].join(' ');
      const match = candidate.match(/(\d{9})/);
      if (match) return match[1];
    }
    return '';
  };

  const subjectANif = findFirstByLabel(['sujeito passivo a']);
  const subjectBNif = findFirstByLabel(['sujeito passivo b']);

  const dependentNifSet = new Set<string>();
  const dependentRegex = /dependente[^0-9]{0,80}(\d{9})/gi;
  let dependentMatch: RegExpExecArray | null = dependentRegex.exec(normalizedFullText);
  while (dependentMatch) {
    dependentNifSet.add(dependentMatch[1]);
    dependentMatch = dependentRegex.exec(normalizedFullText);
  }

  if (dependentNifSet.size === 0) {
    normalizedLines.forEach((line, index) => {
      if (!line.includes('dependente')) return;
      const candidate = [lines[index], lines[index + 1] || ''].join(' ');
      const matches = candidate.match(/\d{9}/g) || [];
      matches.forEach((nif) => dependentNifSet.add(nif));
    });
  }

  return {
    subjectANif: normalizeNif(subjectANif),
    subjectBNif: normalizeNif(subjectBNif),
    dependentNifs: Array.from(dependentNifSet).map((nif) => normalizeNif(nif)).filter((nif) => nif.length === 9),
    firstPageText: fullText,
    hasBLabel,
    hasDependentLabel,
    source: 'local',
  };
};

const shouldUseAiFallback = (parsed: IrsPdfParseResult): boolean => {
  if (!parsed.subjectANif) return true;
  if (parsed.hasBLabel && !parsed.subjectBNif) return true;
  if (parsed.hasDependentLabel && parsed.dependentNifs.length === 0) return true;
  return false;
};

const mergeParsedWithAi = (
  localParsed: IrsPdfParseResult,
  aiParsed: { subjectANif: string; subjectBNif: string; dependentNifs: string[] }
): IrsPdfParseResult => {
  const mergedDependentNifs = Array.from(
    new Set([
      ...localParsed.dependentNifs.map((nif) => normalizeNif(nif)),
      ...(aiParsed.dependentNifs || []).map((nif) => normalizeNif(nif)),
    ].filter((nif) => nif.length === 9))
  );

  return {
    ...localParsed,
    subjectANif: localParsed.subjectANif || normalizeNif(aiParsed.subjectANif),
    subjectBNif: localParsed.subjectBNif || normalizeNif(aiParsed.subjectBNif),
    dependentNifs: mergedDependentNifs,
    source: 'local+ai',
  };
};
const validateIrsPdfData = (
  parsed: IrsPdfParseResult,
  currentClient: Client,
  currentFichaInfo: IrsClientFichaInfo | undefined,
  allClients: Client[]
): IrsPdfValidationResult => {
  const allClientsByNif = new Map<string, Client>();
  allClients.forEach((client) => {
    const nif = normalizeNif(client.nif);
    if (nif) allClientsByNif.set(nif, client);
  });

  const notes: string[] = [];
  const suggestions: string[] = [];
  const members = currentFichaInfo?.householdMembers || [];

  const hasRelation = (nif: string, relationKind: 'conjuge' | 'filho'): boolean => {
    const expectedNif = normalizeNif(nif);
    return members.some((member) => {
      const memberNif = normalizeNif(resolveMemberNifForCopy(member));
      if (memberNif !== expectedNif) return false;
      const relation = normalizeSearch(member.relation || '');
      if (relationKind === 'conjuge') {
        return relation.includes('conjuge') || relation.includes('marido') || relation.includes('esposa');
      }
      return relation.includes('filho') || relation.includes('filha') || relation.includes('dependente');
    });
  };

  const currentClientNif = normalizeNif(currentClient.nif);

  if (!parsed.subjectANif) {
    notes.push('Não foi possível detetar o NIF do Sujeito Passivo A na 1ª página.');
  } else if (currentClientNif !== parsed.subjectANif) {
    notes.push(`Sujeito Passivo A (${parsed.subjectANif}) é diferente do cliente aberto (${currentClientNif}).`);
  }

  if (parsed.subjectBNif) {
    if (!allClientsByNif.has(parsed.subjectBNif)) {
      suggestions.push(`Criar ficha para Sujeito Passivo B (NIF ${parsed.subjectBNif}).`);
    }
    if (!hasRelation(parsed.subjectBNif, 'conjuge')) {
      suggestions.push(`Criar relação "cônjuge" com o NIF ${parsed.subjectBNif}.`);
    }
  } else {
    notes.push('Sem Sujeito Passivo B identificado na 1ª página.');
  }

  if (parsed.dependentNifs.length === 0) {
    notes.push('Sem dependentes identificados na 1ª página.');
  } else {
    parsed.dependentNifs.forEach((dependentNif) => {
      if (!allClientsByNif.has(dependentNif)) {
        suggestions.push(`Criar ficha para dependente (NIF ${dependentNif}).`);
      }
      if (!hasRelation(dependentNif, 'filho')) {
        suggestions.push(`Criar relação "filho" para dependente (NIF ${dependentNif}).`);
      }
    });
  }

  if (suggestions.length === 0 && notes.length === 0) {
    notes.push('Validação OK: NIFs e relações principais estão consistentes.');
  }

  if (parsed.source === 'local+ai') {
    notes.unshift('Alguns NIFs foram inferidos por IA (Gemini) por dúvida na leitura local.');
  }

  return { parsed, notes, suggestions };
};

const runIrsPdfValidation = async (
  file: File,
  currentClient: Client,
  currentFichaInfo: IrsClientFichaInfo | undefined,
  allClients: Client[]
): Promise<IrsPdfValidationResult> => {
  const localParsed = await parseIrsPdfFirstPage(file);
  let finalParsed = localParsed;

  if (shouldUseAiFallback(localParsed)) {
    try {
      const aiParsed = await parseIrsPdfNifsWithAI(localParsed.firstPageText);
      finalParsed = mergeParsedWithAi(localParsed, aiParsed);
    } catch (aiErr) {
      console.error('Falha no fallback Gemini para IRS:', aiErr);
    }
  }

  return validateIrsPdfData(finalParsed, currentClient, currentFichaInfo, allClients);
};

const IrsControlSection: React.FC<IrsControlSectionProps> = ({
  currentYear,
  setCurrentYear,
  irsGroup,
  allClients,
  irsGroupClients,
  clientFichaInfoMap,
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
  onSettlementAmountChange,
}) => {
  const [floatingClientId, setFloatingClientId] = React.useState<string | null>(null);
  const [visiblePasswords, setVisiblePasswords] = React.useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = React.useState<string>('');
  const [isVerifyingPdf, setIsVerifyingPdf] = React.useState(false);
  const [pdfValidationResult, setPdfValidationResult] = React.useState<IrsPdfValidationResult | null>(null);
  const pdfFileInputRef = React.useRef<HTMLInputElement | null>(null);

  const [rowVerifyingClientId, setRowVerifyingClientId] = React.useState<string | null>(null);
  const [rowPdfPickerClientId, setRowPdfPickerClientId] = React.useState<string | null>(null);
  const [rowValidationMap, setRowValidationMap] = React.useState<Record<string, IrsPdfValidationResult>>({});
  const rowPdfFileInputRef = React.useRef<HTMLInputElement | null>(null);

  const floatingClient = floatingClientId
    ? irsGroupClients.find((client) => client.id === floatingClientId) || null
    : null;
  const floatingFichaInfo = floatingClient ? clientFichaInfoMap.get(floatingClient.id) : undefined;
  const floatingRecord = floatingClient ? irsControlMap.get(`${floatingClient.id}-${currentYear}`) : undefined;

  const copyText = React.useCallback(async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((prev) => (prev === key ? '' : prev)), 1500);
    } catch (err) {
      console.error('Erro ao copiar texto para clipboard:', err);
    }
  }, []);

  React.useEffect(() => {
    setPdfValidationResult(null);
    setIsVerifyingPdf(false);
  }, [floatingClientId]);

  const handleVerifyPdfClick = React.useCallback(() => {
    pdfFileInputRef.current?.click();
  }, []);

  const handleRowVerifyPdfClick = React.useCallback((clientId: string) => {
    setRowPdfPickerClientId(clientId);
    rowPdfFileInputRef.current?.click();
  }, []);

  const handlePdfSelected = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !floatingClient) return;

    setIsVerifyingPdf(true);
    try {
      const validation = await runIrsPdfValidation(file, floatingClient, floatingFichaInfo, allClients);
      setPdfValidationResult(validation);
    } catch (err) {
      console.error('Erro ao verificar PDF do IRS:', err);
      setPdfValidationResult({
        parsed: {
          subjectANif: '',
          subjectBNif: '',
          dependentNifs: [],
          firstPageText: '',
          hasBLabel: false,
          hasDependentLabel: false,
          source: 'local',
        },
        notes: ['Não foi possível ler o PDF. Confirme se é um PDF de texto (não imagem digitalizada).'],
        suggestions: [],
      });
    } finally {
      setIsVerifyingPdf(false);
    }
  }, [allClients, floatingClient, floatingFichaInfo]);

  const handleRowPdfSelected = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    const clientId = rowPdfPickerClientId;
    setRowPdfPickerClientId(null);
    if (!file || !clientId) return;

    const targetClient = irsGroupClients.find((client) => client.id === clientId);
    if (!targetClient) return;
    const targetFichaInfo = clientFichaInfoMap.get(clientId);

    setRowVerifyingClientId(clientId);
    try {
      const validation = await runIrsPdfValidation(file, targetClient, targetFichaInfo, allClients);
      setRowValidationMap((prev) => ({ ...prev, [clientId]: validation }));
    } catch (err) {
      console.error('Erro ao verificar PDF do IRS na linha:', err);
      setRowValidationMap((prev) => ({
        ...prev,
        [clientId]: {
          parsed: {
            subjectANif: '',
            subjectBNif: '',
            dependentNifs: [],
            firstPageText: '',
            hasBLabel: false,
            hasDependentLabel: false,
            source: 'local',
          },
          notes: ['Não foi possível ler o PDF para validação desta ficha.'],
          suggestions: [],
        },
      }));
    } finally {
      setRowVerifyingClientId((current) => (current === clientId ? null : current));
    }
  }, [allClients, clientFichaInfoMap, irsGroupClients, rowPdfPickerClientId]);
  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
      <input
        ref={rowPdfFileInputRef}
        type="file"
        accept="application/pdf"
        className="hidden"
        onChange={handleRowPdfSelected}
      />

      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-slate-800">Control IRS</h3>
        <div className="flex items-center gap-2 text-xs">
          <span className="font-bold text-slate-500">Ano:</span>
          <button onClick={() => setCurrentYear((y) => y - 1)} className="p-1 rounded-full hover:bg-slate-200">{'<'}</button>
          <span className="font-bold text-slate-700 w-14 text-center">{currentYear}</span>
          <button onClick={() => setCurrentYear((y) => y + 1)} className="p-1 rounded-full hover:bg-slate-200">{'>'}</button>
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
                {irsGroupClients.map((client) => {
                  const record = irsControlMap.get(`${client.id}-${currentYear}`);
                  const delivered = Boolean(record?.delivered);
                  const paid = Boolean(record?.paid);
                  const amount = record?.amount ?? 0;
                  const paymentMethod = record?.paymentMethod || 'Numerário';
                  const notes = record?.notes ?? '';
                  const isClosed = Boolean(record?.deliveryCloseId);
                  const rowValidation = rowValidationMap[client.id];
                  const isRowVerifying = rowVerifyingClientId === client.id;

                  return (
                    <React.Fragment key={`${client.id}-${currentYear}`}>
                      <tr className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-700">
                          <button
                            type="button"
                            onClick={() => setFloatingClientId(client.id)}
                            className="text-left hover:text-blue-600"
                          >
                            <span className="block">{client.name}</span>
                            <span className="block text-[10px] font-normal text-blue-500">Abrir caixa IRS</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleRowVerifyPdfClick(client.id)}
                            disabled={isRowVerifying}
                            className="mt-1 inline-flex items-center gap-1 text-[10px] font-bold px-2 py-1 rounded border border-blue-200 text-blue-700 hover:bg-blue-50 disabled:opacity-60"
                          >
                            {isRowVerifying ? 'A verificar...' : 'Verificar IRS'}
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
                      {rowValidation && (
                        <tr className="bg-blue-50/40">
                          <td colSpan={8} className="px-3 py-2">
                            <div className="text-xs text-slate-700">
                              <p>
                                <span className="font-bold">Detetado:</span>{' '}
                                A={rowValidation.parsed.subjectANif || '-'} | B={rowValidation.parsed.subjectBNif || '-'} | Dependentes={rowValidation.parsed.dependentNifs.join(', ') || '-'}
                              </p>
                              {rowValidation.notes.map((note) => (
                                <p key={`${client.id}-note-${note}`}>• {note}</p>
                              ))}
                              {rowValidation.suggestions.length > 0 && (
                                <div className="mt-1 bg-amber-50 border border-amber-200 rounded p-2 text-amber-800">
                                  {rowValidation.suggestions.map((suggestion) => (
                                    <p key={`${client.id}-suggest-${suggestion}`}>• {suggestion}</p>
                                  ))}
                                </div>
                              )}
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
                ) : deliveryHistoryForYear.map((item) => (
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

      {floatingClient && (
        <div className="fixed inset-0 z-50 bg-slate-900/45 backdrop-blur-[1px] p-4 flex items-center justify-center">
          <div className="bg-white w-full max-w-5xl rounded-2xl shadow-2xl border border-slate-200 max-h-[90vh] overflow-y-auto">
            <div className="sticky top-0 z-10 bg-white border-b border-slate-100 px-5 py-4 flex items-start justify-between gap-4">
              <div>
                <h4 className="text-lg font-black text-slate-800">{floatingClient.name}</h4>
                <p className="text-xs text-slate-500 mt-0.5">NIF {floatingClient.nif}</p>
              </div>
              <button
                type="button"
                onClick={() => setFloatingClientId(null)}
                className="text-slate-500 hover:text-slate-800"
                aria-label="Fechar caixa IRS"
              >
                <X size={18} />
              </button>
            </div>

            <div className="p-5 space-y-4">
              <div className="bg-white border border-slate-200 rounded-lg p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={handleVerifyPdfClick}
                    disabled={isVerifyingPdf}
                    className="inline-flex items-center gap-2 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-bold disabled:opacity-60"
                  >
                    {isVerifyingPdf ? 'A verificar...' : 'Verificar IRS (PDF)'}
                  </button>
                  <span className="text-xs text-slate-500">
                    Lê a 1ª página: Sujeito Passivo A/B e Dependentes.
                  </span>
                </div>
                <input
                  ref={pdfFileInputRef}
                  type="file"
                  accept="application/pdf"
                  className="hidden"
                  onChange={handlePdfSelected}
                />

                {pdfValidationResult && (
                  <div className="mt-3 space-y-2 text-sm">
                    <div className="text-xs text-slate-600">
                      <span className="font-bold">Detetado:</span>{' '}
                      A={pdfValidationResult.parsed.subjectANif || '-'} | B={pdfValidationResult.parsed.subjectBNif || '-'} | Dependentes={pdfValidationResult.parsed.dependentNifs.join(', ') || '-'}
                    </div>
                    {pdfValidationResult.notes.map((note) => (
                      <p key={`note-${note}`} className="text-slate-700">• {note}</p>
                    ))}
                    {pdfValidationResult.suggestions.length > 0 && (
                      <div className="bg-amber-50 border border-amber-200 rounded p-3">
                        <p className="text-xs font-bold uppercase text-amber-700 mb-1">Sugestões</p>
                        {pdfValidationResult.suggestions.map((suggestion) => (
                          <p key={`suggestion-${suggestion}`} className="text-amber-800">• {suggestion}</p>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="bg-slate-50 border border-slate-200 rounded-lg p-4">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <p className="text-xs font-bold uppercase text-slate-500">Agregado Familiar</p>
                  <button
                    type="button"
                    onClick={() => copyText(
                      (floatingFichaInfo?.householdMembers || [])
                        .map((member) => buildMemberLine(member))
                        .join('\n'),
                      `${floatingClient.id}-all`
                    )}
                    className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 hover:text-blue-800"
                  >
                    <Copy size={14} />
                    Copiar Tudo (NIF + Senha)
                  </button>
                </div>
                <p className="text-sm text-slate-700 mb-3">
                  {floatingFichaInfo?.householdSummary || 'Sem relações de agregado encontradas.'}
                </p>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="text-xs uppercase text-slate-500 bg-white">
                      <tr>
                        <th className="px-2 py-2 text-left">Relação</th>
                        <th className="px-2 py-2 text-left">Nome</th>
                        <th className="px-2 py-2 text-left">NIF</th>
                        <th className="px-2 py-2 text-left">Senha AT</th>
                        <th className="px-2 py-2 text-right">Ações</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {(floatingFichaInfo?.householdMembers || []).map((member) => {
                        const memberKey = `${floatingClient.id}-${member.key}`;
                        const isVisible = Boolean(visiblePasswords[memberKey]);
                        return (
                          <tr key={memberKey}>
                            <td className="px-2 py-2 text-slate-600">{member.relation || '-'}</td>
                            <td className="px-2 py-2 font-medium text-slate-700">{member.name || '-'}</td>
                            <td className="px-2 py-2 font-mono text-slate-700">{resolveMemberNifForCopy(member) || '-'}</td>
                            <td className="px-2 py-2">
                              <div className="flex items-center gap-1">
                                <input
                                  readOnly
                                  type={isVisible ? 'text' : 'password'}
                                  value={member.atPassword || ''}
                                  placeholder="-"
                                  className="w-full max-w-[220px] px-2 py-1 border rounded bg-white font-mono text-slate-700"
                                />
                                {member.atPassword && (
                                  <button
                                    type="button"
                                    onClick={() => setVisiblePasswords((prev) => ({ ...prev, [memberKey]: !prev[memberKey] }))}
                                    className="text-slate-500 hover:text-slate-700"
                                    aria-label="Mostrar ou ocultar senha"
                                  >
                                    {isVisible ? <EyeOff size={15} /> : <Eye size={15} />}
                                  </button>
                                )}
                              </div>
                            </td>
                            <td className="px-2 py-2 text-right">
                              <div className="flex items-center justify-end gap-2">
                                <button
                                  type="button"
                                  onClick={() => copyText(resolveMemberNifForCopy(member) || '', `${memberKey}-nif`)}
                                  className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 hover:text-blue-800"
                                >
                                  <Copy size={13} />
                                  {copiedKey === `${memberKey}-nif` ? 'NIF Copiado' : 'Copiar NIF'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => copyText(member.atPassword || '', `${memberKey}-pwd`)}
                                  className="inline-flex items-center gap-1 text-xs font-bold text-blue-700 hover:text-blue-800"
                                >
                                  <Copy size={13} />
                                  {copiedKey === `${memberKey}-pwd` ? 'Senha Copiada' : 'Copiar Senha'}
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-500 uppercase">Valor IRS (Pagar/Receber)</label>
                <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-2">
                  <select
                    value={(Number(floatingRecord?.irsSettlementAmount || 0) < 0) ? 'A pagar' : 'A receber'}
                    onChange={(e) => {
                      const currentAbsolute = Math.abs(Number(floatingRecord?.irsSettlementAmount || 0));
                      const signedAmount = e.target.value === 'A pagar' ? -currentAbsolute : currentAbsolute;
                      onSettlementAmountChange(floatingClient.id, signedAmount);
                    }}
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-white"
                  >
                    <option value="A pagar">A pagar</option>
                    <option value="A receber">A receber</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={Math.abs(Number(floatingRecord?.irsSettlementAmount || 0)) || ''}
                    onChange={(e) => {
                      const nextAbsolute = Math.max(0, Number((e.target.value || '').replace(',', '.')) || 0);
                      const direction = Number(floatingRecord?.irsSettlementAmount || 0) < 0 ? -1 : 1;
                      onSettlementAmountChange(floatingClient.id, nextAbsolute * direction);
                    }}
                    className="w-full px-3 py-2 border rounded-lg text-sm text-right bg-white"
                    placeholder="0.00"
                  />
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default IrsControlSection;
