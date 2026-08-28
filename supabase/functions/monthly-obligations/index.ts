import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { GoogleGenerativeAI } from "npm:@google/generative-ai";
import { AppAuthorizationError, requireAppPermission } from "../_shared/authorization.ts";
import {
  buildEmailDocument,
  cleanEmailHeader,
  createEmailTransport,
  emailCorsHeaders,
  escapeEmailHtml,
  getEmailSender,
  htmlToReadableText,
  mustEmailEnv,
  normalizeEmailAddress,
} from "../_shared/email.ts";

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
  schedule_day?: number;
  schedule_hour?: number;
  requires_approval?: boolean;
  campaign_type?: "service" | "marketing";
};

const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...emailCorsHeaders, "Content-Type": "application/json" },
});

const extractJson = (text: string): { subject: string; html: string } => {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) throw new Error("A IA não devolveu JSON válido.");
  const parsed = JSON.parse(match[0]);
  const subject = String(parsed.subject || "").trim();
  const html = String(parsed.html || "").trim();
  if (!subject || !html) throw new Error("A IA devolveu conteúdo incompleto.");
  return { subject, html };
};

const renderTemplate = (template: string, client: any, responsibleName: string, html: boolean): string => {
  const safe = (value: unknown) => html ? escapeEmailHtml(String(value ?? "")) : String(value ?? "");
  const replacements: Record<string, string> = {
    name: safe(client.name),
    responsible_name: safe(responsibleName),
    nif: safe(client.nif),
    email: safe(client.email),
    phone: safe(client.phone),
    address: safe(client.address),
    sector: safe(client.sector),
    entityType: safe(client.entity_type),
    avenca_atual: client.monthly_fee == null ? "" : `${Number(client.monthly_fee).toFixed(2).replace(".", ",")} €`,
    turnover: client.turnover == null ? "" : String(client.turnover),
    status: safe(client.status),
    contractRenewalDate: safe(client.contract_renewal_date),
  };
  return Object.entries(replacements).reduce(
    (result, [key, value]) => result.replaceAll(`{{${key}}}`, value),
    template,
  );
};

const lisbonParts = () => Object.fromEntries(
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Lisbon",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hourCycle: "h23",
  }).formatToParts(new Date()).filter((part) => part.type !== "literal").map((part) => [part.type, part.value]),
);

const authorize = async (req: Request) => {
  const expected = Deno.env.get("CRON_SECRET")?.trim();
  const supplied = req.headers.get("x-cron-secret")?.trim();
  if (expected && supplied === expected) return;
  await requireAppPermission(req, "emails", "create");
};

const notifyFailure = async (automation: Automation | null, message: string, runId: string | null) => {
  const email = normalizeEmailAddress(automation?.admin_email || Deno.env.get("DEFAULT_ADMIN_EMAIL") || "mpr@mpr.pt");
  if (!email) return;
  const transport = createEmailTransport();
  try {
    const html = buildEmailDocument({
      html: `<h2>Falha na automação de email</h2><p><strong>Automação:</strong> ${escapeEmailHtml(automation?.name || "-")}</p><p><strong>Erro:</strong> ${escapeEmailHtml(message)}</p>${runId ? `<p><strong>Execução:</strong> ${escapeEmailHtml(runId)}</p>` : ""}`,
    });
    await transport.sendMail({
      to: email,
      from: getEmailSender(Deno.env.get("DEFAULT_FROM_NAME") || "MPR"),
      subject: cleanEmailHeader(`Erro na automação de email: ${automation?.name || "CMRMPR"}`),
      html,
      text: htmlToReadableText(html),
    });
  } finally {
    transport.close();
  }
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: emailCorsHeaders });
  let runId: string | null = null;
  let automation: Automation | null = null;
  let supabase: ReturnType<typeof createClient> | null = null;
  try {
    if (req.method !== "POST") throw new AppAuthorizationError("Método não permitido.", 405);
    await authorize(req);
    const body = await req.json().catch(() => ({}));
    const force = body.force === true;
    const parts = lisbonParts();
    const runMonth = String(body.month || `${parts.year}-${parts.month}`);

    supabase = createClient(mustEmailEnv("SUPABASE_URL"), mustEmailEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });

    if (body.automation_id) {
      const { data: selectedAutomation, error: automationError } = await supabase
        .from("email_automations")
        .select("*")
        .eq("is_active", true)
        .eq("id", body.automation_id)
        .maybeSingle();
      if (automationError) throw automationError;
      automation = selectedAutomation as Automation | null;
    } else {
      const { data: activeAutomations, error: automationError } = await supabase
        .from("email_automations")
        .select("*")
        .eq("is_active", true)
        .order("created_at");
      if (automationError) throw automationError;
      const { data: completedRuns, error: completedRunsError } = await supabase
        .from("email_automation_runs")
        .select("automation_id")
        .eq("run_month", runMonth)
        .in("status", ["running", "draft", "queued", "success"]);
      if (completedRunsError) throw completedRunsError;
      const completedIds = new Set((completedRuns || []).map((run: any) => run.automation_id));
      const currentDay = Number(parts.day);
      const currentHour = Number(parts.hour);
      automation = ((activeAutomations || []) as Automation[]).find((candidate) => {
        if (completedIds.has(candidate.id)) return false;
        const day = Number(candidate.schedule_day || 1);
        const hour = Number(candidate.schedule_hour || 9);
        return currentDay > day || (currentDay === day && currentHour >= hour);
      }) || null;
    }
    if (!automation) return response({ ok: true, skipped: true, reason: "Nenhuma automação ativa." });

    const currentDay = Number(parts.day);
    const currentHour = Number(parts.hour);
    if (!force && (currentDay < Number(automation.schedule_day || 1) || (currentDay === Number(automation.schedule_day || 1) && currentHour < Number(automation.schedule_hour || 9)))) {
      return response({ ok: true, skipped: true, reason: "Fora da janela configurada." });
    }

    const { data: previousRun, error: previousError } = await supabase
      .from("email_automation_runs")
      .select("id,status")
      .eq("automation_id", automation.id)
      .eq("run_month", runMonth)
      .in("status", ["running", "draft", "queued", "success"])
      .order("started_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (previousError) throw previousError;
    if (previousRun && !force) return response({ ok: true, skipped: true, reason: "Automação já executada neste mês.", runId: previousRun.id });

    const { data: run, error: runError } = await supabase.from("email_automation_runs").insert({
      automation_id: automation.id,
      run_month: runMonth,
      status: "running",
    }).select("id").single();
    if (runError) throw runError;
    runId = run.id;

    const { data: group, error: groupError } = await supabase
      .from("fee_groups")
      .select("id,name,client_ids")
      .eq("name", automation.client_group)
      .maybeSingle();
    if (groupError) throw groupError;
    if (!group) throw new Error(`Grupo "${automation.client_group}" não encontrado.`);
    const clientIds = Array.isArray(group.client_ids) ? group.client_ids : [];
    if (!clientIds.length) throw new Error(`Grupo "${group.name}" sem clientes.`);

    const { data: clients, error: clientsError } = await supabase
      .from("clients")
      .select("id,name,email,phone,address,nif,sector,entity_type,responsavel_interno_id,monthly_fee,turnover,status,contract_renewal_date")
      .in("id", clientIds);
    if (clientsError) throw clientsError;
    if (!clients?.length) throw new Error("A automação não encontrou clientes.");

    const staffIds = Array.from(new Set(clients.map((client: any) => client.responsavel_interno_id).filter(Boolean)));
    const staffMap = new Map<string, string>();
    if (staffIds.length) {
      const { data: staffRows, error: staffError } = await supabase.from("staff").select("id,name").in("id", staffIds);
      if (staffError) throw staffError;
      (staffRows || []).forEach((member: any) => staffMap.set(member.id, member.name));
    }

    const model = new GoogleGenerativeAI(mustEmailEnv("GEMINI_API_KEY"))
      .getGenerativeModel({ model: Deno.env.get("GEMINI_MODEL") || "gemini-2.0-flash" });
    const prompt = `
És especialista em comunicação para um gabinete de contabilidade em Portugal.
Cria um rascunho mensal referente a ${runMonth}.
Assunto pretendido: ${automation.subject_hint}
Instruções: ${automation.ai_instructions}
Regras: responde apenas em JSON com {"subject":"...","html":"..."}; usa HTML simples; usa {{name}} e {{responsible_name}}; não inventes prazos, valores ou obrigações; escreve em português de Portugal; máximo 180 palavras.
    `.trim();
    const generated = extractJson((await model.generateContent(prompt)).response.text());

    const recipients = clients.map((client: any) => {
      const responsibleName = staffMap.get(client.responsavel_interno_id) || "";
      return {
        client_id: client.id,
        name: client.name,
        email: client.email,
        subject: renderTemplate(generated.subject, client, responsibleName, false),
        html: renderTemplate(generated.html, client, responsibleName, true),
        metadata: { automation_id: automation!.id, run_month: runMonth },
      };
    });

    const { data: campaign, error: campaignError } = await supabase.rpc("create_email_campaign", {
      p_subject: generated.subject,
      p_body: generated.html,
      p_group_name: group.name,
      p_campaign_type: automation.campaign_type || "service",
      p_preheader: "",
      p_signature_html: "",
      p_from_name: automation.from_name,
      p_from_email: automation.from_email,
      p_reply_to: automation.reply_to || automation.from_email,
      p_scheduled_at: new Date().toISOString(),
      p_template_id: null,
      p_idempotency_key: `automation:${automation.id}:${runMonth}`,
      p_requires_approval: automation.requires_approval !== false,
      p_recipients: recipients,
    });
    if (campaignError) throw campaignError;

    const runStatus = automation.requires_approval !== false ? "draft" : "queued";
    await supabase.from("email_automation_runs").update({
      finished_at: new Date().toISOString(),
      status: runStatus,
      successes: 0,
      failures: Number(campaign.excluded_count || 0),
      details: { campaign_id: campaign.id, eligible: campaign.eligible_count, excluded: campaign.excluded_count },
    }).eq("id", runId);
    await supabase.from("email_automations").update({ last_run_at: new Date().toISOString() }).eq("id", automation.id);

    return response({ ok: true, campaign, runId, requiresApproval: automation.requires_approval !== false });
  } catch (error: any) {
    const message = String(error?.message || "Erro desconhecido.");
    console.error("monthly-obligations:", message);
    if (runId && supabase) {
      await supabase.from("email_automation_runs").update({
        finished_at: new Date().toISOString(),
        status: "error",
        failures: 1,
        error: message.slice(0, 2000),
      }).eq("id", runId).catch(() => undefined);
    }
    await notifyFailure(automation, message, runId).catch((notifyError) => console.error("automation notification:", notifyError));
    return response({ error: message }, error instanceof AppAuthorizationError ? error.status : 500);
  }
});
