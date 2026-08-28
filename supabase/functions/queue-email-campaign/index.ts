import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AppAuthorizationError, requireAppPermission } from "../_shared/authorization.ts";
import { emailCorsHeaders, isValidEmailAddress, normalizeEmailAddress } from "../_shared/email.ts";

type QueueRecipient = {
  clientId: string;
  name: string;
  email: string;
  subject: string;
  html: string;
  metadata?: Record<string, unknown>;
};

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...emailCorsHeaders, "Content-Type": "application/json" },
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: emailCorsHeaders });
  try {
    if (req.method !== "POST") throw new AppAuthorizationError("Método não permitido.", 405);
    await requireAppPermission(req, "emails", "create");

    const authorization = req.headers.get("authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") || "",
      Deno.env.get("SUPABASE_ANON_KEY") || "",
      { auth: { persistSession: false }, global: { headers: { Authorization: `Bearer ${token}` } } },
    );

    const payload = await req.json().catch(() => ({}));
    const subject = String(payload.subject || "").trim();
    const body = String(payload.body || "");
    const recipients = Array.isArray(payload.recipients) ? payload.recipients as QueueRecipient[] : [];
    const campaignType = payload.campaignType === "marketing" ? "marketing" : "service";
    const fromName = String(payload.fromName || "").trim();
    const fromEmail = normalizeEmailAddress(payload.fromEmail || "");
    const replyTo = normalizeEmailAddress(payload.replyTo || fromEmail);
    const scheduledAt = payload.scheduledAt ? new Date(payload.scheduledAt) : new Date();

    if (!subject || !body.trim()) return jsonResponse({ error: "O assunto e o corpo são obrigatórios." }, 400);
    if (!fromName || !isValidEmailAddress(fromEmail)) return jsonResponse({ error: "Remetente inválido." }, 400);
    if (recipients.length === 0 || recipients.length > 2000) return jsonResponse({ error: "Selecione entre 1 e 2000 destinatários." }, 400);
    if (Number.isNaN(scheduledAt.getTime()) || scheduledAt.getTime() < Date.now() - 60_000) {
      return jsonResponse({ error: "Data de agendamento inválida." }, 400);
    }

    const { data: visibleClients, error: clientsError } = await supabase.rpc("get_visible_clients");
    if (clientsError) throw clientsError;
    const visibleById = new Map((visibleClients || []).map((client: any) => [String(client.id), client]));
    const seenEmails = new Set<string>();
    const safeRecipients: any[] = [];

    for (const recipient of recipients) {
      const client = visibleById.get(String(recipient.clientId));
      if (!client) throw new AppAuthorizationError("Um destinatário está fora do âmbito autorizado.", 403);
      const databaseEmail = normalizeEmailAddress(client.email || "");
      if (databaseEmail !== normalizeEmailAddress(recipient.email)) {
        return jsonResponse({ error: `O email de ${client.name || "um cliente"} foi alterado. Atualize a seleção.` }, 409);
      }
      if (seenEmails.has(databaseEmail)) continue;
      seenEmails.add(databaseEmail);
      if (!String(recipient.subject || "").trim() || !String(recipient.html || "").trim()) {
        return jsonResponse({ error: `Conteúdo personalizado vazio para ${client.name || databaseEmail}.` }, 400);
      }
      safeRecipients.push({
        client_id: client.id,
        name: client.name || recipient.name || "",
        email: databaseEmail,
        subject: String(recipient.subject),
        html: String(recipient.html),
        metadata: recipient.metadata || {},
      });
    }

    const { data: campaign, error } = await supabase.rpc("create_email_campaign", {
      p_subject: subject,
      p_body: body,
      p_group_name: String(payload.groupName || ""),
      p_campaign_type: campaignType,
      p_preheader: String(payload.preheader || ""),
      p_signature_html: String(payload.signatureHtml || ""),
      p_from_name: fromName,
      p_from_email: fromEmail,
      p_reply_to: replyTo || null,
      p_scheduled_at: scheduledAt.toISOString(),
      p_template_id: payload.templateId || null,
      p_idempotency_key: String(payload.idempotencyKey || crypto.randomUUID()),
      p_requires_approval: Boolean(payload.requiresApproval),
      p_recipients: safeRecipients,
    });
    if (error) throw error;

    return jsonResponse({ ok: true, campaign });
  } catch (error: any) {
    console.error("queue-email-campaign:", error);
    return jsonResponse(
      { error: error?.message || "Não foi possível criar a campanha." },
      error instanceof AppAuthorizationError ? error.status : 500,
    );
  }
});

