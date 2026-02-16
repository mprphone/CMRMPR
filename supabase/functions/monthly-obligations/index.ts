import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenerativeAI } from "npm:@google/generative-ai";
import nodemailer from "npm:nodemailer@6.9.15";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Automation = {
  id: string;
  name: string;
  is_active: boolean;
  client_group: string;
  admin_email: string;
  from_name: string;
  from_email: string;
  reply_to?: string | null;
  subject_hint: string;
  ai_instructions: string;
};

type Client = {
  id: string;
  name: string;
  email: string;
  phone?: string | null;
  address?: string | null;
  nif?: string | null;
  sector?: string | null;
  entityType?: string | null;
  responsibleStaff?: string | null;
  monthlyFee?: number | null;
  turnover?: number | null;
  status?: string | null;
  contractRenewalDate?: string | null;
};

type FeeGroup = {
  id: string;
  name: string;
  clientIds: string[];
};

type Staff = {
  id: string;
  name: string;
};

function mustEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing secret/env: ${name}`);
  return v;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value == null) return fallback;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "on"].includes(normalized);
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

function extractFirstJsonObject(text: string): any {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("A IA não devolveu JSON válido.");
  return JSON.parse(match[0]);
}

function escapeHtml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function toNumber(v: any): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function renderTemplate(template: string, client: Client, responsibleName?: string): string {
  // Replace {{var}} placeholders (same idea as your EmailCampaigns UI)
  return template
    .replaceAll("{{name}}", escapeHtml(client.name ?? ""))
    .replaceAll("{{responsible_name}}", escapeHtml(responsibleName ?? ""))
    .replaceAll("{{nif}}", escapeHtml(client.nif ?? ""))
    .replaceAll("{{email}}", escapeHtml(client.email ?? ""))
    .replaceAll("{{phone}}", escapeHtml(client.phone ?? ""))
    .replaceAll("{{address}}", escapeHtml(client.address ?? ""))
    .replaceAll("{{sector}}", escapeHtml(client.sector ?? ""))
    .replaceAll("{{entityType}}", escapeHtml(client.entityType ?? ""))
    .replaceAll("{{avenca_atual}}", client.monthlyFee != null ? String(client.monthlyFee) : "")
    .replaceAll("{{turnover}}", client.turnover != null ? String(client.turnover) : "")
    .replaceAll("{{status}}", escapeHtml(client.status ?? ""))
    .replaceAll("{{contractRenewalDate}}", escapeHtml(client.contractRenewalDate ?? ""));
}

async function sendSmtpEmail(params: {
  to: string;
  subject: string;
  html: string;
  fromName: string;
  fromEmail: string;
  replyTo?: string | null;
}): Promise<void> {
  const smtpHost = mustEnv("SMTP_HOST");
  const smtpUsername = mustEnv("SMTP_USERNAME");
  const smtpPassword = mustEnv("SMTP_PASSWORD");
  const smtpPortRaw = Deno.env.get("SMTP_PORT") ?? "465";
  const smtpPort = Number.parseInt(smtpPortRaw, 10);
  if (!Number.isInteger(smtpPort) || smtpPort <= 0) {
    throw new Error("SMTP_PORT is invalid. Use a numeric value (example: 465).");
  }

  const smtpTls = parseBool(Deno.env.get("SMTP_TLS"), true);
  if ([25, 587].includes(smtpPort)) {
    throw new Error("SMTP port 25/587 is blocked in hosted Edge Functions. Configure SMTP_PORT=465 and SMTP_TLS=true.");
  }

  const envFromEmail = (Deno.env.get("SMTP_FROM_EMAIL") || smtpUsername).trim();
  if (!envFromEmail.includes("@")) {
    throw new Error("SMTP_FROM_EMAIL (or SMTP_USERNAME) must be a valid email.");
  }

  const envFromName = (Deno.env.get("SMTP_FROM_NAME") || "").trim();
  const fromName =
    params.fromName?.trim() ||
    envFromName ||
    envFromEmail.split("@")[0];
  const from = {
    name: cleanHeaderValue(fromName),
    address: envFromEmail,
  };

  let effectiveReplyTo = params.replyTo?.trim() || "";
  if (!effectiveReplyTo && params.fromEmail?.trim() && params.fromEmail.trim().toLowerCase() !== envFromEmail.toLowerCase()) {
    effectiveReplyTo = params.fromEmail.trim();
  }

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
      from,
      to: cleanHeaderValue(params.to),
      subject: cleanHeaderValue(params.subject),
      html: params.html,
      text: stripHtmlToText(params.html) || "Mensagem",
      replyTo: effectiveReplyTo || undefined,
    });
  } finally {
    transport.close();
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startedAt = new Date();
  let runId: string | null = null;

  try {
    // 🔒 Protect the cron-triggered endpoint
    const expected = mustEnv("CRON_SECRET");
    const got = req.headers.get("x-cron-secret");
    if (!got || got !== expected) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 401,
      });
    }

    const body = await req.json().catch(() => ({}));
    const automationId: string | undefined = body.automation_id;
    const runMonth: string = body.month ?? new Date().toISOString().slice(0, 7); // YYYY-MM

    // Supabase admin client (service role)
    const SUPABASE_URL = mustEnv("SUPABASE_URL");
    const SUPABASE_SERVICE_ROLE_KEY = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false },
    });

    // Load automation
    let automation: Automation | null = null;
    if (automationId) {
      const { data, error } = await supabase
        .from("email_automations")
        .select("*")
        .eq("id", automationId)
        .maybeSingle();
      if (error) throw error;
      automation = data as Automation | null;
    } else {
      // fallback: first active automation
      const { data, error } = await supabase
        .from("email_automations")
        .select("*")
        .eq("is_active", true)
        .order("created_at", { ascending: true })
        .limit(1);
      if (error) throw error;
      automation = (data?.[0] ?? null) as Automation | null;
    }

    if (!automation) throw new Error("Automation not found (email_automations).");
    if (!automation.is_active) throw new Error(`Automation "${automation.name}" is inactive.`);

    // Create run record
    {
      const { data, error } = await supabase
        .from("email_automation_runs")
        .insert({
          automation_id: automation.id,
          run_month: runMonth,
          started_at: startedAt.toISOString(),
          status: "running",
        })
        .select("id")
        .single();
      if (error) throw error;
      runId = data.id;
    }

    // Load group
    const { data: groupData, error: groupErr } = await supabase
      .from("fee_groups")
      .select("id,name,clientIds")
      .eq("name", automation.client_group)
      .maybeSingle();
    if (groupErr) throw groupErr;

    const group = groupData as FeeGroup | null;
    if (!group) throw new Error(`Grupo "${automation.client_group}" não encontrado na tabela fee_groups.`);

    const clientIds = Array.isArray(group.clientIds) ? group.clientIds : [];
    if (clientIds.length === 0) throw new Error(`Grupo "${group.name}" não tem clientes (clientIds vazio).`);

    // Load clients
    const { data: clientsData, error: clientsErr } = await supabase
      .from("clients")
      .select("id,name,email,phone,address,nif,sector,entityType,responsibleStaff,monthlyFee,turnover,status,contractRenewalDate")
      .in("id", clientIds);
    if (clientsErr) throw clientsErr;

    const clients = (clientsData ?? []) as Client[];
    const invalid = clients.filter((c) => !c.email || !c.email.includes("@"));
    if (invalid.length) {
      throw new Error(`Há ${invalid.length} cliente(s) sem email válido. Corrija antes de enviar.`);
    }

    // Load staff (for {{responsible_name}})
    const staffIds = Array.from(new Set(clients.map((c) => c.responsibleStaff).filter(Boolean))) as string[];
    let staffMap = new Map<string, string>();
    if (staffIds.length) {
      const { data: staffData, error: staffErr } = await supabase
        .from("staff")
        .select("id,name")
        .in("id", staffIds);
      if (staffErr) throw staffErr;

      (staffData ?? []).forEach((s: any) => staffMap.set(s.id, s.name));
    }

    // Generate email template via Gemini (one template with variables)
    const GEMINI_API_KEY = mustEnv("GEMINI_API_KEY");
    const GEMINI_MODEL = mustEnv("GEMINI_MODEL");

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

    const prompt = `
És especialista em comunicação para um gabinete de contabilidade em Portugal.

Objetivo:
Gerar um EMAIL MENSAL automático para clientes, referente ao mês ${runMonth}.

Dicas de assunto (podes adaptar):
${automation.subject_hint}

Instruções (OBRIGATÓRIO cumprir):
${automation.ai_instructions}

Regras:
- Responde APENAS em JSON.
- O JSON deve ter:
  {
    "subject": "...",
    "html": "..." 
  }
- Usa as variáveis {{name}} e {{responsible_name}} quando fizer sentido.
- O campo "html" deve ser HTML simples compatível com email (sem CSS moderno).
- Não inventes prazos legais se não estiverem nas instruções; se não houver informação suficiente, diz que é um resumo e recomenda validação.
`.trim();

    const result = await model.generateContent(prompt);
    const text = result.response.text();
    const parsed = extractFirstJsonObject(text);

    const subjectTemplate = String(parsed.subject ?? "").trim();
    const htmlTemplate = String(parsed.html ?? "").trim();
    if (!subjectTemplate || !htmlTemplate) {
      throw new Error("IA devolveu JSON sem subject/html.");
    }

    // Send to clients (stop on first failure and notify admin)
    let successes = 0;
    const sentTo: string[] = [];

    for (const client of clients) {
      const responsibleName = client.responsibleStaff ? staffMap.get(client.responsibleStaff) : "";
      const subject = renderTemplate(subjectTemplate, client, responsibleName);
      const html = renderTemplate(htmlTemplate, client, responsibleName);

      await sendSmtpEmail({
        to: client.email,
        subject,
        html,
        fromName: automation.from_name,
        fromEmail: automation.from_email,
        replyTo: automation.reply_to ?? null,
      });

      successes += 1;
      sentTo.push(client.email);
    }

    // Mark run as success
    if (runId) {
      await supabase
        .from("email_automation_runs")
        .update({
          finished_at: new Date().toISOString(),
          status: "success",
          successes,
          failures: 0,
          details: { sentTo },
        })
        .eq("id", runId);
    }

    return new Response(JSON.stringify({ ok: true, successes }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (err: any) {
    const msg = typeof err?.message === "string" ? err.message : String(err);
    console.error("monthly-obligations error:", msg);

    try {
      // Best-effort: notify admin
      const admin = Deno.env.get("DEFAULT_ADMIN_EMAIL") ?? "mpr@mpr.pt";
      const fromName = Deno.env.get("DEFAULT_FROM_NAME") ?? "MPR";
      const fromEmail = Deno.env.get("DEFAULT_FROM_EMAIL") ?? "no-reply@mpr.pt";

      const subject = `Erro no envio automático (${new Date().toISOString().slice(0, 10)})`;
      const html = `
        <p>Olá,</p>
        <p>Deu erro no envio automático deste mês.</p>
        <p><strong>Erro:</strong> ${escapeHtml(msg)}</p>
        ${runId ? `<p><strong>Run ID:</strong> ${escapeHtml(runId)}</p>` : ""}
        <p>— Sistema</p>
      `;

      await sendSmtpEmail({ to: admin, subject, html, fromName, fromEmail });
    } catch (notifyErr) {
      console.error("Failed to notify admin:", notifyErr);
    }

    // Update run record if it exists
    try {
      const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
      const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
      if (runId && SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) {
        const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
          auth: { persistSession: false },
        });
        await supabase
          .from("email_automation_runs")
          .update({
            finished_at: new Date().toISOString(),
            status: "error",
            successes: 0,
            failures: 1,
            error: msg,
          })
          .eq("id", runId);
      }
    } catch (_e) {}

    return new Response(JSON.stringify({ ok: false, error: msg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
