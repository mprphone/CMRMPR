import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emailCorsHeaders, escapeEmailHtml, mustEmailEnv, normalizeEmailAddress } from "../_shared/email.ts";

const page = (title: string, message: string, status = 200) => new Response(`<!doctype html>
<html lang="pt"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeEmailHtml(title)}</title></head>
<body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;display:grid;min-height:100vh;place-items:center;">
<main style="max-width:520px;background:white;border:1px solid #e2e8f0;border-radius:16px;padding:32px;text-align:center;box-shadow:0 10px 30px rgba(15,23,42,.08)">
<h1 style="font-size:24px;margin:0 0 12px">${escapeEmailHtml(title)}</h1><p style="line-height:1.6;color:#475569">${escapeEmailHtml(message)}</p>
</main></body></html>`, { status, headers: { ...emailCorsHeaders, "Content-Type": "text/html; charset=utf-8" } });

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: emailCorsHeaders });
  if (!["GET", "POST"].includes(req.method)) return page("Pedido inválido", "Este endereço não suporta esta operação.", 405);
  try {
    const url = new URL(req.url);
    let token = url.searchParams.get("token") || "";
    if (req.method === "POST" && !token) {
      const contentType = req.headers.get("content-type") || "";
      if (contentType.includes("application/json")) token = String((await req.json().catch(() => ({}))).token || "");
      else token = String((await req.formData().catch(() => new FormData())).get("token") || "");
    }
    if (!/^[0-9a-f-]{36}$/i.test(token)) return page("Ligação inválida", "O pedido de remoção não é válido ou já expirou.", 400);

    const supabase = createClient(mustEmailEnv("SUPABASE_URL"), mustEmailEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });
    const { data: recipient, error } = await supabase
      .from("email_campaign_recipients")
      .select("id,campaign_id,email,email_normalized")
      .eq("unsubscribe_token", token)
      .maybeSingle();
    if (error) throw error;
    if (!recipient) return page("Ligação inválida", "Não foi possível identificar o endereço associado.", 404);

    const normalized = normalizeEmailAddress(recipient.email_normalized || recipient.email);
    const { data: existing } = await supabase.from("email_suppressions").select("id").eq("email_normalized", normalized).is("lifted_at", null).maybeSingle();
    if (!existing) {
      const { error: insertError } = await supabase.from("email_suppressions").insert({
        email: recipient.email,
        email_normalized: normalized,
        reason: "unsubscribe",
        source: "email_link",
      });
      if (insertError && insertError.code !== "23505") throw insertError;
    }

    await supabase.from("clients").update({ email_marketing_status: "opted_out" }).ilike("email", normalized);
    await supabase.from("email_campaign_recipients").update({
      status: "suppressed",
      exclusion_reason: "Oposição recebida antes do envio",
    }).eq("email_normalized", normalized).in("status", ["pending", "retry"]);
    await supabase.from("email_delivery_events").insert({
      recipient_id: recipient.id,
      campaign_id: recipient.campaign_id,
      event_type: "unsubscribe",
      payload: { email: normalized },
    });

    return page("Preferência atualizada", "O endereço foi removido de futuras comunicações de marketing. Continuará a receber mensagens estritamente necessárias à prestação do serviço.");
  } catch (error) {
    console.error("email-unsubscribe:", error);
    return page("Não foi possível concluir", "Tente novamente ou contacte-nos diretamente para remover o endereço.", 500);
  }
});

