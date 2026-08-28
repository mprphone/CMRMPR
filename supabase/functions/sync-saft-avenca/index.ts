import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AppAuthorizationError, requireAppPermission } from "../_shared/authorization.ts";
import { emailCorsHeaders, mustEmailEnv } from "../_shared/email.ts";

const VAT_RATES: Record<string, number> = {
  continente: 0.23,
  madeira: 0.22,
  acores: 0.18,
};

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...emailCorsHeaders, "Content-Type": "application/json" },
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: emailCorsHeaders });
  try {
    if (req.method !== "POST") throw new AppAuthorizationError("Método não permitido.", 405);
    await requireAppPermission(req, "billing", "edit");

    const authorization = req.headers.get("authorization") || "";
    const token = authorization.replace(/^Bearer\s+/i, "").trim();
    const userClient = createClient(mustEmailEnv("SUPABASE_URL"), Deno.env.get("SUPABASE_ANON_KEY") || "", {
      auth: { persistSession: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData } = await userClient.auth.getUser(token);
    const userId = userData?.user?.id || null;

    const supabase = createClient(mustEmailEnv("SUPABASE_URL"), mustEmailEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });

    const { data: clients, error: clientsError } = await supabase
      .from("clients")
      .select("nif, name, monthly_fee, vat_region, status, entity_type")
      .gt("monthly_fee", 0);
    if (clientsError) throw clientsError;

    const ACTIVE_STATUSES = new Set(["ATIVO", "ATIVA", "ACTIVA"]);
    const ENTITY_TYPES = new Set(["SOCIEDADE", "INDEPENDENTE"]);

    const items = (clients || [])
      .filter((client: any) =>
        ACTIVE_STATUSES.has(String(client.status || "").trim().toUpperCase())
        && ENTITY_TYPES.has(String(client.entity_type || "").trim().toUpperCase()))
      .map((client: any) => {
        const nif = String(client.nif || "").replace(/\D/g, "");
        const rate = VAT_RATES[client.vat_region] ?? VAT_RATES.continente;
        const valor = Math.round(Number(client.monthly_fee || 0) * (1 + rate) * 100) / 100;
        return { nif, valor, name: client.name };
      })
      .filter((item) => item.nif.length === 9 && item.valor > 0);

    if (!items.length) return jsonResponse({ error: "Nenhum cliente elegível encontrado." }, 400);

    const { data: run, error: runError } = await supabase.from("saft_avenca_sync_runs").insert({
      triggered_by: userId,
      total: items.length,
      status: "running",
    }).select("id").single();
    if (runError) throw runError;

    const saftUrl = mustEmailEnv("SAFTONLINE_WRITE_URL");
    const cmrKey = mustEmailEnv("CMR_INTEGRATION_API_KEY");
    const response = await fetch(saftUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-cmr-integration-key": cmrKey },
      body: JSON.stringify({ runId: run.id, items: items.map(({ nif, valor }) => ({ nif, valor })) }),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok || body?.success === false) {
      await supabase.from("saft_avenca_sync_runs").update({
        status: "failed",
        finished_at: new Date().toISOString(),
        error: body?.error || `HTTP ${response.status}`,
      }).eq("id", run.id);
      return jsonResponse({ error: body?.error || "Falha ao iniciar a sincronização no mprWA." }, 502);
    }

    return jsonResponse({ ok: true, runId: run.id, total: items.length });
  } catch (error: any) {
    console.error("sync-saft-avenca:", error);
    return jsonResponse(
      { error: error?.message || "Não foi possível iniciar a sincronização." },
      error instanceof AppAuthorizationError ? error.status : 500,
    );
  }
});
