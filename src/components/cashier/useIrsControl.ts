import { useCallback, useEffect, useMemo, useState } from 'react';

export interface IrsControlRecord {
  clientId: string;
  year: number;
  delivered: boolean;
  paid: boolean;
  amount: number;
  paymentMethod: 'Numerário' | 'MB Way';
  notes: string;
  deliveryCloseId?: string | null;
  updatedAt: string;
}

export interface IrsDeliveryClose {
  id: string;
  year: number;
  createdAt: string;
  totalAmount: number;
  itemCount: number;
  note: string;
}

const IRS_CONTROL_STORAGE_KEY = 'cashier-irs-control-records-v1';
const IRS_DELIVERY_CLOSES_STORAGE_KEY = 'cashier-irs-delivery-closes-v1';

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
        paymentMethod: item?.paymentMethod === 'MB Way' ? 'MB Way' : 'Numerário',
        notes: typeof item?.notes === 'string' ? item.notes : '',
        deliveryCloseId: typeof item?.deliveryCloseId === 'string' ? item.deliveryCloseId : null,
        updatedAt: typeof item?.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
      });
      return acc;
    }, []);
  } catch {
    return [];
  }
};

const parseStoredIrsDeliveryCloses = (rawValue: string | null): IrsDeliveryClose[] => {
  if (!rawValue) return [];
  try {
    const parsedValue = JSON.parse(rawValue);
    if (!Array.isArray(parsedValue)) return [];

    return parsedValue.reduce<IrsDeliveryClose[]>((acc, item: any) => {
      const id = typeof item?.id === 'string' ? item.id : '';
      const year = Number(item?.year);
      if (!id || !Number.isFinite(year)) return acc;
      acc.push({
        id,
        year,
        createdAt: typeof item?.createdAt === 'string' ? item.createdAt : new Date().toISOString(),
        totalAmount: Number.isFinite(Number(item?.totalAmount)) ? Number(item.totalAmount) : 0,
        itemCount: Number.isFinite(Number(item?.itemCount)) ? Number(item.itemCount) : 0,
        note: typeof item?.note === 'string' ? item.note : '',
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
  const [deliveryCloses, setDeliveryCloses] = useState<IrsDeliveryClose[]>(() => {
    if (typeof window === 'undefined') return [];
    return parseStoredIrsDeliveryCloses(localStorage.getItem(IRS_DELIVERY_CLOSES_STORAGE_KEY));
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
  useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(IRS_DELIVERY_CLOSES_STORAGE_KEY, JSON.stringify(deliveryCloses));
  }, [deliveryCloses]);

  const pendingDeliveryRecords = useMemo(() => (
    irsControlRecords.filter(record =>
      record.year === currentYear &&
      record.paid &&
      (record.amount || 0) > 0 &&
      record.paymentMethod === 'Numerário' &&
      !record.deliveryCloseId
    )
  ), [currentYear, irsControlRecords]);
  const pendingMbWayTotal = useMemo(() => (
    irsControlRecords
      .filter(record =>
        record.year === currentYear &&
        record.paid &&
        (record.amount || 0) > 0 &&
        record.paymentMethod === 'MB Way'
      )
      .reduce((sum, record) => sum + (record.amount || 0), 0)
  ), [currentYear, irsControlRecords]);
  const pendingDeliveryTotal = useMemo(
    () => pendingDeliveryRecords.reduce((sum, record) => sum + (record.amount || 0), 0),
    [pendingDeliveryRecords]
  );
  const deliveryHistoryForYear = useMemo(() => (
    deliveryCloses
      .filter(close => close.year === currentYear)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  ), [currentYear, deliveryCloses]);

  const upsertIrsRecord = useCallback((clientId: string, updater: (previous: IrsControlRecord) => IrsControlRecord) => {
    setIrsControlRecords(prev => {
      const recordKey = `${clientId}-${currentYear}`;
      const existing = prev.find(record => `${record.clientId}-${record.year}` === recordKey) || {
        clientId,
        year: currentYear,
        delivered: false,
        paid: false,
        amount: 0,
        paymentMethod: 'Numerário',
        notes: '',
        deliveryCloseId: null,
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
    if (existing?.deliveryCloseId) {
      alert('Este registo já está fechado numa entrega de dinheiro.');
      return;
    }
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
      paymentMethod: 'Numerário',
    }));
  }, [currentYear, irsControlMap, upsertIrsRecord]);

  const handleIrsAmountChange = useCallback((clientId: string, value: string) => {
    const existing = irsControlMap.get(`${clientId}-${currentYear}`);
    if (existing?.deliveryCloseId) return;
    const parsedAmount = Number(value.replace(',', '.'));
    upsertIrsRecord(clientId, previous => ({
      ...previous,
      amount: Number.isFinite(parsedAmount) ? parsedAmount : 0,
    }));
  }, [currentYear, irsControlMap, upsertIrsRecord]);

  const handleIrsNotesChange = useCallback((clientId: string, notes: string) => {
    upsertIrsRecord(clientId, previous => ({
      ...previous,
      notes,
    }));
  }, [upsertIrsRecord]);

  const handleIrsPaymentMethodChange = useCallback((clientId: string, paymentMethod: 'Numerário' | 'MB Way') => {
    const existing = irsControlMap.get(`${clientId}-${currentYear}`);
    if (existing?.deliveryCloseId) return;
    upsertIrsRecord(clientId, previous => ({
      ...previous,
      paymentMethod,
    }));
  }, [currentYear, irsControlMap, upsertIrsRecord]);

  const handleCloseDelivery = useCallback(() => {
    if (pendingDeliveryRecords.length === 0) {
      alert('Não existem valores pendentes para fecho.');
      return;
    }
    const note = window.prompt('Nota do fecho (opcional):', '') || '';
    const closeId = crypto.randomUUID();
    const now = new Date().toISOString();

    setIrsControlRecords(prev => prev.map(record => {
      const isPendingForClose =
        record.year === currentYear &&
        record.paid &&
        (record.amount || 0) > 0 &&
        !record.deliveryCloseId;
      if (!isPendingForClose) return record;
      return { ...record, deliveryCloseId: closeId, updatedAt: now };
    }));

    setDeliveryCloses(prev => [
      {
        id: closeId,
        year: currentYear,
        createdAt: now,
        totalAmount: pendingDeliveryTotal,
        itemCount: pendingDeliveryRecords.length,
        note: note.trim(),
      },
      ...prev,
    ]);
  }, [currentYear, pendingDeliveryRecords, pendingDeliveryTotal]);

  return {
    irsControlMap,
    pendingDeliveryTotal,
    pendingDeliveryCount: pendingDeliveryRecords.length,
    pendingMbWayTotal,
    deliveryHistoryForYear,
    handleCloseDelivery,
    handleIrsDeliveredToggle,
    handleIrsPaidToggle,
    handleIrsPaymentMethodChange,
    handleIrsAmountChange,
    handleIrsNotesChange,
  };
};
