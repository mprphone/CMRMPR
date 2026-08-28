import { useEffect, useMemo, useState } from 'react';
import { CashSessionExpense } from '../types';
import { cashSessionExpenseService } from '../services';
import { SessionExpense } from '../types/cashier';
import { clearLegacySessionExpenses, loadLegacySessionExpenses } from '../utils/cashierLegacyStorage';

const mapDbExpenseToSessionExpense = (expense: CashSessionExpense): SessionExpense => ({
  id: expense.id,
  amount: expense.amount,
  description: expense.description,
});

export const useCashierExpenses = () => {
  const [isExpenseModalOpen, setIsExpenseModalOpen] = useState(false);
  const [newExpense, setNewExpense] = useState<{ amount: string; description: string }>({ amount: '', description: '' });
  const [sessionExpenses, setSessionExpenses] = useState<SessionExpense[]>([]);
  const [isSessionExpensesDbAvailable, setIsSessionExpensesDbAvailable] = useState(true);

  const totalSessionExpenses = useMemo(() => sessionExpenses.reduce((sum, expense) => sum + expense.amount, 0), [sessionExpenses]);

  useEffect(() => {
    let isMounted = true;
    const loadOpenSessionExpenses = async () => {
      try {
        const openExpenses = await cashSessionExpenseService.getOpen();
        if (!isMounted) return;
        setIsSessionExpensesDbAvailable(true);
        if (openExpenses.length > 0) {
          setSessionExpenses(openExpenses.map(mapDbExpenseToSessionExpense));
          return;
        }
        const legacyExpenses = loadLegacySessionExpenses();
        if (legacyExpenses.length === 0) {
          setSessionExpenses([]);
          return;
        }
        try {
          const migratedExpenses = await cashSessionExpenseService.bulkCreate(legacyExpenses.map(expense => ({ amount: expense.amount, description: expense.description })));
          if (!isMounted) return;
          setSessionExpenses(migratedExpenses.map(mapDbExpenseToSessionExpense));
          clearLegacySessionExpenses();
        } catch (migrationError) {
          console.error('Erro ao migrar sa?das locais para SQL:', migrationError);
          if (!isMounted) return;
          setIsSessionExpensesDbAvailable(false);
          setSessionExpenses(legacyExpenses);
        }
      } catch (err) {
        console.error('Erro ao carregar sa?das de caixa:', err);
        if (isMounted) {
          setIsSessionExpensesDbAvailable(false);
          setSessionExpenses(loadLegacySessionExpenses());
        }
      }
    };
    loadOpenSessionExpenses();
    return () => { isMounted = false; };
  }, []);

  const handleAddExpense = async () => {
    const amount = parseFloat(newExpense.amount);
    const description = newExpense.description.trim();
    if (!amount || amount <= 0 || !description) {
      alert('Por favor, preencha um valor e uma descri??o v?lidos para a sa?da de caixa.');
      return;
    }
    if (!isSessionExpensesDbAvailable) {
      alert('A base de dados SQL não está disponível. A saída não foi gravada; recarregue a página e tente novamente.');
      return;
    }
    try {
      const createdExpense = await cashSessionExpenseService.create({ amount, description });
      setSessionExpenses(prev => [...prev, mapDbExpenseToSessionExpense(createdExpense)]);
      clearLegacySessionExpenses();
      setIsExpenseModalOpen(false);
      setNewExpense({ amount: '', description: '' });
    } catch (err) {
      console.error('Erro ao gravar sa?das de caixa em SQL:', err);
      setIsSessionExpensesDbAvailable(false);
      alert('A saída não foi gravada porque a base SQL não respondeu. Nenhum registo local foi criado.');
    }
  };

  const handleRemoveExpense = async (id: string) => {
    if (!isSessionExpensesDbAvailable) {
      alert('A base de dados SQL não está disponível. A saída não foi removida.');
      return;
    }
    try {
      await cashSessionExpenseService.delete(id);
      setSessionExpenses(prev => prev.filter(expense => expense.id !== id));
    } catch (err) {
      console.error('Erro ao remover sa?das de caixa em SQL:', err);
      setIsSessionExpensesDbAvailable(false);
      alert('A saída não foi removida porque a base SQL não respondeu.');
    }
  };

  const resetSessionExpenses = () => {
    setSessionExpenses([]);
    clearLegacySessionExpenses();
  };

  return {
    isExpenseModalOpen,
    setIsExpenseModalOpen,
    newExpense,
    setNewExpense,
    sessionExpenses,
    isSessionExpensesDbAvailable,
    totalSessionExpenses,
    handleAddExpense,
    handleRemoveExpense,
    resetSessionExpenses,
  };
};
