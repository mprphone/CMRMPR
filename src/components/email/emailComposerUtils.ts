import { Client } from '../../types';

export const CLIENT_EMAIL_VARIABLES: (keyof Client)[] = [
  'name', 'nif', 'email', 'phone', 'address', 'sector', 'entityType', 'monthlyFee',
  'turnover', 'status', 'contractRenewalDate',
];
export const SPECIAL_EMAIL_VARIABLES = ['responsible_name', 'avenca_atual', 'nova_avenca'];
export const ALL_EMAIL_VARIABLES = [...CLIENT_EMAIL_VARIABLES, ...SPECIAL_EMAIL_VARIABLES];

export const normalizeEmail = (value: string): string => String(value || '').trim().toLowerCase();
export const isValidEmail = (value: string): boolean =>
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(normalizeEmail(value));

export const formatEmailMoney = (value: unknown): string => {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return '';
  return `${numeric.toLocaleString('pt-PT', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
};

export const escapeEmailHtml = (value: unknown): string => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#39;');

const removeUnsafeHtml = (value: string): string => value
  .replace(/<script[\s\S]*?<\/script>/gi, '')
  .replace(/<style[\s\S]*?<\/style>/gi, '')
  .replace(/\son\w+\s*=\s*(["']).*?\1/gi, '')
  .replace(/javascript:/gi, '');

const inlineMarkdown = (value: string): string => escapeEmailHtml(value)
  .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
  .replace(/__(.+?)__/g, '<strong>$1</strong>')
  .replace(/\[([^\]]+)]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" style="color:#2563eb;text-decoration:underline;">$1</a>');

export const renderEmailBody = (body: string): string => {
  const normalized = String(body || '').replace(/\r\n/g, '\n').trim();
  if (!normalized) return '';
  if (/<[a-z][\s\S]*>/i.test(normalized)) return removeUnsafeHtml(normalized);

  const blocks: string[] = [];
  let list: string[] = [];
  const flushList = () => {
    if (!list.length) return;
    blocks.push(`<ul style="margin:0 0 18px 22px;padding:0;">${list.join('')}</ul>`);
    list = [];
  };

  for (const rawLine of normalized.split('\n')) {
    const line = rawLine.trimEnd();
    if (!line.trim()) {
      flushList();
      continue;
    }
    if (/^\s*[-*]\s+/.test(line)) {
      list.push(`<li style="margin:0 0 8px 0;">${inlineMarkdown(line.replace(/^\s*[-*]\s+/, ''))}</li>`);
      continue;
    }
    flushList();
    const keyValue = line.match(/^([^:]{2,45}:)\s*(.+)$/);
    blocks.push(keyValue
      ? `<p style="margin:0 0 16px 0;"><strong>${escapeEmailHtml(keyValue[1])}</strong> ${inlineMarkdown(keyValue[2])}</p>`
      : `<p style="margin:0 0 18px 0;">${inlineMarkdown(line)}</p>`);
  }
  flushList();
  return blocks.join('');
};

export const applyEmailVariables = (
  template: string,
  client: Client,
  responsibleName: string,
  newFee?: number | null,
): string => {
  const values: Record<string, string> = Object.fromEntries(CLIENT_EMAIL_VARIABLES.map((key) => {
    const value = client[key];
    if (key === 'monthlyFee') return [key, formatEmailMoney(value)];
    if (key === 'turnover') return [key, Number(value || 0).toLocaleString('pt-PT')];
    if (key === 'contractRenewalDate' && value) {
      const date = new Date(String(value));
      return [key, Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString('pt-PT')];
    }
    return [key, value == null ? '' : String(value)];
  }));
  values.responsible_name = responsibleName;
  values.avenca_atual = formatEmailMoney(client.monthlyFee);
  values.nova_avenca = newFee == null ? '' : formatEmailMoney(newFee);

  return Object.entries(values).reduce(
    (result, [key, value]) => result.replace(new RegExp(`{{\\s*${key}\\s*}}`, 'g'), value),
    String(template || ''),
  );
};

export const getUnknownEmailVariables = (subject: string, body: string): string[] => {
  const found = `${subject} ${body}`.match(/{{\s*([^{}]+?)\s*}}/g) || [];
  return Array.from(new Set(found
    .map((token) => token.replace(/{{|}}/g, '').trim())
    .filter((name) => !ALL_EMAIL_VARIABLES.includes(name as any))));
};

export const buildPersonalizedEmailHtml = (body: string, signatureHtml = ''): string => {
  const content = renderEmailBody(body);
  const signature = signatureHtml ? `<div style="margin-top:24px;">${removeUnsafeHtml(signatureHtml)}</div>` : '';
  return `${content}${signature}`;
};

export const buildEmailPreviewDocument = (
  html: string,
  preheader = '',
  campaignType: 'service' | 'marketing' = 'service',
): string => {
  const footer = campaignType === 'marketing'
    ? `<div style="border-top:1px solid #e2e8f0;margin-top:32px;padding-top:16px;color:#64748b;font-size:12px;line-height:1.5;">
        Recebeu esta comunicação por existir uma relação ou autorização registada.
        <a href="#" style="color:#475569;text-decoration:underline;">Deixar de receber comunicações de marketing</a> (pré-visualização — a ligação real é gerada por destinatário).
      </div>`
    : '';

  return `<!doctype html>
<html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#f8fafc;font-family:'Segoe UI',Arial,sans-serif;color:#0f172a;">
${preheader ? `<div style="display:none">${escapeEmailHtml(preheader)}</div>` : ''}
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:20px 10px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:680px;background:white;border:1px solid #e2e8f0;border-radius:12px"><tr><td style="padding:30px;font-size:16px;line-height:1.6">${html}${footer}</td></tr></table>
</td></tr></table></body></html>`;
};

