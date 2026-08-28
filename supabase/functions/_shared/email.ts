import nodemailer from "npm:nodemailer@6.9.15";

export const emailCorsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret, x-webhook-secret",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

export const mustEmailEnv = (name: string): string => {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} não configurado.`);
  return value;
};

const parseBool = (value: string | undefined, fallback: boolean): boolean => {
  if (value == null || !value.trim()) return fallback;
  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
};

export const cleanEmailHeader = (input: string): string =>
  String(input || "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();

export const normalizeEmailAddress = (input: string): string => String(input || "").trim().toLowerCase();

export const isValidEmailAddress = (input: string): boolean =>
  /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(normalizeEmailAddress(input));

export const escapeEmailHtml = (input: string): string =>
  String(input || "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

export const htmlToReadableText = (input: string): string =>
  String(input || "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#0?39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

const ensureParagraphSpacing = (html: string): string => html
  .replace(/<p(?![^>]*style=)([^>]*)>/gi, '<p$1 style="margin:0 0 18px 0;">')
  .replace(/<ul(?![^>]*style=)([^>]*)>/gi, '<ul$1 style="margin:0 0 18px 22px;padding:0;">')
  .replace(/<ol(?![^>]*style=)([^>]*)>/gi, '<ol$1 style="margin:0 0 18px 22px;padding:0;">');

export const buildEmailDocument = (params: {
  html: string;
  preheader?: string | null;
  unsubscribeUrl?: string | null;
  campaignType?: string | null;
  openTrackingUrl?: string | null;
}): string => {
  const content = ensureParagraphSpacing(params.html);
  const footer = params.campaignType === "marketing" && params.unsubscribeUrl
    ? `<div style="border-top:1px solid #e2e8f0;margin-top:32px;padding-top:16px;color:#64748b;font-size:12px;line-height:1.5;">
        Recebeu esta comunicação por existir uma relação ou autorização registada.
        <a href="${escapeEmailHtml(params.unsubscribeUrl)}" style="color:#475569;text-decoration:underline;">Deixar de receber comunicações de marketing</a>.
      </div>`
    : "";
  const trackingPixel = params.openTrackingUrl
    ? `<img src="${escapeEmailHtml(params.openTrackingUrl)}" width="1" height="1" alt="" style="display:block;border:0;width:1px;height:1px;" />`
    : "";

  return `<!doctype html>
<html lang="pt">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width,initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>Email</title>
</head>
<body style="margin:0;padding:0;background:#f8fafc;">
  ${params.preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;visibility:hidden;mso-hide:all;">${escapeEmailHtml(params.preheader)}</div>` : ""}
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f8fafc;">
    <tr><td align="center" style="padding:24px 12px;">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:680px;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;">
        <tr><td style="padding:32px;font-family:'Segoe UI',Calibri,Arial,Helvetica,sans-serif;font-size:16px;line-height:1.6;color:#0f172a;">
          ${content}
          ${footer}
        </td></tr>
      </table>
    </td></tr>
  </table>
  ${trackingPixel}
</body>
</html>`;
};

export const createEmailTransport = () => {
  const port = Number.parseInt(Deno.env.get("SMTP_PORT") || "465", 10);
  if (!Number.isInteger(port) || port <= 0) throw new Error("SMTP_PORT inválido.");
  const secure = parseBool(Deno.env.get("SMTP_TLS"), port === 465);

  return nodemailer.createTransport({
    host: mustEmailEnv("SMTP_HOST"),
    port,
    secure,
    requireTLS: !secure && port !== 25,
    auth: {
      user: mustEmailEnv("SMTP_USERNAME"),
      pass: mustEmailEnv("SMTP_PASSWORD"),
    },
    pool: true,
    maxConnections: Math.min(Math.max(Number(Deno.env.get("SMTP_MAX_CONNECTIONS") || 3), 1), 10),
    maxMessages: Math.min(Math.max(Number(Deno.env.get("SMTP_MAX_MESSAGES") || 100), 1), 500),
  });
};

export const getEmailSender = (requestedName?: string | null) => {
  const smtpUsername = mustEmailEnv("SMTP_USERNAME");
  const address = normalizeEmailAddress(Deno.env.get("SMTP_FROM_EMAIL") || smtpUsername);
  if (!isValidEmailAddress(address)) throw new Error("SMTP_FROM_EMAIL inválido.");
  const name = cleanEmailHeader(requestedName || Deno.env.get("SMTP_FROM_NAME") || address.split("@")[0]);
  return { name, address };
};

export const getEmailPublicBaseUrl = (): string => {
  const configured = Deno.env.get("EMAIL_PUBLIC_BASE_URL")?.trim().replace(/\/$/, "");
  if (configured) return configured;
  return `${mustEmailEnv("SUPABASE_URL").replace(/\/$/, "")}/functions/v1`;
};

