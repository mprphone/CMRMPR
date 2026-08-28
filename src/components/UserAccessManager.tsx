import React, { useEffect, useMemo, useState } from 'react';
import { KeyRound, Plus, RefreshCcw, Save, ShieldCheck, UserCog, X } from 'lucide-react';
import {
  AccessRole,
  APP_MODULES,
  DataScope,
  getRolePreset,
  ModulePermissionSet,
  PermissionAction,
  UserAccessProfile,
} from '../accessControl';
import { accessControlService } from '../services';
import { Client, FeeGroup, Staff } from '../types';

interface UserAccessManagerProps {
  currentProfile: UserAccessProfile;
  clients: Client[];
  groups: FeeGroup[];
  staff: Staff[];
  onCurrentProfileChanged: (profile: UserAccessProfile) => void;
}

const roleLabels: Record<AccessRole, string> = {
  admin: 'Administrador',
  manager: 'Gestor',
  user: 'Utilizador',
  insurance: 'Seguros próprios',
  custom: 'Personalizado',
};

const actionLabels: Record<PermissionAction, string> = {
  view: 'Ver',
  create: 'Criar',
  edit: 'Editar',
  delete: 'Eliminar',
  export: 'Exportar',
};

const cloneProfile = (profile: UserAccessProfile): UserAccessProfile => ({
  ...profile,
  modulePermissions: Object.fromEntries(
    Object.entries(profile.modulePermissions).map(([module, permission]) => [module, { ...permission }]),
  ) as UserAccessProfile['modulePermissions'],
  allowedClientIds: [...profile.allowedClientIds],
  allowedGroupIds: [...profile.allowedGroupIds],
});

const UserAccessManager: React.FC<UserAccessManagerProps> = ({
  currentProfile,
  clients,
  groups,
  staff,
  onCurrentProfileChanged,
}) => {
  const [users, setUsers] = useState<UserAccessProfile[]>([]);
  const [selectedUserId, setSelectedUserId] = useState<string>('');
  const [draft, setDraft] = useState<UserAccessProfile | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [isManagingAccount, setIsManagingAccount] = useState(false);
  const [accountForm, setAccountForm] = useState<{
    mode: 'create' | 'reset' | null;
    email: string;
    displayName: string;
    password: string;
  }>({ mode: null, email: '', displayName: '', password: '' });
  const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const loadUsers = async (preferredId?: string) => {
    setIsLoading(true);
    setMessage(null);
    try {
      const loaded = await accessControlService.listUsers();
      setUsers(loaded);
      const nextId = preferredId && loaded.some(user => user.userId === preferredId)
        ? preferredId
        : selectedUserId && loaded.some(user => user.userId === selectedUserId)
          ? selectedUserId
          : loaded[0]?.userId || '';
      setSelectedUserId(nextId);
      setDraft(loaded.find(user => user.userId === nextId) ? cloneProfile(loaded.find(user => user.userId === nextId)!) : null);
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Não foi possível carregar os utilizadores.' });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers(currentProfile.userId);
  }, []);

  const selectedUser = useMemo(
    () => users.find(user => user.userId === selectedUserId) || null,
    [users, selectedUserId],
  );

  const selectUser = (userId: string) => {
    setSelectedUserId(userId);
    const profile = users.find(user => user.userId === userId);
    setDraft(profile ? cloneProfile(profile) : null);
    setMessage(null);
  };

  const applyRole = (accessRole: AccessRole) => {
    if (!draft) return;
    const preset = getRolePreset(accessRole);
    setDraft({
      ...draft,
      accessRole,
      ...preset,
      insuranceAgent: accessRole === 'insurance' ? (draft.insuranceAgent || 'Paula') : draft.insuranceAgent,
    });
  };

  const updateModulePermission = (module: keyof UserAccessProfile['modulePermissions'], action: PermissionAction, enabled: boolean) => {
    if (!draft) return;
    const current = draft.modulePermissions[module];
    const next: ModulePermissionSet = {
      ...current,
      [action]: enabled,
      ...(action === 'view' && !enabled ? { create: false, edit: false, delete: false, export: false } : {}),
      ...(action !== 'view' && enabled ? { view: true } : {}),
    };
    setDraft({
      ...draft,
      accessRole: draft.accessRole === 'admin' ? 'admin' : 'custom',
      modulePermissions: { ...draft.modulePermissions, [module]: next },
    });
  };

  const updateSelectedValues = (field: 'allowedClientIds' | 'allowedGroupIds', options: HTMLCollectionOf<HTMLOptionElement>) => {
    if (!draft) return;
    setDraft({ ...draft, [field]: Array.from(options).filter(option => option.selected).map(option => option.value) });
  };

  const save = async () => {
    if (!draft) return;
    setIsSaving(true);
    setMessage(null);
    try {
      await accessControlService.updateUser(draft);
      const refreshedCurrent = draft.userId === currentProfile.userId
        ? await accessControlService.getMyProfile()
        : null;
      if (refreshedCurrent) onCurrentProfileChanged(refreshedCurrent);
      await loadUsers(draft.userId);
      setMessage({ type: 'success', text: 'Permissões guardadas e aplicadas.' });
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Não foi possível guardar as permissões.' });
    } finally {
      setIsSaving(false);
    }
  };

  const closeAccountForm = () => {
    setAccountForm({ mode: null, email: '', displayName: '', password: '' });
  };

  const createAccount = async () => {
    setIsManagingAccount(true);
    setMessage(null);
    try {
      const created = await accessControlService.createUser({
        email: accountForm.email,
        displayName: accountForm.displayName,
        password: accountForm.password,
      });
      closeAccountForm();
      await loadUsers(created.id);
      setMessage({
        type: 'success',
        text: `Conta ${created.email} criada. Confirme agora o perfil e as permissões antes de entregar o acesso.`,
      });
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Não foi possível criar a conta.' });
    } finally {
      setIsManagingAccount(false);
    }
  };

  const resetPassword = async () => {
    if (!draft) return;
    if (!window.confirm(`Alterar a palavra-passe de ${draft.email}? A palavra-passe anterior deixa de funcionar imediatamente.`)) return;
    setIsManagingAccount(true);
    setMessage(null);
    try {
      await accessControlService.resetPassword(draft.userId, accountForm.password);
      closeAccountForm();
      setMessage({ type: 'success', text: `Palavra-passe de ${draft.email} alterada com sucesso.` });
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Não foi possível alterar a palavra-passe.' });
    } finally {
      setIsManagingAccount(false);
    }
  };

  const disableMfaForUser = async () => {
    if (!draft) return;
    if (!window.confirm(`Remover o MFA de ${draft.email}? Use apenas para recuperação de acesso perdido ao autenticador — a conta fica temporariamente sem 2º fator até voltar a ativá-lo.`)) return;
    setIsManagingAccount(true);
    setMessage(null);
    try {
      const removed = await accessControlService.disableUserMfa(draft.userId);
      setMessage({
        type: 'success',
        text: removed > 0
          ? `MFA removido de ${draft.email}. Peça para ativar de novo em Configurações → Segurança da sua conta.`
          : `${draft.email} já não tinha nenhum fator MFA ativo.`,
      });
    } catch (error: any) {
      setMessage({ type: 'error', text: error?.message || 'Não foi possível remover o MFA desta conta.' });
    } finally {
      setIsManagingAccount(false);
    }
  };

  const passwordIsValid = accountForm.password.length >= 12
    && /[a-z]/.test(accountForm.password)
    && /[A-Z]/.test(accountForm.password)
    && /[0-9]/.test(accountForm.password);

  if (isLoading) {
    return (
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 flex items-center gap-3 text-slate-500">
        <RefreshCcw size={18} className="animate-spin" /> A carregar utilizadores...
      </div>
    );
  }

  return (
    <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100 space-y-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h3 className="font-bold text-slate-800 flex items-center gap-2"><UserCog size={19} /> Utilizadores e permissões</h3>
          <p className="text-xs text-slate-500 mt-1">As regras são aplicadas no ecrã, na API e diretamente na base de dados.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setAccountForm({ mode: 'create', email: '', displayName: '', password: '' })}
            className="text-xs font-bold px-3 py-2 rounded-lg bg-blue-600 text-white hover:bg-blue-700 flex items-center gap-2"
          >
            <Plus size={14} /> Criar conta
          </button>
          <button onClick={() => void loadUsers(selectedUserId)} className="text-xs font-bold px-3 py-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 flex items-center gap-2">
            <RefreshCcw size={14} /> Atualizar
          </button>
        </div>
      </div>

      {message && (
        <div className={`rounded-lg px-4 py-3 text-sm ${message.type === 'success' ? 'bg-green-50 text-green-700 border border-green-100' : 'bg-red-50 text-red-700 border border-red-100'}`}>
          {message.text}
        </div>
      )}

      {accountForm.mode && (
        <div className="rounded-xl border border-blue-200 bg-blue-50 p-4 space-y-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h4 className="font-bold text-slate-800 flex items-center gap-2">
                {accountForm.mode === 'create' ? <Plus size={17} /> : <KeyRound size={17} />}
                {accountForm.mode === 'create' ? 'Nova conta local' : `Nova palavra-passe — ${draft?.email || ''}`}
              </h4>
              <p className="text-xs text-slate-600 mt-1">A palavra-passe não fica visível nem é guardada neste ecrã.</p>
            </div>
            <button type="button" onClick={closeAccountForm} className="p-1 text-slate-500 hover:text-slate-800" aria-label="Fechar">
              <X size={18} />
            </button>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            {accountForm.mode === 'create' && (
              <>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Nome</label>
                  <input
                    value={accountForm.displayName}
                    onChange={event => setAccountForm({ ...accountForm, displayName: event.target.value })}
                    autoComplete="off"
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-white"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-600 mb-1">Email</label>
                  <input
                    type="email"
                    value={accountForm.email}
                    onChange={event => setAccountForm({ ...accountForm, email: event.target.value })}
                    autoComplete="off"
                    className="w-full px-3 py-2 border rounded-lg text-sm bg-white"
                  />
                </div>
              </>
            )}
            <div className={accountForm.mode === 'reset' ? 'md:col-span-2' : ''}>
              <label className="block text-xs font-bold text-slate-600 mb-1">Palavra-passe temporária</label>
              <input
                type="password"
                value={accountForm.password}
                onChange={event => setAccountForm({ ...accountForm, password: event.target.value })}
                autoComplete="new-password"
                className="w-full px-3 py-2 border rounded-lg text-sm bg-white"
              />
              <p className={`text-[10px] mt-1 ${passwordIsValid ? 'text-green-700' : 'text-slate-500'}`}>
                Mínimo 12 caracteres, com maiúscula, minúscula e número.
              </p>
            </div>
            <div className="flex items-end">
              <button
                type="button"
                disabled={
                  isManagingAccount
                  || !passwordIsValid
                  || (accountForm.mode === 'create' && (!accountForm.email.trim() || !accountForm.displayName.trim()))
                }
                onClick={() => void (accountForm.mode === 'create' ? createAccount() : resetPassword())}
                className="w-full px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {isManagingAccount ? <RefreshCcw size={15} className="animate-spin" /> : accountForm.mode === 'create' ? <Plus size={15} /> : <KeyRound size={15} />}
                {accountForm.mode === 'create' ? 'Criar conta' : 'Alterar palavra-passe'}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] gap-6">
        <div className="border border-slate-200 rounded-xl overflow-hidden self-start">
          {users.map(user => (
            <button
              key={user.userId}
              onClick={() => selectUser(user.userId)}
              className={`w-full text-left p-4 border-b last:border-b-0 transition-colors ${selectedUserId === user.userId ? 'bg-blue-50 border-blue-100' : 'hover:bg-slate-50 border-slate-100'}`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-bold text-slate-800 truncate">{user.displayName || user.email}</span>
                <span className={`w-2 h-2 rounded-full ${user.active ? 'bg-green-500' : 'bg-slate-300'}`} />
              </div>
              <p className="text-xs text-slate-500 truncate mt-1">{user.email}</p>
              <p className="text-[10px] uppercase font-bold text-blue-600 mt-2">{roleLabels[user.accessRole]}</p>
            </button>
          ))}
        </div>

        {draft && selectedUser && (
          <div className="space-y-6 min-w-0">
            <div className="flex flex-wrap justify-end gap-2">
              <button
                type="button"
                disabled={isManagingAccount}
                onClick={() => void disableMfaForUser()}
                className="text-xs font-bold px-3 py-2 rounded-lg border border-red-200 text-red-700 hover:bg-red-50 disabled:opacity-50 flex items-center gap-2"
              >
                <ShieldCheck size={14} /> Remover MFA
              </button>
              <button
                type="button"
                onClick={() => setAccountForm({ mode: 'reset', email: '', displayName: '', password: '' })}
                className="text-xs font-bold px-3 py-2 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-2"
              >
                <KeyRound size={14} /> Alterar palavra-passe
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Nome</label>
                <input value={draft.displayName} onChange={event => setDraft({ ...draft, displayName: event.target.value })} className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Email</label>
                <input value={draft.email} readOnly className="w-full px-3 py-2 border rounded-lg text-sm bg-slate-50 text-slate-500" />
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Perfil base</label>
                <select value={draft.accessRole} onChange={event => applyRole(event.target.value as AccessRole)} className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
                  {Object.entries(roleLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                </select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 px-3 py-2 border rounded-lg w-full text-sm">
                  <input type="checkbox" checked={draft.active} onChange={event => setDraft({ ...draft, active: event.target.checked })} />
                  Conta ativa no CMR
                </label>
              </div>
            </div>

            <div>
              <h4 className="text-sm font-bold text-slate-800 mb-3 flex items-center gap-2"><ShieldCheck size={16} /> Módulos e ações</h4>
              <div className="overflow-x-auto border rounded-xl">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 text-[10px] uppercase text-slate-500">
                    <tr>
                      <th className="text-left px-3 py-2">Módulo</th>
                      {(Object.keys(actionLabels) as PermissionAction[]).map(action => <th key={action} className="text-center px-2 py-2">{actionLabels[action]}</th>)}
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {APP_MODULES.map(module => (
                      <tr key={module.id}>
                        <td className="px-3 py-2 font-medium text-slate-700">{module.label}</td>
                        {(Object.keys(actionLabels) as PermissionAction[]).map(action => (
                          <td key={action} className="text-center px-2 py-2">
                            <input
                              type="checkbox"
                              aria-label={`${module.label}: ${actionLabels[action]}`}
                              checked={draft.modulePermissions[module.id][action]}
                              onChange={event => updateModulePermission(module.id, action, event.target.checked)}
                            />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Dados visíveis</label>
                <select value={draft.dataScope} onChange={event => setDraft({ ...draft, dataScope: event.target.value as DataScope })} className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
                  <option value="all">Todos os dados permitidos</option>
                  <option value="assigned">Apenas clientes atribuídos</option>
                  <option value="selected">Clientes/grupos selecionados</option>
                  <option value="insurance_own">Apenas seguros do responsável</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Colaborador associado</label>
                <select value={draft.staffId || ''} onChange={event => setDraft({ ...draft, staffId: event.target.value || null })} className="w-full px-3 py-2 border rounded-lg text-sm bg-white">
                  <option value="">Sem associação</option>
                  {staff.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}
                </select>
              </div>
            </div>

            {draft.dataScope === 'insurance_own' && (
              <div>
                <label className="block text-xs font-bold text-slate-500 mb-1">Responsável dos seguros</label>
                <input value={draft.insuranceAgent || ''} onChange={event => setDraft({ ...draft, insuranceAgent: event.target.value })} placeholder="Ex.: Paula" className="w-full px-3 py-2 border rounded-lg text-sm" />
              </div>
            )}

            {draft.dataScope === 'selected' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">Clientes permitidos</label>
                  <select multiple size={8} value={draft.allowedClientIds} onChange={event => updateSelectedValues('allowedClientIds', event.target.options)} className="w-full px-3 py-2 border rounded-lg text-xs bg-white">
                    {[...clients].sort((a, b) => a.name.localeCompare(b.name)).map(client => <option key={client.id} value={client.id}>{client.name} — {client.nif}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-bold text-slate-500 mb-1">Grupos permitidos</label>
                  <select multiple size={8} value={draft.allowedGroupIds} onChange={event => updateSelectedValues('allowedGroupIds', event.target.options)} className="w-full px-3 py-2 border rounded-lg text-xs bg-white">
                    {[...groups].sort((a, b) => a.name.localeCompare(b.name)).map(group => <option key={group.id} value={group.id}>{group.name}</option>)}
                  </select>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {[
                ['canViewFinancial', 'Ver custos, avenças e rentabilidade'],
                ['canViewCommissions', 'Ver e gerir comissões de seguros'],
                ['canSyncWampr', 'Executar sincronização WAPRO → CMR'],
                ['canManageUsers', 'Gerir utilizadores e permissões'],
              ].map(([field, label]) => (
                <label key={field} className="flex items-center gap-2 px-3 py-2 border rounded-lg text-sm">
                  <input
                    type="checkbox"
                    checked={Boolean(draft[field as keyof UserAccessProfile])}
                    onChange={event => setDraft({ ...draft, [field]: event.target.checked, accessRole: draft.accessRole === 'admin' ? 'admin' : 'custom' })}
                  />
                  {label}
                </label>
              ))}
            </div>

            <div className="flex justify-end">
              <button onClick={() => void save()} disabled={isSaving} className="bg-blue-600 text-white px-5 py-2 rounded-lg text-sm font-bold hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
                {isSaving ? <RefreshCcw size={16} className="animate-spin" /> : <Save size={16} />} Guardar permissões
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default UserAccessManager;
