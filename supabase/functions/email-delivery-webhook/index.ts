import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emailCorsHeaders, mustEmailEnv, normalizeEmailAddress } from "../_shared/email.ts";

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...emailCorsHeaders, "Content-Type": "application/json" },
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: emailCorsHeaders });
  if (req.method !== "POST") return response({ error: "Method not allowed" }, 405);
  try {
    const expected = mustEmailEnv("EMAIL_WEBHOOK_SECRET");
    const supplied = req.headers.get("x-webhook-secret") || req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") || "";
    if (supplied !== expected) return response({ error: "Unauthorized" }, 401);

    const payload = await req.json().catch(() => ({}));
    const providerMessageId = String(payload.messageId || payload.message_id || payload.provider_message_id || "").trim();
    const event = String(payload.event || payload.type || "").toLowerCase();
    const normalizedEmail = normalizeEmailAddress(payload.email || payload.recipient || "");
    const supabase = createClient(mustEmailEnv("SUPABASE_URL"), mustEmailEnv("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

    let query = supabase.from("email_campaign_recipients").select("id,campaign_id,email,email_normalized,status");
    if (providerMessageId) query = query.eq("provider_message_id", providerMessageId);
    else if (normalizedEmail) query = query.eq("email_normalized", normalizedEmail).order("created_at", { ascending: false }).limit(1);
    else return response({ error: "messageId or email required" }, 400);

    const { data: recipients, error } = await query;
    if (error) throw error;
    const recipient = recipients?.[0];
    if (!recipient) return response({ error: "Recipient not found" }, 404);

    const status = event.includes("complaint") || event.includes("spam")
      ? "complained"
      : event.includes("bounce")
        ? "bounced"
        : event.includes("deliver")
          ? "delivered"
          : null;
    if (!status) return response({ ok: true, ignored: true });

    const now = new Date().toISOString();
    await supabase.from("email_campaign_recipients").update({
      status,
      delivered_at: status === "delivered" ? now : undefined,
      bounced_at: status === "bounced" ? now : undefined,
      last_error: status === "delivered" ? null : String(payload.reason || payload.error || event).slice(0, 1000),
    }).eq("id", recipient.id);
    await supabase.from("email_delivery_events").insert({
      recipient_id: recipient.id,
      campaign_id: recipient.campaign_id,
      event_type: status,
      provider_message_id: providerMessageId || null,
      payload,
    });

    if (status === "bounced" || status === "complained") {
      const normalized = normalizeEmailAddress(recipient.email_normalized || recipient.email);
      const { data: existing } = await supabase.from("email_suppressions").select("id").eq("email_normalized", normalized).is("lifted_at", null).maybeSingle();
      if (!existing) await supabase.from("email_suppressions").insert({
        email: recipient.email,
        email_normalized: normalized,
        reason: status === "bounced" ? "hard_bounce" : "complaint",
        source: "provider_webhook",
        notes: String(payload.reason || payload.error || "").slice(0, 1000),
      });
    }
    await supabase.rpc("refresh_email_campaign", { p_campaign_id: recipient.campaign_id });
    return response({ ok: true });
  } catch (error: any) {
    console.error("email-delivery-webhook:", error);
    return response({ error: error?.message || "Webhook failed" }, 500);
  }
});

