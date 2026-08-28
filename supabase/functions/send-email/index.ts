import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildEmailDocument,
  cleanEmailHeader,
  createEmailTransport,
  emailCorsHeaders,
  getEmailSender,
  htmlToReadableText,
  mustEmailEnv,
} from "../_shared/email.ts";

type SendEmailBody = {
  to: string;
  from?: string;
  replyTo?: string;
  subject: string;
  html: string; // inner content (can be plain text or HTML)
  preheader?: string;
};

function parseMailbox(input: string | undefined): { name: string; email: string } {
  if (!input) return { name: "", email: "" };

  const raw = input.trim();
  const match = raw.match(/^(.*)<([^>]+)>$/);
  if (match) {
    const name = match[1].trim().replace(/^"(.*)"$/, "$1");
    const email = match[2].trim();
    return { name, email };
  }

  if (raw.includes("@")) {
    return { name: "", email: raw };
  }

  return { name: raw, email: "" };
}

function escHtml(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function looksLikeHtml(input: string) {
  return /<\w+[\s>]/.test(input);
}

function removeLegacyOptOutText(input: string) {
  if (!input) return "";

  return input
    .replace(
      /<p[^>]*>\s*Para deixar de receber[\s\S]*?assunto\s*["“”]?Remover["“”]?\s*\.?\s*<\/p>/gi,
      ""
    )
    .replace(
      /Para deixar de receber[\s\S]*?assunto\s*["“”]?Remover["“”]?\s*\.?/gi,
      ""
    );
}

function normalizeEuroCurrency(input: string) {
  if (!input) return "";
  return input
    .replace(/(\d[\d.,\s]*)\s*EUR\b/gi, (_m, amount) => `${String(amount).trim()} €`)
    .replace(/€\s*EUR\b/gi, "€")
    .replace(/\bEUR\b/gi, "€");
}

// Se o chamador enviar texto simples em vez de HTML, converte em parágrafos.
// O único chamador atual (envio de teste) já envia HTML pronto; isto existe
// para manter o contrato da função caso outro chamador envie texto simples.
function normalizeInnerHtml(inner: string) {
  const sanitizedInner = normalizeEuroCurrency(removeLegacyOptOutText(inner));
  if (looksLikeHtml(sanitizedInner)) return sanitizedInner;

  const lines = sanitizedInner.split(/\r?\n/);
  const blocks: string[] = [];
  let pendingEmptyLines = 0;

  const pushSpacerLines = (count: number) => {
    const safeCount = Math.min(Math.max(count, 1), 3);
    for (let i = 0; i < safeCount; i += 1) {
      blocks.push('<div style="height:16px;line-height:16px;font-size:16px;">&nbsp;</div>');
    }
  };
  const formatText = (s: string) => escHtml(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");

  for (const rawLine of lines) {
    const line = rawLine.replace(/[ \t]+$/g, "");
    if (!line.trim()) {
      pendingEmptyLines += 1;
      continue;
    }
    if (pendingEmptyLines > 0) {
      pushSpacerLines(pendingEmptyLines);
      pendingEmptyLines = 0;
    }
    blocks.push(`<p style="margin:0 0 22px 0;">${formatText(line)}</p>`);
  }

  return blocks.join("");
}

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...emailCorsHeaders, "Content-Type": "application/json" },
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: emailCorsHeaders });
  let transport: ReturnType<typeof createEmailTransport> | null = null;

  try {
    if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!jwt) return jsonResponse({ error: "Missing Authorization header" }, 401);

    const supabase = createClient(mustEmailEnv("SUPABASE_URL"), mustEmailEnv("SUPABASE_ANON_KEY"), {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) return jsonResponse({ error: "Invalid JWT" }, 401);

    const { data: canSendEmail, error: permissionError } = await supabase.rpc("app_has_permission", {
      p_module: "emails",
      p_action: "create",
    });
    if (permissionError) throw permissionError;
    if (canSendEmail !== true) {
      return jsonResponse({ error: "Esta conta não tem permissão para enviar emails." }, 403);
    }

    const { to, from, replyTo, subject, html, preheader } = (await req.json()) as SendEmailBody;
    if (!to || !subject || !html) {
      return jsonResponse({ error: "Missing required fields: to, subject, html" }, 400);
    }

    const fromParsed = parseMailbox(from);
    const replyToParsed = parseMailbox(replyTo);
    const sender = getEmailSender(fromParsed.name);

    let effectiveReplyTo = replyToParsed.email;
    if (!effectiveReplyTo && fromParsed.email && fromParsed.email.toLowerCase() !== sender.address.toLowerCase()) {
      effectiveReplyTo = fromParsed.email;
    }

    const finalHtml = buildEmailDocument({
      html: normalizeInnerHtml(html),
      preheader,
    });

    transport = createEmailTransport();
    await transport.sendMail({
      to: cleanEmailHeader(to),
      from: sender,
      replyTo: effectiveReplyTo || undefined,
      subject: cleanEmailHeader(subject),
      html: finalHtml,
      text: htmlToReadableText(finalHtml) || "Mensagem",
    });

    return jsonResponse({ ok: true, data: { provider: "smtp", to } });
  } catch (error: any) {
    console.error("Error in send-email function:", error);
    return jsonResponse({ error: error?.message ?? "Unknown error" }, 500);
  } finally {
    if (transport) transport.close();
  }
});
