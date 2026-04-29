
import React from 'react';
import { Check, Copy, Eye, EyeOff, X } from 'lucide-react';
import { Client, FeeGroup } from '../../types';
import type { IrsClientFichaInfo } from '../IrsControl';
import { IrsControlRecord, IrsDeliveryClose, IrsSettlementDirection } from './useIrsControl';
import { parseIrsPdfNifsFromPdfWithAI, parseIrsPdfNifsWithAI } from '../../services/geminiService';

interface IrsControlSectionProps {
  currentYear: number;
  setCurrentYear: React.Dispatch<React.SetStateAction<number>>;
  irsGroup?: FeeGroup;
  allClients: Client[];
  availableClientsToAdd: Client[];
  isAddingClientToIrsGroup: boolean;
  onQuickAddClientToIrsGroup: (clientId: string) => Promise<void>;
  onApplyPdfSuggestions: (payload: {
    subjectANif: string;
    subjectBNif: string;
    dependentNifs: string[];
    namesByNif?: Record<string, string>;
  }) => Promise<{
    createdClientsStore: number;
    createdClientsImport: number;
    createdRelations: number;
    createdRelationsImport: number;
    addedToIrsGroup: number;
    errors: string[];
  }>;
  irsGroupClients: Client[];
  attachmentCountByNif: Record<string, number>;
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
  onSettlementDirectionChange: (clientId: string, direction: IrsSettlementDirection) => void;
}

interface IrsPdfParseResult {
  subjectANif: string;
  subjectBNif: string;
  dependentNifs: string[];
  namesByNif: Record<string, string>;
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
type StatusFilter = 'all' | 'yes' | 'no';

const resolveSettlementDirection = (record: IrsControlRecord | undefined): IrsSettlementDirection => {
  if (record?.irsSettlementDirection) return record.irsSettlementDirection;
  const amount = Number(record?.irsSettlementAmount || 0);
  if (amount < 0) return 'A pagar';
  if (amount > 0) return 'A receber';
  return 'Nulo';
};

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

const sanitizeSuggestedName = (value: string): string => {
  const cleaned = (value || '')
    .replace(/sujeito\s+passivo\s*[ab]/gi, ' ')
    .replace(/dependente/gi, ' ')
    .replace(/\bnif\b/gi, ' ')
    .replace(/\d{9}/g, ' ')
    .replace(/[:;,_\-()[\]{}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const words = cleaned.split(' ').filter(Boolean);
  if (words.length < 2) return '';
  return cleaned;
};

const extractNameNearNif = (text: string, nif: string): string => {
  if (!text || !nif) return '';
  const idx = text.indexOf(nif);
  if (idx < 0) return '';
  const before = text.slice(Math.max(0, idx - 90), idx);
  const after = text.slice(idx + nif.length, idx + nif.length + 90);
  const beforeCandidate = sanitizeSuggestedName(before);
  if (beforeCandidate) return beforeCandidate;
  return sanitizeSuggestedName(after);
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

  const findFirstByLabel = (labels: string[]): { nif: string; name: string } => {
    for (let index = 0; index < normalizedLines.length; index += 1) {
      const line = normalizedLines[index];
      if (!labels.some((label) => line.includes(label))) continue;
      const candidate = [lines[index], lines[index + 1] || '', lines[index + 2] || ''].join(' ');
      const match = candidate.match(/(\d{9})/);
      if (match) {
        return {
          nif: match[1],
          name: extractNameNearNif(candidate, match[1]),
        };
      }
    }
    return { nif: '', name: '' };
  };

  const subjectA = findFirstByLabel(['sujeito passivo a']);
  const subjectB = findFirstByLabel(['sujeito passivo b']);
  const namesByNif: Record<string, string> = {};
  if (subjectA.nif && subjectA.name) namesByNif[normalizeNif(subjectA.nif)] = subjectA.name;
  if (subjectB.nif && subjectB.name) namesByNif[normalizeNif(subjectB.nif)] = subjectB.name;

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
      matches.forEach((nif) => {
        dependentNifSet.add(nif);
        const suggestedName = extractNameNearNif(candidate, nif);
        if (suggestedName) namesByNif[normalizeNif(nif)] = suggestedName;
      });
    });
  } else {
    lines.forEach((line) => {
      const normalized = normalizeSearch(line);
      if (!normalized.includes('dependente')) return;
      const matches = line.match(/\d{9}/g) || [];
      matches.forEach((nif) => {
        const suggestedName = extractNameNearNif(line, nif);
        if (suggestedName) namesByNif[normalizeNif(nif)] = suggestedName;
      });
    });
  }

  return {
    subjectANif: normalizeNif(subjectA.nif),
    subjectBNif: normalizeNif(subjectB.nif),
    dependentNifs: Array.from(dependentNifSet).map((nif) => normalizeNif(nif)).filter((nif) => nif.length === 9),
    namesByNif,
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
    namesByNif: localParsed.namesByNif || {},
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

const IrsControlSection: React.FC<IrsControlSectionProps> = ({
  currentYear,
  setCurrentYear,
  irsGroup,
  allClients,
  availableClientsToAdd,
  isAddingClientToIrsGroup,
  onQuickAddClientToIrsGroup,
  onApplyPdfSuggestions,
  irsGroupClients,
  attachmentCountByNif,
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
  onSettlementDirectionChange,
}) => {
  const [floatingClientId, setFloatingClientId] = React.useState<string | null>(null);
  const [visiblePasswords, setVisiblePasswords] = React.useState<Record<string, boolean>>({});
  const [copiedKey, setCopiedKey] = React.useState<string>('');
  const [isVerifyingPdf, setIsVerifyingPdf] = React.useState(false);
  const [isApplyingSuggestions, setIsApplyingSuggestions] = React.useState(false);
  const [selectedClientIdToAdd, setSelectedClientIdToAdd] = React.useState('');
  const [pdfValidationResult, setPdfValidationResult] = React.useState<IrsPdfValidationResult | null>(null);
  const [applySummary, setApplySummary] = React.useState<string>('');
  const [searchTerm, setSearchTerm] = React.useState('');
  const [paidFilter, setPaidFilter] = React.useState<StatusFilter>('all');
  const [deliveredFilter, setDeliveredFilter] = React.useState<StatusFilter>('all');
  const pdfFileInputRef = React.useRef<HTMLInputElement | null>(null);

  const floatingClient = floatingClientId
    ? irsGroupClients.find((client) => client.id === floatingClientId) || null
    : null;
  const floatingFichaInfo = floatingClient ? clientFichaInfoMap.get(floatingClient.id) : undefined;
  const floatingRecord = floatingClient ? irsControlMap.get(`${floatingClient.id}-${currentYear}`) : undefined;
  const floatingSettlementDirection = resolveSettlementDirection(floatingRecord);

  const copyText = React.useCallback(async (value: string, key: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((prev) => (prev === key ? '' : prev)), 1500);
    } catch (err) {
      console.error('Erro ao copiar texto para clipboard:', err);
    }
  }, []);

  const handleVerifyPdfClick = React.useCallback(() => {
    pdfFileInputRef.current?.click();
  }, []);

  const handlePdfSelected = React.useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    setIsVerifyingPdf(true);
    setApplySummary('');
    try {
      let finalParsed: IrsPdfParseResult;
      try {
        const localParsed = await parseIrsPdfFirstPage(file);
        finalParsed = localParsed;
        if (shouldUseAiFallback(localParsed)) {
          try {
            const aiParsed = await parseIrsPdfNifsWithAI(localParsed.firstPageText);
            finalParsed = mergeParsedWithAi(localParsed, aiParsed);
          } catch (aiErr) {
            console.error('Falha no fallback Gemini por texto:', aiErr);
          }
        }
      } catch (localErr) {
        console.error('Falha na leitura local do PDF:', localErr);
        const aiFromPdf = await parseIrsPdfNifsFromPdfWithAI(file);
        finalParsed = {
          subjectANif: normalizeNif(aiFromPdf.subjectANif),
          subjectBNif: normalizeNif(aiFromPdf.subjectBNif),
          dependentNifs: (aiFromPdf.dependentNifs || []).map((nif) => normalizeNif(nif)).filter((nif) => nif.length === 9),
          namesByNif: {},
          firstPageText: '',
          hasBLabel: false,
          hasDependentLabel: false,
          source: 'local+ai',
        };
      }

      const targetClient = irsGroupClients.find((client) => normalizeNif(client.nif) === finalParsed.subjectANif)
        || allClients.find((client) => normalizeNif(client.nif) === finalParsed.subjectANif);

      if (targetClient) {
        const targetFichaInfo = clientFichaInfoMap.get(targetClient.id);
        const validation = validateIrsPdfData(finalParsed, targetClient, targetFichaInfo, allClients);
        setPdfValidationResult(validation);
      } else {
        const existsNif = (nif: string) => allClients.some((client) => normalizeNif(client.nif) === normalizeNif(nif));
        const suggestions: string[] = [];
        if (finalParsed.subjectANif && !existsNif(finalParsed.subjectANif)) {
          suggestions.push(`Criar ficha para Sujeito Passivo A (NIF ${finalParsed.subjectANif}).`);
        }
        if (finalParsed.subjectBNif && !existsNif(finalParsed.subjectBNif)) {
          suggestions.push(`Criar ficha para Sujeito Passivo B (NIF ${finalParsed.subjectBNif}).`);
        }
        finalParsed.dependentNifs.forEach((nif) => {
          if (!existsNif(nif)) suggestions.push(`Criar ficha para dependente (NIF ${nif}).`);
        });
        setPdfValidationResult({
          parsed: finalParsed,
          notes: finalParsed.subjectANif
            ? [`Sujeito Passivo A (${finalParsed.subjectANif}) não encontrado na base atual.`]
            : ['Não foi possível detetar o NIF do Sujeito Passivo A.'],
          suggestions,
        });
      }
    } catch (err) {
      console.error('Erro ao verificar PDF do IRS:', err);
      const errorMessage = err instanceof Error && err.message
        ? err.message
        : 'Erro desconhecido ao validar o PDF com IA.';
      setPdfValidationResult({
        parsed: {
          subjectANif: '',
          subjectBNif: '',
          dependentNifs: [],
          namesByNif: {},
          firstPageText: '',
          hasBLabel: false,
          hasDependentLabel: false,
          source: 'local',
        },
        notes: [errorMessage],
        suggestions: [],
      });
    } finally {
      setIsVerifyingPdf(false);
    }
  }, [allClients, clientFichaInfoMap, irsGroupClients]);

  const handleApplySuggestions = React.useCallback(async () => {
    if (!pdfValidationResult) return;
    setIsApplyingSuggestions(true);
    setApplySummary('');
    try {
      const existingNifs = new Set(allClients.map((client) => normalizeNif(client.nif)).filter(Boolean));
      const missingNifs = [
        pdfValidationResult.parsed.subjectANif,
        pdfValidationResult.parsed.subjectBNif,
        ...pdfValidationResult.parsed.dependentNifs,
      ].map((nif) => normalizeNif(nif)).filter((nif) => nif.length === 9 && !existingNifs.has(nif));

      const namesByNif: Record<string, string> = { ...(pdfValidationResult.parsed.namesByNif || {}) };
      for (const nif of missingNifs) {
        const suggested = (namesByNif[nif] || '').trim();
        const typed = window.prompt(`Indica o nome para o NIF ${nif}:`, suggested);
        if (typed === null) {
          setApplySummary('Criação automática cancelada (falta confirmar nomes).');
          setIsApplyingSuggestions(false);
          return;
        }
        const finalName = typed.trim() || suggested.trim();
        if (!finalName) {
          setApplySummary(`Nome obrigatório para criar a ficha do NIF ${nif}.`);
          setIsApplyingSuggestions(false);
          return;
        }
        namesByNif[nif] = finalName;
      }

      const applyResult = await onApplyPdfSuggestions({
        subjectANif: pdfValidationResult.parsed.subjectANif,
        subjectBNif: pdfValidationResult.parsed.subjectBNif,
        dependentNifs: pdfValidationResult.parsed.dependentNifs,
        namesByNif,
      });

      const summaryParts: string[] = [];
      if (applyResult.createdClientsStore > 0) summaryParts.push(`${applyResult.createdClientsStore} ficha(s) criada(s) na app`);
      if (applyResult.createdClientsImport > 0) summaryParts.push(`${applyResult.createdClientsImport} ficha(s) criada(s) no Supabase clientes`);
      if (applyResult.createdRelations > 0) summaryParts.push(`${applyResult.createdRelations} relação(ões) criada(s)`);
      if (applyResult.createdRelationsImport > 0) summaryParts.push(`${applyResult.createdRelationsImport} relação(ões) criada(s) no Supabase original`);
      if (applyResult.addedToIrsGroup > 0) summaryParts.push(`${applyResult.addedToIrsGroup} cliente(s) adicionado(s) ao grupo IRS`);
      if (summaryParts.length === 0) summaryParts.push('Sem alterações (já estava tudo criado)');

      const nextNotes = [...pdfValidationResult.notes];
      if (applyResult.errors.length > 0) {
        applyResult.errors.forEach((error) => nextNotes.push(error));
      } else {
        nextNotes.push('Criação automática concluída.');
      }

      setPdfValidationResult({
        ...pdfValidationResult,
        notes: nextNotes,
        suggestions: [],
      });
      setApplySummary(summaryParts.join(' | '));
    } catch (err: any) {
      setApplySummary(`Falha na criação automática: ${err?.message || 'erro desconhecido'}`);
    } finally {
      setIsApplyingSuggestions(false);
    }
  }, [allClients, onApplyPdfSuggestions, pdfValidationResult]);

  const filteredIrsGroupClients = React.useMemo(() => {
    const normalizedQuery = normalizeSearch(searchTerm.trim());
    const normalizedQueryNif = normalizeNif(searchTerm);

    return irsGroupClients.filter((client) => {
      const record = irsControlMap.get(`${client.id}-${currentYear}`);
      const delivered = Boolean(record?.delivered);
      const paid = Boolean(record?.paid);

      const matchesPaid = (
        paidFilter === 'all'
        || (paidFilter === 'yes' && paid)
        || (paidFilter === 'no' && !paid)
      );
      const matchesDelivered = (
        deliveredFilter === 'all'
        || (deliveredFilter === 'yes' && delivered)
        || (deliveredFilter === 'no' && !delivered)
      );

      const nameMatches = normalizeSearch(client.name || '').includes(normalizedQuery);
      const nifDigits = normalizeNif(client.nif || '');
      const nifMatches = normalizedQueryNif
        ? nifDigits.includes(normalizedQueryNif)
        : nifDigits.includes(normalizedQuery);
      const matchesSearch = !normalizedQuery || nameMatches || nifMatches;

      return matchesPaid && matchesDelivered && matchesSearch;
    });
  }, [currentYear, deliveredFilter, irsControlMap, irsGroupClients, paidFilter, searchTerm]);

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
      <input ref={pdfFileInputRef} type="file" accept="application/pdf" className="hidden" onChange={handlePdfSelected} />

      <div className="flex items-center justify-between mb-4">
        <h3 className="font-bold text-slate-800">Control IRS</h3>
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 text-xs">
            <span className="font-bold text-slate-500">Ano:</span>
            <button onClick={() => setCurrentYear((y) => y - 1)} className="p-1 rounded-full hover:bg-slate-200">{'<'}</button>
            <span className="font-bold text-slate-700 w-14 text-center">{currentYear}</span>
            <button onClick={() => setCurrentYear((y) => y + 1)} className="p-1 rounded-full hover:bg-slate-200">{'>'}</button>
          </div>
          <div className="flex items-center gap-2">
            <select
              value={selectedClientIdToAdd}
              onChange={(e) => setSelectedClientIdToAdd(e.target.value)}
              disabled={!irsGroup || availableClientsToAdd.length === 0 || isAddingClientToIrsGroup}
              className="min-w-[260px] px-2 py-1.5 border rounded-lg text-xs bg-white disabled:bg-slate-100 disabled:text-slate-400"
            >
              <option value="">
                {!irsGroup
                  ? 'Sem grupo IRS'
                  : availableClientsToAdd.length === 0
                    ? 'Sem clientes por adicionar'
                    : 'Selecionar cliente...'}
              </option>
              {availableClientsToAdd.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.name} ({client.nif})
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={!selectedClientIdToAdd || isAddingClientToIrsGroup || !irsGroup}
              onClick={async () => {
                if (!selectedClientIdToAdd) return;
                await onQuickAddClientToIrsGroup(selectedClientIdToAdd);
                setSelectedClientIdToAdd('');
              }}
              className="px-3 py-1.5 rounded-lg text-xs font-bold bg-blue-600 text-white disabled:opacity-50"
            >
              {isAddingClientToIrsGroup ? 'A adicionar...' : 'Adicionar Cliente'}
            </button>
          </div>
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

          <div className="bg-white border border-slate-200 rounded-lg p-4">
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleVerifyPdfClick}
                disabled={isVerifyingPdf}
                className="inline-flex items-center gap-2 bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-bold disabled:opacity-60"
              >
                {isVerifyingPdf ? 'A verificar...' : 'Verificar IRS'}
              </button>
              <span className="text-xs text-slate-500">
                Carrega um PDF e valida NIFs + relações automaticamente.
              </span>
            </div>
            {pdfValidationResult && (
              <div className="mt-3 space-y-2 text-sm">
                <div className="text-xs text-slate-600">
                  <span className="font-bold">Detetado:</span>{' '}
                  A={pdfValidationResult.parsed.subjectANif || '-'} | B={pdfValidationResult.parsed.subjectBNif || '-'} | Dependentes={pdfValidationResult.parsed.dependentNifs.join(', ') || '-'}
                </div>
                {pdfValidationResult.notes.map((note) => (
                  <p key={`global-note-${note}`} className="text-slate-700">• {note}</p>
                ))}
                {pdfValidationResult.suggestions.length > 0 && (
                  <div className="bg-amber-50 border border-amber-200 rounded p-3">
                    <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
                      <p className="text-xs font-bold uppercase text-amber-700">Sugestões</p>
                      <button
                        type="button"
                        onClick={handleApplySuggestions}
                        disabled={isApplyingSuggestions}
                        className="inline-flex items-center gap-2 bg-amber-600 text-white px-3 py-1.5 rounded-md text-xs font-bold disabled:opacity-60"
                      >
                        {isApplyingSuggestions ? 'A criar...' : 'Criar fichas + relações automaticamente'}
                      </button>
                    </div>
                    {pdfValidationResult.suggestions.map((suggestion) => (
                      <p key={`global-suggestion-${suggestion}`} className="text-amber-800">• {suggestion}</p>
                    ))}
                  </div>
                )}
                {applySummary && (
                  <p className="text-xs font-bold text-emerald-700">{applySummary}</p>
                )}
              </div>
            )}
          </div>

          <div className="bg-white border border-slate-200 rounded-lg p-3">
            <div className="flex flex-wrap items-end gap-3 mb-3">
              <div className="min-w-[240px] flex-1">
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Pesquisar</label>
                <input
                  type="text"
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Nome ou NIF..."
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                />
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Pago</label>
                <select
                  value={paidFilter}
                  onChange={(e) => setPaidFilter(e.target.value as StatusFilter)}
                  className="px-3 py-2 border rounded-lg text-sm bg-white"
                >
                  <option value="all">Todos</option>
                  <option value="yes">Pago</option>
                  <option value="no">Não pago</option>
                </select>
              </div>
              <div>
                <label className="block text-[11px] font-bold uppercase text-slate-500 mb-1">Entregue</label>
                <select
                  value={deliveredFilter}
                  onChange={(e) => setDeliveredFilter(e.target.value as StatusFilter)}
                  className="px-3 py-2 border rounded-lg text-sm bg-white"
                >
                  <option value="all">Todos</option>
                  <option value="yes">Entregue</option>
                  <option value="no">Não entregue</option>
                </select>
              </div>
              <p className="text-xs text-slate-500 ml-auto">{filteredIrsGroupClients.length} registo(s)</p>
            </div>

            <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500 uppercase bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left">Cliente</th>
                  <th className="px-3 py-2 text-left">NIF</th>
                  <th className="px-3 py-2 text-center">Nº Anexos</th>
                  <th className="px-3 py-2 text-left">IRS</th>
                  <th className="px-3 py-2 text-center">Entregue</th>
                  <th className="px-3 py-2 text-center">Pago</th>
                  <th className="px-3 py-2 text-left">Método</th>
                  <th className="px-3 py-2 text-right">Valor (EUR)</th>
                  <th className="px-3 py-2 text-left">Obs (oferta/motivo)</th>
                  <th className="px-3 py-2 text-center">Fecho</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredIrsGroupClients.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-3 py-4 text-center text-slate-400 italic">
                      Sem resultados para os filtros aplicados.
                    </td>
                  </tr>
                ) : filteredIrsGroupClients.map((client) => {
                  const record = irsControlMap.get(`${client.id}-${currentYear}`);
                  const delivered = Boolean(record?.delivered);
                  const paid = Boolean(record?.paid);
                  const amount = record?.amount ?? 0;
                  const paymentMethod = record?.paymentMethod || 'Numerário';
                  const notes = record?.notes ?? '';
                  const isClosed = Boolean(record?.deliveryCloseId);
                  const settlementAmount = Number(record?.irsSettlementAmount || 0);
                  const settlementDirection = resolveSettlementDirection(record);
                  const attachmentCount = attachmentCountByNif[normalizeNif(client.nif)] ?? 0;
                  return (
                    <tr key={`${client.id}-${currentYear}`} className="hover:bg-slate-50">
                        <td className="px-3 py-2 font-medium text-slate-700">
                          <button
                            type="button"
                            onClick={() => setFloatingClientId(client.id)}
                            className="text-left hover:text-blue-600"
                          >
                            <span className="block">{client.name}</span>
                            <span className="block text-[10px] font-normal text-blue-500">Abrir caixa IRS</span>
                          </button>
                        </td>
                        <td className="px-3 py-2 text-slate-600">{client.nif}</td>
                        <td className="px-3 py-2 text-center font-semibold text-slate-700">{attachmentCount}</td>
                        <td className="px-3 py-2 min-w-[230px]">
                          <div className="grid grid-cols-[95px_minmax(96px,1fr)] gap-2">
                            <select
                              value={settlementDirection}
                              onChange={(e) => {
                                onSettlementDirectionChange(client.id, e.target.value as IrsSettlementDirection);
                              }}
                              className={`w-full px-2 py-1.5 border rounded-lg text-xs font-bold bg-white ${
                                settlementDirection === 'A pagar'
                                  ? 'text-red-700 border-red-200'
                                  : settlementDirection === 'Nulo'
                                    ? 'text-slate-600 border-slate-200'
                                    : 'text-emerald-700 border-emerald-200'
                              }`}
                            >
                              <option value="A pagar">A pagar</option>
                              <option value="Nulo">Nulo</option>
                              <option value="A receber">A receber</option>
                            </select>
                            <input
                              type="number"
                              min="0"
                              step="0.01"
                              value={Math.abs(settlementAmount) || ''}
                              disabled={settlementDirection === 'Nulo'}
                              onChange={(e) => {
                                const nextAbsolute = Math.max(0, Number((e.target.value || '').replace(',', '.')) || 0);
                                onSettlementAmountChange(client.id, nextAbsolute);
                              }}
                              className="w-full px-2 py-1.5 border rounded-lg text-sm text-right disabled:bg-slate-100 disabled:text-slate-400"
                              placeholder="0.00"
                            />
                          </div>
                        </td>
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
                  );
                })}
              </tbody>
            </table>
            </div>
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
                <label className="text-[11px] font-bold text-slate-500 uppercase">Valor IRS (Pagar/Receber/Nulo)</label>
                <div className="mt-1 grid grid-cols-1 md:grid-cols-2 gap-2">
                  <select
                    value={floatingSettlementDirection}
                    onChange={(e) => {
                      onSettlementDirectionChange(floatingClient.id, e.target.value as IrsSettlementDirection);
                    }}
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-white"
                  >
                    <option value="A pagar">A pagar</option>
                    <option value="Nulo">Nulo</option>
                    <option value="A receber">A receber</option>
                  </select>
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={Math.abs(Number(floatingRecord?.irsSettlementAmount || 0)) || ''}
                    disabled={floatingSettlementDirection === 'Nulo'}
                    onChange={(e) => {
                      const nextAbsolute = Math.max(0, Number((e.target.value || '').replace(',', '.')) || 0);
                      onSettlementAmountChange(floatingClient.id, nextAbsolute);
                    }}
                    className="w-full px-3 py-2 border rounded-lg text-sm text-right bg-white disabled:bg-slate-100 disabled:text-slate-400"
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
