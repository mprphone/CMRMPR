export type AccessRole = 'admin' | 'manager' | 'user' | 'insurance' | 'custom';
export type DataScope = 'all' | 'assigned' | 'selected' | 'insurance_own';
export type PermissionAction = 'view' | 'create' | 'edit' | 'delete' | 'export';
export type AppModule =
  | 'dashboard'
  | 'clients'
  | 'billing'
  | 'groups'
  | 'insurance'
  | 'sht'
  | 'cashier'
  | 'irs_control'
  | 'emails'
  | 'team'
  | 'tasks'
  | 'calculator'
  | 'settings';

export interface ModulePermissionSet {
  view: boolean;
  create: boolean;
  edit: boolean;
  delete: boolean;
  export: boolean;
}

export type ModulePermissions = Record<AppModule, ModulePermissionSet>;

export interface UserAccessProfile {
  userId: string;
  email: string;
  displayName: string;
  accessRole: AccessRole;
  active: boolean;
  modulePermissions: ModulePermissions;
  dataScope: DataScope;
  staffId: string | null;
  allowedClientIds: string[];
  allowedGroupIds: string[];
  insuranceAgent: string | null;
  canViewFinancial: boolean;
  canViewCommissions: boolean;
  canSyncWampr: boolean;
  canManageUsers: boolean;
  updatedAt?: string | null;
}

export const APP_MODULES: Array<{ id: AppModule; label: string }> = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'clients', label: 'Clientes' },
  { id: 'billing', label: 'Faturação Primavera' },
  { id: 'groups', label: 'Grupos Avenças' },
  { id: 'insurance', label: 'Seguros' },
  { id: 'sht', label: 'SHT' },
  { id: 'cashier', label: 'Caixa Numerário' },
  { id: 'irs_control', label: 'Controlo IRS' },
  { id: 'emails', label: 'Email Marketing' },
  { id: 'team', label: 'Equipa' },
  { id: 'tasks', label: 'Catálogo Tarefas' },
  { id: 'calculator', label: 'Orçamentador' },
  { id: 'settings', label: 'Configurações' },
];

export const MODULE_VIEW_IDS: Record<AppModule, string> = {
  dashboard: 'dashboard',
  clients: 'clients',
  billing: 'billing',
  groups: 'groups',
  insurance: 'insurance',
  sht: 'sht',
  cashier: 'cashier',
  irs_control: 'irs-control',
  emails: 'emails',
  team: 'team',
  tasks: 'tasks',
  calculator: 'calculator',
  settings: 'settings',
};

const allActions = (enabled: boolean): ModulePermissionSet => ({
  view: enabled,
  create: enabled,
  edit: enabled,
  delete: enabled,
  export: enabled,
});

const permissionsWith = (enabledModules: AppModule[]): ModulePermissions =>
  Object.fromEntries(APP_MODULES.map(({ id }) => [id, allActions(enabledModules.includes(id))])) as ModulePermissions;

export const getRolePreset = (role: AccessRole): Pick<
  UserAccessProfile,
  'modulePermissions' | 'dataScope' | 'canViewFinancial' | 'canViewCommissions' | 'canSyncWampr' | 'canManageUsers'
> => {
  if (role === 'admin') {
    return {
      modulePermissions: permissionsWith(APP_MODULES.map(({ id }) => id)),
      dataScope: 'all',
      canViewFinancial: true,
      canViewCommissions: true,
      canSyncWampr: true,
      canManageUsers: true,
    };
  }
  if (role === 'manager') {
    return {
      modulePermissions: {
        ...permissionsWith([
          'dashboard', 'clients', 'billing', 'groups', 'insurance', 'sht', 'cashier',
          'irs_control', 'team', 'tasks', 'calculator',
        ]),
        // Faturação Primavera contém valores financeiros e fica só de leitura
        // por omissão para gestores (alinhado com app_default_module_permissions
        // no lado da base de dados) — sem isto, o formulário de criação de
        // conta pré-selecionava criar/editar/apagar em falta, mesmo que a
        // aplicação ainda não tenha UI para essas ações.
        billing: { view: true, create: false, edit: false, delete: false, export: true },
      },
      dataScope: 'all',
      canViewFinancial: true,
      canViewCommissions: false,
      canSyncWampr: true,
      canManageUsers: false,
    };
  }
  if (role === 'insurance') {
    return {
      modulePermissions: permissionsWith(['insurance']),
      dataScope: 'insurance_own',
      canViewFinancial: false,
      canViewCommissions: false,
      canSyncWampr: false,
      canManageUsers: false,
    };
  }
  if (role === 'custom') {
    return {
      modulePermissions: permissionsWith([]),
      dataScope: 'selected',
      canViewFinancial: false,
      canViewCommissions: false,
      canSyncWampr: false,
      canManageUsers: false,
    };
  }
  return {
    modulePermissions: permissionsWith(['clients', 'groups', 'insurance', 'sht', 'cashier', 'irs_control', 'tasks']),
    dataScope: 'all',
    canViewFinancial: false,
    canViewCommissions: false,
    canSyncWampr: false,
    canManageUsers: false,
  };
};

export const normalizeModulePermissions = (value: unknown): ModulePermissions => {
  const input = value && typeof value === 'object' ? value as Record<string, Partial<ModulePermissionSet>> : {};
  return Object.fromEntries(APP_MODULES.map(({ id }) => {
    const permission = input[id] || {};
    return [id, {
      view: Boolean(permission.view),
      create: Boolean(permission.create),
      edit: Boolean(permission.edit),
      delete: Boolean(permission.delete),
      export: Boolean(permission.export),
    }];
  })) as ModulePermissions;
};

export const hasAppPermission = (
  profile: UserAccessProfile | null | undefined,
  module: AppModule,
  action: PermissionAction = 'view',
): boolean => Boolean(profile?.active && (profile.accessRole === 'admin' || profile.modulePermissions[module]?.[action]));

export const getAccessibleViews = (profile: UserAccessProfile | null | undefined): string[] =>
  APP_MODULES
    .filter(({ id }) => hasAppPermission(profile, id, 'view'))
    .map(({ id }) => MODULE_VIEW_IDS[id]);
