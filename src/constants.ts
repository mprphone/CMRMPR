
import { Task, TaskArea, TaskType, Client, Staff, TurnoverBracket } from './types';

// Default costs per area (used in Settings)
export const DEFAULT_AREA_COSTS: Record<TaskArea, number> = {
  [TaskArea.CONTABILIDADE]: 25.00,
  [TaskArea.RH]: 22.00,
  [TaskArea.ADMINISTRATIVO]: 18.00,
  [TaskArea.CONSULTORIA]: 50.00,
  [TaskArea.FISCALIDADE]: 40.00,
  [TaskArea.GESTAO]: 45.00,
};

// Based on the user's provided image/table
export const DEFAULT_TURNOVER_BRACKETS: TurnoverBracket[] = [
  { id: 'tb1', minTurnover: 0, maxTurnover: 24999.99, minPercent: 0.20, maxPercent: 0.20 },
  { id: 'tb2', minTurnover: 25000, maxTurnover: 49999.99, minPercent: 0.08, maxPercent: 0.15 },
  { id: 'tb3', minTurnover: 50000, maxTurnover: 99999.99, minPercent: 0.07, maxPercent: 0.11 },
  { id: 'tb4', minTurnover: 100000, maxTurnover: 149999.99, minPercent: 0.05, maxPercent: 0.09 },
  { id: 'tb5', minTurnover: 150000, maxTurnover: 199999.99, minPercent: 0.04, maxPercent: 0.08 },
  { id: 'tb6', minTurnover: 200000, maxTurnover: 249999.99, minPercent: 0.03, maxPercent: 0.07 },
  { id: 'tb7', minTurnover: 250000, maxTurnover: 299999.99, minPercent: 0.03, maxPercent: 0.07 },
  { id: 'tb8', minTurnover: 300000, maxTurnover: 549999.99, minPercent: 0.02, maxPercent: 0.05 },
  { id: 'tb9', minTurnover: 550000, maxTurnover: 999999.99, minPercent: 0.02, maxPercent: 0.03 },
  { id: 'tb10', minTurnover: 1000000, maxTurnover: 1999999.99, minPercent: 0.01, maxPercent: 0.02 },
  { id: 'tb11', minTurnover: 2000000, maxTurnover: 999999999, minPercent: 0.01, maxPercent: 0.01 },
];

export const DEFAULT_STAFF: Staff[] = [
  { 
    id: 's1', 
    name: 'Ana Silva', 
    role: 'Contabilista Sénior', 
    email: 'ana@gabinete.pt',
    baseSalary: 2000,
    socialChargesPercent: 23.75,
    mealAllowance: 150,
    otherMonthlyCosts: 100,
    capacityHoursPerMonth: 140,
    hourlyCost: 35.00, // Pre-calculated approx
    assignedAreas: [TaskArea.CONTABILIDADE, TaskArea.FISCALIDADE]
  },
  { 
    id: 's2', 
    name: 'João Santos', 
    role: 'Técnico de Contabilidade', 
    email: 'joao@gabinete.pt',
    baseSalary: 1200,
    socialChargesPercent: 23.75,
    mealAllowance: 150,
    otherMonthlyCosts: 50,
    capacityHoursPerMonth: 160,
    hourlyCost: 20.00,
    assignedAreas: [TaskArea.CONTABILIDADE]
  },
  { 
    id: 's3', 
    name: 'Maria Costa', 
    role: 'Gestora de RH', 
    email: 'maria@gabinete.pt',
    baseSalary: 1400,
    socialChargesPercent: 23.75,
    mealAllowance: 150,
    otherMonthlyCosts: 50,
    capacityHoursPerMonth: 150,
    hourlyCost: 28.00,
    assignedAreas: [TaskArea.RH]
  },
  { 
    id: 's4', 
    name: 'Pedro Admin', 
    role: 'Administrativo', 
    email: 'pedro@gabinete.pt',
    baseSalary: 900,
    socialChargesPercent: 23.75,
    mealAllowance: 150,
    otherMonthlyCosts: 30,
    capacityHoursPerMonth: 160,
    hourlyCost: 15.00,
    assignedAreas: [TaskArea.ADMINISTRATIVO]
  },
];

export const DEFAULT_TASKS: Task[] = [
  // Contabilidade - Base
  { id: 't1', name: 'Lançar Contabilidade (Docs)', area: TaskArea.CONTABILIDADE, type: TaskType.OBRIGACAO, defaultTimeMinutes: 4, defaultFrequencyPerYear: 12, multiplierLogic: 'documentCount' },
  { id: 't2', name: 'Reconciliações Bancárias', area: TaskArea.CONTABILIDADE, type: TaskType.OBRIGACAO, defaultTimeMinutes: 30, defaultFrequencyPerYear: 12, multiplierLogic: 'banks' },
  { id: 't3', name: 'Conferência de Contas', area: TaskArea.CONTABILIDADE, type: TaskType.OBRIGACAO, defaultTimeMinutes: 60, defaultFrequencyPerYear: 4 },
  { id: 't4', name: 'Pagamento IRC - Por Conta', area: TaskArea.CONTABILIDADE, type: TaskType.OBRIGACAO, defaultTimeMinutes: 15, defaultFrequencyPerYear: 3 },
  { id: 't5', name: 'Modelo 30', area: TaskArea.CONTABILIDADE, type: TaskType.OBRIGACAO, defaultTimeMinutes: 30, defaultFrequencyPerYear: 12 }, 
  { id: 't6', name: 'IVA Trimestral', area: TaskArea.CONTABILIDADE, type: TaskType.OBRIGACAO, defaultTimeMinutes: 45, defaultFrequencyPerYear: 4 },
  { id: 't7', name: 'IVA Mensal', area: TaskArea.CONTABILIDADE, type: TaskType.OBRIGACAO, defaultTimeMinutes: 45, defaultFrequencyPerYear: 12 },
  { id: 't8', name: 'Declaração Recapitulativa IVA', area: TaskArea.CONTABILIDADE, type: TaskType.OBRIGACAO, defaultTimeMinutes: 20, defaultFrequencyPerYear: 12 },
  { id: 't9', name: 'Banco de Portugal (COPE)', area: TaskArea.CONTABILIDADE, type: TaskType.OBRIGACAO, defaultTimeMinutes: 20, defaultFrequencyPerYear: 12 },
  { id: 't10', name: 'Balancete Mensal (Envio)', area: TaskArea.CONTABILIDADE, type: TaskType.OBRIGACAO, defaultTimeMinutes: 15, defaultFrequencyPerYear: 12 },
  
  // Contabilidade - Encerramento
  { id: 't11', name: 'Movimentos Encerramento Contas', area: TaskArea.CONTABILIDADE, type: TaskType.OBRIGACAO, defaultTimeMinutes: 180, defaultFrequencyPerYear: 1 },
  { id: 't12', name: 'DF - Balanço e Dem. Res.', area: TaskArea.CONTABILIDADE, type: TaskType.OBRIGACAO, defaultTimeMinutes: 60, defaultFrequencyPerYear: 1 },
  { id: 't13', name: 'DF - Anexo', area: TaskArea.CONTABILIDADE, type: TaskType.OBRIGACAO, defaultTimeMinutes: 180, defaultFrequencyPerYear: 1 },
  { id: 't14', name: 'Modelo 10', area: TaskArea.CONTABILIDADE, type: TaskType.OBRIGACAO, defaultTimeMinutes: 60, defaultFrequencyPerYear: 1 },
  { id: 't15', name: 'Modelo 22', area: TaskArea.CONTABILIDADE, type: TaskType.OBRIGACAO, defaultTimeMinutes: 120, defaultFrequencyPerYear: 1 },
  { id: 't16', name: 'Pagto IRC - Autoliquidação', area: TaskArea.CONTABILIDADE, type: TaskType.OBRIGACAO, defaultTimeMinutes: 15, defaultFrequencyPerYear: 1 },
  { id: 't17', name: 'IES / Dossier Fiscal', area: TaskArea.CONTABILIDADE, type: TaskType.OBRIGACAO, defaultTimeMinutes: 180, defaultFrequencyPerYear: 1 },

  // RH
  { id: 't30', name: 'Processamento Salarial (por func.)', area: TaskArea.RH, type: TaskType.OBRIGACAO, defaultTimeMinutes: 15, defaultFrequencyPerYear: 14, multiplierLogic: 'employeeCount' },
  { id: 't31', name: 'DRI - Segurança Social', area: TaskArea.RH, type: TaskType.OBRIGACAO, defaultTimeMinutes: 15, defaultFrequencyPerYear: 12 },
  { id: 't32', name: 'DMR - Finanças', area: TaskArea.RH, type: TaskType.OBRIGACAO, defaultTimeMinutes: 15, defaultFrequencyPerYear: 12 },
  { id: 't33', name: 'Pagto Segurança Social', area: TaskArea.RH, type: TaskType.OBRIGACAO, defaultTimeMinutes: 10, defaultFrequencyPerYear: 12 },
  { id: 't34', name: 'Relatório Único', area: TaskArea.RH, type: TaskType.OBRIGACAO, defaultTimeMinutes: 120, defaultFrequencyPerYear: 1 },
  { id: 't35', name: 'Gestão de Penhoras', area: TaskArea.RH, type: TaskType.EXTRA, defaultTimeMinutes: 30, defaultFrequencyPerYear: 1 },

  // Administrativo / Outros
  { id: 't50', name: 'Faturação a Cliente (SaaS)', area: TaskArea.ADMINISTRATIVO, type: TaskType.OBRIGACAO, defaultTimeMinutes: 15, defaultFrequencyPerYear: 12 },
  { id: 't51', name: 'Envio SAFT Faturação', area: TaskArea.ADMINISTRATIVO, type: TaskType.OBRIGACAO, defaultTimeMinutes: 15, defaultFrequencyPerYear: 12 },
  { id: 't52', name: 'Comunicação Inventários', area: TaskArea.ADMINISTRATIVO, type: TaskType.OBRIGACAO, defaultTimeMinutes: 20, defaultFrequencyPerYear: 1 },
  { id: 't53', name: 'Renovação IAPMEI', area: TaskArea.ADMINISTRATIVO, type: TaskType.EXTRA, defaultTimeMinutes: 60, defaultFrequencyPerYear: 1 },
  { id: 't54', name: 'Emissão Guias IUC', area: TaskArea.ADMINISTRATIVO, type: TaskType.OBRIGACAO, defaultTimeMinutes: 10, defaultFrequencyPerYear: 1, multiplierLogic: 'manual' },

  // Gestão / Estratégia
  { id: 't60', name: 'Orçamento Econ-Financeiro', area: TaskArea.GESTAO, type: TaskType.NECESSIDADE, defaultTimeMinutes: 240, defaultFrequencyPerYear: 1 },
  { id: 't61', name: 'Mapas Execução Orçamental (Report)', area: TaskArea.GESTAO, type: TaskType.NECESSIDADE, defaultTimeMinutes: 60, defaultFrequencyPerYear: 12 },
];

export const MOCK_CLIENTS: Client[] = [
  {
    id: 'c1',
    name: 'Café Central Lda',
    nif: '501234567',
    email: 'geral@cafecentral.pt',
    phone: '210000000',
    sector: 'Restauração',
    responsibleStaff: 'Ana Silva',
    monthlyFee: 250,
    employeeCount: 4,
    establishments: 1,
    banks: 2,
    turnover: 150000,
    documentCount: 85,
    callTimeBalance: 30, // minutes per month
    travelCount: 0,
    status: 'Ativo',
    contractRenewalDate: '2024-12-01',
    tasks: [
      { taskId: 't1', frequencyPerYear: 12, multiplier: 85 }, // Docs
      { taskId: 't2', frequencyPerYear: 12, multiplier: 2 }, // Banks
      { taskId: 't6', frequencyPerYear: 4, multiplier: 1 }, // IVA Trim
      { taskId: 't15', frequencyPerYear: 1, multiplier: 1 }, // Mod 22
      { taskId: 't17', frequencyPerYear: 1, multiplier: 1 }, // IES
      { taskId: 't30', frequencyPerYear: 14, multiplier: 4 }, // 4 employees
      { taskId: 't32', frequencyPerYear: 12, multiplier: 1 },
    ]
  },
  {
    id: 'c2',
    name: 'TechSolutions Unipessoal',
    nif: '509876543',
    email: 'ceo@techsolutions.pt',
    phone: '220000000',
    sector: 'Tecnologia',
    responsibleStaff: 'João Santos',
    monthlyFee: 400,
    employeeCount: 1,
    establishments: 1,
    banks: 3,
    turnover: 350000,
    documentCount: 15,
    callTimeBalance: 60,
    travelCount: 2,
    status: 'Ativo',
    contractRenewalDate: '2024-06-15',
    tasks: [
      { taskId: 't1', frequencyPerYear: 12, multiplier: 15 },
      { taskId: 't6', frequencyPerYear: 4, multiplier: 1 },
      { taskId: 't15', frequencyPerYear: 1, multiplier: 1 },
      { taskId: 't61', frequencyPerYear: 12, multiplier: 1 }, // Reporting
      { taskId: 't30', frequencyPerYear: 14, multiplier: 1 },
    ]
  },
  {
    id: 'c3',
    name: 'Oficina do Zé',
    nif: '505555555',
    email: 'ze@oficina.pt',
    phone: '910000000',
    sector: 'Serviços',
    responsibleStaff: 'Ana Silva',
    monthlyFee: 150,
    employeeCount: 3,
    establishments: 1,
    banks: 1,
    turnover: 80000,
    documentCount: 40,
    callTimeBalance: 120, // High support need
    travelCount: 4,
    status: 'Risco',
    contractRenewalDate: '2024-05-30',
    tasks: [
      { taskId: 't1', frequencyPerYear: 12, multiplier: 40 },
      { taskId: 't2', frequencyPerYear: 12, multiplier: 1 },
      { taskId: 't6', frequencyPerYear: 4, multiplier: 1 },
      { taskId: 't15', frequencyPerYear: 1, multiplier: 1 },
      { taskId: 't30', frequencyPerYear: 14, multiplier: 3 },
      { taskId: 't32', frequencyPerYear: 12, multiplier: 1 },
      { taskId: 't34', frequencyPerYear: 1, multiplier: 1 },
    ]
  }
];
