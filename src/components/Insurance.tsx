import React, { useEffect, useState, useMemo } from 'react';
import { InsurancePolicy, Client } from '../types';
import { insuranceService } from '../services';
import { Plus, X, Save, RefreshCcw, Trash2, Edit2, Search, FileCheck, FileClock, Paperclip, ChevronUp, ChevronDown, PieChart, Printer } from 'lucide-react';

interface InsuranceProps {
  policies: InsurancePolicy[];
  setPolicies: (policies: InsurancePolicy[]) => void;
  clients: Client[];
  forcedAgent?: InsurancePolicy['agent'];
  viewerEmail?: string;
}

type SortableKeys = 'policyHolder' | 'policyNumber' | 'company' | 'mediatorPartner' | 'internalResponsible' | 'renewalDate' | 'branch' | 'communicationType' | 'status' | 'premiumValue' | 'netPremiumValue';

interface CommissionPeriodRow {
  key: string;
  policyId: string;
  dueDate: string;
  clientName: string;
  policyHolder: string;
  policyNumber: string;
  company: string;
  mediatorPartner: string;
  internalResponsible: string;
  paymentFrequency: InsurancePolicy['paymentFrequency'];
  netPremium: number;
  commissionRate: number;
  amount: number;
  isPaid: boolean;
}

interface PaidCommissionHistoryRow {
  id: string;
  policyId: string;
  dueDate: string;
  paidAt: string;
  clientName: string;
  policyHolder: string;
  policyNumber: string;
  company: string;
  paymentFrequency: InsurancePolicy['paymentFrequency'];
  amount: number;
}

const LEGACY_MEDIATOR_PARTNERS = ['Finiconde', 'Nepseguros', 'Neoseguros'];
const normalizeMediatorPartner = (value: string) => value === 'Nepseguros' ? 'Neoseguros' : value;
const isLegacyMediatorPartner = (value?: string) => Boolean(value && LEGACY_MEDIATOR_PARTNERS.includes(value));

const getCompany = (policy: Partial<InsurancePolicy>) => {
  const company = policy.company || policy.insuranceProvider || '';
  return isLegacyMediatorPartner(company) ? '' : company;
};
const getBranch = (policy: Partial<InsurancePolicy>) => policy.branch || policy.policyType || '';
const getPolicyHolder = (policy: Partial<InsurancePolicy>) => policy.policyHolder || policy.clientName || '';
const getMediatorPartner = (policy: Partial<InsurancePolicy>) => {
  if (policy.mediatorPartner) return policy.mediatorPartner;
  const legacyCompany = policy.company || policy.insuranceProvider || '';
  return isLegacyMediatorPartner(legacyCompany) ? normalizeMediatorPartner(legacyCompany) : '';
};
const getInternalResponsible = (policy: Partial<InsurancePolicy>) => policy.internalResponsible || policy.agent || '';
const getTotalPremium = (policy: Partial<InsurancePolicy>) => Number(policy.premiumValue ?? policy.netPremiumValue ?? 0);
const getNetPremium = (policy: Partial<InsurancePolicy>) => {
  const totalPremium = getTotalPremium(policy);
  const netPremiumRaw = Number(policy.netPremiumValue ?? Number.NaN);
  if (!Number.isFinite(netPremiumRaw) || netPremiumRaw <= 0) {
    return totalPremium;
  }
  return netPremiumRaw;
};

const formatCurrency = (value: number) =>
  new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' }).format(Number(value || 0));

const formatDate = (value?: string) => {
  if (!value) return '-';
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? '-' : date.toLocaleDateString('pt-PT');
};

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

const MEDIATOR_PARTNER_OPTIONS = ['Finiconde', 'Neoseguros', 'Outra'] as const;
const COMPANY_OPTIONS = ['Allianz', 'Tranquilidade', 'Fidelidade', 'Liberty', 'Zurich', 'Generali', 'Ageas', 'Lusitania', 'Outra'] as const;
const BRANCH_OPTIONS = [
  'Automovel',
  'Ac Trabalho',
  'Multi Risco',
  'Responsabilidade Civil',
  'Casa',
  'Seguro Credito',
  'Vida',
  'Animais',
  'Acidentes pessoais',
  'Outros',
] as const;

const isInOptions = (value: string | undefined, options: readonly string[]) =>
  Boolean(value && options.includes(value));

const parseIsoDate = (value?: string): Date | null => {
  if (!value) return null;
  const [year, month, day] = value.split('-').map(Number);
  if (!year || !month || !day) return null;
  const parsed = new Date(year, month - 1, day);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
};

const toIsoDate = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

const getFrequencyCadence = (paymentFrequency: InsurancePolicy['paymentFrequency']) => {
  switch (paymentFrequency) {
    case 'Mensal':
      return { stepMonths: 1, installmentsPerYear: 12 };
    case 'Trimestral':
      return { stepMonths: 3, installmentsPerYear: 4 };
    case 'Semestral':
      return { stepMonths: 6, installmentsPerYear: 2 };
    case 'Anual':
    default:
      return { stepMonths: 12, installmentsPerYear: 1 };
  }
};

const addMonthsWithAnchor = (date: Date, months: number, anchorDay: number): Date => {
  const target = new Date(date.getFullYear(), date.getMonth() + months, 1);
  const lastDayInTargetMonth = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  return new Date(target.getFullYear(), target.getMonth(), Math.min(anchorDay, lastDayInTargetMonth));
};

const buildDueDatesForPolicy = (
  policy: InsurancePolicy,
  periodStart: string,
  periodEnd: string
): string[] => {
  const startDate = parseIsoDate(periodStart);
  const endDate = parseIsoDate(periodEnd);
  const anchorDate = parseIsoDate(policy.renewalDate || policy.policyDate);
  if (!startDate || !endDate || !anchorDate || startDate > endDate) return [];

  const { stepMonths } = getFrequencyCadence(policy.paymentFrequency);
  const anchorDay = anchorDate.getDate();
  let cursor = new Date(anchorDate.getTime());
  let guard = 0;

  while (cursor < startDate && guard < 1200) {
    cursor = addMonthsWithAnchor(cursor, stepMonths, anchorDay);
    guard += 1;
  }

  const dueDates: string[] = [];
  while (cursor <= endDate && guard < 2400) {
    if (cursor >= startDate) {
      dueDates.push(toIsoDate(cursor));
    }
    cursor = addMonthsWithAnchor(cursor, stepMonths, anchorDay);
    guard += 1;
  }

  return dueDates;
};

const getSortValue = (policy: InsurancePolicy, sortKey: SortableKeys): string | number => {
  switch (sortKey) {
    case 'policyHolder':
      return getPolicyHolder(policy);
    case 'policyNumber':
      return policy.policyNumber || '';
    case 'company':
      return getCompany(policy);
    case 'mediatorPartner':
      return getMediatorPartner(policy);
    case 'internalResponsible':
      return getInternalResponsible(policy);
    case 'renewalDate':
      return policy.renewalDate || '';
    case 'branch':
      return getBranch(policy);
    case 'communicationType':
      return policy.communicationType || '';
    case 'status':
      return policy.status || '';
    case 'premiumValue':
      return getTotalPremium(policy);
    case 'netPremiumValue':
      return getNetPremium(policy);
    default:
      return '';
  }
};

const Insurance: React.FC<InsuranceProps> = ({ policies, setPolicies, clients, forcedAgent, viewerEmail }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<Partial<InsurancePolicy> | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [customCompany, setCustomCompany] = useState('');
  const [customMediatorPartner, setCustomMediatorPartner] = useState('');
  const [customBranch, setCustomBranch] = useState('');

  // Filters
  const [searchTerm, setSearchTerm] = useState('');
  const [companyFilter, setCompanyFilter] = useState('all');
  const [mediatorPartnerFilter, setMediatorPartnerFilter] = useState('all');
  const [internalResponsibleFilter, setInternalResponsibleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [policyStatusFilter, setPolicyStatusFilter] = useState('all');
  const [sortConfig, setSortConfig] = useState<{ key: SortableKeys; direction: 'ascending' | 'descending' }>({ key: 'renewalDate', direction: 'ascending' });
  const [isQuarterlyModalOpen, setIsQuarterlyModalOpen] = useState(false);
  const [commissionPeriodStart, setCommissionPeriodStart] = useState(() => {
    const now = new Date();
    return toIsoDate(new Date(now.getFullYear(), now.getMonth(), 1));
  });
  const [commissionPeriodEnd, setCommissionPeriodEnd] = useState(() => {
    const now = new Date();
    return toIsoDate(new Date(now.getFullYear(), now.getMonth() + 1, 0));
  });
  const [commissionRows, setCommissionRows] = useState<CommissionPeriodRow[]>([]);
  const [selectedCommissionRowKeys, setSelectedCommissionRowKeys] = useState<string[]>([]);
  const [isGeneratingCommissions, setIsGeneratingCommissions] = useState(false);
  const [isMarkingCommissionsPaid, setIsMarkingCommissionsPaid] = useState(false);
  const [hasGeneratedCommissions, setHasGeneratedCommissions] = useState(false);
  const [paidCommissionHistoryRows, setPaidCommissionHistoryRows] = useState<PaidCommissionHistoryRow[]>([]);
  const [isLoadingPaidCommissionHistory, setIsLoadingPaidCommissionHistory] = useState(false);
  const [paidCommissionHistoryError, setPaidCommissionHistoryError] = useState<string | null>(null);
  const canViewCommissionData = (viewerEmail || '').trim().toLowerCase() === 'mpr@mpr.pt';

  const visiblePolicies = useMemo(() => {
    if (!forcedAgent) return policies;
    return policies.filter(policy => getInternalResponsible(policy) === forcedAgent);
  }, [policies, forcedAgent]);
  const visiblePolicyById = useMemo(() => new Map(visiblePolicies.map(policy => [policy.id, policy])), [visiblePolicies]);

  const uniqueCompanies = useMemo(() => {
    const companies = new Set(visiblePolicies.map(policy => getCompany(policy)).filter(Boolean));
    return Array.from(companies) as string[];
  }, [visiblePolicies]);

  const uniqueMediatorPartners = useMemo(() => {
    const mediators = new Set(visiblePolicies.map(policy => getMediatorPartner(policy)).filter(Boolean));
    return Array.from(mediators) as string[];
  }, [visiblePolicies]);

  const uniqueInternalResponsibles = useMemo(() => {
    const responsibles = new Set(visiblePolicies.map(policy => getInternalResponsible(policy)).filter(Boolean));
    return Array.from(responsibles) as string[];
  }, [visiblePolicies]);

  const sortedClients = useMemo(() => {
    return [...clients].sort((a, b) => a.name.localeCompare(b.name));
  }, [clients]);

  const sortedPolicies = useMemo(() => {
    let filtered = visiblePolicies.filter(p => {
      const search = searchTerm.toLowerCase();
      const searchMatch = searchTerm === '' ||
        p.clientName?.toLowerCase().includes(search) ||
        getPolicyHolder(p).toLowerCase().includes(search) ||
        p.policyNumber?.toLowerCase().includes(search) ||
        getCompany(p).toLowerCase().includes(search) ||
        getBranch(p).toLowerCase().includes(search) ||
        (p.communicationType || '').toLowerCase().includes(search) ||
        getMediatorPartner(p).toLowerCase().includes(search) ||
        getInternalResponsible(p).toLowerCase().includes(search);
      
      const companyMatch = companyFilter === 'all' || getCompany(p) === companyFilter;
      const mediatorPartnerMatch = mediatorPartnerFilter === 'all' || getMediatorPartner(p) === mediatorPartnerFilter;
      const internalResponsibleMatch = internalResponsibleFilter === 'all' || getInternalResponsible(p) === internalResponsibleFilter;
      
      const statusMatch = statusFilter === 'all' ||
        (statusFilter === 'paid' && p.hasReceipt) ||
        (statusFilter === 'pending' && !p.hasReceipt);
      
      const policyStatusMatch = policyStatusFilter === 'all' || p.status === policyStatusFilter;

      return searchMatch && companyMatch && mediatorPartnerMatch && internalResponsibleMatch && statusMatch && policyStatusMatch;
    });

    if (sortConfig !== null) {
      filtered.sort((a, b) => {
        const aValue = getSortValue(a, sortConfig.key);
        const bValue = getSortValue(b, sortConfig.key);
        if (aValue < bValue) {
          return sortConfig.direction === 'ascending' ? -1 : 1;
        }
        if (aValue > bValue) {
          return sortConfig.direction === 'ascending' ? 1 : -1;
        }
        return 0;
      });
    }
    return filtered;
  }, [visiblePolicies, searchTerm, companyFilter, mediatorPartnerFilter, internalResponsibleFilter, statusFilter, policyStatusFilter, sortConfig, canViewCommissionData]);

  const totals = useMemo(() => {
    let pending = 0;
    let paid = 0;
    let totalPremiumGross = 0;
    let totalPremiumNet = 0;
    // Only calculate totals for accepted policies
    const acceptedPolicies = visiblePolicies.filter(p => p.status === 'Aceite');
    acceptedPolicies.forEach(p => {
      const totalPremium = getTotalPremium(p);
      const netPremium = getNetPremium(p);
      const commissionValue = (netPremium * p.commissionRate) / 100;
      if (p.commissionPaid) {
        paid += commissionValue;
      } else {
        pending += commissionValue;
      }
      totalPremiumGross += totalPremium;
      totalPremiumNet += netPremium;
    });
    return { pending, paid, totalPremiumGross, totalPremiumNet };
  }, [visiblePolicies]);

  const quarterlyPremiums = useMemo(() => {
    const quarters: Record<string, number> = { Q1: 0, Q2: 0, Q3: 0, Q4: 0 };
    const acceptedPolicies = visiblePolicies.filter(p => p.status === 'Aceite');
    acceptedPolicies.forEach(p => {
      const month = new Date(p.policyDate).getMonth();
      const totalPremium = getTotalPremium(p);
      if (month < 3) quarters.Q1 += totalPremium;
      else if (month < 6) quarters.Q2 += totalPremium;
      else if (month < 9) quarters.Q3 += totalPremium;
      else quarters.Q4 += totalPremium;
    });
    return quarters;
  }, [visiblePolicies]);

  const pendingCommissionRows = useMemo(
    () => commissionRows.filter(row => !row.isPaid),
    [commissionRows]
  );
  const selectedCommissionRows = useMemo(() => {
    const selectedSet = new Set(selectedCommissionRowKeys);
    return commissionRows.filter(row => selectedSet.has(row.key) && !row.isPaid);
  }, [commissionRows, selectedCommissionRowKeys]);
  const commissionTotals = useMemo(() => {
    const pending = pendingCommissionRows.reduce((sum, row) => sum + row.amount, 0);
    const paid = commissionRows.filter(row => row.isPaid).reduce((sum, row) => sum + row.amount, 0);
    const selected = selectedCommissionRows.reduce((sum, row) => sum + row.amount, 0);
    return { pending, paid, selected };
  }, [pendingCommissionRows, commissionRows, selectedCommissionRows]);
  const commissionTotalsByResponsible = useMemo(() => {
    return commissionRows.reduce<Record<string, { count: number; pending: number; selected: number }>>((acc, row) => {
      const responsible = row.internalResponsible || 'Sem responsavel';
      if (!acc[responsible]) acc[responsible] = { count: 0, pending: 0, selected: 0 };
      acc[responsible].count += 1;
      if (!row.isPaid) acc[responsible].pending += row.amount;
      if (selectedCommissionRowKeys.includes(row.key) && !row.isPaid) acc[responsible].selected += row.amount;
      return acc;
    }, {});
  }, [commissionRows, selectedCommissionRowKeys]);
  const allPendingSelected = pendingCommissionRows.length > 0 && selectedCommissionRows.length === pendingCommissionRows.length;
  const paidCommissionHistoryTotal = useMemo(
    () => paidCommissionHistoryRows.reduce((sum, row) => sum + row.amount, 0),
    [paidCommissionHistoryRows]
  );

  const loadPaidCommissionHistory = async () => {
    setIsLoadingPaidCommissionHistory(true);
    setPaidCommissionHistoryError(null);
    try {
      const settlements = await insuranceService.getCommissionSettlementsHistory();
      const rows = settlements
        .map(settlement => {
          const policy = visiblePolicyById.get(settlement.policyId);
          if (!policy) return null;
          return {
            id: settlement.id,
            policyId: settlement.policyId,
            dueDate: settlement.dueDate,
            paidAt: settlement.paidAt,
            clientName: policy.clientName || getPolicyHolder(policy) || 'Sem cliente',
            policyHolder: getPolicyHolder(policy) || '-',
            policyNumber: policy.policyNumber || '-',
            company: getCompany(policy) || '-',
            paymentFrequency: policy.paymentFrequency,
            amount: Number(settlement.amount || 0),
          } as PaidCommissionHistoryRow;
        })
        .filter((row): row is PaidCommissionHistoryRow => row !== null);

      rows.sort((a, b) => {
        const paidCompare = b.paidAt.localeCompare(a.paidAt);
        if (paidCompare !== 0) return paidCompare;
        const clientCompare = a.clientName.localeCompare(b.clientName, 'pt-PT', { sensitivity: 'base' });
        if (clientCompare !== 0) return clientCompare;
        const policyCompare = a.policyNumber.localeCompare(b.policyNumber, 'pt-PT', { sensitivity: 'base' });
        if (policyCompare !== 0) return policyCompare;
        return b.dueDate.localeCompare(a.dueDate);
      });

      setPaidCommissionHistoryRows(rows);
    } catch (err: any) {
      setPaidCommissionHistoryError('Erro ao carregar histórico de comissões: ' + err.message);
    } finally {
      setIsLoadingPaidCommissionHistory(false);
    }
  };

  useEffect(() => {
    if (!canViewCommissionData) {
      setPaidCommissionHistoryRows([]);
      setPaidCommissionHistoryError(null);
      return;
    }
    void loadPaidCommissionHistory();
  }, [visiblePolicyById, canViewCommissionData]);

  const handleOpenModal = (policy?: InsurancePolicy) => {
    const companyValue = policy ? getCompany(policy) : '';
    const mediatorPartnerValue = policy ? getMediatorPartner(policy) : '';
    const branchValue = policy ? getBranch(policy) : '';
    const companyOption = isInOptions(companyValue, COMPANY_OPTIONS) ? companyValue : (companyValue ? 'Outra' : '');
    const mediatorPartnerOption = isInOptions(mediatorPartnerValue, MEDIATOR_PARTNER_OPTIONS) ? mediatorPartnerValue : (mediatorPartnerValue ? 'Outra' : '');
    const branchOption = isInOptions(branchValue, BRANCH_OPTIONS) ? branchValue : (branchValue ? 'Outros' : '');

    setCustomCompany(companyOption === 'Outra' && companyValue !== 'Outra' ? companyValue : '');
    setCustomMediatorPartner(mediatorPartnerOption === 'Outra' && mediatorPartnerValue !== 'Outra' ? mediatorPartnerValue : '');
    setCustomBranch(branchOption === 'Outros' && branchValue !== 'Outros' ? branchValue : '');

    setEditingPolicy(policy ? {
      ...policy,
      policyHolder: getPolicyHolder(policy),
      agent: forcedAgent || getInternalResponsible(policy) || 'MPR',
      internalResponsible: forcedAgent || getInternalResponsible(policy) || 'MPR',
      mediatorPartner: mediatorPartnerOption,
      renewalDate: policy.renewalDate || policy.policyDate,
      company: companyOption,
      branch: branchOption,
      premiumValue: getTotalPremium(policy),
      netPremiumValue: getNetPremium(policy),
      policyTier: policy.policyTier || 'Base',
      insuranceProvider: companyOption,
      policyType: branchOption,
    } : {
      policyDate: new Date().toISOString().split('T')[0],
      renewalDate: new Date().toISOString().split('T')[0],
      paymentFrequency: 'Anual',
      status: 'Proposta',
      policyTier: 'Base',
      commissionPaid: false,
      hasReceipt: false,
      commissionRate: 10,
      premiumValue: 0,
      netPremiumValue: 0,
      agent: forcedAgent || 'MPR',
      internalResponsible: forcedAgent || 'MPR',
      mediatorPartner: 'Finiconde',
      policyHolder: '',
      company: 'Allianz',
      branch: 'Automovel',
      insuranceProvider: 'Allianz',
      policyType: 'Automovel',
      notes: '',
    });
    setSelectedFile(null);
    setIsModalOpen(true);
  };

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingPolicy) {
      return;
    }

    const resolvedCompany =
      editingPolicy.company === 'Outra'
        ? ((customCompany || '').trim() || 'Outra')
        : (editingPolicy.company || '').trim();
    const resolvedMediatorPartner =
      editingPolicy.mediatorPartner === 'Outra'
        ? ((customMediatorPartner || '').trim() || 'Outra')
        : (editingPolicy.mediatorPartner || '').trim();
    const resolvedBranch =
      editingPolicy.branch === 'Outros'
        ? ((customBranch || '').trim() || 'Outros')
        : (editingPolicy.branch || '').trim();

    if (!resolvedCompany || !resolvedMediatorPartner || !resolvedBranch) {
      alert('Mediador/parceiro, Companhia e Ramo sao obrigatorios.');
      return;
    }

    const resolvedAgent = forcedAgent || editingPolicy.internalResponsible || editingPolicy.agent || 'MPR';
    const isPaulaAgent = resolvedAgent === 'Paula';
    if (!isPaulaAgent && !editingPolicy.clientId) {
      alert('Cliente, Companhia e Ramo sao obrigatorios.');
      return;
    }

    if (isPaulaAgent && !editingPolicy.clientId && !(editingPolicy.policyHolder || '').trim()) {
      alert('Quando a responsavel interna e Paula e nao ha cliente, o Tomador e obrigatorio.');
      return;
    }

    setIsSaving(true);
    try {
      const policyId = editingPolicy.id || crypto.randomUUID();
      let attachmentUrl = editingPolicy.attachment_url;

      if (selectedFile) {
        attachmentUrl = await insuranceService.uploadAttachment(selectedFile, policyId);
      }

      const selectedClientName = sortedClients.find(client => client.id === editingPolicy.clientId)?.name || '';
      const netPremium = getNetPremium(editingPolicy);
      const totalPremium = getTotalPremium(editingPolicy);

      const policyToSave = {
        ...editingPolicy,
        id: policyId,
        agent: resolvedAgent,
        internalResponsible: resolvedAgent,
        mediatorPartner: resolvedMediatorPartner,
        attachment_url: attachmentUrl,
        policyHolder: (editingPolicy.policyHolder || '').trim() || selectedClientName,
        renewalDate: editingPolicy.renewalDate || editingPolicy.policyDate,
        company: resolvedCompany,
        branch: resolvedBranch,
        insuranceProvider: resolvedCompany,
        policyType: resolvedBranch,
        policyTier: editingPolicy.policyTier || 'Base',
        netPremiumValue: netPremium,
        premiumValue: totalPremium,
      };

      const savedPolicy = await insuranceService.upsert(policyToSave);

      if (editingPolicy.id) {
        setPolicies(policies.map(p => p.id === savedPolicy.id ? savedPolicy : p));
      } else {
        setPolicies([savedPolicy, ...policies]);
      }
      setIsModalOpen(false);
    } catch (err: any) {
      alert('Erro ao salvar a apolice: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleGenerateCommissionMap = async () => {
    if (!commissionPeriodStart || !commissionPeriodEnd) {
      alert('Selecione o período inicial e final.');
      return;
    }
    if (commissionPeriodStart > commissionPeriodEnd) {
      alert('A data inicial não pode ser superior à data final.');
      return;
    }

    setIsGeneratingCommissions(true);
    try {
      const settlements = await insuranceService.getCommissionSettlementsByPeriod(commissionPeriodStart, commissionPeriodEnd);
      const paidKeys = new Set(settlements.map(item => `${item.policyId}__${item.dueDate}`));
      const rows: CommissionPeriodRow[] = [];

      visiblePolicies
        .filter(policy => policy.status === 'Aceite')
        .forEach(policy => {
          const annualCommission = (getNetPremium(policy) * Number(policy.commissionRate || 0)) / 100;
          if (annualCommission <= 0) return;

          const { installmentsPerYear } = getFrequencyCadence(policy.paymentFrequency);
          const installmentAmount = Number((annualCommission / installmentsPerYear).toFixed(2));
          const dueDates = buildDueDatesForPolicy(policy, commissionPeriodStart, commissionPeriodEnd);

          dueDates.forEach(dueDate => {
            const key = `${policy.id}__${dueDate}`;
            if (paidKeys.has(key)) {
              return;
            }
            rows.push({
              key,
              policyId: policy.id,
              dueDate,
              clientName: policy.clientName || getPolicyHolder(policy) || 'Sem cliente',
              policyHolder: getPolicyHolder(policy) || '-',
              policyNumber: policy.policyNumber || '-',
              company: getCompany(policy) || '-',
              mediatorPartner: getMediatorPartner(policy) || '-',
              internalResponsible: getInternalResponsible(policy) || '-',
              paymentFrequency: policy.paymentFrequency,
              netPremium: getNetPremium(policy),
              commissionRate: Number(policy.commissionRate || 0),
              amount: installmentAmount,
              isPaid: false,
            });
          });
        });

      rows.sort((a, b) => {
        const clientCompare = a.clientName.localeCompare(b.clientName, 'pt-PT', { sensitivity: 'base' });
        if (clientCompare !== 0) return clientCompare;
        const policyCompare = (a.policyNumber || '').localeCompare((b.policyNumber || ''), 'pt-PT', { sensitivity: 'base' });
        if (policyCompare !== 0) return policyCompare;
        return a.dueDate.localeCompare(b.dueDate);
      });

      setCommissionRows(rows);
      setSelectedCommissionRowKeys([]);
      setHasGeneratedCommissions(true);
    } catch (err: any) {
      alert('Erro ao gerar mapa de comissões: ' + err.message);
    } finally {
      setIsGeneratingCommissions(false);
    }
  };

  const toggleCommissionRowSelection = (rowKey: string) => {
    setSelectedCommissionRowKeys(prev =>
      prev.includes(rowKey) ? prev.filter(key => key !== rowKey) : [...prev, rowKey]
    );
  };

  const toggleAllPendingCommissions = () => {
    if (allPendingSelected) {
      setSelectedCommissionRowKeys([]);
      return;
    }
    setSelectedCommissionRowKeys(pendingCommissionRows.map(row => row.key));
  };

  const handleMarkSelectedCommissionsAsPaid = async () => {
    if (selectedCommissionRows.length === 0) {
      alert('Selecione pelo menos uma comissão pendente.');
      return;
    }

    setIsMarkingCommissionsPaid(true);
    try {
      await insuranceService.markCommissionSettlementsPaid(
        selectedCommissionRows.map(row => ({
          policyId: row.policyId,
          dueDate: row.dueDate,
          amount: row.amount,
        }))
      );

      const selectedSet = new Set(selectedCommissionRows.map(row => row.key));
      setCommissionRows(prev => prev.filter(row => !selectedSet.has(row.key)));
      setSelectedCommissionRowKeys([]);
      await loadPaidCommissionHistory();
    } catch (err: any) {
      alert('Erro ao marcar comissões como pagas: ' + err.message);
    } finally {
      setIsMarkingCommissionsPaid(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (confirm("Tem a certeza que deseja apagar esta apólice?")) {
      try {
        await insuranceService.delete(id);
        setPolicies(policies.filter(p => p.id !== id));
      } catch (err: any) {
        alert("Erro ao apagar a apólice: " + err.message);
      }
    }
  };

  const openPrintableReport = (title: string, subtitle: string, bodyHtml: string) => {
    const printWindow = window.open('', '_blank', 'width=1200,height=800');
    if (!printWindow) {
      alert('Nao foi possivel abrir o relatorio. Verifique se o bloqueador de pop-ups esta ativo.');
      return;
    }

    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <meta charset="utf-8" />
          <title>${escapeHtml(title)}</title>
          <style>
            @page { size: A4 landscape; margin: 12mm; }
            * { box-sizing: border-box; }
            body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #0f172a; background: #fff; }
            header { display: flex; justify-content: space-between; gap: 24px; align-items: flex-start; border-bottom: 2px solid #0f172a; padding-bottom: 12px; margin-bottom: 14px; }
            h1 { margin: 0; font-size: 22px; letter-spacing: 0; }
            .subtitle { margin-top: 4px; color: #475569; font-size: 11px; }
            .stamp { text-align: right; color: #475569; font-size: 10px; line-height: 1.5; }
            .kpis { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; margin: 12px 0 14px; }
            .kpi { border: 1px solid #dbe4ee; background: #f8fafc; padding: 8px; border-radius: 8px; }
            .kpi-label { color: #64748b; font-size: 9px; font-weight: 700; text-transform: uppercase; }
            .kpi-value { margin-top: 4px; font-size: 15px; font-weight: 800; }
            table { width: 100%; border-collapse: collapse; font-size: 9px; }
            th { background: #eaf0f7; color: #334155; text-align: left; font-size: 8px; text-transform: uppercase; padding: 6px; border-bottom: 1px solid #cbd5e1; }
            td { padding: 6px; border-bottom: 1px solid #e2e8f0; vertical-align: top; }
            tr:nth-child(even) td { background: #fbfdff; }
            .num { text-align: right; white-space: nowrap; }
            .mono { font-family: "Courier New", monospace; }
            .badge { display: inline-block; border-radius: 999px; padding: 2px 6px; font-size: 8px; font-weight: 700; background: #dcfce7; color: #166534; }
            .badge.gray { background: #f1f5f9; color: #475569; }
            .badge.red { background: #fee2e2; color: #991b1b; }
            .muted { color: #64748b; font-size: 8px; }
            footer { margin-top: 12px; color: #64748b; font-size: 9px; }
            @media print { button { display: none; } body { print-color-adjust: exact; -webkit-print-color-adjust: exact; } }
          </style>
        </head>
        <body>
          <header>
            <div>
              <h1>${escapeHtml(title)}</h1>
              <div class="subtitle">${escapeHtml(subtitle)}</div>
            </div>
            <div class="stamp">
              MPR Negocios<br/>
              Gerado em ${new Date().toLocaleString('pt-PT')}
            </div>
          </header>
          ${bodyHtml}
          <footer>Relatorio gerado a partir da Gestao de Seguros.</footer>
          <script>
            window.onload = () => {
              window.focus();
              setTimeout(() => window.print(), 250);
            };
          </script>
        </body>
      </html>
    `);
    printWindow.document.close();
  };

  const handleExportPoliciesPdf = () => {
    const acceptedCount = sortedPolicies.filter(policy => policy.status === 'Aceite').length;
    const proposalCount = sortedPolicies.filter(policy => policy.status === 'Proposta').length;
    const totalPremium = sortedPolicies.reduce((sum, policy) => sum + getTotalPremium(policy), 0);
    const netPremium = sortedPolicies.reduce((sum, policy) => sum + getNetPremium(policy), 0);
    const commissionTotal = sortedPolicies.reduce((sum, policy) => sum + ((getNetPremium(policy) * Number(policy.commissionRate || 0)) / 100), 0);
    const rowsHtml = sortedPolicies.map(policy => {
      const statusClass = policy.status === 'Aceite' ? '' : policy.status === 'Cancelada' ? 'red' : 'gray';
      return `
        <tr>
          <td><strong>${escapeHtml(getPolicyHolder(policy) || '-')}</strong><div class="muted">${escapeHtml(policy.clientName || '-')}</div></td>
          <td class="mono">${escapeHtml(policy.policyNumber || '-')}</td>
          <td>${escapeHtml(getCompany(policy) || '-')}</td>
          <td>${escapeHtml(getMediatorPartner(policy) || '-')}</td>
          <td><strong>${escapeHtml(getInternalResponsible(policy) || '-')}</strong></td>
          <td>${escapeHtml(getBranch(policy) || '-')}</td>
          <td>${formatDate(policy.renewalDate || policy.policyDate)}</td>
          <td>${escapeHtml(policy.paymentFrequency || '-')}</td>
          <td class="num">${formatCurrency(getTotalPremium(policy))}</td>
          <td class="num">${formatCurrency(getNetPremium(policy))}</td>
          <td class="num">${Number(policy.commissionRate || 0).toFixed(2)}%</td>
          <td><span class="badge ${statusClass}">${escapeHtml(policy.status || '-')}</span></td>
        </tr>
      `;
    }).join('');

    openPrintableReport(
      'Apolices a gerir',
      `${sortedPolicies.length} apolices filtradas | ${acceptedCount} aceites | ${proposalCount} propostas`,
      `
        <section class="kpis">
          <div class="kpi"><div class="kpi-label">Apolices</div><div class="kpi-value">${sortedPolicies.length}</div></div>
          <div class="kpi"><div class="kpi-label">Premios cliente</div><div class="kpi-value">${formatCurrency(totalPremium)}</div></div>
          <div class="kpi"><div class="kpi-label">Base comissao</div><div class="kpi-value">${formatCurrency(netPremium)}</div></div>
          <div class="kpi"><div class="kpi-label">Comissao estimada</div><div class="kpi-value">${formatCurrency(commissionTotal)}</div></div>
        </section>
        <table>
          <thead>
            <tr>
              <th>Tomador</th><th>Apolice</th><th>Companhia</th><th>Mediador</th><th>Resp.</th><th>Ramo</th><th>Renovacao</th><th>Pag.</th><th class="num">Premio</th><th class="num">Liquido</th><th class="num">Taxa</th><th>Estado</th>
            </tr>
          </thead>
          <tbody>${rowsHtml || '<tr><td colspan="12">Sem apolices para listar.</td></tr>'}</tbody>
        </table>
      `
    );
  };

  const handleExportCommissionPdf = () => {
    const byResponsibleHtml = Object.entries(commissionTotalsByResponsible)
      .sort(([a], [b]) => a.localeCompare(b, 'pt-PT', { sensitivity: 'base' }))
      .map(([responsible, item]) => `
        <div class="kpi">
          <div class="kpi-label">${escapeHtml(responsible)} pendente</div>
          <div class="kpi-value">${formatCurrency(item.pending)}</div>
          <div class="muted">${item.count} linha(s) | selecionado ${formatCurrency(item.selected)}</div>
        </div>
      `).join('');
    const rowsHtml = commissionRows.map(row => `
      <tr>
        <td>${formatDate(row.dueDate)}</td>
        <td><strong>${escapeHtml(row.clientName)}</strong><div class="muted">${escapeHtml(row.policyHolder)}</div></td>
        <td class="mono">${escapeHtml(row.policyNumber)}</td>
        <td>${escapeHtml(row.company)}</td>
        <td>${escapeHtml(row.mediatorPartner)}</td>
        <td><strong>${escapeHtml(row.internalResponsible)}</strong></td>
        <td>${escapeHtml(row.paymentFrequency)}</td>
        <td class="num">${formatCurrency(row.netPremium)}</td>
        <td class="num">${row.commissionRate.toFixed(2)}%</td>
        <td class="num"><strong>${formatCurrency(row.amount)}</strong></td>
        <td><span class="badge ${row.isPaid ? '' : 'gray'}">${row.isPaid ? 'Pago' : 'Pendente'}</span></td>
      </tr>
    `).join('');

    openPrintableReport(
      'Mapa de comissoes por periodo',
      `${formatDate(commissionPeriodStart)} a ${formatDate(commissionPeriodEnd)} | ${commissionRows.length} linha(s)`,
      `
        <section class="kpis">
          <div class="kpi"><div class="kpi-label">Pendente</div><div class="kpi-value">${formatCurrency(commissionTotals.pending)}</div></div>
          <div class="kpi"><div class="kpi-label">Selecionado</div><div class="kpi-value">${formatCurrency(commissionTotals.selected)}</div></div>
          <div class="kpi"><div class="kpi-label">Recebido no mapa</div><div class="kpi-value">${formatCurrency(commissionTotals.paid)}</div></div>
          <div class="kpi"><div class="kpi-label">Linhas pendentes</div><div class="kpi-value">${pendingCommissionRows.length}</div></div>
          ${byResponsibleHtml}
        </section>
        <table>
          <thead>
            <tr>
              <th>Liquidacao</th><th>Cliente / Tomador</th><th>Apolice</th><th>Companhia</th><th>Mediador</th><th>Resp.</th><th>Pag.</th><th class="num">Base</th><th class="num">Taxa</th><th class="num">Comissao</th><th>Estado</th>
            </tr>
          </thead>
          <tbody>${rowsHtml || '<tr><td colspan="11">Sem comissoes para listar.</td></tr>'}</tbody>
        </table>
      `
    );
  };

  const requestSort = (key: SortableKeys) => {
    let direction: 'ascending' | 'descending' = 'ascending';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'ascending') {
      direction = 'descending';
    }
    setSortConfig({ key, direction });
  };

  const SortableHeader = ({ children, sortKey, className = '' }: { children: React.ReactNode, sortKey: SortableKeys, className?: string }) => (
    <th className={`px-4 py-3 cursor-pointer hover:bg-slate-100 ${className}`} onClick={() => requestSort(sortKey)}>
      <div className="flex items-center gap-1">
        {children}
        {sortConfig?.key === sortKey ? (sortConfig.direction === 'ascending' ? <ChevronUp size={14} /> : <ChevronDown size={14} />) : <ChevronUp size={14} className="text-slate-300" />}
      </div>
    </th>
  );

  const selectedCompanyOption = editingPolicy
    ? (isInOptions(editingPolicy.company, COMPANY_OPTIONS)
        ? (editingPolicy.company || '')
        : (editingPolicy.company ? 'Outra' : ''))
    : '';
  const selectedMediatorPartnerOption = editingPolicy
    ? (isInOptions(editingPolicy.mediatorPartner, MEDIATOR_PARTNER_OPTIONS)
        ? (editingPolicy.mediatorPartner || '')
        : (editingPolicy.mediatorPartner ? 'Outra' : ''))
    : '';
  const selectedBranchOption = editingPolicy
    ? (isInOptions(editingPolicy.branch, BRANCH_OPTIONS)
        ? (editingPolicy.branch || '')
        : (editingPolicy.branch ? 'Outros' : ''))
    : '';

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Gestão de Seguros</h2>
          <p className="text-sm text-slate-500">Com tomador, companhia, mediador, responsavel interno, renovacao, ramo e comissao.</p>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <button onClick={handleExportPoliciesPdf} className="bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-slate-50 font-bold shadow-sm">
            <Printer size={18}/> PDF apolices
          </button>
          <button onClick={() => handleOpenModal()} className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 font-bold shadow-sm">
            <Plus size={18}/> Adicionar Seguro
          </button>
        </div>
      </div>

      {canViewCommissionData && (
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-800">Mapa de Comissões por Período</h3>
            <p className="text-xs text-slate-500">
              Gere o período, selecione as comissões recebidas e marque como pagas. As não selecionadas ficam pendentes.
            </p>
          </div>
          <button
            onClick={handleExportCommissionPdf}
            disabled={commissionRows.length === 0}
            className="bg-white text-slate-700 border border-slate-200 px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-slate-50 disabled:opacity-50"
          >
            <Printer size={16} />
            PDF mapa
          </button>
          <button
            onClick={handleGenerateCommissionMap}
            disabled={isGeneratingCommissions}
            className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2 hover:bg-black disabled:opacity-50"
          >
            {isGeneratingCommissions ? <RefreshCcw size={16} className="animate-spin" /> : <PieChart size={16} />}
            Gerar Comissões
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">Período Inicial</label>
            <input
              type="date"
              value={commissionPeriodStart}
              onChange={e => setCommissionPeriodStart(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1">Período Final</label>
            <input
              type="date"
              value={commissionPeriodEnd}
              onChange={e => setCommissionPeriodEnd(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm"
            />
          </div>
          <div className="bg-amber-50 rounded-lg px-3 py-2 border border-amber-100">
            <p className="text-[11px] font-bold uppercase text-amber-700">Pendente no período</p>
            <p className="text-lg font-bold text-amber-800">{commissionTotals.pending.toFixed(2)}€</p>
          </div>
          <div className="bg-blue-50 rounded-lg px-3 py-2 border border-blue-100">
            <p className="text-[11px] font-bold uppercase text-blue-700">Selecionado para pagar</p>
            <p className="text-lg font-bold text-blue-800">{commissionTotals.selected.toFixed(2)}€</p>
          </div>
        </div>

        {commissionRows.length > 0 && (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-3">
            {Object.entries(commissionTotalsByResponsible)
              .sort(([a], [b]) => a.localeCompare(b, 'pt-PT', { sensitivity: 'base' }))
              .map(([responsible, item]) => (
                <div key={responsible} className="bg-slate-50 rounded-lg px-3 py-2 border border-slate-100">
                  <p className="text-[11px] font-bold uppercase text-slate-500">{responsible}</p>
                  <p className="text-lg font-bold text-slate-800">{item.pending.toFixed(2)}€</p>
                  <p className="text-[11px] text-slate-500">{item.count} linha(s) | selecionado {item.selected.toFixed(2)}€</p>
                </div>
              ))}
          </div>
        )}

        {commissionRows.length > 0 ? (
          <>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2 text-xs text-slate-600">
              <div>
                Registos pendentes: <span className="font-bold text-amber-700">{pendingCommissionRows.length}</span>
              </div>
              <button
                onClick={handleMarkSelectedCommissionsAsPaid}
                disabled={isMarkingCommissionsPaid || selectedCommissionRows.length === 0}
                className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-emerald-700 disabled:opacity-50"
              >
                {isMarkingCommissionsPaid ? 'A marcar...' : `Marcar ${selectedCommissionRows.length} como pagas`}
              </button>
            </div>

            <div className="overflow-x-auto border border-slate-100 rounded-lg">
              <table className="w-full text-sm text-left">
                <thead className="text-xs text-slate-500 uppercase bg-slate-50">
                  <tr>
                    <th className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        checked={allPendingSelected}
                        onChange={toggleAllPendingCommissions}
                        className="rounded"
                        aria-label="Selecionar comissões pendentes"
                      />
                    </th>
                    <th className="px-3 py-2">Liquidação</th>
                    <th className="px-3 py-2">Cliente / Tomador</th>
                    <th className="px-3 py-2">Apólice</th>
                    <th className="px-3 py-2">Companhia</th>
                    <th className="px-3 py-2">Resp.</th>
                    <th className="px-3 py-2">Fracionamento</th>
                    <th className="px-3 py-2 text-right">Base</th>
                    <th className="px-3 py-2 text-right">Taxa</th>
                    <th className="px-3 py-2 text-right">Comissão</th>
                    <th className="px-3 py-2 text-center">Estado</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {commissionRows.map(row => {
                    const isSelected = selectedCommissionRowKeys.includes(row.key);
                    return (
                      <tr key={row.key} className={row.isPaid ? 'bg-emerald-50/50' : 'hover:bg-slate-50'}>
                        <td className="px-3 py-2 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleCommissionRowSelection(row.key)}
                            disabled={row.isPaid}
                            className="rounded"
                            aria-label={`Selecionar comissão ${row.clientName}`}
                          />
                        </td>
                        <td className="px-3 py-2 text-xs">{new Date(`${row.dueDate}T00:00:00`).toLocaleDateString('pt-PT')}</td>
                        <td className="px-3 py-2">
                          <div className="font-semibold text-slate-700">{row.clientName}</div>
                          <div className="text-[11px] text-slate-400">{row.policyHolder}</div>
                        </td>
                        <td className="px-3 py-2 text-xs font-mono">{row.policyNumber}</td>
                        <td className="px-3 py-2 text-xs">{row.company}</td>
                        <td className="px-3 py-2 text-xs font-bold text-slate-700">{row.internalResponsible}</td>
                        <td className="px-3 py-2 text-xs">{row.paymentFrequency}</td>
                        <td className="px-3 py-2 text-right text-xs">{row.netPremium.toFixed(2)}€</td>
                        <td className="px-3 py-2 text-right text-xs">{row.commissionRate.toFixed(2)}%</td>
                        <td className="px-3 py-2 text-right font-bold">{row.amount.toFixed(2)}€</td>
                        <td className="px-3 py-2 text-center">
                          <span className={`inline-flex items-center px-2 py-1 rounded-full text-[11px] font-bold ${row.isPaid ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                            {row.isPaid ? 'Pago' : 'Pendente'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="text-sm italic text-slate-400 border border-dashed border-slate-200 rounded-lg p-4">
            {hasGeneratedCommissions
              ? 'Não foram encontradas comissões para este período com os seguros atuais.'
              : 'Gere um período para listar comissões a receber e controlar os pagamentos.'}
          </div>
        )}
      </div>
      )}

      {canViewCommissionData && (
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-4">
        <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-slate-800">Histórico de Comissões Pagas</h3>
            <p className="text-xs text-slate-500">
              Registo das comissões já liquidadas, com data de liquidação e referência da apólice.
            </p>
          </div>
          <button
            onClick={loadPaidCommissionHistory}
            disabled={isLoadingPaidCommissionHistory}
            className="bg-slate-100 text-slate-700 px-4 py-2 rounded-lg text-sm font-bold hover:bg-slate-200 disabled:opacity-50 flex items-center gap-2"
          >
            {isLoadingPaidCommissionHistory ? <RefreshCcw size={16} className="animate-spin" /> : <RefreshCcw size={16} />}
            Atualizar Histórico
          </button>
        </div>

        {paidCommissionHistoryError && (
          <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
            {paidCommissionHistoryError}
          </div>
        )}

        <div className="text-xs text-slate-600">
          Registos: <span className="font-bold">{paidCommissionHistoryRows.length}</span> | Total liquidado: <span className="font-bold text-green-700">{paidCommissionHistoryTotal.toFixed(2)}€</span>
        </div>

        {paidCommissionHistoryRows.length > 0 ? (
          <div className="overflow-x-auto border border-slate-100 rounded-lg">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-500 uppercase bg-slate-50">
                <tr>
                  <th className="px-3 py-2">Pago em</th>
                  <th className="px-3 py-2">Liquidação</th>
                  <th className="px-3 py-2">Cliente / Tomador</th>
                  <th className="px-3 py-2">Apólice</th>
                  <th className="px-3 py-2">Companhia</th>
                  <th className="px-3 py-2">Fracionamento</th>
                  <th className="px-3 py-2 text-right">Comissão</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {paidCommissionHistoryRows.map(row => (
                  <tr key={row.id} className="hover:bg-slate-50">
                    <td className="px-3 py-2 text-xs">{new Date(row.paidAt).toLocaleString('pt-PT')}</td>
                    <td className="px-3 py-2 text-xs">{new Date(`${row.dueDate}T00:00:00`).toLocaleDateString('pt-PT')}</td>
                    <td className="px-3 py-2">
                      <div className="font-semibold text-slate-700">{row.clientName}</div>
                      <div className="text-[11px] text-slate-400">{row.policyHolder}</div>
                    </td>
                    <td className="px-3 py-2 text-xs font-mono">{row.policyNumber}</td>
                    <td className="px-3 py-2 text-xs">{row.company}</td>
                    <td className="px-3 py-2 text-xs">{row.paymentFrequency}</td>
                    <td className="px-3 py-2 text-right font-bold text-green-700">{row.amount.toFixed(2)}€</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="text-sm italic text-slate-400 border border-dashed border-slate-200 rounded-lg p-4">
            Ainda não existem comissões marcadas como pagas.
          </div>
        )}
      </div>
      )}

      <div className={`grid grid-cols-1 ${canViewCommissionData ? 'md:grid-cols-3' : 'md:grid-cols-1'} gap-6`}>
        {canViewCommissionData && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
            <p className="text-sm font-medium text-amber-600">Comissoes Pendentes</p>
            <h3 className="text-2xl font-bold text-slate-800 mt-1">{totals.pending.toFixed(2)}{'\u20AC'}</h3>
          </div>
        )}
        {canViewCommissionData && (
          <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
            <p className="text-sm font-medium text-green-600">Comissoes Recebidas (Total)</p>
            <h3 className="text-2xl font-bold text-slate-800 mt-1">{totals.paid.toFixed(2)}{'\u20AC'}</h3>
          </div>
        )}
        <div onClick={() => setIsQuarterlyModalOpen(true)} className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 cursor-pointer hover:bg-slate-50">
          <p className="text-sm font-medium text-blue-600 flex items-center gap-1">Total Premios (Cliente Paga) <PieChart size={14}/></p>
          <h3 className="text-2xl font-bold text-slate-800 mt-1">{totals.totalPremiumGross.toFixed(2)}{'\u20AC'}</h3>
          {canViewCommissionData && (
            <p className="text-xs text-slate-500 mt-1">Liquido base comissao: {totals.totalPremiumNet.toFixed(2)}{'\u20AC'}</p>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-4 border-b flex flex-wrap gap-3">
            <div className="relative flex-[1_1_260px] min-w-[220px]">
                <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-slate-400" size={16} />
                <input type="text" placeholder="Pesquisar tomador, companhia, mediador, responsavel ou apolice..." value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm" />
            </div>
            <select value={mediatorPartnerFilter} onChange={e => setMediatorPartnerFilter(e.target.value)} className="flex-[1_1_190px] min-w-[180px] px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
                <option value="all">Todos os Mediadores</option>
                {uniqueMediatorPartners.map(mediator => <option key={mediator} value={mediator}>{mediator}</option>)}
            </select>
            <select value={internalResponsibleFilter} onChange={e => setInternalResponsibleFilter(e.target.value)} className="flex-[1_1_190px] min-w-[180px] px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
                <option value="all">Todos os Responsaveis</option>
                {uniqueInternalResponsibles.map(responsible => <option key={responsible} value={responsible}>{responsible}</option>)}
            </select>
            <select value={companyFilter} onChange={e => setCompanyFilter(e.target.value)} className="flex-[1_1_190px] min-w-[180px] px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
                <option value="all">Todas as Companhias</option>
                {uniqueCompanies.map(company => <option key={company} value={company}>{company}</option>)}
            </select>
            <select value={policyStatusFilter} onChange={e => setPolicyStatusFilter(e.target.value)} className="flex-[1_1_190px] min-w-[180px] px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
                <option value="all">Todos os Estados da Apolice</option>
                <option value="Proposta">Proposta</option>
                <option value="Aceite">Aceite</option>
                <option value="Cancelada">Cancelada</option>
            </select>
            <select value={statusFilter} onChange={e => setStatusFilter(e.target.value)} className="flex-[1_1_190px] min-w-[180px] px-3 py-2 border border-slate-200 rounded-lg text-sm bg-white">
                <option value="all">Com recibo e sem recibo</option>
                <option value="paid">Com recibo</option>
                <option value="pending">Sem recibo</option>
            </select>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1480px] text-sm text-left table-fixed">
            <colgroup>
              <col className="w-[270px]" />
              <col className="w-[220px]" />
              <col className="w-[140px]" />
              <col className="w-[145px]" />
              <col className="w-[125px]" />
              <col className="w-[130px]" />
              <col className="w-[135px]" />
              <col className="w-[150px]" />
              <col className="w-[120px]" />
              <col className="w-[105px]" />
            </colgroup>
            <thead className="text-xs text-slate-500 uppercase bg-slate-50">
              <tr>
                <SortableHeader sortKey="policyHolder">Tomador</SortableHeader>
                <SortableHeader sortKey="policyNumber">Apolice</SortableHeader>
                <SortableHeader sortKey="company">Companhia</SortableHeader>
                <SortableHeader sortKey="mediatorPartner">Mediador</SortableHeader>
                <SortableHeader sortKey="internalResponsible">Responsavel</SortableHeader>
                <SortableHeader sortKey="renewalDate">Renovacao</SortableHeader>
                <SortableHeader sortKey="branch">Ramo</SortableHeader>
                <SortableHeader sortKey="communicationType">Comunicacao</SortableHeader>
                <SortableHeader sortKey="status" className="text-center">Estado</SortableHeader>
                <th className="px-4 py-3 text-center sticky right-0 bg-slate-50 z-10 shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]">Acoes</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {sortedPolicies.map(p => {
                const branch = getBranch(p);
                const policyHolder = getPolicyHolder(p);
                const company = getCompany(p);
                const mediatorPartner = getMediatorPartner(p);
                const internalResponsible = getInternalResponsible(p);
                const communicationType = p.communicationType || '';
                return (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3 text-xs truncate" title={policyHolder || '-'}>{policyHolder || '-'}</td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800 font-mono text-xs">{p.policyNumber || '-'}</div>
                      <div className="text-[11px] text-slate-400 truncate" title={p.clientName || '-'}>{p.clientName || '-'}</div>
                    </td>
                    <td className="px-4 py-3 text-xs truncate" title={company || '-'}>{company || '-'}</td>
                    <td className="px-4 py-3 text-xs truncate" title={mediatorPartner || '-'}>{mediatorPartner || '-'}</td>
                    <td className="px-4 py-3 text-xs font-bold text-slate-700 whitespace-nowrap">{internalResponsible || '-'}</td>
                    <td className="px-4 py-3 text-xs whitespace-nowrap">{p.renewalDate ? new Date(p.renewalDate).toLocaleDateString('pt-PT') : '-'}</td>
                    <td className="px-4 py-3 text-xs truncate" title={branch || '-'}>{branch || '-'}</td>
                    <td className="px-4 py-3 text-xs truncate" title={communicationType || '-'}>{communicationType || '-'}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-flex items-center gap-1 text-xs font-bold px-2 py-1 rounded-full ${p.status === 'Aceite' ? 'bg-green-100 text-green-700' : p.status === 'Cancelada' ? 'bg-red-100 text-red-700' : 'bg-gray-100 text-gray-600'}`}>
                        {p.status === 'Aceite' ? <FileCheck size={14}/> : <FileClock size={14}/>}
                        {p.status}
                      </span>
                    </td>
                    <td className="px-3 py-3 sticky right-0 bg-white z-10 shadow-[-8px_0_12px_-12px_rgba(15,23,42,0.45)]">
                      <div className="flex items-center justify-center gap-1">
                        {p.attachment_url && (
                          <a href={p.attachment_url} target="_blank" rel="noopener noreferrer" title="Ver Anexo" className="p-2 text-slate-400 hover:text-blue-600 inline-flex">
                            <Paperclip size={14}/>
                          </a>
                        )}
                        <button type="button" title="Editar" onClick={() => handleOpenModal(p)} className="p-2 text-slate-400 hover:text-blue-600"><Edit2 size={14}/></button>
                        <button type="button" title="Apagar" onClick={() => handleDelete(p.id)} className="p-2 text-slate-400 hover:text-red-600"><Trash2 size={14}/></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {sortedPolicies.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center italic text-slate-400 py-10">Nenhuma apolice encontrada.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {isModalOpen && editingPolicy && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <form onSubmit={handleSave} className="bg-white rounded-xl shadow-xl w-full max-w-2xl p-6 space-y-4">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">{editingPolicy.id ? 'Editar Apólice' : 'Nova Apólice de Seguro'}</h3>
              <button type="button" onClick={() => setIsModalOpen(false)}><X size={20} /></button>
            </div>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">
                  {(forcedAgent || editingPolicy.internalResponsible || editingPolicy.agent) === 'Paula' ? 'Cliente' : 'Cliente*'}
                </label>
                <select value={editingPolicy.clientId || ''} onChange={e => {
                  const clientId = e.target.value || undefined;
                  const selectedClientName = sortedClients.find(client => client.id === clientId)?.name || '';
                  const nextPolicy: Partial<InsurancePolicy> = {
                    ...editingPolicy,
                    clientId,
                  };
                  if (selectedClientName) {
                    nextPolicy.policyHolder = selectedClientName;
                  }
                  setEditingPolicy(nextPolicy);
                }} className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
                  <option value="">
                    {(forcedAgent || editingPolicy.internalResponsible || editingPolicy.agent) === 'Paula' ? 'Sem cliente (tomador manual)' : 'Selecione um cliente'}
                  </option>
                  {sortedClients.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Tomador</label>
                <input
                  type="text"
                  value={editingPolicy.policyHolder || ''}
                  onChange={e => setEditingPolicy({ ...editingPolicy, policyHolder: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  placeholder="Por defeito igual ao cliente"
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Responsavel interno*</label>
                {forcedAgent ? (
                  <input type="text" value={forcedAgent} readOnly className="w-full px-3 py-2 border rounded-lg text-sm bg-slate-100 text-slate-600" />
                ) : (
                  <select value={editingPolicy.internalResponsible || editingPolicy.agent || 'MPR'} onChange={e => setEditingPolicy({...editingPolicy, agent: e.target.value as InsurancePolicy['agent'], internalResponsible: e.target.value as InsurancePolicy['internalResponsible']})} className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
                    <option value="MPR">MPR</option>
                    <option value="Paula">Paula</option>
                  </select>
                )}
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Data da Apólice*</label>
                <input type="date" required value={editingPolicy.policyDate} onChange={e => setEditingPolicy({...editingPolicy, policyDate: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Data de Renovação*</label>
                <input type="date" required value={editingPolicy.renewalDate || ''} onChange={e => setEditingPolicy({...editingPolicy, renewalDate: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Nº da Apólice</label>
                <input type="text" value={editingPolicy.policyNumber || ''} onChange={e => setEditingPolicy({...editingPolicy, policyNumber: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Mediador / Parceiro*</label>
                <select
                  required
                  value={selectedMediatorPartnerOption}
                  onChange={e => {
                    const value = e.target.value;
                    setEditingPolicy({ ...editingPolicy, mediatorPartner: value });
                    if (value !== 'Outra') setCustomMediatorPartner('');
                  }}
                  className="w-full px-3 py-2 border rounded-lg text-sm bg-white"
                >
                  <option value="">Selecione o mediador</option>
                  {MEDIATOR_PARTNER_OPTIONS.map(mediator => (
                    <option key={mediator} value={mediator}>{mediator}</option>
                  ))}
                </select>
                {selectedMediatorPartnerOption === 'Outra' && (
                  <input
                    type="text"
                    value={customMediatorPartner}
                    onChange={e => setCustomMediatorPartner(e.target.value)}
                    className="w-full mt-2 px-3 py-2 border rounded-lg text-sm"
                    placeholder="Escreva o mediador"
                  />
                )}
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Companhia*</label>
                <select
                  required
                  value={selectedCompanyOption}
                  onChange={e => {
                    const value = e.target.value;
                    setEditingPolicy({ ...editingPolicy, company: value, insuranceProvider: value });
                    if (value !== 'Outra') setCustomCompany('');
                  }}
                  className="w-full px-3 py-2 border rounded-lg text-sm bg-white"
                >
                  <option value="">Selecione a companhia</option>
                  {COMPANY_OPTIONS.map(company => (
                    <option key={company} value={company}>{company}</option>
                  ))}
                </select>
                {selectedCompanyOption === 'Outra' && (
                  <input
                    type="text"
                    value={customCompany}
                    onChange={e => setCustomCompany(e.target.value)}
                    className="w-full mt-2 px-3 py-2 border rounded-lg text-sm"
                    placeholder="Escreva a companhia"
                  />
                )}
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Ramo*</label>
                <select
                  required
                  value={selectedBranchOption}
                  onChange={e => {
                    const value = e.target.value;
                    setEditingPolicy({ ...editingPolicy, branch: value, policyType: value });
                    if (value !== 'Outros') setCustomBranch('');
                  }}
                  className="w-full px-3 py-2 border rounded-lg text-sm bg-white"
                >
                  <option value="">Selecione o ramo</option>
                  {BRANCH_OPTIONS.map(branch => (
                    <option key={branch} value={branch}>{branch}</option>
                  ))}
                </select>
                {selectedBranchOption === 'Outros' && (
                  <input
                    type="text"
                    value={customBranch}
                    onChange={e => setCustomBranch(e.target.value)}
                    className="w-full mt-2 px-3 py-2 border rounded-lg text-sm"
                    placeholder="Escreva o ramo"
                  />
                )}
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Pagamento</label>
                <select value={editingPolicy.paymentFrequency} onChange={e => setEditingPolicy({...editingPolicy, paymentFrequency: e.target.value as any})} className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
                  <option>Anual</option>
                  <option>Semestral</option>
                  <option>Trimestral</option>
                  <option>Mensal</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Estado da Apólice*</label>
                <select required value={editingPolicy.status || 'Proposta'} onChange={e => setEditingPolicy({...editingPolicy, status: e.target.value as any})} className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
                  <option value="Proposta">Proposta</option>
                  <option value="Aceite">Aceite</option>
                  <option value="Cancelada">Cancelada</option>
                </select>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-slate-500 mb-1">Tipo*</label>
                <select
                  required
                  value={editingPolicy.policyTier || 'Base'}
                  onChange={e => setEditingPolicy({ ...editingPolicy, policyTier: e.target.value as InsurancePolicy['policyTier'] })}
                  className="w-full px-3 py-2 border rounded-lg text-sm bg-white"
                >
                  <option value="Base">Base</option>
                  <option value="Flexível">Flexível</option>
                </select>
              </div>
              <div className="md:col-span-2 grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">Prémio Total (€)</label>
                  <input type="number" step="0.01" value={getTotalPremium(editingPolicy)} onChange={e => { const value = parseFloat(e.target.value) || 0; setEditingPolicy({...editingPolicy, premiumValue: value}); }} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">Prémio Líquido (€)</label>
                  <input type="number" step="0.01" value={getNetPremium(editingPolicy)} onChange={e => { const value = parseFloat(e.target.value) || 0; setEditingPolicy({...editingPolicy, netPremiumValue: value}); }} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
              </div>
              <div className="md:col-span-2 grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">Taxa de Comissão (%)</label>
                  <input type="number" step="0.1" value={editingPolicy.commissionRate} onChange={e => setEditingPolicy({...editingPolicy, commissionRate: parseFloat(e.target.value) || 0})} className="w-full px-3 py-2 border rounded-lg text-sm" />
                </div>
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 pt-6">
                  <input
                    type="checkbox"
                    checked={Boolean(editingPolicy.hasReceipt)}
                    onChange={e => setEditingPolicy({ ...editingPolicy, hasReceipt: e.target.checked })}
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Com recibo
                </label>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-slate-500 mb-1">Tipo de Comunicação</label>
                <input type="text" value={editingPolicy.communicationType || ''} onChange={e => setEditingPolicy({...editingPolicy, communicationType: e.target.value})} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="Ex: Via Mediador"/>
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-slate-500 mb-1">Observações</label>
                <textarea
                  rows={3}
                  value={editingPolicy.notes || ''}
                  onChange={e => setEditingPolicy({ ...editingPolicy, notes: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg text-sm"
                  placeholder="Notas internas sobre esta apólice"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-xs font-bold text-slate-500 mb-1">Anexo (Apólice)</label>
                <input
                  type="file"
                  onChange={(e) => setSelectedFile(e.target.files ? e.target.files[0] : null)}
                  className="w-full text-sm text-slate-500 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
                />
                {editingPolicy.attachment_url && !selectedFile && (
                  <div className="mt-2 text-xs">
                    Ficheiro atual: <a href={editingPolicy.attachment_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">{editingPolicy.attachment_url.split('/').pop()}</a>
                  </div>
                )}
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-4 border-t">
              <button type="button" onClick={() => setIsModalOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">Cancelar</button>
              <button type="submit" disabled={isSaving} className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2 disabled:opacity-50">
                {isSaving ? <RefreshCcw size={16} className="animate-spin" /> : <Save size={16} />} Salvar
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Quarterly Breakdown Modal */}
      {isQuarterlyModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setIsQuarterlyModalOpen(false)}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6" onClick={e => e.stopPropagation()}>
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Prémios Totais por Trimestre</h3>
              <button type="button" onClick={() => setIsQuarterlyModalOpen(false)}><X size={20} /></button>
            </div>
            <div className="space-y-3">
              {Object.entries(quarterlyPremiums).map(([quarter, value]) => (
                <div key={quarter} className="flex justify-between items-center bg-slate-50 p-3 rounded-lg">
                  <span className="font-bold text-slate-600">{quarter}</span>
                  <span className="font-bold text-blue-600 text-lg">{value.toFixed(2)}€</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Insurance;
