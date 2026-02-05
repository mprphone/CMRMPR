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

function normalizeInnerHtml(inner: string) {
  // If caller sent plain text, convert to paragraphs.
  if (!looksLikeHtml(inner)) {
    const lines = inner.split(/\r?\n/).map(l => l.trim());
    const blocks: string[] = [];
    let buf: string[] = [];
    const flush = () => {
      if (buf.length) {
        blocks.push(`<p style="margin:0 0 14px 0;">${escHtml(buf.join(" "))}</p>`);
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
  return inner
    .replaceAll("<p>", '<p style="margin:0 0 14px 0;">')
    .replaceAll("<ul>", '<ul style="margin:0 0 14px 18px;padding:0;">')
    .replaceAll("<ol>", '<ol style="margin:0 0 14px 18px;padding:0;">')
    .replaceAll("<li>", '<li style="margin:0 0 8px 0;">');
}

function wrapEmailHtml(innerHtml: string) {
  const logoUrl = Deno.env.get("EMAIL_LOGO_URL") || "";
  const brandName = Deno.env.get("EMAIL_BRAND_NAME") || "MPR Negócios";
  const brandColor = Deno.env.get("EMAIL_BRAND_COLOR") || "#1F4B99"; // professional blue
  const brandTagline = Deno.env.get("EMAIL_BRAND_TAGLINE") || "";
  const footerHtml = Deno.env.get("EMAIL_FOOTER_HTML") || "";
  const preheader = Deno.env.get("EMAIL_PREHEADER") || "";

  const bodyHtml = normalizeInnerHtml(innerHtml);

  // Modern-but-safe: system fonts; larger size; generous line-height; white card; soft UI.
  // Use table layout for Outlook compatibility.
  return `<!doctype html>
<html lang="pt">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${escHtml(brandName)}</title>
</head>
<body style="margin:0;padding:0;background:#F6F7FB;">
  ${preheader ? `<div style="display:none;max-height:0;overflow:hidden;opacity:0;color:transparent;visibility:hidden;mso-hide:all;">${escHtml(preheader)}</div>` : ""}

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#F6F7FB;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <!-- Card -->
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" style="width:600px;max-width:600px;background:#ffffff;border:1px solid #E5EAF3;border-radius:18px;overflow:hidden;box-shadow:0 8px 24px rgba(15,23,42,0.06);">
          <!-- Header -->
          <tr>
            <td style="padding:22px 26px;border-bottom:1px solid #EEF2F7;background:#FFFFFF;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">
                <tr>
                  <td align="left" valign="middle" style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,Helvetica,sans-serif;">
                    ${logoUrl
                      ? `<img src="${logoUrl}" alt="${escHtml(brandName)}" width="160" style="display:block;border:0;outline:none;text-decoration:none;height:auto;max-width:160px;" />`
                      : `<div style="font-size:18px;font-weight:700;color:#0F172A;letter-spacing:0.2px;">${escHtml(brandName)}</div>`}
                    ${brandTagline ? `<div style="margin-top:4px;font-size:11px;letter-spacing:0.6px;text-transform:uppercase;color:#64748B;">${escHtml(brandTagline)}</div>` : ""}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Accent bar -->
          <tr>
            <td style="height:3px;background:${brandColor};font-size:0;line-height:0;">&nbsp;</td>
          </tr>

          <!-- Content -->
          <tr>
            <td style="padding:30px 30px 14px 30px;">
              <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,Helvetica,sans-serif;font-size:16px;line-height:1.8;color:#0F172A;">
                ${bodyHtml}
              </div>
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="padding:18px 30px 22px 30px;border-top:1px solid #EEF2F7;background:#F8FAFF;">
              <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;color:#64748B;">
                ${footerHtml || ""}
              </div>
            </td>
          </tr>
        </table>

        <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,Helvetica,sans-serif;font-size:11px;color:#94A3B8;margin-top:12px;">
          Se não visualizar corretamente, responda a este email.
        </div>
      </td>
    </tr>
  </table>
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
