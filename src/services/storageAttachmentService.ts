import { ensureStoreClient } from './supabaseClient';

const ATTACHMENTS_BUCKET = 'attachments';
const SIGNED_URL_TTL_SECONDS = 15 * 60;
const MAX_ATTACHMENT_SIZE_BYTES = 25 * 1024 * 1024;
const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  'pdf', 'png', 'jpg', 'jpeg', 'webp', 'doc', 'docx', 'xls', 'xlsx',
]);

export const validateAttachmentFile = (file: File): void => {
  const fileName = String(file?.name || '').trim();
  const extension = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() || '' : '';

  if (!fileName || fileName.includes('..') || /[\\/\u0000-\u001f]/.test(fileName)) {
    throw new Error('O nome do anexo não é válido.');
  }
  if (!ALLOWED_ATTACHMENT_EXTENSIONS.has(extension)) {
    throw new Error('Formato não permitido. Use PDF, imagem, Word ou Excel.');
  }
  if (!Number.isFinite(file.size) || file.size <= 0) {
    throw new Error('O anexo está vazio.');
  }
  if (file.size > MAX_ATTACHMENT_SIZE_BYTES) {
    throw new Error('O anexo não pode exceder 25 MB.');
  }
};

export const getAttachmentStoragePath = (value?: string | null): string | null => {
  const raw = String(value || '').trim();
  if (!raw) return null;

  let candidate = raw;
  try {
    const parsed = new URL(raw);
    const decodedPath = decodeURIComponent(parsed.pathname);
    const markers = [
      `/storage/v1/object/public/${ATTACHMENTS_BUCKET}/`,
      `/storage/v1/object/sign/${ATTACHMENTS_BUCKET}/`,
      `/storage/v1/object/authenticated/${ATTACHMENTS_BUCKET}/`,
    ];
    const marker = markers.find(item => decodedPath.includes(item));
    if (!marker) return null;
    candidate = decodedPath.slice(decodedPath.indexOf(marker) + marker.length);
  } catch {
    candidate = raw.replace(/^\/+/, '').replace(/^attachments\//, '');
  }

  const normalized = candidate.replace(/^\/+/, '').split('?')[0];
  if (!normalized || normalized.includes('..') || normalized.includes('\\')) return null;
  return normalized;
};

export const createSignedAttachmentUrl = async (value?: string | null): Promise<string | undefined> => {
  const path = getAttachmentStoragePath(value);
  if (!path) return undefined;

  const storeClient = ensureStoreClient();
  const { data, error } = await storeClient.storage
    .from(ATTACHMENTS_BUCKET)
    .createSignedUrl(path, SIGNED_URL_TTL_SECONDS);

  if (error) {
    console.error(`Não foi possível autorizar o anexo ${path}:`, error.message);
    return undefined;
  }
  return data.signedUrl;
};
