import {
  AccessRole,
  DataScope,
  normalizeModulePermissions,
  UserAccessProfile,
} from '../accessControl';
import { ensureStoreClient } from './supabaseClient';

const mapAccessRow = (row: any): UserAccessProfile => ({
  userId: row.user_id,
  email: row.email || '',
  displayName: row.display_name || '',
  accessRole: row.access_role as AccessRole,
  active: Boolean(row.active),
  modulePermissions: normalizeModulePermissions(row.module_permissions),
  dataScope: row.data_scope as DataScope,
  staffId: row.staff_id || null,
  allowedClientIds: Array.isArray(row.allowed_client_ids) ? row.allowed_client_ids : [],
  allowedGroupIds: Array.isArray(row.allowed_group_ids) ? row.allowed_group_ids : [],
  insuranceAgent: row.insurance_agent || null,
  canViewFinancial: Boolean(row.can_view_financial),
  canViewCommissions: Boolean(row.can_view_commissions),
  canSyncWampr: Boolean(row.can_sync_wampr),
  canManageUsers: Boolean(row.can_manage_users),
  updatedAt: row.updated_at || null,
});

export const accessControlService = {
  async getMyProfile(): Promise<UserAccessProfile | null> {
    const client = ensureStoreClient();
    const { data, error } = await client.rpc('get_my_access_profile').maybeSingle();
    if (error) throw error;
    return data ? mapAccessRow(data) : null;
  },

  async listUsers(): Promise<UserAccessProfile[]> {
    const client = ensureStoreClient();
    const { data, error } = await client.rpc('admin_list_user_access');
    if (error) throw error;
    return (data || []).map(mapAccessRow);
  },

  async updateUser(profile: UserAccessProfile): Promise<void> {
    const client = ensureStoreClient();
    const { error } = await client.rpc('admin_update_user_access', {
      p_user_id: profile.userId,
      p_display_name: profile.displayName,
      p_access_role: profile.accessRole,
      p_active: profile.active,
      p_module_permissions: profile.modulePermissions,
      p_data_scope: profile.dataScope,
      p_staff_id: profile.staffId,
      p_allowed_client_ids: profile.allowedClientIds,
      p_allowed_group_ids: profile.allowedGroupIds,
      p_insurance_agent: profile.insuranceAgent,
      p_can_view_financial: profile.canViewFinancial,
      p_can_view_commissions: profile.canViewCommissions,
      p_can_sync_wampr: profile.canSyncWampr,
      p_can_manage_users: profile.canManageUsers,
    });
    if (error) throw error;
  },

  async createUser(input: { email: string; displayName: string; password: string }): Promise<{ id: string; email: string }> {
    const client = ensureStoreClient();
    const { data, error } = await client.functions.invoke('manage-users', {
      body: { action: 'create', ...input },
    });
    if (error) throw error;
    if (!data?.success || !data?.user?.id) {
      throw new Error(data?.error || 'Não foi possível criar o utilizador.');
    }
    return data.user;
  },

  async resetPassword(userId: string, password: string): Promise<void> {
    const client = ensureStoreClient();
    const { data, error } = await client.functions.invoke('manage-users', {
      body: { action: 'reset_password', userId, password },
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Não foi possível alterar a palavra-passe.');
  },

  /** Remove o MFA de OUTRA conta (recuperação de acesso perdido ao autenticador). */
  async disableUserMfa(userId: string): Promise<number> {
    const client = ensureStoreClient();
    const { data, error } = await client.functions.invoke('manage-users', {
      body: { action: 'disable_mfa', userId },
    });
    if (error) throw error;
    if (!data?.success) throw new Error(data?.error || 'Não foi possível remover o MFA desta conta.');
    return Number(data?.removedFactors || 0);
  },
};
