import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { appConfigService } from '../../services/supabase';

export interface IrsControlRecord {
  clientId: string;
  year: number;
  delivered: boolean;
  paid: boolean;
  amount: number;
  paymentMethod: 'Numerário' | 'MB Way';
  notes: string;
  irsSettlementAmount: number;
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
const IRS_CONTROL_APP_CONFIG_KEY = 'cashier_irs_control_v1';

interface IrsControlPersistedState {
  records?: unknown;
  deliveryCloses?: unknown;
  closes?: unknown;
}

const normalizeIrsControlRecords = (parsedValue: unknown): IrsControlRecord[] => {
  if (!Array.isArray(parsedValue)) return [];

  return parsedValue.reduce<IrsControlRecord[]>((acc, item: any) => {
    const clientId = typeof item?.clientId === 'string' ? item.clientId : '';
    const year = Number(item?.year);
    if (!clientId || !Number.isFinite(year)) return acc;

    const irsSettlementAmountRaw = Number(item?.irsSettlementAmount);

    acc.push({
      clientId,
      year,
      delivered: Boolean(item?.delivered),
      paid: Boolean(item?.paid),
      amount: Number.isFinite(Number(item?.amount)) ? Number(item.amount) : 0,
      paymentMethod: item?.paymentMethod === 'MB Way' ? 'MB Way' : 'Numerário',
      notes: typeof item?.notes === 'string' ? item.notes : '',
      irsSettlementAmount: Number.isFinite(irsSettlementAmountRaw) ? irsSettlementAmountRaw : 0,
      deliveryCloseId: typeof item?.deliveryCloseId === 'string' ? item.deliveryCloseId : null,
      updatedAt: typeof item?.updatedAt === 'string' ? item.updatedAt : new Date().toISOString(),
    });
    return acc;
  }, []);
};

const normalizeIrsDeliveryCloses = (parsedValue: unknown): IrsDeliveryClose[] => {
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
};

const parseStoredIrsControlRecords = (rawValue: string | null): IrsControlRecord[] => {
  if (!rawValue) return [];
  try {
    return normalizeIrsControlRecords(JSON.parse(rawValue));
  } catch {
    return [];
  }
};

const parseStoredIrsDeliveryCloses = (rawValue: string | null): IrsDeliveryClose[] => {
  if (!rawValue) return [];
  try {
    return normalizeIrsDeliveryCloses(JSON.parse(rawValue));
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
  const initialLocalRecordsRef = useRef(irsControlRecords);
  const initialLocalClosesRef = useRef(deliveryCloses);
  const [isDbHydrated, setIsDbHydrated] = useState(false);
  const [isDbAvailable, setIsDbAvailable] = useState(true);

  const irsControlMap = useMemo(() => {
    const map = new Map<string, IrsControlRecord>();
    irsControlRecords.forEach(record => {
      map.set(`${record.clientId}-${record.year}`, record);
    });
    return map;
  }, [irsControlRecords]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(IRS_CONTROL_STORAGE_KEY, JSON.stringify(irsControlRecords));
    } catch (err) {
      console.error('Erro ao guardar controlo IRS localmente:', err);
    }
  }, [irsControlRecords]);
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(IRS_DELIVERY_CLOSES_STORAGE_KEY, JSON.stringify(deliveryCloses));
    } catch (err) {
      console.error('Erro ao guardar histórico de fecho IRS localmente:', err);
    }
  }, [deliveryCloses]);

  useEffect(() => {
    let isMounted = true;

    const hydrateFromDb = async () => {
      try {
        const remoteValue = await appConfigService.getValueByKey<IrsControlPersistedState>(IRS_CONTROL_APP_CONFIG_KEY);
        if (!isMounted) return;

        const remoteRecords = normalizeIrsControlRecords(remoteValue?.records);
        const remoteCloses = normalizeIrsDeliveryCloses(remoteValue?.deliveryCloses ?? remoteValue?.closes);

        if (remoteRecords.length > 0 || remoteCloses.length > 0) {
          setIrsControlRecords(remoteRecords);
          setDeliveryCloses(remoteCloses);
        } else if (initialLocalRecordsRef.current.length > 0 || initialLocalClosesRef.current.length > 0) {
          await appConfigService.upsertValueByKey(IRS_CONTROL_APP_CONFIG_KEY, {
            records: initialLocalRecordsRef.current,
            deliveryCloses: initialLocalClosesRef.current,
          });
        }

        setIsDbAvailable(true);
      } catch (err) {
        console.error('Erro ao sincronizar controlo IRS com o servidor:', err);
        if (isMounted) {
          setIsDbAvailable(false);
        }
      } finally {
        if (isMounted) {
          setIsDbHydrated(true);
        }
      }
    };

    hydrateFromDb();

    return () => {
      isMounted = false;
    };
  }, []);

  useEffect(() => {
    if (!isDbHydrated || !isDbAvailable) return;
    let isMounted = true;

    const timer = window.setTimeout(async () => {
      try {
        await appConfigService.upsertValueByKey(IRS_CONTROL_APP_CONFIG_KEY, {
          records: irsControlRecords,
          deliveryCloses,
        });
      } catch (err) {
        console.error('Erro ao gravar controlo IRS no servidor:', err);
        if (isMounted) {
          setIsDbAvailable(false);
        }
      }
    }, 400);

    return () => {
      isMounted = false;
      window.clearTimeout(timer);
    };
  }, [deliveryCloses, irsControlRecords, isDbAvailable, isDbHydrated]);

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
      const existingForYear = prev.find(record => `${record.clientId}-${record.year}` === recordKey);
      const latestForClient = prev
        .filter(record => record.clientId === clientId)
        .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
      const existing = existingForYear || {
        clientId,
        year: currentYear,
        delivered: false,
        paid: false,
        amount: 0,
        paymentMethod: 'Numerário',
        notes: '',
        irsSettlementAmount: latestForClient?.irsSettlementAmount || 0,
        deliveryCloseId: null,
        updatedAt: new Date().toISOString(),
      };
      const nextRecord = updater(existing);
      const withoutCurrent = prev.filter(record => `${record.clientId}-${record.year}` !== recordKey);
      return [...withoutCurrent, { ...nextRecord, updatedAt: new Date().toISOString() }];
    });
  }, [currentYear]);

  const handleIrsDeliveredToggle = useCallback((clientId: string) => {
    const existing = irsControlMap.get(`${clientId}-${currentYear}`);
    if (existing?.deliveryCloseId) {
      alert('Este registo já está fechado numa entrega de dinheiro.');
      return;
    }
    upsertIrsRecord(clientId, previous => ({ ...previous, delivered: !previous.delivered }));
  }, [currentYear, irsControlMap, upsertIrsRecord]);

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

  const handleIrsSettlementAmountChange = useCallback((clientId: string, amount: number) => {
    upsertIrsRecord(clientId, previous => ({
      ...previous,
      irsSettlementAmount: Number.isFinite(amount) ? amount : 0,
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
        record.paymentMethod === 'Numerário' &&
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
    handleIrsSettlementAmountChange,
  };
};
