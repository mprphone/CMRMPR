import { FeeGroup } from '../types';
import { ensureStoreClient } from './supabaseClient';

export const groupService = {
  async getAll(): Promise<FeeGroup[]> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.from('fee_groups').select('*');
    if (error) throw error;
    return (data || []).map(g => ({ id: g.id, name: g.name, description: g.description, clientIds: g.client_ids || [], proposed_fees: g.proposed_fees || {} }));
  },
  async upsert(group: FeeGroup): Promise<FeeGroup> {
    const storeClient = ensureStoreClient();
    const groupToSave = { id: group.id, name: group.name, description: group.description, client_ids: group.clientIds, proposed_fees: group.proposed_fees || {} };
    const { data, error } = await storeClient.from('fee_groups').upsert(groupToSave).select().single();
    if (error) throw error;
    // Map back from DB schema to app schema
    return { id: data.id, name: data.name, description: data.description, clientIds: data.client_ids || [], proposed_fees: data.proposed_fees || {} };
  }
};
