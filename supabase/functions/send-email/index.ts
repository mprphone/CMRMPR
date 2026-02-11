import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type SendEmailBody = {
  to: string;
  from: string;
  subject: string;
  html: string; // inner content (can be plain text or HTML)
};

function mustEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name} is not set in Supabase secrets.`);
  return v;
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

function normalizeInnerHtml(inner: string) {
  const sanitizedInner = removeLegacyOptOutText(inner);

  // If caller sent plain text, convert to paragraphs.
  if (!looksLikeHtml(sanitizedInner)) {
    const lines = sanitizedInner.split(/\r?\n/).map(l => l.trim());
    const blocks: string[] = [];
    let buf: string[] = [];
    const formatText = (s: string) => {
      const escaped = escHtml(s);
      return escaped.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
    };
    const flush = () => {
      if (buf.length) {
        blocks.push(`<p style="margin:0 0 14px 0;">${formatText(buf.join(" "))}</p>`);
        buf = [];
      }
    };
    for (const line of lines) {
      if (!line) { flush(); continue; }
      buf.push(line);
    }
    flush();
    return blocks.join("");
  }

  // If it's HTML, enforce sensible spacing on common tags
  // (Outlook ignores many CSS rules; inline styles win)
  return sanitizedInner
    .replaceAll("<p>", '<p style="margin:0 0 16px 0;">')
    .replaceAll("<ul>", '<ul style="margin:0 0 16px 22px;padding:0;">')
    .replaceAll("<ol>", '<ol style="margin:0 0 16px 22px;padding:0;">')
    .replaceAll("<li>", '<li style="margin:0 0 10px 0;">');
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
<body style="margin:0;padding:24px 22px;background:#FFFFFF;">
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

    const { to, from, subject, html } = (await req.json()) as SendEmailBody;
    if (!to || !from || !subject || !html) {
      return new Response(JSON.stringify({ error: "Missing required fields: to, from, subject, html" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const RESEND_API_KEY = mustEnv("RESEND_API_KEY");
    const finalHtml = wrapEmailHtml(html);

    const resendResp = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ to, from, subject, html: finalHtml }),
    });

    const resendJson = await resendResp.json().catch(() => ({}));
    if (!resendResp.ok) {
      const msg =
        (resendJson && (resendJson.error?.message || resendJson.message || resendJson.error)) ||
        `Resend error (${resendResp.status})`;
      return new Response(JSON.stringify({ error: msg, details: resendJson }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, data: resendJson }), {
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
