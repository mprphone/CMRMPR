import { Staff } from '../types';
import { importClient, ensureStoreClient } from './supabaseClient';

const mapDbToStaff = (s: any): Staff => ({
  id: s.id,
  name: s.name || s.nome || s.Name || s.Nome || s.funcionario || s.Funcionario || 'Sem Nome',
  email: s.email || '',
  phone: s.phone || s.telefone || s.Phone || s.Telefone || '',
  role: s.role || 'Colaborador',
  baseSalary: Number(s.base_salary || 0),
  socialChargesPercent: Number(s.social_charges_percent || 23.75),
  mealAllowance: Number(s.meal_allowance || 0),
  otherMonthlyCosts: Number(s.other_monthly_costs || 0),
  capacityHoursPerMonth: Number(s.capacity_hours_per_month || 160),
  hourlyCost: Number(s.hourly_cost || 0),
  assignedAreas: s.assigned_areas || []
});

const mapStaffToDb = (s: Staff) => ({
  id: s.id,
  name: s.name,
  email: s.email,
  phone: s.phone,
  role: s.role,
  base_salary: s.baseSalary,
  social_charges_percent: s.socialChargesPercent,
  meal_allowance: s.mealAllowance,
  other_monthly_costs: s.otherMonthlyCosts,
  capacity_hours_per_month: s.capacityHoursPerMonth,
  hourly_cost: s.hourlyCost,
  assigned_areas: s.assignedAreas
});

export const staffService = {
  async getAll(): Promise<Staff[]> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.from('staff').select('*');
    if (error) throw error;
    return (data || []).map(mapDbToStaff);
  },
  async importExternalStaff(): Promise<Staff[]> {
    if (!importClient) throw new Error("Origem não configurada.");
    const { data, error } = await importClient.from('funcionarios').select('*');
    if (error) throw error;
    // Import only identifying info, set defaults for financial data
    return (data || []).map(s => (mapDbToStaff(s)));
  },
  async bulkUpsert(members: Staff[]): Promise<void> {
    const storeClient = ensureStoreClient();
    // During sync, we only want to update core identification fields.
    const staffToUpsert = members.map(s => ({
      id: s.id, // Conflict key
      name: s.name,
      email: s.email,
      phone: s.phone,
      role: s.role,
      // Financial data is managed inside the app, so we don't overwrite it during sync.
    }));
    const { error } = await storeClient.from('staff').upsert(staffToUpsert, { onConflict: 'id' });
    if (error) throw error;
  },
  async upsert(member: Staff): Promise<Staff> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.from('staff').upsert(mapStaffToDb(member)).select().single();
    if (error) throw error;
    return mapDbToStaff(data);
  }
};
