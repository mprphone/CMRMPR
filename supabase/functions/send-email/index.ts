import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import nodemailer from "npm:nodemailer@6.9.15";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SendEmailBody = {
  to: string;
  from?: string;
  replyTo?: string;
  subject: string;
  html: string; // inner content (can be plain text or HTML)
};

function mustEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name} is not set in Supabase secrets.`);
  return v;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
}

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

function stripHtmlToText(input: string): string {
  return input
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function cleanHeaderValue(input: string): string {
  return (input || "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
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

function normalizeInnerHtml(inner: string) {
  const sanitizedInner = normalizeEuroCurrency(removeLegacyOptOutText(inner));

  // If caller sent plain text, convert to paragraphs.
  if (!looksLikeHtml(sanitizedInner)) {
    const lines = sanitizedInner.split(/\r?\n/);
    const blocks: string[] = [];
    let pendingEmptyLines = 0;

    const pushSpacerLines = (count: number) => {
      const safeCount = Math.min(Math.max(count, 1), 3);
      for (let i = 0; i < safeCount; i += 1) {
        blocks.push('<div style="height:16px;line-height:16px;font-size:16px;">&nbsp;</div>');
      }
    };
    const formatText = (s: string) => {
      const escaped = escHtml(s);
      return escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    };

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

  // If it's HTML, enforce sensible spacing on common tags
  // (Outlook ignores many CSS rules; inline styles win)
  return sanitizedInner
    .replaceAll("<p>", '<p style="margin:0 0 22px 0;">')
    .replaceAll("<ul>", '<ul style="margin:0 0 22px 22px;padding:0;">')
    .replaceAll("<ol>", '<ol style="margin:0 0 22px 22px;padding:0;">')
    .replaceAll("<li>", '<li style="margin:0 0 14px 0;">');
}

function wrapEmailHtml(innerHtml: string) {
  const preheader = Deno.env.get("EMAIL_PREHEADER") || "";

  const bodyHtml = normalizeInnerHtml(innerHtml);

  // Minimal, left-aligned layout without automatic signature/header.
  return `<!doctype html>
<html lang="pt">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>Email</title>
</head>
<body style="margin:0;padding:100px 22px 24px 22px;background:#FFFFFF;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;visibility:hidden;mso-hide:all;">${escHtml(preheader)}</div>` : ""}
  <div style="font-family:'Segoe UI',Calibri,Arial,Helvetica,sans-serif;font-size:18px;line-height:1.65;color:#111827;">
    ${bodyHtml}
  </div>
</body>
</html>`;
}
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    if (req.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Require JWT (recommended)
    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
    if (!jwt) {
      return new Response(JSON.stringify({ error: "Missing Authorization header" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const SUPABASE_URL = mustEnv("SUPABASE_URL");
    const SUPABASE_ANON_KEY = mustEnv("SUPABASE_ANON_KEY");

    const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
      auth: { persistSession: false },
    });

    const { data: userData, error: userErr } = await supabase.auth.getUser();
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Invalid JWT" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { to, from, replyTo, subject, html } = (await req.json()) as SendEmailBody;
    if (!to || !subject || !html) {
      return new Response(JSON.stringify({ error: "Missing required fields: to, subject, html" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const smtpHost = mustEnv("SMTP_HOST");
    const smtpUsername = mustEnv("SMTP_USERNAME");
    const smtpPassword = mustEnv("SMTP_PASSWORD");
    const smtpPortRaw = Deno.env.get("SMTP_PORT") ?? "465";
    const smtpPort = Number.parseInt(smtpPortRaw, 10);
    if (!Number.isInteger(smtpPort) || smtpPort <= 0) {
      throw new Error("SMTP_PORT is invalid. Use a numeric value (example: 465).");
    }

    const smtpTls = parseBool(Deno.env.get("SMTP_TLS"), true);

    // On hosted Supabase Edge Functions, 25/587 are blocked. Use 465.
    if ([25, 587].includes(smtpPort)) {
      throw new Error("SMTP port 25/587 is blocked in hosted Edge Functions. Configure SMTP_PORT=465 and SMTP_TLS=true.");
    }

    const smtpFromEmail = (Deno.env.get("SMTP_FROM_EMAIL") || smtpUsername).trim();
    if (!smtpFromEmail.includes("@")) {
      throw new Error("SMTP_FROM_EMAIL (or SMTP_USERNAME) must be a valid email.");
    }
    const smtpFromName = (Deno.env.get("SMTP_FROM_NAME") || "").trim();

    const fromParsed = parseMailbox(from);
    const replyToParsed = parseMailbox(replyTo);

    const effectiveFromName =
      fromParsed.name ||
      smtpFromName ||
      smtpFromEmail.split("@")[0];
    const effectiveFrom = {
      name: cleanHeaderValue(effectiveFromName),
      address: smtpFromEmail,
    };

    let effectiveReplyTo = replyToParsed.email;
    if (!effectiveReplyTo && fromParsed.email && fromParsed.email.toLowerCase() !== smtpFromEmail.toLowerCase()) {
      effectiveReplyTo = fromParsed.email;
    }

    const finalHtml = wrapEmailHtml(html).trim();
    const textVersion = stripHtmlToText(finalHtml) || "Mensagem";
    const cleanSubject = cleanHeaderValue(subject);

    const transport = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpTls,
      auth: {
        user: smtpUsername,
        pass: smtpPassword,
      },
    });

    try {
      await transport.sendMail({
        to: cleanHeaderValue(to),
        from: effectiveFrom,
        replyTo: effectiveReplyTo || undefined,
        subject: cleanSubject,
        html: finalHtml,
        text: textVersion,
      });
    } finally {
      transport.close();
    }

    return new Response(JSON.stringify({ ok: true, data: { provider: "smtp", to } }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in send-email function:", error);
    return new Response(JSON.stringify({ error: error?.message ?? "Unknown error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
