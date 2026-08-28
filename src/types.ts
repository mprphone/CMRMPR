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
  id?: string;
  taskId?: string;
  quantity: number;
  frequency: number;
  customName?: string;
  customArea?: TaskArea | string;
  customTimeMinutes?: number;
  customHourlyCost?: number;
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
  status: 'Ativo' | 'Inativo';
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
  saftCollectEnabled?: boolean;

  tasks: ClientTaskOverride[];
  status: 'Ativo' | 'Em Análise' | 'Risco' | 'Cancelado' | 'Inativo';
  contractRenewalDate: string;
  emailMarketingStatus?: 'unknown' | 'consented' | 'legitimate_interest' | 'opted_out';
  emailMarketingConsentAt?: string | null;
  emailMarketingConsentSource?: string | null;
  aiAnalysisCache?: AiAnalysis | null;
}

export interface SaftDossierData {
  attachments?: SaftDossierAttachment[];
  clientNif: string;
  clientName: string;
  sourceDetailUrl?: string;
  atStatus?: string;
  atCollectedAt?: string | null;
  ssStatus?: string;
  ssCollectedAt?: string | null;
  certidaoAtStatus?: string;
  certidaoSsStatus?: string;
  certidaoPermanenteStatus?: string;
  certidaoPermanenteCode?: string;
  rawList?: Record<string, any>;
  rawDetail?: Record<string, any>;
  syncedAt: string;
  updatedAt: string;
}

export interface SaftDossierAttachment {
  label: string;
  actionPath: string;
  fileName?: string;
  contentType?: string;
  sizeBytes?: number;
  storagePath?: string;
  publicUrl?: string;
  syncedAt?: string;
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
  preheader?: string;
  category?: string;
  approval_status?: 'draft' | 'approved' | 'archived';
  version?: number;
  created_at?: string;
  updated_at?: string;
}

export interface CampaignRecipientResult {
  id?: string;
  client_id?: string | null;
  name: string;
  email: string;
  status: 'success' | 'error' | 'pending' | 'sending' | 'retry' | 'accepted' | 'delivered' | 'bounced' | 'complained' | 'failed' | 'cancelled' | 'suppressed' | 'skipped';
  error?: string;
  exclusion_reason?: string | null;
  attempts?: number;
  max_attempts?: number;
  provider_message_id?: string | null;
  updated_at?: string;
}

export interface CampaignHistory {
  id: string;
  sent_at: string;
  subject: string;
  body: string;
  recipient_count: number;
  recipient_ids?: string[];
  recipient_results?: CampaignRecipientResult[];
  group_name: string;
  status: string;
  scheduled_at?: string | null;
  send_delay?: number | null;
  template_id?: string | null;
  delivery_status?: 'draft' | 'scheduled' | 'queued' | 'processing' | 'completed' | 'partial' | 'failed' | 'cancelled';
  campaign_type?: 'service' | 'marketing';
  preheader?: string;
  signature_html?: string;
  from_name?: string;
  from_email?: string;
  reply_to?: string | null;
  created_by?: string | null;
  updated_at?: string;
  started_at?: string | null;
  completed_at?: string | null;
  idempotency_key?: string | null;
  eligible_count?: number;
  excluded_count?: number;
  success_count?: number;
  failure_count?: number;
  bounce_count?: number;
  last_error?: string | null;
}

export interface EmailSuppression {
  id: string;
  email: string;
  email_normalized: string;
  reason: 'unsubscribe' | 'hard_bounce' | 'complaint' | 'invalid' | 'manual';
  source: string;
  notes?: string | null;
  created_at: string;
  lifted_at?: string | null;
}

export interface EmailAutomation {
  id: string;
  name: string;
  is_active: boolean;
  client_group: string;
  admin_email: string;
  from_name: string;
  from_email: string;
  reply_to?: string | null;
  subject_hint: string;
  ai_instructions: string;
  trigger_type?: 'monthly_documents';
  schedule_day?: number;
  schedule_hour?: number;
  requires_approval?: boolean;
  campaign_type?: 'service' | 'marketing';
  last_run_at?: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface EmailAutomationRun {
  id: string;
  automation_id: string;
  run_month: string;
  started_at: string;
  finished_at?: string | null;
  status: string;
  successes: number;
  failures: number;
  details?: Record<string, unknown> | null;
  error?: string | null;
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
  policyHolder?: string;
  agent?: string;
  mediatorPartner?: 'Finiconde' | 'Neoseguros' | 'Outra' | string;
  internalResponsible?: string;
  policyDate: string;
  renewalDate?: string;
  policyNumber?: string;
  company?: string;
  branch?: string;
  insuranceProvider?: string;
  paymentFrequency: 'Mensal' | 'Trimestral' | 'Semestral' | 'Anual';
  policyType: string;
  premiumValue: number;
  netPremiumValue?: number;
  commissionRate: number;
  commissionPaid: boolean;
  hasReceipt?: boolean;
  status: 'Proposta' | 'Aceite' | 'Cancelada';
  communicationType?: string;
  notes?: string;
  policyTier?: 'Base' | 'Flexível';
  attachment_url?: string;
  documentChecklist?: Record<string, boolean>;
  createdAt?: string;
  updatedAt?: string;
}

export interface InsuranceCommissionSettlement {
  id: string;
  policyId: string;
  dueDate: string;
  amount: number;
  paidAt: string;
  createdAt: string;
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
  documentChecklist?: Record<string, boolean>;
  profileData?: WorkSafetyProfileData;
  aiObligationsSummary?: string;
}

export interface WorkSafetyProfileData {
  nif?: string;
  nic?: string;
  cae?: string;
  irct?: string;
  workSchedule?: string;
  occupationalMedicineAdmissionDate?: string;
  occupationalMedicinePeriodicDate?: string;
  occupationalMedicineHasRecords?: boolean;
  safetyVisitsNotes?: string;
  safetyReportMeasuresNotes?: string;
  providerDetails?: string;
  providerPeriodicity?: 'Semestral' | 'Anual' | 'Bi-anual';
  nextDueDate?: string;
  paidValue?: number;
  commissionValue?: number;
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
  status: 'Ativo' | 'Anulado' | 'Concluido';
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

export interface CashSessionExpense {
  id: string;
  amount: number;
  description: string;
  cashOperationId: string | null;
  createdAt: string;
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

