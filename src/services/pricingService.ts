import { TurnoverBracket, QuoteHistory } from '../types';
import { ensureStoreClient } from './supabaseClient';

const mapDbToTurnoverBracket = (db: any): TurnoverBracket => ({
  id: db.id,
  minTurnover: db.min_turnover,
  maxTurnover: db.max_turnover,
  minPercent: db.min_percent,
  maxPercent: db.max_percent,
});

const mapTurnoverBracketToDb = (b: TurnoverBracket) => ({
  id: b.id,
  min_turnover: b.minTurnover,
  max_turnover: b.maxTurnover,
  min_percent: b.minPercent,
  max_percent: b.maxPercent,
});

export const turnoverBracketService = {
  async getAll(): Promise<TurnoverBracket[]> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.from('turnover_brackets').select('*').order('min_turnover');
    if (error) throw error;
    return (data || []).map(mapDbToTurnoverBracket);
  },
  async replaceAll(brackets: TurnoverBracket[]): Promise<void> { // This function is more robust
    const storeClient = ensureStoreClient();
    
    // Get all existing IDs from the DB to determine which ones to delete
    const { data: existingBrackets, error: fetchError } = await storeClient.from('turnover_brackets').select('id');
    if (fetchError) throw fetchError;
    const existingIds = existingBrackets.map(b => b.id);
    const newIds = brackets.map(b => b.id);

    // Find and delete brackets that are no longer in the UI list
    const idsToDelete = existingIds.filter(id => !newIds.includes(id));
    if (idsToDelete.length > 0) {
        const { error: deleteError } = await storeClient.from('turnover_brackets').delete().in('id', idsToDelete);
        if (deleteError) throw deleteError;
    }

    if (brackets.length === 0) return;
    // Upsert all current brackets. This will update existing ones and insert new ones.
    const { error: upsertError } = await storeClient
      .from('turnover_brackets')
      .upsert(brackets.map(mapTurnoverBracketToDb), { onConflict: 'id' });
    if (upsertError) throw upsertError;
  }
};

const mapDbToQuoteHistory = (db: any): QuoteHistory => ({
  id: db.id,
  created_at: db.created_at,
  client_name: db.client_name,
  client_nif: db.client_nif,
  client_volume: db.client_volume,
  employee_count: db.employee_count || 0,
  document_count: db.document_count || 0,
  establishments: db.establishments || 0,
  banks: db.banks || 0,
  items: db.items,
  target_margin: db.target_margin,
  recommended_monthly_fee: db.recommended_monthly_fee,
  total_annual_cost: db.total_annual_cost,
  total_annual_hours: db.total_annual_hours,
});

const mapQuoteHistoryToDb = (q: Partial<QuoteHistory>) => ({
  id: q.id,
  client_name: q.client_name,
  client_nif: q.client_nif,
  client_volume: q.client_volume,
  employee_count: q.employee_count,
  document_count: q.document_count,
  establishments: q.establishments,
  banks: q.banks,
  items: q.items,
  target_margin: q.target_margin,
  recommended_monthly_fee: q.recommended_monthly_fee,
  total_annual_cost: q.total_annual_cost,
  total_annual_hours: q.total_annual_hours,
});

export const quoteHistoryService = {
  async getAll(): Promise<QuoteHistory[]> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient
      .from('quote_history')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;
    return (data || []).map(mapDbToQuoteHistory);
  },
  async create(quote: Partial<QuoteHistory>): Promise<QuoteHistory> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.from('quote_history').insert(mapQuoteHistoryToDb(quote)).select().single();
    if (error) throw error;
    return mapDbToQuoteHistory(data);
  },
  async delete(id: string): Promise<void> {
    const storeClient = ensureStoreClient();
    const { error } = await storeClient.from('quote_history').delete().match({ id });
    if (error) throw error;
  }
};
