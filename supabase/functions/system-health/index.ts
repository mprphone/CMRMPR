import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AppAuthorizationError, requireAppPermission } from "../_shared/authorization.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const mustEnv = (name: string): string => {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} não configurado.`);
  return value;
};

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });

const ageHours = (value: unknown): number | null => {
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? Math.max(0, (Date.now() - parsed) / 3_600_000) : null;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method !== "POST") throw new AppAuthorizationError("Método não permitido.", 405);
    await requireAppPermission(req, "settings", "view");

    const admin = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const [clientsResult, syncedClientsResult, staffResult, syncedStaffResult, syncRunResult, backupResult] = await Promise.all([
      admin.from("clients").select("id", { count: "exact", head: true }),
      admin.from("clients").select("id", { count: "exact", head: true }).not("wampr_source_id", "is", null),
      admin.from("staff").select("id", { count: "exact", head: true }),
      admin.from("staff").select("id", { count: "exact", head: true }).not("wampr_source_id", "is", null),
      admin.from("wampr_sync_runs")
        .select("snapshot_id,generated_at,received_at,completed_at,clients_count,staff_count,status,error")
        .order("received_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      admin.from("app_config").select("value,updated_at").eq("key", "system_backup_health").maybeSingle(),
    ]);

    const dbErrors = [clientsResult, syncedClientsResult, staffResult, syncedStaffResult, syncRunResult, backupResult]
      .map(result => result.error)
      .filter(Boolean);
    if (dbErrors.length > 0) throw dbErrors[0];

    let wamprStatus: any = null;
    let wamprError: string | null = null;
    try {
      const snapshotUrl = mustEnv("WAMPR_API_URL");
      const statusUrl = snapshotUrl.replace(/\/snapshot\/?$/i, "/status");
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 10_000);
      try {
        const response = await fetch(statusUrl, {
          headers: {
            Accept: "application/json",
            "x-cmr-integration-key": mustEnv("WAMPR_INTEGRATION_API_KEY"),
          },
          signal: controller.signal,
        });
        const payload = await response.json().catch(() => null);
        if (!response.ok || payload?.success !== true) {
          throw new Error(payload?.error || `WAPRO respondeu HTTP ${response.status}`);
        }
        wamprStatus = payload.status || null;
      } finally {
        clearTimeout(timeout);
      }
    } catch (error: any) {
      wamprError = String(error?.message || error);
    }

    const backup = (backupResult.data?.value || null) as any;
    const latestSync = syncRunResult.data || null;
    const syncAge = ageHours(wamprStatus?.lastSuccessAt || latestSync?.completed_at);
    const backupAge = ageHours(backupResult.data?.updated_at || backup?.checkedAt);
    const syncHealthy = Boolean(
      !wamprError
      && wamprStatus?.enabled
      && wamprStatus?.configured
      && Number(wamprStatus?.failed || 0) === 0
      && syncAge !== null
      && syncAge <= 3
      && latestSync?.status === "success"
    );
    const backupHealthy = Boolean(backup?.status === "success" && backupAge !== null && backupAge <= 36);

    const warnings: string[] = [];
    if (wamprError) warnings.push(`Ligação ao WAPRO: ${wamprError}`);
    if (!wamprStatus?.enabled || !wamprStatus?.configured) warnings.push("Sincronização automática WAPRO → CMR inativa ou incompleta.");
    if (Number(wamprStatus?.failed || 0) > 0) warnings.push(`${wamprStatus.failed} alteração(ões) com falha na fila de sincronização.`);
    if (Number(wamprStatus?.pending || 0) > 0) warnings.push(`${wamprStatus.pending} alteração(ões) aguardam sincronização.`);
    if (syncAge === null || syncAge > 3) warnings.push("A última sincronização bem-sucedida tem mais de 3 horas.");
    if (latestSync?.status === "error") {
      warnings.push(`A última sincronização WAPRO → CMR falhou: ${latestSync.error || "erro desconhecido"}.`);
    }
    if (!backup) warnings.push("Ainda não existe estado verificável do backup automático.");
    else if (backup?.status !== "success") warnings.push(backup?.message || "O último backup não terminou com sucesso.");
    else if (backupAge === null || backupAge > 36) warnings.push("O último backup bem-sucedido tem mais de 36 horas.");

    return jsonResponse(200, {
      success: true,
      health: {
        overall: warnings.length === 0 ? "healthy" : "warning",
        checkedAt: new Date().toISOString(),
        warnings,
        database: {
          ok: true,
          clients: clientsResult.count || 0,
          syncedClients: syncedClientsResult.count || 0,
          staff: staffResult.count || 0,
          syncedStaff: syncedStaffResult.count || 0,
        },
        sync: {
          ok: syncHealthy,
          enabled: Boolean(wamprStatus?.enabled),
          configured: Boolean(wamprStatus?.configured),
          running: Boolean(wamprStatus?.running),
          pending: Number(wamprStatus?.pending || 0),
          failed: Number(wamprStatus?.failed || 0),
          lastSuccessAt: wamprStatus?.lastSuccessAt || latestSync?.completed_at || null,
          latestDatabaseRun: latestSync,
        },
        backup: {
          ok: backupHealthy,
          status: backup?.status || "unknown",
          lastCheckedAt: backupResult.data?.updated_at || backup?.checkedAt || null,
          backupId: backup?.backupId || null,
          message: backup?.message || null,
        },
      },
    });
  } catch (error: any) {
    console.error("[system-health]", error?.message || error);
    const status = error instanceof AppAuthorizationError ? error.status : 500;
    return jsonResponse(status, {
      success: false,
      error: status >= 500 ? "Não foi possível verificar o estado do sistema." : String(error?.message || error),
    });
  }
});

