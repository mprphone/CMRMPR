export interface ClientPaymentPlan {
  id?: string;
  clientId: string;
  year: number;
  paidUntilMonth: number;
  monthlyAmount: number;
  debtAmount: number;
  status: 'Ativo' | 'Anulado' | 'Concluido';
  notes: string;
  called: boolean;
  letterSent: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface PlanFormState {
  monthlyAmount: string;
  debtAmount: string;
  payUntilMonth: number;
  payUntilYear: number;
  notes: string;
  called: boolean;
  letterSent: boolean;
}

export interface SessionExpense {
  id: string;
  amount: number;
  description: string;
}
