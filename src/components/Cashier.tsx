import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Client, FeeGroup, CashPayment, CashAgreement, CashOperation } from '../types';
import { cashPaymentService, cashAgreementService, cashOperationService } from '../services';
import { Landmark, Check, X, Save, RefreshCcw, DollarSign, Banknote, Download, History, CreditCard, Plus } from 'lucide-react';
import { ClientPaymentPlan, PlanFormState } from '../types/cashier';
import { useCashierExpenses } from '../hooks/useCashierExpenses';
import CashierReport from './cashier/CashierReport';
import CashierHistory from './cashier/CashierHistory';
import PlanModal from './cashier/PlanModal';
import ExpenseModal from './cashier/ExpenseModal';

interface CashierProps {
  clients: Client[];
  groups: FeeGroup[];
  cashPayments: CashPayment[];
  setCashPayments: (payments: CashPayment[]) => void;
  cashAgreements: CashAgreement[];
  setCashAgreements: React.Dispatch<React.SetStateAction<CashAgreement[]>>;
  cashOperations: CashOperation[];
  setCashOperations: (operations: CashOperation[]) => void;
}

const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const vatMultiplier = 1.23;
const AGREEMENT_PAYMENT_MONTH_START = 100;

const isAgreementPaymentMonth = (month: number | undefined) => Number(month || 0) >= AGREEMENT_PAYMENT_MONTH_START;
const getPaymentReferenceLabel = (month: number) => (
  isAgreementPaymentMonth(month) ? 'Acordo divida antiga' : months[month - 1] || `Ref. ${month}`
);

const buildPlanKey = (clientId: string, year: number) => `${clientId}-${year}`;

const Cashier: React.FC<CashierProps> = ({ clients, groups, cashPayments, setCashPayments, cashAgreements, setCashAgreements, cashOperations, setCashOperations }) => {
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [pendingChanges, setPendingChanges] = useState<Map<string, Partial<CashPayment>>>(new Map());
  const [isSaving, setIsSaving] = useState(false);
  const [view, setView] = useState<'main' | 'report' | 'history'>('main');
  const [paymentMode, setPaymentMode] = useState<'Numerário' | 'MB Way'>('Numerário');
  const [activeReport, setActiveReport] = useState<CashOperation | null>(null);

  const {
    isExpenseModalOpen,
    setIsExpenseModalOpen,
    newExpense,
    setNewExpense,
    sessionExpenses,
    totalSessionExpenses,
    handleAddExpense,
    handleRemoveExpense,
    resetSessionExpenses,
  } = useCashierExpenses();

  // Form state for closing the register
  const [depositAmount, setDepositAmount] = useState('');
  const [mbWayDepositAmount, setMbWayDepositAmount] = useState('');
  const [isDepositAmountEdited, setIsDepositAmountEdited] = useState(false);
  const [isMbWayDepositAmountEdited, setIsMbWayDepositAmountEdited] = useState(false);
  const [adjustmentAmount, setAdjustmentAmount] = useState('');
  const [isPlanModalOpen, setIsPlanModalOpen] = useState(false);
  const [isSavingPlan, setIsSavingPlan] = useState(false);
  const [selectedPlanClient, setSelectedPlanClient] = useState<Client | null>(null);
  const [planForm, setPlanForm] = useState<PlanFormState>({
    monthlyAmount: '',
    debtAmount: '',
    payUntilMonth: 12,
    payUntilYear: new Date().getFullYear(),
    notes: '',
    called: false,
    letterSent: false,
  });

  const cashGroup = useMemo(() => groups.find(g => g.name.toLowerCase().includes('pagamento numerário')), [groups]);
  const groupClients = useMemo(() => {
    if (!cashGroup) return [];
    return clients
      .filter(c => cashGroup.clientIds.includes(c.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, cashGroup]);

  const agreementsMap = useMemo(() => {
    return new Map(
      cashAgreements
        .filter(agreement => agreement.agreementYear === currentYear)
        .map(agreement => [buildPlanKey(agreement.clientId, agreement.agreementYear), agreement])
    );
  }, [cashAgreements, currentYear]);

  const getClientPlan = useCallback((clientId: string) => {
    const agreementForCurrentYear = agreementsMap.get(buildPlanKey(clientId, currentYear));
    const latestPreviousActiveAgreement = cashAgreements
      .filter(agreement =>
        agreement.clientId === clientId &&
        agreement.agreementYear < currentYear &&
        agreement.status === 'Ativo' &&
        agreement.debtAmount > 0
      )
      .sort((a, b) => {
        if (a.agreementYear !== b.agreementYear) return b.agreementYear - a.agreementYear;
        return (b.updatedAt || '').localeCompare(a.updatedAt || '');
      })[0];

    const agreement = agreementForCurrentYear || latestPreviousActiveAgreement;
    if (!agreement) return undefined;

    return {
      id: agreement.id,
      clientId: agreement.clientId,
      year: agreement.agreementYear,
      paidUntilMonth: agreement.paidUntilMonth,
      monthlyAmount: agreement.monthlyAmount,
      debtAmount: agreement.debtAmount,
      status: agreement.status,
      notes: agreement.notes,
      called: agreement.called,
      letterSent: agreement.letterSent,
      createdAt: agreement.createdAt,
      updatedAt: agreement.updatedAt,
    } as ClientPaymentPlan;
  }, [agreementsMap, currentYear, cashAgreements]);

  const getMonthAmount = useCallback((client: Client, monthNumber: number) => {
    const plan = getClientPlan(client.id);
    if (plan && currentYear === plan.year && monthNumber <= plan.paidUntilMonth) {
      return plan.monthlyAmount;
    }
    return client.monthlyFee * vatMultiplier;
  }, [getClientPlan, currentYear]);

  const plansForCurrentYear = useMemo(() => {
    return groupClients
      .map(client => ({ client, plan: getClientPlan(client.id) }))
      .filter((entry): entry is { client: Client; plan: ClientPaymentPlan } => Boolean(entry.plan));
  }, [groupClients, getClientPlan]);

  const selectedClientPlan = useMemo(() => {
    if (!selectedPlanClient) return null;
    return getClientPlan(selectedPlanClient.id) || null;
  }, [currentYear, getClientPlan, selectedPlanClient]);

  const paymentsMap = useMemo(() => {
    const map = new Map<string, Map<number, CashPayment>>();
    // Start with DB payments
    cashPayments.filter(p => p.paymentYear === currentYear).forEach(p => {
      if (!map.has(p.clientId)) map.set(p.clientId, new Map());
      map.get(p.clientId)!.set(p.paymentMonth, p as CashPayment);
    });
    // Override with pending changes
    pendingChanges.forEach((change) => {
      if (change.clientId && change.paymentMonth && change.paymentYear === currentYear) {
        if (!map.has(change.clientId)) map.set(change.clientId, new Map());
        map.get(change.clientId)!.set(change.paymentMonth, change as CashPayment);
      }
    });
    return map;
  }, [cashPayments, pendingChanges, currentYear]);

  const consolidatedPayments = useMemo(() => {
    const map = new Map<string, Partial<CashPayment>>();
    cashPayments.forEach(payment => {
      map.set(`${payment.clientId}-${payment.paymentYear}-${payment.paymentMonth}`, payment);
    });
    pendingChanges.forEach((change, key) => {
      map.set(key, change);
    });
    return map;
  }, [cashPayments, pendingChanges]);

  const { cashInHand, mbWayInHand } = useMemo(() => {
    let cashTotal = 0;
    let mbWayTotal = 0;

    consolidatedPayments.forEach(payment => {
      // Only sum payments that are not yet processed and not marked for deletion
      if (!payment.cashOperationId && payment.amountPaid !== -1) {
        if (payment.paymentMethod === 'Numerário') {
          cashTotal += payment.amountPaid || 0;
        } else if (payment.paymentMethod === 'MB Way') {
          mbWayTotal += payment.amountPaid || 0;
        }
      }
    });

    return { cashInHand: cashTotal, mbWayInHand: mbWayTotal };
  }, [consolidatedPayments]);

  useEffect(() => {
    if (!isDepositAmountEdited) {
      const parsedAdjustment = parseFloat(adjustmentAmount) || 0;
      const suggestedDeposit = cashInHand - totalSessionExpenses - parsedAdjustment;
      setDepositAmount(suggestedDeposit.toFixed(2));
    }
  }, [cashInHand, totalSessionExpenses, adjustmentAmount, isDepositAmountEdited]);

  useEffect(() => {
    if (!isMbWayDepositAmountEdited) {
      setMbWayDepositAmount(mbWayInHand.toFixed(2));
    }
  }, [mbWayInHand, isMbWayDepositAmountEdited]);

  const agreementDebtByClient = useMemo(() => {
    const debtMap = new Map<string, { debtConfigured: number; paidTotal: number; debt: number }>();

    groupClients.forEach(client => {
      const agreement = getClientPlan(client.id);
      if (!agreement) return;

      let paidTotal = 0;

      consolidatedPayments.forEach(payment => {
        if (
          payment.clientId !== client.id ||
          payment.paymentYear !== currentYear ||
          payment.amountPaid === -1
        ) {
          return;
        }

        const paymentMonth = Number(payment.paymentMonth || 0);
        const isLegacyAgreementPayment =
          paymentMonth >= 1 &&
          paymentMonth <= agreement.paidUntilMonth &&
          (
            agreement.year === currentYear ||
            Number(payment.amountPaid || 0) <= agreement.monthlyAmount
          );

        if (isAgreementPaymentMonth(paymentMonth) || isLegacyAgreementPayment) {
          paidTotal += payment.amountPaid || 0;
        }
      });

      debtMap.set(client.id, {
        debtConfigured: agreement.debtAmount,
        paidTotal,
        debt: Math.max(0, agreement.debtAmount - paidTotal),
      });
    });

    return debtMap;
  }, [groupClients, getClientPlan, consolidatedPayments, currentYear]);

  const getDisplayedPlanStatus = useCallback(
    (plan: ClientPaymentPlan, debt: number): 'Ativo' | 'Anulado' | 'Concluido' => {
      if (plan.status === 'Anulado') return 'Anulado';
      if (debt <= 0) return 'Concluido';
      return 'Ativo';
    },
    []
  );

  const activePlansForCurrentYear = useMemo(() => {
    return plansForCurrentYear.filter(({ client, plan }) => {
      const debt = agreementDebtByClient.get(client.id)?.debt || 0;
      return getDisplayedPlanStatus(plan, debt) === 'Ativo';
    });
  }, [plansForCurrentYear, agreementDebtByClient, getDisplayedPlanStatus]);

  const resetPlanFormSelection = useCallback(() => {
    setSelectedPlanClient(null);
    setPlanForm({
      monthlyAmount: '',
      debtAmount: '',
      payUntilMonth: 12,
      payUntilYear: currentYear,
      notes: '',
      called: false,
      letterSent: false,
    });
  }, [currentYear]);

  const fillPlanFormForClient = useCallback((client: Client) => {
    const existingPlan = getClientPlan(client.id);
    const defaultMonthlyAmount = client.monthlyFee * vatMultiplier;
    const defaultPaidUntilMonth = 12;
    const defaultPaidUntilYear = currentYear;
    const monthlyAmount = existingPlan ? existingPlan.monthlyAmount : defaultMonthlyAmount;
    const paidUntilMonth = existingPlan?.paidUntilMonth || defaultPaidUntilMonth;
    const paidUntilYear = existingPlan?.year || defaultPaidUntilYear;
    const debtAmount = existingPlan ? existingPlan.debtAmount : monthlyAmount * paidUntilMonth;

    setSelectedPlanClient(client);
    setPlanForm({
      monthlyAmount: monthlyAmount.toFixed(2),
      debtAmount: debtAmount.toFixed(2),
      payUntilMonth: paidUntilMonth,
      payUntilYear: paidUntilYear,
      notes: existingPlan?.notes || '',
      called: existingPlan?.called || false,
      letterSent: existingPlan?.letterSent || false,
    });
  }, [currentYear, getClientPlan]);

  const handleOpenPlanModal = (client?: Client) => {
    if (client) {
      fillPlanFormForClient(client);
    } else {
      resetPlanFormSelection();
    }
    setIsPlanModalOpen(true);
  };

  const handlePlanClientChange = (clientId: string) => {
    const client = groupClients.find(c => c.id === clientId);
    if (!client) {
      resetPlanFormSelection();
      return;
    }
    fillPlanFormForClient(client);
  };

  const handleSavePlan = async () => {
    if (!selectedPlanClient) {
      alert('Selecione um cliente para criar o acordo.');
      return;
    }

    const monthlyAmount = parseFloat(planForm.monthlyAmount);
    const debtAmount = parseFloat(planForm.debtAmount);
    if (!Number.isFinite(monthlyAmount) || monthlyAmount <= 0) {
      alert('Indique um valor mensal valido para o acordo.');
      return;
    }
    if (!Number.isFinite(debtAmount) || debtAmount < 0) {
      alert('Indique um valor de divida valido para o acordo.');
      return;
    }

    const paidUntilMonth = Math.min(12, Math.max(1, Number(planForm.payUntilMonth) || 12));
    const paidUntilYear = Math.min(3000, Math.max(2000, Number(planForm.payUntilYear) || currentYear));
    const existingPlan = getClientPlan(selectedPlanClient.id);
    const isChangingYear = Boolean(existingPlan && existingPlan.year !== paidUntilYear);
    const previousPlanId = existingPlan?.id;
    const nextStatus =
      existingPlan?.status === 'Anulado'
        ? 'Anulado'
        : debtAmount <= 0
          ? 'Concluido'
          : 'Ativo';

    try {
      setIsSavingPlan(true);
      const savedAgreement = await cashAgreementService.upsert({
        id: isChangingYear ? undefined : existingPlan?.id,
        clientId: selectedPlanClient.id,
        agreementYear: paidUntilYear,
        paidUntilMonth,
        monthlyAmount,
        debtAmount,
        status: nextStatus,
        notes: planForm.notes.trim(),
        called: planForm.called,
        letterSent: planForm.letterSent,
      });

      // If the agreement moved to another year, remove the previous row to avoid duplicates.
      if (isChangingYear && previousPlanId && previousPlanId !== savedAgreement.id) {
        try {
          await cashAgreementService.delete(previousPlanId);
        } catch (cleanupError) {
          console.error('Erro ao remover acordo antigo apos alterar o ano:', cleanupError);
        }
      }

      setCashAgreements(prev => {
        const next = prev.filter(a =>
          a.id !== savedAgreement.id &&
          a.id !== previousPlanId &&
          !(a.clientId === savedAgreement.clientId && a.agreementYear === savedAgreement.agreementYear)
        );
        return [...next, savedAgreement];
      });

      setIsPlanModalOpen(false);
      resetPlanFormSelection();
    } catch (err: any) {
      alert('Erro ao guardar acordo: ' + err.message);
    } finally {
      setIsSavingPlan(false);
    }
  };

  const handleSetPlanStatus = async (client: Client, status: 'Ativo' | 'Anulado' | 'Concluido') => {
    const existingPlan = getClientPlan(client.id);
    if (!existingPlan?.id) return;

    try {
      setIsSavingPlan(true);
      const savedAgreement = await cashAgreementService.upsert({
        id: existingPlan.id,
        clientId: existingPlan.clientId,
        agreementYear: existingPlan.year,
        paidUntilMonth: existingPlan.paidUntilMonth,
        monthlyAmount: existingPlan.monthlyAmount,
        debtAmount: existingPlan.debtAmount,
        status,
        notes: existingPlan.notes,
        called: existingPlan.called,
        letterSent: existingPlan.letterSent,
      });

      setCashAgreements(prev =>
        prev.map(agreement => (agreement.id === savedAgreement.id ? savedAgreement : agreement))
      );
    } catch (err: any) {
      alert('Erro ao atualizar estado do acordo: ' + err.message);
    } finally {
      setIsSavingPlan(false);
    }
  };

  const handleRemovePlan = async () => {
    if (!selectedPlanClient) return;
    const existingPlan = getClientPlan(selectedPlanClient.id);
    if (!existingPlan?.id) return;

    try {
      setIsSavingPlan(true);
      await cashAgreementService.delete(existingPlan.id);
      setCashAgreements(prev => prev.filter(a => a.id !== existingPlan.id));
      setIsPlanModalOpen(false);
      resetPlanFormSelection();
    } catch (err: any) {
      alert('Erro ao remover acordo: ' + err.message);
    } finally {
      setIsSavingPlan(false);
    }
  };

  const handlePaymentToggle = (client: Client, month: number) => {
    const monthNumber = month + 1;
    const plan = getClientPlan(client.id);
    if (plan && currentYear === plan.year && monthNumber <= plan.paidUntilMonth) {
      alert('Este mes esta dentro do acordo. Use os botoes "Pagar Numerario" ou "Pagar MB Way" na tabela de acordos.');
      return;
    }

    const changeKey = `${client.id}-${currentYear}-${monthNumber}`;
    const currentPaymentState = paymentsMap.get(client.id)?.get(monthNumber);

    // If it's already processed, do nothing.
    if (currentPaymentState?.cashOperationId) return;

    // If it's currently considered paid (not pending, not marked for deletion)
    if (currentPaymentState && currentPaymentState.amountPaid !== -1) {
      // We want to un-pay it. Mark for deletion.
      const newChange: Partial<CashPayment> = { ...currentPaymentState, amountPaid: -1 };
      setPendingChanges(new Map(pendingChanges.set(changeKey, newChange)));
    } else {
      // It's currently considered pending (either not existing, or marked for deletion). We want to pay it.
      const newPayment: Partial<CashPayment> = {
        id: currentPaymentState?.id || crypto.randomUUID(),
        clientId: client.id,
        paymentYear: currentYear,
        paymentMonth: monthNumber,
        amountPaid: getMonthAmount(client, monthNumber),
        paidAt: new Date().toISOString(),
        cashOperationId: null,
        paymentMethod: paymentMode
      };
      setPendingChanges(new Map(pendingChanges.set(changeKey, newPayment)));
    }
  };

  const getNextAgreementPaymentMonth = (clientId: string) => {
    const usedAgreementMonths = Array.from(consolidatedPayments.values())
      .filter(payment =>
        payment.clientId === clientId &&
        payment.paymentYear === currentYear &&
        payment.amountPaid !== -1 &&
        isAgreementPaymentMonth(payment.paymentMonth)
      )
      .map(payment => Number(payment.paymentMonth || 0));

    const latestAgreementMonth = usedAgreementMonths.length > 0
      ? Math.max(...usedAgreementMonths)
      : AGREEMENT_PAYMENT_MONTH_START - 1;

    return latestAgreementMonth + 1;
  };

  const handlePayInstallment = (client: Client, method: 'Numerário' | 'MB Way') => {
    const agreement = getClientPlan(client.id);
    if (!agreement) {
      alert('Este cliente não tem acordo definido.');
      return;
    }

    if (agreement.status === 'Anulado') {
      alert('Este acordo está anulado. Reative o acordo para registar novas prestações.');
      return;
    }

    const debtInfo = agreementDebtByClient.get(client.id);
    if (!debtInfo || debtInfo.debt <= 0) {
      alert('Não existe dívida pendente para este acordo.');
      return;
    }

    const defaultAmount = Math.min(agreement.monthlyAmount, debtInfo.debt);
    const amountInput = window.prompt(
      `Valor a registar (${method}) para ${client.name}:`,
      defaultAmount.toFixed(2).replace('.', ',')
    );

    if (amountInput === null) return;

    const parsedAmount = Number(amountInput.replace(',', '.').trim());
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      alert('Indique um valor válido superior a zero.');
      return;
    }

    const amountToPay = Math.min(parsedAmount, debtInfo.debt);
    if (parsedAmount > debtInfo.debt) {
      alert(`O valor excede a dívida em aberto. Será registado apenas ${amountToPay.toFixed(2)} EUR.`);
    }

    const targetMonth = getNextAgreementPaymentMonth(client.id);
    const currentPaymentState = paymentsMap.get(client.id)?.get(targetMonth);
    if (currentPaymentState?.cashOperationId) {
      alert('Esta prestacao do acordo ja foi processada em caixa.');
      return;
    }

    const changeKey = `${client.id}-${currentYear}-${targetMonth}`;
    const newPayment: Partial<CashPayment> = {
      id: currentPaymentState?.id || crypto.randomUUID(),
      clientId: client.id,
      paymentYear: currentYear,
      paymentMonth: targetMonth,
      amountPaid: amountToPay,
      paidAt: new Date().toISOString(),
      cashOperationId: null,
      paymentMethod: method,
    };

    setPendingChanges(prev => {
      const next = new Map(prev);
      next.set(changeKey, newPayment);
      return next;
    });
  };
  const handleSaveChanges = useCallback(async (silent = false): Promise<CashPayment[] | null> => {
    if (pendingChanges.size === 0) return null;
    setIsSaving(true);
    const toDelete = Array.from(pendingChanges.values()).filter(p => p.amountPaid === -1).map(p => p.id!);
    const toUpsert = Array.from(pendingChanges.values()).filter(p => p.amountPaid !== -1);

    try {
      if (toDelete.length > 0) await cashPaymentService.deleteMany(toDelete);
      if (toUpsert.length > 0) await cashPaymentService.bulkUpsert(toUpsert);

      const updatedPayments = await cashPaymentService.getAll();
      setCashPayments(updatedPayments);
      setPendingChanges(new Map());
      if (!silent) {
        alert('Pagamentos gravados com sucesso!');
      }
      return updatedPayments;
    } catch (err: any) {
      if (!silent) {
        alert('Erro ao gravar pagamentos: ' + err.message);
      } else {
        console.error('Erro ao gravar pagamentos ao sair:', err.message);
      }
      return null;
    } finally {
      setIsSaving(false);
    }
  }, [pendingChanges, setCashPayments]);

  useEffect(() => {
    // Auto-save on unmount
    return () => {
      if (pendingChanges.size > 0) {
        console.log("A gravar alterações pendentes ao sair...");
        handleSaveChanges(true);
      }
    };
  }, [pendingChanges, handleSaveChanges]);

  const handleCloseRegister = async () => {
    let paymentsForProcessing = cashPayments;
    if (pendingChanges.size > 0) {
      const updatedPayments = await handleSaveChanges(true); // Save silently
      if (updatedPayments) {
        paymentsForProcessing = updatedPayments;
      } else {
        alert("Falha ao gravar alterações pendentes. Não é possível fechar a caixa.");
        return;
      }
    }
    // Collect ALL payments that are not yet processed, regardless of method
    const allPaymentsToProcess = paymentsForProcessing.filter(p => !p.cashOperationId);
    if (allPaymentsToProcess.length === 0 && sessionExpenses.length === 0) {
      alert('Não há pagamentos ou saídas de caixa pendentes para processar.');
      return;
    }

    const numerarioPaymentsToProcess = allPaymentsToProcess.filter(p => p.paymentMethod === 'Numerário');
    const totalNumerarioToProcess = numerarioPaymentsToProcess.reduce((sum, p) => sum + p.amountPaid, 0);

    const deposit = parseFloat(depositAmount) || 0;
    const spent = totalSessionExpenses;
    const adjustment = parseFloat(adjustmentAmount) || 0;
    const mbWayDeposit = parseFloat(mbWayDepositAmount) || 0;

    // Only check balance for Numerário
    if (Math.abs(totalNumerarioToProcess - (deposit + spent + adjustment)) > 0.01) {
      if (!confirm(`Atenção: O total em caixa (Numerário: ${totalNumerarioToProcess.toFixed(2)}€) não corresponde à soma do depósito, gastos e acertos (${(deposit + spent + adjustment).toFixed(2)}€). Deseja continuar mesmo assim?`)) {
        return;
      }
    }

    setIsSaving(true);

    const reportDetailsMap = new Map<string, { clientName: string, months: string[], total: number, method: 'Numerário' | 'MB Way' }>();
    allPaymentsToProcess.forEach(p => {
      const client = clients.find(c => c.id === p.clientId);
      if (client) {
        const key = `${client.id}-${p.paymentMethod}`; // Group by client and method
        if (!reportDetailsMap.has(key)) {
          reportDetailsMap.set(key, { clientName: client.name, months: [], total: 0, method: p.paymentMethod });
        }
        const entry = reportDetailsMap.get(key)!;
        entry.months.push(getPaymentReferenceLabel(p.paymentMonth));
        entry.total += p.amountPaid;
      }
    });

    const newOperation: Partial<CashOperation> = {
      depositedAmount: deposit,
      spentAmount: spent, // Use calculated total
      spentDescription: sessionExpenses.map(e => `${e.description}: ${e.amount.toFixed(2)}€`).join('; '), // Generate description
      mbWayDepositedAmount: mbWayDeposit,
      adjustmentAmount: adjustment,
      reportDetails: Array.from(reportDetailsMap.values()),
    };

    try {
      // Pass ALL payment IDs to be marked as processed
      const createdOperation = await cashOperationService.create(
        newOperation,
        allPaymentsToProcess.map(p => p.id),
        sessionExpenses.map(exp => exp.id)
      );
      setCashOperations([createdOperation, ...cashOperations]);
      
      const updatedPayments = await cashPaymentService.getAll();
      setCashPayments(updatedPayments);

      setActiveReport(createdOperation);
      setView('report');
      // Reset form
      setDepositAmount('');
      setMbWayDepositAmount('');
      setIsDepositAmountEdited(false);
      setIsMbWayDepositAmountEdited(false);
      setAdjustmentAmount('');
      resetSessionExpenses();
    } catch (err: any) {
      alert('Erro ao fechar a caixa: ' + err.message);
    } finally {
      setIsSaving(false);
    }
  };

  if (!cashGroup) {
    return <div className="text-center p-10 bg-white rounded-xl border-dashed border-2">Nenhum grupo com o nome "Pagamento numerário" foi encontrado.</div>;
  }

  if (view === 'report' && activeReport) {
    return <CashierReport report={activeReport} onBack={() => setView('main')} />;
  }

  if (view === 'history') {
    return (
      <CashierHistory
        operations={cashOperations}
        onBack={() => setView('main')}
        onSelectReport={(operation) => {
          setActiveReport(operation);
          setView('report');
        }}
      />
    );
  }


  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-slate-800">Caixa de Pagamentos em Numerário</h2>
          <p className="text-sm text-slate-500">Grupo: <span className="font-bold">{cashGroup.name}</span></p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setView('history')} className="flex items-center gap-2 text-xs font-bold text-slate-500 hover:text-blue-600 bg-white border border-slate-200 px-3 py-2 rounded-lg"><History size={14} /> Histórico</button>
          <div className="p-3 rounded-lg bg-green-100 text-green-800 text-center">
            <span className="text-xs font-bold uppercase">Em Caixa</span>
            <p className="text-xl font-black">{cashInHand.toFixed(2)}€</p>
          </div>
          <div className="p-3 rounded-lg bg-blue-100 text-blue-800 text-center">
            <span className="text-xs font-bold uppercase">MB Way Pendente</span>
            <p className="text-xl font-black">{mbWayInHand.toFixed(2)}€</p>
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="p-4 border-b flex justify-between items-center">
          <div className="flex items-center gap-2">
            <span className="text-sm font-bold">Ano:</span>
            <button onClick={() => setCurrentYear(y => y - 1)} className="p-1 rounded-full hover:bg-slate-200">{'<'}</button>
            <span className="font-bold text-lg w-16 text-center">{currentYear}</span>
            <button onClick={() => setCurrentYear(y => y + 1)} className="p-1 rounded-full hover:bg-slate-200">{'>'}</button>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-bold">Modo de Pagamento:</label>
            <select value={paymentMode} onChange={e => setPaymentMode(e.target.value as any)} className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-sm">
                <option>Numerário</option>
                <option>MB Way</option>
            </select>
            <span className="text-xs font-bold text-amber-700">A = Acordo</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => handleOpenPlanModal()}
              className="bg-emerald-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-emerald-700 font-bold shadow-sm"
            >
              <Plus size={16} /> Adicionar acordo
            </button>
            <button onClick={handleSaveChanges} disabled={isSaving || pendingChanges.size === 0} className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 font-bold shadow-sm disabled:opacity-50">
              {isSaving ? <RefreshCcw size={16} className="animate-spin" /> : <Save size={16} />} Gravar Pagamentos
            </button>
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50">
              <tr>
                <th className="px-4 py-2 text-left">Cliente</th>
                {months.map(m => <th key={m} className="p-1 text-center w-16">{m}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {groupClients.map(client => {
                const clientPlan = getClientPlan(client.id);
                const debtInfo = agreementDebtByClient.get(client.id);

                return (
                  <tr key={client.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2">
                      <div>
                        <div>
                          <p className="font-bold text-slate-700">{client.name}</p>
                          {clientPlan ? (
                            <p className="text-[11px] text-slate-500">
                              Acordo ate {months[clientPlan.paidUntilMonth - 1]}/{clientPlan.year} | Mensal {clientPlan.monthlyAmount.toFixed(2)} EUR | Divida {(debtInfo?.debt || 0).toFixed(2)} EUR
                            </p>
                          ) : (
                            <p className="text-[11px] text-slate-400">Sem acordo definido</p>
                          )}
                        </div>
                      </div>
                    </td>
                    {months.map((_, index) => {
                      const monthNumber = index + 1;
                      const payment = paymentsMap.get(client.id)?.get(monthNumber);
                      const hasAgreementForMonth = Boolean(
                        clientPlan &&
                        currentYear === clientPlan.year &&
                        monthNumber <= clientPlan.paidUntilMonth
                      );
                      const agreementCancelled = clientPlan?.status === 'Anulado';
                      let status: 'pending' | 'agreement' | 'agreement_cancelled' | 'paid_cash' | 'paid_mbway' | 'processed' = 'pending';
                      if (hasAgreementForMonth) {
                        status = agreementCancelled ? 'agreement_cancelled' : 'agreement';
                      } else if (payment) {
                        if (payment.amountPaid === -1) {
                          status = 'pending';
                        } else if (payment.cashOperationId) {
                          status = 'processed';
                        } else if (payment.paymentMethod === 'MB Way') {
                          status = 'paid_mbway';
                        } else {
                          status = 'paid_cash';
                        }
                      }

                      const isPendingChange = pendingChanges.has(`${client.id}-${currentYear}-${monthNumber}`);
                      const disableMonthToggle = status === 'processed' || hasAgreementForMonth;

                      return (
                        <td key={index} className="p-1 text-center">
                          <button
                            onClick={() => handlePaymentToggle(client, index)}
                            disabled={disableMonthToggle}
                            className={`w-full h-8 rounded-md text-xs font-bold transition-all
                            ${status === 'paid_cash' ? 'bg-green-500 text-white' : ''}
                            ${status === 'paid_mbway' ? 'bg-blue-500 text-white' : ''}
                            ${status === 'agreement' ? 'bg-amber-100 text-amber-700 hover:bg-amber-200' : ''}
                            ${status === 'agreement_cancelled' ? 'bg-red-100 text-red-700' : ''}
                            ${status === 'pending' ? 'bg-slate-100 text-slate-400 hover:bg-green-200' : ''}
                            ${disableMonthToggle ? 'cursor-not-allowed' : ''}
                            ${status === 'processed' ? 'bg-slate-300 text-slate-500' : ''}
                            ${isPendingChange ? 'ring-2 ring-blue-500' : ''}
                          `}
                          >
                            {status === 'paid_cash' && <Check size={14} className="mx-auto" />}
                            {status === 'paid_mbway' && <Check size={14} className="mx-auto" />}
                            {status === 'processed' && <Check size={14} className="mx-auto" />}
                            {status === 'agreement' && 'A'}
                            {status === 'agreement_cancelled' && 'A'}
                            {status === 'pending' && getMonthAmount(client, monthNumber).toFixed(0)}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-slate-800">Acordos e Notas de Cobranca ({currentYear})</h3>
          <span className="text-xs text-slate-500 font-medium">{activePlansForCurrentYear.length} acordo(s) ativo(s)</span>
        </div>
        {plansForCurrentYear.length === 0 ? (
          <p className="text-sm text-slate-400 italic text-center py-4">
            Ainda nao existem acordos definidos para este ano.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-xs text-slate-500 uppercase bg-slate-50">
                <tr>
                  <th className="px-3 py-2 text-left">Cliente</th>
                  <th className="px-3 py-2 text-right">Valor mensal</th>
                  <th className="px-3 py-2 text-left">Ate mes/ano</th>
                  <th className="px-3 py-2 text-right">Divida</th>
                  <th className="px-3 py-2 text-left">Estado</th>
                  <th className="px-3 py-2 text-left">Acompanhamento</th>
                  <th className="px-3 py-2 text-left">Notas</th>
                  <th className="px-3 py-2 text-right">Acao</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {plansForCurrentYear.map(({ client, plan }) => {
                  const debt = agreementDebtByClient.get(client.id)?.debt || 0;
                  const displayedStatus = getDisplayedPlanStatus(plan, debt);
                  const canRegisterPayment = displayedStatus === 'Ativo' && debt > 0;

                  return (
                    <tr key={buildPlanKey(client.id, currentYear)} className="hover:bg-slate-50">
                      <td className="px-3 py-2 font-medium text-slate-700">{client.name}</td>
                      <td className="px-3 py-2 text-right font-bold text-slate-800">{plan.monthlyAmount.toFixed(2)} EUR</td>
                      <td className="px-3 py-2">{months[plan.paidUntilMonth - 1]}/{plan.year}</td>
                      <td className="px-3 py-2 text-right font-bold text-orange-600">{debt.toFixed(2)} EUR</td>
                      <td className="px-3 py-2">
                        <span className={`inline-flex items-center px-2 py-1 rounded-md text-[11px] font-bold
                          ${displayedStatus === 'Ativo' ? 'bg-green-100 text-green-700' : ''}
                          ${displayedStatus === 'Anulado' ? 'bg-red-100 text-red-700' : ''}
                          ${displayedStatus === 'Concluido' ? 'bg-slate-200 text-slate-700' : ''}
                        `}>
                          {displayedStatus}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-xs">
                        Ligacao: {plan.called ? 'Sim' : 'Nao'} | Carta: {plan.letterSent ? 'Sim' : 'Nao'}
                      </td>
                      <td className="px-3 py-2 text-xs text-slate-600 max-w-xs truncate" title={plan.notes || ''}>
                        {plan.notes || 'Sem notas'}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="flex items-center justify-end gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => handlePayInstallment(client, 'Numerário')}
                            disabled={!canRegisterPayment}
                            className="text-[11px] px-2 py-1 rounded-md bg-green-100 text-green-700 font-bold hover:bg-green-200 disabled:opacity-40"
                          >
                            Pagar Numerario
                          </button>
                          <button
                            type="button"
                            onClick={() => handlePayInstallment(client, 'MB Way')}
                            disabled={!canRegisterPayment}
                            className="text-[11px] px-2 py-1 rounded-md bg-blue-100 text-blue-700 font-bold hover:bg-blue-200 disabled:opacity-40"
                          >
                            Pagar MB Way
                          </button>
                          {displayedStatus === 'Anulado' ? (
                            <button
                              type="button"
                              onClick={() => handleSetPlanStatus(client, 'Ativo')}
                              disabled={isSavingPlan}
                              className="text-[11px] px-2 py-1 rounded-md bg-emerald-100 text-emerald-700 font-bold hover:bg-emerald-200 disabled:opacity-40"
                            >
                              Reativar
                            </button>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                if (window.confirm('Marcar este acordo como anulado?')) {
                                  handleSetPlanStatus(client, 'Anulado');
                                }
                              }}
                              disabled={isSavingPlan}
                              className="text-[11px] px-2 py-1 rounded-md bg-red-100 text-red-700 font-bold hover:bg-red-200 disabled:opacity-40"
                            >
                              Anular
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => handleOpenPlanModal(client)}
                            className="text-xs font-bold text-blue-600 hover:underline"
                          >
                            Editar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Session Expenses Section */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <div className="flex justify-between items-center mb-4">
          <h3 className="font-bold text-slate-800 flex items-center gap-2"><DollarSign size={18} /> Saídas de Caixa (Sessão Atual)</h3>
          <button onClick={() => setIsExpenseModalOpen(true)} className="bg-orange-500 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-orange-600 font-bold text-sm">
            <Plus size={16} /> Adicionar Saída
          </button>
        </div>
        <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-2">
          {sessionExpenses.length === 0 ? (
            <p className="text-sm text-slate-400 italic text-center py-4">Nenhuma saída de caixa nesta sessão.</p>
          ) : (
            sessionExpenses.map(exp => (
              <div key={exp.id} className="flex justify-between items-center bg-slate-50 p-2 rounded-lg">
                <div className="text-sm">
                  <span className="font-medium text-slate-700">{exp.description}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-bold text-orange-600">{exp.amount.toFixed(2)}€</span>
                  <button onClick={() => handleRemoveExpense(exp.id)} className="text-slate-400 hover:text-red-500">
                    <X size={16} />
                  </button>
                </div>
              </div>
            ))
          )}
        </div>
        {sessionExpenses.length > 0 && (
          <div className="mt-4 border-t pt-3 flex justify-end font-bold">
            <span className="text-sm text-slate-500 mr-2">Total de Saídas:</span>
            <span className="text-slate-800">{totalSessionExpenses.toFixed(2)}€</span>
          </div>
        )}
      </div>

      {/* Close Register Section */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><Download size={18} /> Fechar Caixa e Gerar Relatório</h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end">
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1"><Banknote size={14}/> Depósito (Numerário)</label>
            <input type="number" value={depositAmount} onChange={e => { setIsDepositAmountEdited(true); setDepositAmount(e.target.value); }} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="0.00" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1"><CreditCard size={14}/> Depósito (MB Way)</label>
            <input type="number" value={mbWayDepositAmount} onChange={e => { setIsMbWayDepositAmountEdited(true); setMbWayDepositAmount(e.target.value); }} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="0.00" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1"><DollarSign size={14} /> Gastos de Caixa (€)</label>
            <input type="number" value={totalSessionExpenses.toFixed(2)} readOnly className="w-full px-3 py-2 border rounded-lg text-sm bg-slate-100 text-slate-500" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1">Acertos (+/- €)</label>
            <input type="number" value={adjustmentAmount} onChange={e => setAdjustmentAmount(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="0.00" />
          </div>
          <div className="md:col-span-4 text-right">
            <button onClick={handleCloseRegister} disabled={isSaving || (cashInHand + mbWayInHand === 0 && sessionExpenses.length === 0)} className="bg-slate-900 text-white px-6 py-3 rounded-xl font-bold flex items-center gap-2 hover:bg-black transition-all shadow-lg disabled:opacity-50 ml-auto">
              {isSaving ? <RefreshCcw size={18} className="animate-spin" /> : <Check size={18} />} Finalizar e Gerar Relatório
            </button>
          </div>
        </div>
      </div>

      <PlanModal
        isOpen={isPlanModalOpen}
        selectedPlanClient={selectedPlanClient}
        selectedClientPlan={selectedClientPlan}
        displayedStatus={selectedClientPlan && selectedPlanClient ? getDisplayedPlanStatus(selectedClientPlan, agreementDebtByClient.get(selectedPlanClient.id)?.debt || 0) : null}
        openDebt={selectedPlanClient ? agreementDebtByClient.get(selectedPlanClient.id)?.debt || 0 : 0}
        groupClients={groupClients}
        planForm={planForm}
        months={months}
        isSavingPlan={isSavingPlan}
        onClose={() => {
          setIsPlanModalOpen(false);
          resetPlanFormSelection();
        }}
        onClientChange={handlePlanClientChange}
        onPlanFormChange={setPlanForm}
        onRemove={handleRemovePlan}
        onSave={handleSavePlan}
      />

      <ExpenseModal
        isOpen={isExpenseModalOpen}
        amount={newExpense.amount}
        description={newExpense.description}
        onClose={() => setIsExpenseModalOpen(false)}
        onAmountChange={(value) => setNewExpense(prev => ({ ...prev, amount: value }))}
        onDescriptionChange={(value) => setNewExpense(prev => ({ ...prev, description: value }))}
        onAdd={handleAddExpense}
      />
    </div>
  );
};

export default Cashier;
