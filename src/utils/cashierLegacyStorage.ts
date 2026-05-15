import { SessionExpense } from '../types/cashier';

const LEGACY_SESSION_EXPENSES_STORAGE_KEY = 'cashier-session-expenses-open-register';
const LEGACY_SESSION_EXPENSES_STORAGE_PREFIX = 'cashier-session-expenses-';

const parseStoredSessionExpenses = (rawValue: string | null): SessionExpense[] => {
  if (!rawValue) return [];
  try {
    const parsedValue = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) return [];

    return parsedValue.reduce<SessionExpense[]>((acc, item: any) => {
      const amount = typeof item?.amount === 'number' ? item.amount : Number(item?.amount);
      const description = typeof item?.description === 'string' ? item.description.trim() : '';
      if (!Number.isFinite(amount) || amount <= 0 || description.length === 0) {
        return acc;
      }

      acc.push({
        id: typeof item?.id === 'string' && item.id ? item.id : crypto.randomUUID(),
        amount,
        description,
      });
      return acc;
    }, []);
  } catch {
    return [];
  }
};

const getLegacySessionExpenseKeys = (): string[] => {
  if (typeof window === 'undefined') return [];
  const keys = new Set<string>([LEGACY_SESSION_EXPENSES_STORAGE_KEY]);
  for (let index = 0; index < localStorage.length; index++) {
    const key = localStorage.key(index);
    if (key && key.startsWith(LEGACY_SESSION_EXPENSES_STORAGE_PREFIX)) {
      keys.add(key);
    }
  }
  return Array.from(keys);
};

export const loadLegacySessionExpenses = (): SessionExpense[] => {
  const keys = getLegacySessionExpenseKeys();
  if (keys.length === 0) return [];
  return keys.flatMap((key) => parseStoredSessionExpenses(localStorage.getItem(key)));
};

export const clearLegacySessionExpenses = () => {
  if (typeof window === 'undefined') return;
  getLegacySessionExpenseKeys().forEach((key) => localStorage.removeItem(key));
};

export const persistLegacySessionExpenses = (expenses: SessionExpense[]) => {
  if (typeof window === 'undefined') return;
  try {
    if (expenses.length === 0) {
      localStorage.removeItem(LEGACY_SESSION_EXPENSES_STORAGE_KEY);
      return;
    }
    localStorage.setItem(LEGACY_SESSION_EXPENSES_STORAGE_KEY, JSON.stringify(expenses));
  } catch (err) {
    console.error('Erro ao guardar sa?das de caixa localmente:', err);
  }
};
