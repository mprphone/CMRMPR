import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AppAuthorizationError, requireAppPermission } from "../_shared/authorization.ts";
import {
  buildEmailDocument,
  cleanEmailHeader,
  createEmailTransport,
  emailCorsHeaders,
  getEmailPublicBaseUrl,
  getEmailSender,
  htmlToReadableText,
  mustEmailEnv,
  normalizeEmailAddress,
} from "../_shared/email.ts";

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...emailCorsHeaders, "Content-Type": "application/json" },
});

const authorizeWorker = async (req: Request) => {
  const expectedCronSecret = Deno.env.get("CRON_SECRET")?.trim();
  const suppliedCronSecret = req.headers.get("x-cron-secret")?.trim();
  if (expectedCronSecret && suppliedCronSecret === expectedCronSecret) return;
  await requireAppPermission(req, "emails", "create");
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: emailCorsHeaders });
  let transport: ReturnType<typeof createEmailTransport> | null = null;
  try {
    if (req.method !== "POST") throw new AppAuthorizationError("Método não permitido.", 405);
    await authorizeWorker(req);

    const payload = await req.json().catch(() => ({}));
    const batchSize = Math.min(Math.max(Number(payload.batchSize || 25), 1), 100);
    const campaignId = payload.campaignId || null;
    const supabase = createClient(mustEmailEnv("SUPABASE_URL"), mustEmailEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });

    await supabase
      .from("email_campaign_recipients")
      .update({ status: "retry", next_attempt_at: new Date().toISOString(), last_error: "Bloqueio expirado; reentrada automática na fila." })
      .eq("status", "sending")
      .lt("locked_at", new Date(Date.now() - 15 * 60_000).toISOString());

    const { data: deliveries, error: claimError } = await supabase.rpc("claim_email_deliveries", {
      p_limit: batchSize,
      p_campaign_id: campaignId,
    });
    if (claimError) throw claimError;
    if (!deliveries?.length) return jsonResponse({ ok: true, processed: 0, accepted: 0, failed: 0, retried: 0 });

    transport = createEmailTransport();
    const publicBaseUrl = getEmailPublicBaseUrl();
    const campaignIds = new Set<string>();
    let accepted = 0;
    let failed = 0;
    let retried = 0;
    let suppressed = 0;

    for (const delivery of deliveries) {
      campaignIds.add(delivery.campaign_id);
      const normalizedEmail = normalizeEmailAddress(delivery.email);
      const { data: suppression } = await supabase
        .from("email_suppressions")
        .select("id")
        .eq("email_normalized", normalizedEmail)
        .is("lifted_at", null)
        .maybeSingle();

      if (suppression) {
        await supabase.from("email_campaign_recipients").update({
          status: "suppressed",
          exclusion_reason: "Endereço suprimido antes do envio",
          locked_at: null,
        }).eq("id", delivery.id);
        suppressed += 1;
        continue;
      }

      const unsubscribeUrl = `${publicBaseUrl}/email-unsubscribe?token=${encodeURIComponent(delivery.unsubscribe_token)}`;
      const finalHtml = buildEmailDocument({
        html: delivery.rendered_html,
        preheader: delivery.preheader,
        unsubscribeUrl,
        campaignType: delivery.campaign_type,
      });
      const sender = getEmailSender(delivery.from_name);
      const replyTo = normalizeEmailAddress(delivery.reply_to || delivery.from_email || "");

      try {
        const result = await transport.sendMail({
          to: cleanEmailHeader(delivery.email),
          from: sender,
          replyTo: replyTo || undefined,
          subject: cleanEmailHeader(delivery.rendered_subject),
          html: finalHtml,
          text: htmlToReadableText(finalHtml) || "Mensagem",
          headers: delivery.campaign_type === "marketing" ? {
            "List-Unsubscribe": `<${unsubscribeUrl}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          } : undefined,
        });
        const messageId = cleanEmailHeader(result.messageId || "") || null;
        await supabase.from("email_campaign_recipients").update({
          status: "accepted",
          provider_message_id: messageId,
          accepted_at: new Date().toISOString(),
          locked_at: null,
          last_error: null,
        }).eq("id", delivery.id);
        await supabase.from("email_delivery_events").insert({
          recipient_id: delivery.id,
          campaign_id: delivery.campaign_id,
          event_type: "accepted",
          provider_message_id: messageId,
          payload: { accepted: result.accepted || [], rejected: result.rejected || [] },
        });
        accepted += 1;
      } catch (error: any) {
        const message = String(error?.message || "Falha SMTP").slice(0, 1000);
        const hasAttemptsLeft = Number(delivery.attempts) < Number(delivery.max_attempts);
        const delayMinutes = [1, 5, 30, 180][Math.max(0, Number(delivery.attempts) - 1)] || 360;
        await supabase.from("email_campaign_recipients").update({
          status: hasAttemptsLeft ? "retry" : "failed",
          next_attempt_at: new Date(Date.now() + delayMinutes * 60_000).toISOString(),
          locked_at: null,
          last_error: message,
        }).eq("id", delivery.id);
        await supabase.from("email_delivery_events").insert({
          recipient_id: delivery.id,
          campaign_id: delivery.campaign_id,
          event_type: hasAttemptsLeft ? "retry" : "failed",
          payload: { error: message, attempt: delivery.attempts },
        });
        if (hasAttemptsLeft) retried += 1; else failed += 1;
      }
    }

    for (const id of campaignIds) await supabase.rpc("refresh_email_campaign", { p_campaign_id: id });

    return jsonResponse({ ok: true, processed: deliveries.length, accepted, failed, retried, suppressed });
  } catch (error: any) {
    console.error("process-email-queue:", error);
    return jsonResponse(
      { error: error?.message || "Falha ao processar a fila." },
      error instanceof AppAuthorizationError ? error.status : 500,
    );
  } finally {
    if (transport) transport.close();
  }
});

