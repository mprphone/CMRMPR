import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { Client, FeeGroup, CashPayment, CashOperation } from '../types';
import { cashPaymentService, cashOperationService } from '../services/supabase';
import { Landmark, Check, X, Save, RefreshCcw, Printer, ArrowLeft, DollarSign, Banknote, Download, History, CreditCard, Plus } from 'lucide-react';

interface CashierProps {
  clients: Client[];
  groups: FeeGroup[];
  cashPayments: CashPayment[];
  setCashPayments: (payments: CashPayment[]) => void;
  cashOperations: CashOperation[];
  setCashOperations: (operations: CashOperation[]) => void;
}

const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

const Cashier: React.FC<CashierProps> = ({ clients, groups, cashPayments, setCashPayments, cashOperations, setCashOperations }) => {
  const [currentYear, setCurrentYear] = useState(new Date().getFullYear());
  const [pendingChanges, setPendingChanges] = useState<Map<string, Partial<CashPayment>>>(new Map());
  const [isSaving, setIsSaving] = useState(false);
  const [view, setView] = useState<'main' | 'report' | 'history'>('main');
  const [paymentMode, setPaymentMode] = useState<'Numerário' | 'MB Way'>('Numerário');
  const [activeReport, setActiveReport] = useState<CashOperation | null>(null);

  // New state for session expenses
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [newExpense, setNewExpense] = useState<{ amount: string; description: string }>({ amount: '', description: '' });
  const [sessionExpenses, setSessionExpenses] = useState<{ id: string; amount: number; description: string }[]>([]);

  // Form state for closing the register
  const [depositAmount, setDepositAmount] = useState('');
  const [mbWayDepositAmount, setMbWayDepositAmount] = useState('');
  const [adjustmentAmount, setAdjustmentAmount] = useState('');

  const cashGroup = useMemo(() => groups.find(g => g.name.toLowerCase().includes('pagamento numerário')), [groups]);
  const groupClients = useMemo(() => {
    if (!cashGroup) return [];
    return clients
      .filter(c => cashGroup.clientIds.includes(c.id))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [clients, cashGroup]);

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

  const { cashInHand, mbWayInHand } = useMemo(() => {
    let cashTotal = 0;
    let mbWayTotal = 0;

    // Consolidate all payments (DB + pending changes)
    const consolidatedPayments = new Map<string, Partial<CashPayment>>();
    cashPayments.forEach(p => {
        consolidatedPayments.set(`${p.clientId}-${p.paymentYear}-${p.paymentMonth}`, p);
    });
    pendingChanges.forEach((change, key) => {
        consolidatedPayments.set(key, change);
    });

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
  }, [cashPayments, pendingChanges]);

  const totalSessionExpenses = useMemo(() => {
    return sessionExpenses.reduce((sum, exp) => sum + exp.amount, 0);
  }, [sessionExpenses]);

  const handlePaymentToggle = (client: Client, month: number) => {
    const changeKey = `${client.id}-${currentYear}-${month + 1}`;
    const currentPaymentState = paymentsMap.get(client.id)?.get(month + 1);

    // If it's already processed, do nothing.
    if (currentPaymentState?.cashOperationId) return;

    // If it's currently considered paid (not pending, not marked for deletion)
    if (currentPaymentState && currentPaymentState.amountPaid !== -1) {
      // We want to un-pay it. Mark for deletion.
      const newChange: Partial<CashPayment> = { ...currentPaymentState, amountPaid: -1 };
      setPendingChanges(new Map(pendingChanges.set(changeKey, newChange)));
    } else {
      // It's currently considered pending (either not existing, or marked for deletion). We want to pay it.
      const newPayment: Partial<CashPayment> = { id: currentPaymentState?.id || crypto.randomUUID(), clientId: client.id, paymentYear: currentYear, paymentMonth: month + 1, amountPaid: client.monthlyFee * 1.23, paidAt: new Date().toISOString(), cashOperationId: null, paymentMethod: paymentMode };
      setPendingChanges(new Map(pendingChanges.set(changeKey, newPayment)));
    }
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

  const handleAddExpense = () => {
    const amount = parseFloat(newExpense.amount);
    if (!amount || amount <= 0 || !newExpense.description) {
      alert("Por favor, preencha um valor e uma descrição válidos para a saída de caixa.");
      return;
    }
    setSessionExpenses(prev => [...prev, { id: crypto.randomUUID(), amount, description: newExpense.description }]);
    setIsExpenseModalOpen(false);
    setNewExpense({ amount: '', description: '' });
  };

  const handleRemoveExpense = (id: string) => {
    setSessionExpenses(prev => prev.filter(exp => exp.id !== id));
  };

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
        entry.months.push(months[p.paymentMonth - 1]);
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
      const createdOperation = await cashOperationService.create(newOperation, allPaymentsToProcess.map(p => p.id));
      setCashOperations([createdOperation, ...cashOperations]);
      
      const updatedPayments = await cashPaymentService.getAll();
      setCashPayments(updatedPayments);

      setActiveReport(createdOperation);
      setView('report');
      // Reset form
      setDepositAmount('');
      setMbWayDepositAmount('');
      setAdjustmentAmount('');
      setSessionExpenses([]); // Clear session expenses
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
    return (
      <div className="animate-fade-in bg-white min-h-screen absolute top-0 left-0 w-full z-50 p-6 print:p-0">
        <style>{`@page { size: A4; margin: 1cm; } @media print { .no-print { display: none !important; } body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }`}</style>
        <div className="max-w-4xl mx-auto flex justify-between items-center mb-6 no-print border-b pb-4">
          <button onClick={() => setView('main')} className="flex items-center gap-2 text-slate-500 hover:text-slate-800"><ArrowLeft size={20}/> Voltar</button>
          <button onClick={() => window.print()} className="bg-blue-600 text-white px-6 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 font-bold"><Printer size={20}/> Imprimir Relatório</button>
        </div>
        <div className="max-w-4xl mx-auto bg-white p-4 print:p-2">
          <h2 className="text-xl font-bold text-slate-800">Relatório de Caixa</h2>
          <p className="text-sm text-slate-500 mb-6">Operação de {new Date(activeReport.createdAt).toLocaleString('pt-PT')}</p>
          
          <div className="grid grid-cols-3 gap-2 mb-4 text-center">
            <div className="bg-green-50 p-2 rounded-lg"><p className="text-[10px] font-bold uppercase text-green-700">Recebido (Numerário)</p><p className="text-lg font-bold">{(activeReport.reportDetails.filter(d=>d.method==='Numerário').reduce((s,d)=>s+d.total,0)).toFixed(2)}€</p></div>
            <div className="bg-blue-50 p-2 rounded-lg"><p className="text-[10px] font-bold uppercase text-blue-700">Recebido (MB Way)</p><p className="text-lg font-bold">{(activeReport.reportDetails.filter(d=>d.method==='MB Way').reduce((s,d)=>s+d.total,0)).toFixed(2)}€</p></div>
            <div className="bg-green-100 p-2 rounded-lg"><p className="text-[10px] font-bold uppercase text-green-800">Depósito (Numerário)</p><p className="text-lg font-bold">{activeReport.depositedAmount.toFixed(2)}€</p></div>
            <div className="bg-orange-50 p-2 rounded-lg"><p className="text-[10px] font-bold uppercase text-orange-700">Gastos de Caixa</p><p className="text-lg font-bold">{activeReport.spentAmount.toFixed(2)}€</p></div>
            <div className="bg-yellow-50 p-2 rounded-lg"><p className="text-[10px] font-bold uppercase text-yellow-700">Acertos</p><p className="text-lg font-bold">{(activeReport.adjustmentAmount || 0).toFixed(2)}€</p></div>
            <div className="bg-blue-100 p-2 rounded-lg"><p className="text-[10px] font-bold uppercase text-blue-800">Depósito (MB Way)</p><p className="text-lg font-bold">{(activeReport.mbWayDepositedAmount || 0).toFixed(2)}€</p></div>
          </div>
          {activeReport.spentDescription && <p className="text-xs italic mb-6"><b>Descrição dos Gastos/Acertos:</b> {activeReport.spentDescription}</p>}

          <h3 className="font-bold text-slate-700 mb-1 text-base">Detalhe dos Recebimentos</h3>
          <table className="w-full text-xs text-left">
            <thead className="text-[10px] text-slate-500 uppercase bg-slate-50">
              <tr>
                <th className="px-2 py-1">Cliente</th>
                <th className="px-2 py-1">Método</th>
                <th className="px-2 py-1">Meses Pagos</th>
                <th className="px-2 py-1 text-right">Total (€)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {activeReport.reportDetails.map((item, index) => (
                <tr key={index}><td className="px-2 py-1 font-medium">{item.clientName}</td><td className={`px-2 py-1 font-bold ${item.method === 'MB Way' ? 'text-blue-600' : 'text-green-600'}`}>{item.method}</td><td className="px-2 py-1">{item.months.join(', ')}</td><td className="px-2 py-1 text-right font-bold">{item.total.toFixed(2)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  if (view === 'history') {
    return (
      <div className="space-y-6 animate-fade-in">
        <div className="flex justify-between items-center">
          <div><h2 className="text-2xl font-bold text-slate-800">Histórico de Operações de Caixa</h2></div>
          <button onClick={() => setView('main')} className="flex items-center gap-2 text-slate-500 hover:text-slate-800 text-sm"><ArrowLeft size={16}/> Voltar</button>
        </div>
        <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50"><tr><th className="px-4 py-3">Data</th><th className="px-4 py-3 text-right">Valor Depositado</th><th className="px-4 py-3 text-right">Valor Gasto</th><th className="px-4 py-3">Descrição Gastos</th><th className="px-4 py-3 text-right">Ações</th></tr></thead>
            <tbody className="divide-y divide-slate-50">
              {cashOperations.map(op => (
                <tr key={op.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 text-xs">{new Date(op.createdAt).toLocaleString('pt-PT')}</td>
                  <td className="px-4 py-3 text-right font-bold text-blue-600">{op.depositedAmount.toFixed(2)}€</td>
                  <td className="px-4 py-3 text-right font-bold text-orange-600">{op.spentAmount.toFixed(2)}€</td>
                  <td className="px-4 py-3 text-xs italic">{op.spentDescription}</td>
                  <td className="px-4 py-3 text-right"><button onClick={() => { setActiveReport(op); setView('report'); }} className="text-xs font-bold text-blue-600 hover:underline">Ver Relatório</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
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
            <button onClick={() => setCurrentYear(y => y - 1)} className="p-1 rounded-full hover:bg-slate-200">‹</button>
            <span className="font-bold text-lg w-16 text-center">{currentYear}</span>
            <button onClick={() => setCurrentYear(y => y + 1)} className="p-1 rounded-full hover:bg-slate-200">›</button>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-sm font-bold">Modo de Pagamento:</label>
            <select value={paymentMode} onChange={e => setPaymentMode(e.target.value as any)} className="bg-white border border-slate-200 rounded-lg px-2 py-1 text-sm">
                <option>Numerário</option>
                <option>MB Way</option>
            </select>
          </div>
          <button onClick={handleSaveChanges} disabled={isSaving || pendingChanges.size === 0} className="bg-blue-600 text-white px-4 py-2 rounded-lg flex items-center gap-2 hover:bg-blue-700 font-bold shadow-sm disabled:opacity-50">
            {isSaving ? <RefreshCcw size={16} className="animate-spin" /> : <Save size={16} />} Gravar Pagamentos
          </button>
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
              {groupClients.map(client => (
                <tr key={client.id} className="hover:bg-slate-50">
                  <td className="px-4 py-2 font-bold text-slate-700">{client.name}</td>
                  {months.map((_, index) => {
                    const payment = paymentsMap.get(client.id)?.get(index + 1);
                    let status: 'pending' | 'paid_cash' | 'paid_mbway' | 'processed' = 'pending';
                    if (payment) { // A payment record exists (from DB or pending changes)
                      if (payment.amountPaid === -1) { // Marked for deletion, so it's pending again
                        status = 'pending';
                      } else if (payment.cashOperationId) {
                        status = 'processed';
                      } else if (payment.paymentMethod === 'MB Way') {
                        status = 'paid_mbway';
                      } else { // Default to cash if method is not specified or is 'Numerário'
                        status = 'paid_cash';
                      }
                    }
                    const isPendingChange = pendingChanges.has(`${client.id}-${currentYear}-${index + 1}`);

                    return (
                      <td key={index} className="p-1 text-center">
                        <button
                          onClick={() => handlePaymentToggle(client, index)}
                          disabled={status === 'processed'}
                          className={`w-full h-8 rounded-md text-xs font-bold transition-all
                            ${status === 'paid_cash' ? 'bg-green-500 text-white' : ''}
                            ${status === 'paid_mbway' ? 'bg-blue-500 text-white' : ''}
                            ${status === 'pending' ? 'bg-slate-100 text-slate-400 hover:bg-green-200' : ''}
                            ${status === 'processed' ? 'bg-slate-300 text-slate-500 cursor-not-allowed' : ''}
                            ${isPendingChange ? 'ring-2 ring-blue-500' : ''}
                          `}
                        >
                          {status === 'paid_cash' && <Check size={14} className="mx-auto" />}
                          {status === 'paid_mbway' && <CreditCard size={14} className="mx-auto" />}
                          {status === 'processed' && <Check size={14} className="mx-auto" />}
                          {status === 'pending' && (client.monthlyFee * 1.23).toFixed(0)}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
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
            <input type="number" value={depositAmount} onChange={e => setDepositAmount(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="0.00" />
          </div>
          <div>
            <label className="block text-xs font-bold text-slate-500 mb-1 flex items-center gap-1"><CreditCard size={14}/> Depósito (MB Way)</label>
            <input type="number" value={mbWayDepositAmount} onChange={e => setMbWayDepositAmount(e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" placeholder="0.00" />
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

      {/* Expense Modal */}
      {isExpenseModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-xl font-bold">Nova Saída de Caixa</h3>
              <button type="button" onClick={() => setIsExpenseModalOpen(false)}><X size={20} /></button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Valor (€)</label>
                <input 
                  type="number" 
                  value={newExpense.amount} 
                  onChange={e => setNewExpense(prev => ({ ...prev, amount: e.target.value }))} 
                  className="w-full px-3 py-2 border rounded-lg text-sm" 
                  placeholder="0.00" 
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Descrição</label>
                <input 
                  type="text" 
                  value={newExpense.description} 
                  onChange={e => setNewExpense(prev => ({ ...prev, description: e.target.value }))} 
                  className="w-full px-3 py-2 border rounded-lg text-sm" 
                  placeholder="Ex: Material de escritório" 
                />
              </div>
            </div>
            <div className="flex justify-end gap-3 pt-6">
              <button type="button" onClick={() => setIsExpenseModalOpen(false)} className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm">Cancelar</button>
              <button onClick={handleAddExpense} className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold flex items-center gap-2">
                <Save size={16} /> Adicionar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Cashier;