import { useCallback, useEffect, useMemo, useState } from 'react';

export interface IrsControlRecord {
  clientId: string;
  year: number;
  delivered: boolean;
  paid: boolean;
  amount: number;
  notes: string;
  updatedAt: string;
}

const IRS_CONTROL_STORAGE_KEY = 'cashier-irs-control-records-v1';

const parseStoredIrsControlRecords = (rawValue: string | null): IrsControlRecord[] => {
  if (!rawValue) return [];
  try {
    const parsedValue = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) return [];

    return parsedValue.reduce<IrsControlRecord[]>((acc, item: any) => {
      const clientId = typeof item?.clientId === 'string' ? item.clientId : '';
      const year = Number(item?.year);
      if (!clientId || !Number.isFinite(year)) return acc;

      acc.push({
        clientId,
        year,
        delivered: Boolean(item?.delivered),
        paid: Boolean(item?.paid),
        amount: Number.isFinite(Number(item?.amount)) ? Number(item.amount) : 0,
        notes: typeof item?.notes === 'string' ? item.notes : '',
        updatedAt: typeof item?.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
      });
      return acc;
    }, []);
  } catch {
    return [];
  }
};

export const useIrsControl = (currentYear: number) => {
  const [irsControlRecords, setIrsControlRecords] = useState<IrsControlRecord[]>(() => {
    if (typeof window === 'undefined') return [];
    return parseStoredIrsControlRecords(localStorage.getItem(IRS_CONTROL_STORAGE_KEY));
  });

  const irsControlMap = useMemo(() => {
    const map = new Map<string, IrsControlRecord>();
    irsControlRecords.forEach(record => {
      map.set(`${record.clientId}-${record.year}`, record);
    });
    return map;
  }, [irsControlRecords]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(IRS_CONTROL_STORAGE_KEY, JSON.stringify(irsControlRecords));
  }, [irsControlRecords]);

  const upsertIrsRecord = useCallback((clientId: string, updater: (previous: IrsControlRecord) => IrsControlRecord) => {
    setIrsControlRecords(prev => {
      const recordKey = `${clientId}-${currentYear}`;
      const existing = prev.find(record => `${record.clientId}-${record.year}` === recordKey) || {
        clientId,
        year: currentYear,
        delivered: false,
        paid: false,
        amount: 0,
        notes: '',
        updatedAt: new Date().toISOString(),
      };
      const nextRecord = updater(existing);
      const withoutCurrent = prev.filter(record => `${record.clientId}-${record.year}` !== recordKey);
      return [...withoutCurrent, { ...nextRecord, updatedAt: new Date().toISOString() }];
    });
  }, [currentYear]);

  const handleIrsDeliveredToggle = useCallback((clientId: string) => {
    upsertIrsRecord(clientId, previous => ({ ...previous, delivered: !previous.delivered }));
  }, [upsertIrsRecord]);

  const handleIrsPaidToggle = useCallback((clientId: string) => {
    const existing = irsControlMap.get(`${clientId}-${currentYear}`);
    const nextPaid = !existing?.paid;
    if (nextPaid) {
      const suggestedAmount = existing?.amount && existing.amount > 0 ? existing.amount.toFixed(2) : '';
      const amountInput = window.prompt('Valor pago de IRS (EUR):', suggestedAmount);
      if (amountInput === null) return;
      const parsedAmount = Number((amountInput || '').replace(',', '.').trim());
      if (!Number.isFinite(parsedAmount) || parsedAmount < 0) {
        alert('Indique um valor válido.');
        return;
      }
      upsertIrsRecord(clientId, previous => ({
        ...previous,
        paid: true,
        amount: parsedAmount,
      }));
      return;
    }
    upsertIrsRecord(clientId, previous => ({
      ...previous,
      paid: false,
      amount: 0,
    }));
  }, [currentYear, irsControlMap, upsertIrsRecord]);

  const handleIrsAmountChange = useCallback((clientId: string, value: string) => {
    const parsedAmount = Number(value.replace(',', '.'));
    upsertIrsRecord(clientId, previous => ({
      ...previous,
      amount: Number.isFinite(parsedAmount) ? parsedAmount : 0,
    }));
  }, [upsertIrsRecord]);

  const handleIrsNotesChange = useCallback((clientId: string, notes: string) => {
    upsertIrsRecord(clientId, previous => ({
      ...previous,
      notes,
    }));
  }, [upsertIrsRecord]);

  return {
    irsControlMap,
    handleIrsDeliveredToggle,
    handleIrsPaidToggle,
    handleIrsAmountChange,
    handleIrsNotesChange,
  };
};

