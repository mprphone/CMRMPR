import { GlobalSettings, Task, TaskArea, TaskType, MultiplierLogic } from '../types';
import { ensureStoreClient } from './supabaseClient';

export const APP_CONFIG_GLOBAL_SETTINGS_KEY = 'global_settings';

export interface VersionedGlobalSettings {
  value: Partial<GlobalSettings>;
  updatedAt: string | null;
}

export interface GlobalSettingsSaveResult extends VersionedGlobalSettings {
  conflict: boolean;
}

export interface VersionedTaskCatalog {
  tasks: Task[];
  version: string | null;
}

export interface TaskCatalogSaveResult extends VersionedTaskCatalog {
  conflict: boolean;
}

const toIsoStringOrNull = (value: string | null | undefined): string | null => value || null;

export const appConfigService = {
  async getValueByKey<T = unknown>(key: string): Promise<T | null> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient
      .from('app_config')
      .select('value')
      .eq('key', key)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    return (data.value as T) || null;
  },
  async upsertValueByKey<T = unknown>(key: string, value: T): Promise<void> {
    const storeClient = ensureStoreClient();
    const { error } = await storeClient
      .from('app_config')
      .upsert(
        {
          key,
          value,
        },
        { onConflict: 'key' }
      );

    if (error) throw error;
  },
  async getGlobalSettingsWithMeta(): Promise<VersionedGlobalSettings | null> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient
      .from('app_config')
      .select('value, updated_at')
      .eq('key', APP_CONFIG_GLOBAL_SETTINGS_KEY)
      .maybeSingle();

    if (error) throw error;
    if (!data) return null;
    return {
      value: (data.value as Partial<GlobalSettings>) || {},
      updatedAt: toIsoStringOrNull(data.updated_at),
    };
  },
  async getGlobalSettings(): Promise<Partial<GlobalSettings> | null> {
    const data = await this.getGlobalSettingsWithMeta();
    return data?.value || null;
  },
  async upsertGlobalSettingsWithConflict(
    settings: GlobalSettings,
    expectedUpdatedAt: string | null
  ): Promise<GlobalSettingsSaveResult> {
    const storeClient = ensureStoreClient();
    try {
      const { data, error } = await storeClient
        .rpc('save_global_settings_if_match', {
          p_value: settings,
          p_expected_updated_at: expectedUpdatedAt,
        })
        .single();

      if (error) throw error;
      return {
        conflict: Boolean(data.conflict),
        value: (data.value as Partial<GlobalSettings>) || {},
        updatedAt: toIsoStringOrNull(data.updated_at),
      };
    } catch (err: any) {
      // Fallback for environments where the new RPC is not deployed yet.
      const schemaError = /function .*save_global_settings_if_match.* does not exist|schema cache/i;
      if (!schemaError.test(err?.message || '')) throw err;

      const { error } = await storeClient
        .from('app_config')
        .upsert(
          {
            key: APP_CONFIG_GLOBAL_SETTINGS_KEY,
            value: settings,
          },
          { onConflict: 'key' }
        );
      if (error) throw error;

      const saved = await this.getGlobalSettingsWithMeta();
      return {
        conflict: false,
        value: saved?.value || {},
        updatedAt: saved?.updatedAt || null,
      };
    }
  },
  async upsertGlobalSettings(settings: GlobalSettings): Promise<void> {
    await this.upsertGlobalSettingsWithConflict(settings, null);
  },
};

const mapDbTaskToTask = (db: any): Task => ({
  id: db.id,
  name: db.name,
  area: db.area as TaskArea,
  type: db.type as TaskType,
  defaultTimeMinutes: db.default_time_minutes,
  defaultFrequencyPerYear: db.default_frequency_per_year,
  multiplierLogic: (db.multiplier_logic || undefined) as MultiplierLogic | undefined,
});

const mapTaskToDb = (task: Task) => ({
  id: task.id,
  name: task.name,
  area: task.area,
  type: task.type,
  default_time_minutes: task.defaultTimeMinutes,
  default_frequency_per_year: task.defaultFrequencyPerYear,
  multiplier_logic: task.multiplierLogic || null,
});

export const taskCatalogService = {
  async getAllWithVersion(): Promise<VersionedTaskCatalog> {
    const storeClient = ensureStoreClient();
    const { data, error } = await storeClient.from('app_tasks').select('*').order('name');
    if (error) throw error;
    const rows = data || [];
    const version =
      rows.length === 0
        ? null
        : rows.reduce((latest, row: any) => {
            const updatedAt = toIsoStringOrNull(row.updated_at);
            if (!updatedAt) return latest;
            if (!latest) return updatedAt;
            return updatedAt > latest ? updatedAt : latest;
          }, null as string | null);

    return {
      tasks: rows.map(mapDbTaskToTask),
      version,
    };
  },
  async getAll(): Promise<Task[]> {
    const { tasks } = await this.getAllWithVersion();
    return tasks;
  },
  async replaceAllWithConflict(tasks: Task[], expectedVersion: string | null): Promise<TaskCatalogSaveResult> {
    const storeClient = ensureStoreClient();
    const payload = tasks.map(mapTaskToDb);

    try {
      const { data, error } = await storeClient
        .rpc('replace_app_tasks_if_version', {
          p_tasks: payload,
          p_expected_version: expectedVersion,
        })
        .single();

      if (error) throw error;

      const latest = await this.getAllWithVersion();
      return {
        conflict: Boolean(data.conflict),
        tasks: latest.tasks,
        version: latest.version,
      };
    } catch (err: any) {
      // Fallback for environments where the new RPC is not deployed yet.
      const schemaError = /function .*replace_app_tasks_if_version.* does not exist|schema cache/i;
      if (!schemaError.test(err?.message || '')) throw err;

      if (payload.length > 0) {
        const { error: upsertError } = await storeClient.from('app_tasks').upsert(payload, { onConflict: 'id' });
        if (upsertError) throw upsertError;
      }

      const { data: existingRows, error: existingError } = await storeClient.from('app_tasks').select('id');
      if (existingError) throw existingError;

      const incomingIds = new Set(tasks.map(task => task.id));
      const idsToDelete = (existingRows || [])
        .map((row: any) => row.id as string)
        .filter((id: string) => !incomingIds.has(id));

      if (idsToDelete.length > 0) {
        const { error: deleteError } = await storeClient.from('app_tasks').delete().in('id', idsToDelete);
        if (deleteError) throw deleteError;
      }

      const latest = await this.getAllWithVersion();
      return {
        conflict: false,
        tasks: latest.tasks,
        version: latest.version,
      };
    }
  },
  async replaceAll(tasks: Task[]): Promise<void> {
    await this.replaceAllWithConflict(tasks, null);
  },
};
