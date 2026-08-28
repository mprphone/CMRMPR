import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emailCorsHeaders, mustEmailEnv } from "../_shared/email.ts";

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...emailCorsHeaders, "Content-Type": "application/json" },
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: emailCorsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Método não permitido." }, 405);
  try {
    const expected = mustEmailEnv("CMR_INTEGRATION_API_KEY");
    const supplied = req.headers.get("x-cmr-integration-key") || "";
    if (supplied !== expected) return jsonResponse({ error: "Chave inválida." }, 401);

    const payload = await req.json().catch(() => ({}));
    const runId = String(payload.runId || "").trim();
    if (!runId) return jsonResponse({ error: "runId em falta." }, 400);

    const supabase = createClient(mustEmailEnv("SUPABASE_URL"), mustEmailEnv("SUPABASE_SERVICE_ROLE_KEY"), {
      auth: { persistSession: false },
    });

    const results = Array.isArray(payload.results) ? payload.results : [];
    await supabase.from("saft_avenca_sync_runs").update({
      status: payload.success === false ? "failed" : "completed",
      finished_at: new Date().toISOString(),
      updated_count: Number(payload.updated || 0),
      failed_count: Number(payload.failed || 0),
      details: results,
      error: payload.error || null,
    }).eq("id", runId);

    return jsonResponse({ ok: true });
  } catch (error: any) {
    console.error("saft-avenca-report:", error);
    return jsonResponse({ error: error?.message || "Falha ao registar relatório." }, 500);
  }
});
