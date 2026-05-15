import { CashPayment, CashAgreement, CashOperation, CashSessionExpense } from '../types';
import { ensureStoreClient } from './supabaseClient';

const mapDbToCashSessionExpense = (db: any): CashSessionExpense => ({
  id: db.id,
  amount: db.amount,
  description: db.description || '',
  cashOperationId: db.cash_operation_id,
  createdAt: db.created_at,
});

export const cashSessionExpenseService = {
  async getOpen(): Promise<CashSessionExpense[]> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient
      .from('cash_session_expenses')
      .select('*')
      .is('cash_operation_id', null)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return (data || []).map(mapDbToCashSessionExpense);
  },
  async create(expense: Pick<CashSessionExpense, 'amount' | 'description'>): Promise<CashSessionExpense> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient
      .from('cash_session_expenses')
      .insert({
        amount: expense.amount,
        description: expense.description,
      })
      .select('*')
      .single();

    if (error) throw error;
    return mapDbToCashSessionExpense(data);
  },
  async bulkCreate(expenses: Pick<CashSessionExpense, 'amount' | 'description'>[]): Promise<CashSessionExpense[]> {
    if (expenses.length === 0) return [];
    const storeClient = ensureStoreClient();
    const payload = expenses.map(expense => ({
      amount: expense.amount,
      description: expense.description,
    }));

    const { data, error } = await storeClient
      .from('cash_session_expenses')
      .insert(payload)
      .select('*');

    if (error) throw error;
    return (data || []).map(mapDbToCashSessionExpense);
  },
  async delete(id: string): Promise<void> {
    const storeClient = ensureStoreClient();
    const { error } = await storeClient.from('cash_session_expenses').delete().eq('id', id);
    if (error) throw error;
  },
  async attachToOperation(expenseIds: string[], operationId: string): Promise<void> {
    if (expenseIds.length === 0) return;
    const storeClient = ensureStoreClient();
    const { error } = await storeClient
      .from('cash_session_expenses')
      .update({ cash_operation_id: operationId })
      .in('id', expenseIds);

    if (error) throw error;
  },
};

export const cashPaymentService = {
  async getAll(): Promise<CashPayment[]> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.from('cash_payments').select('*');
    if (error) throw error;
    return data.map(p => ({
      id: p.id,
      clientId: p.client_id,
      paymentYear: p.payment_year,
      paymentMonth: p.payment_month,
      amountPaid: p.amount_paid,
      paidAt: p.paid_at,
      paymentMethod: p.payment_method || 'Numerário',
      cashOperationId: p.cash_operation_id,
    }));
  },
  async bulkUpsert(payments: Partial<CashPayment>[]): Promise<void> {
    const storeClient = ensureStoreClient();
    const toSave = payments.map(p => ({
      id: p.id,
      client_id: p.clientId,
      payment_year: p.paymentYear,
      payment_month: p.paymentMonth,
      amount_paid: p.amountPaid,
      paid_at: p.paidAt,
      payment_method: p.paymentMethod,
    }));
    const { error } = await storeClient.rpc('bulk_upsert_cash_payments', { payments_data: toSave });
    if (error) throw error;
  },
  async deleteMany(ids: string[]): Promise<void> {
    const storeClient = ensureStoreClient();
    const { error } = await storeClient.from('cash_payments').delete().in('id', ids);
    if (error) throw error;
  }
};

export const cashAgreementService = {
  async getAll(): Promise<CashAgreement[]> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient
      .from('cash_payment_agreements')
      .select('*')
      .order('agreement_year', { ascending: false });

    if (error) throw error;

    return (data || []).map(a => ({
      id: a.id,
      clientId: a.client_id,
      agreementYear: a.agreement_year,
      paidUntilMonth: a.paid_until_month,
      monthlyAmount: a.monthly_amount,
      debtAmount: a.debt_amount,
      status: a.status || 'Ativo',
      notes: a.notes || '',
      called: a.called || false,
      letterSent: a.letter_sent || false,
      createdAt: a.created_at,
      updatedAt: a.updated_at,
    }));
  },
  async upsert(agreement: Partial<CashAgreement>): Promise<CashAgreement> {
    const storeClient = ensureStoreClient();

    const payload: any = {
      client_id: agreement.clientId,
      agreement_year: agreement.agreementYear,
      paid_until_month: agreement.paidUntilMonth,
      monthly_amount: agreement.monthlyAmount,
      debt_amount: agreement.debtAmount,
      status: agreement.status || 'Ativo',
      notes: agreement.notes || '',
      called: agreement.called || false,
      letter_sent: agreement.letterSent || false,
    };
    if (agreement.id) payload.id = agreement.id;

    const { data, error } = await storeClient
      .from('cash_payment_agreements')
      .upsert(payload, { onConflict: 'client_id,agreement_year' })
      .select()
      .single();

    if (error) throw error;

    return {
      id: data.id,
      clientId: data.client_id,
      agreementYear: data.agreement_year,
      paidUntilMonth: data.paid_until_month,
      monthlyAmount: data.monthly_amount,
      debtAmount: data.debt_amount,
      status: data.status || 'Ativo',
      notes: data.notes || '',
      called: data.called || false,
      letterSent: data.letter_sent || false,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    };
  },
  async delete(id: string): Promise<void> {
    const storeClient = ensureStoreClient();
    const { error } = await storeClient.from('cash_payment_agreements').delete().match({ id });
    if (error) throw error;
  }
};

const mapDbToCashOperation = (op: any): CashOperation => ({
  id: op.id,
  createdAt: op.created_at,
  depositedAmount: op.deposited_amount,
  spentAmount: op.spent_amount,
  mbWayDepositedAmount: op.mbway_deposited_amount,
  adjustmentAmount: op.adjustment_amount,
  spentDescription: op.spent_description,
  reportDetails: op.report_details,
});

export const cashOperationService = {
  async getAll(): Promise<CashOperation[]> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.from('cash_operations').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return data.map(mapDbToCashOperation);
  },
  async create(operation: Partial<CashOperation>, paymentIds: string[], sessionExpenseIds: string[] = []): Promise<CashOperation> {
    const storeClient = ensureStoreClient();
    const payload = {
      p_deposited_amount: operation.depositedAmount,
      p_spent_amount: operation.spentAmount,
      p_spent_description: operation.spentDescription,
      p_report_details: operation.reportDetails,
      p_payment_ids: paymentIds,
      p_mbway_deposited_amount: operation.mbWayDepositedAmount,
      p_adjustment_amount: operation.adjustmentAmount,
    };

    try {
      const { data, error } = await storeClient
        .rpc('close_cash_register_atomic', {
          ...payload,
          p_session_expense_ids: sessionExpenseIds,
        })
        .single();

      if (error) throw error;
      return mapDbToCashOperation(data);
    } catch (err: any) {
      // Fallback for environments where the atomic RPC is not deployed yet.
      const schemaError = /function .*close_cash_register_atomic.* does not exist|schema cache/i;
      if (!schemaError.test(err?.message || '')) throw err;

      const { data, error } = await storeClient.rpc('create_cash_operation', payload).single();
      if (error) throw error;

      if (sessionExpenseIds.length > 0) {
        const { error: attachError } = await storeClient
          .from('cash_session_expenses')
          .update({ cash_operation_id: data.id })
          .in('id', sessionExpenseIds)
          .is('cash_operation_id', null);

        if (attachError) throw attachError;
      }

      return mapDbToCashOperation(data);
    }
  }
};
