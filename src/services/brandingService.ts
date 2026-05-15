import { ensureStoreClient } from './supabaseClient';

const LOGO_STORAGE_BUCKET = 'attachments';
const LOGO_STORAGE_PATH = 'branding/app-logo';

const buildLogoPublicUrl = (version?: string) => {
  const storeClient = ensureStoreClient();
  const { data } = storeClient.storage.from(LOGO_STORAGE_BUCKET).getPublicUrl(LOGO_STORAGE_PATH);
  if (!version) return data.publicUrl;
  return `${data.publicUrl}?v=${encodeURIComponent(version)}`;
};

export const brandingService = {
  async uploadLogo(file: File): Promise<string> {
    const storeClient = ensureStoreClient();
    const { error: uploadError } = await storeClient.storage
      .from(LOGO_STORAGE_BUCKET)
      .upload(LOGO_STORAGE_PATH, file, {
        cacheControl: '3600',
        upsert: true,
        contentType: file.type || undefined,
      });

    if (uploadError) throw uploadError;

    const { data: files } = await storeClient.storage.from(LOGO_STORAGE_BUCKET).list('branding', {
      limit: 100,
      search: 'app-logo',
    });
    const logoFile = (files || []).find(f => f.name === 'app-logo');
    const version = logoFile?.updated_at || logoFile?.created_at || new Date().toISOString();
    return buildLogoPublicUrl(version);
  },
  async getLogoUrl(): Promise<string | null> {
    const storeClient = ensureStoreClient();
    const { data: files, error } = await storeClient.storage.from(LOGO_STORAGE_BUCKET).list('branding', {
      limit: 100,
      search: 'app-logo',
    });

    if (error) throw error;

    const logoFile = (files || []).find(f => f.name === 'app-logo');
    if (!logoFile) return null;
    const version = logoFile.updated_at || logoFile.created_at || '';
    return buildLogoPublicUrl(version);
  },
};
