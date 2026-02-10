export enum TaskArea {
  CONTABILIDADE = 'Contabilidade',
  RH = 'Recursos Humanos',
  ADMINISTRATIVO = 'Administrativo',
  CONSULTORIA = 'Consultoria',
  FISCALIDADE = 'Fiscalidade',
  GESTAO = 'Gestão'
}

export type MultiplierLogic = 'manual' | 'employeeCount' | 'documentCount' | 'establishments' | 'banks';

export enum TaskType {
  OBRIGACAO = 'Obrigação',
  NECESSIDADE = 'Necessidade',
  EXTRA = 'Extra'
}

export interface Task {
  id: string;
  name: string;
  area: TaskArea;
  type: TaskType;
  defaultTimeMinutes: number;
  defaultFrequencyPerYear: number;
  multiplierLogic?: MultiplierLogic;
}

export interface QuoteItem {
  taskId: string;
  quantity: number;
  frequency: number;
}

export interface ClientTaskOverride {
  taskId: string;
  frequencyPerYear: number;
  multiplier: number;
  assignedStaffId?: string;
}

export interface Staff {
  id: string;
  name: string;
  role: string;
  email?: string;
  phone?: string;
  baseSalary: number;
  socialChargesPercent: number;
  mealAllowance: number;
  otherMonthlyCosts: number;
  capacityHoursPerMonth: number;
  hourlyCost: number;
  assignedAreas: TaskArea[];
}

export interface FeeGroup {
  id: string;
  name: string;
  description: string;
  clientIds: string[];
  proposed_fees?: Record<string, number>;
}

export interface Client {
  id: string;
  name: string;
  email: string;
  phone: string;
  address?: string;
  nif: string;
  sector: string;
  entityType?: string; // ex: Lda, Unipessoal, Individual
  responsibleStaff: string;
  monthlyFee: number;
  
  employeeCount: number;
  establishments: number;
  banks: number;
  turnover: number;
  documentCount: number;
  callTimeBalance: number;
  travelCount: number;
  
  // Complexity Indicators
  deliversOrganizedDocs?: boolean;
  vatRefunds?: boolean;
  hasIneReport?: boolean;
  hasCostCenters?: boolean;
  hasInternationalOps?: boolean;
  hasManagementReports?: boolean;
  supplierCount?: number;
  customerCount?: number;
  communicationCount?: number;
  meetingCount?: number;
  previousYearProfit?: number;

  tasks: ClientTaskOverride[];
  status: 'Ativo' | 'Em Análise' | 'Risco' | 'Cancelado';
  contractRenewalDate: string;
  aiAnalysisCache?: AiAnalysis | null;
}

export interface GlobalSettings {
  payrollUnitCost: number;
  documentUnitCost: number;
  supabaseImportUrl: string;
  supabaseImportKey: string;
  supabaseImportClientsTable?: string;
  supabaseImportStaffTable?: string;
  supabaseStoreUrl: string;
  supabaseStoreKey: string;
  resendApiKey?: string;
  fromEmail?: string;
  fromName?: string;
  emailSignature?: string;
}

export interface AnalysisResult {
  totalAnnualHours: number;
  totalAnnualCost: number;
  totalAnnualRevenue: number;
  profitability: number;
  hourlyReturn: number;
  suggestion: string;
  usedHourlyRate: number;
  turnoverAnalysis?: {
    minRecommendedFee: number;
    maxRecommendedFee: number;
    status: 'Subavaliado' | 'Ajustado' | 'Acima da Média';
    bracketPercentUsed: number;
  };
}

export interface AiAnalysis {
  parecer: string;
  avenca_sugerida: number;
}

export interface AiTemplateAnalysis {
  subject: string;
  body: string;
}

export interface EmailTemplate {
  id: string;
  name: string;
  subject: string;
  body: string;
}

export interface CampaignHistory {
  id: string;
  sent_at: string;
  subject: string;
  body: string;
  recipient_count: number;
  group_name: string;
  status: string;
}

export interface QuoteHistory {
  id: string;
  created_at: string;
  client_name: string;
  client_nif: string;
  client_volume: number;
  employee_count: number;
  document_count: number;
  establishments: number;
  banks: number;
  items: QuoteItem[];
  target_margin: number;
  recommended_monthly_fee: number;
  total_annual_cost: number;
  total_annual_hours: number;
}

export interface InsurancePolicy {
  id: string;
  clientId?: string;
  clientName?: string; // For display
  policyDate: string;
  policyNumber?: string;
  insuranceProvider?: string;
  paymentFrequency: 'Mensal' | 'Trimestral' | 'Semestral' | 'Anual';
  policyType: string;
  premiumValue: number;
  commissionRate: number;
  commissionPaid: boolean;
  status: 'Proposta' | 'Aceite';
  communicationType?: string;
  policyTier?: 'Base' | 'Flexível';
  attachment_url?: string;
}

export interface AppNotification {
  id: string;
  type: 'critical' | 'warning' | 'info' | 'success';
  title: string;
  message: string;
  date: string;
  clientId?: string;
  actionLabel?: string;
}

export interface WorkSafetyService {
  id: string;
  clientId: string;
  clientName?: string; // For display
  serviceDate: string;
  renewalTerm: 'Anual' | 'Bi-anual';
  provider: string;
  totalValue: number;
  hasCommission: boolean;
  isCommissionPaid: boolean;
  proposalStatus: 'Não enviada' | 'Enviada' | 'Aceite' | 'Recusada';
  attachment_url?: string;
}

export interface CashPayment {
  id: string;
  clientId: string;
  paymentYear: number;
  paymentMonth: number;
  amountPaid: number;
  paidAt: string;
  paymentMethod: 'Numerário' | 'MB Way';
  cashOperationId: string | null;
}

export interface CashAgreement {
  id: string;
  clientId: string;
  agreementYear: number;
  paidUntilMonth: number;
  monthlyAmount: number;
  debtAmount: number;
  notes: string;
  called: boolean;
  letterSent: boolean;
  createdAt: string;
  updatedAt: string;
}
export interface CashOperation {
  id: string;
  createdAt: string;
  depositedAmount: number;
  spentAmount: number;
  mbWayDepositedAmount?: number;
  adjustmentAmount?: number;
  spentDescription: string;
  reportDetails: {
    clientName: string;
    months: string[];
    total: number;
    method: 'Numerário' | 'MB Way';
  }[];
}

export interface StaffStats {
  staffName: string;
  clientCount: number;
  allocatedHoursMonth: number;
  capacityUtilization: number;
  totalRevenue: number;
  totalCost: number;
  profitability: number;
}

// Added TurnoverBracket interface to fix missing export errors across the application
export interface TurnoverBracket {
  id: string;
  minTurnover: number;
  maxTurnover: number;
  minPercent: number;
  maxPercent: number;
}

