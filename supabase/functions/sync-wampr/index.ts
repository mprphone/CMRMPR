import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-wampr-sync-secret",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const encoder = new TextEncoder();

function secureEqual(left: string, right: string): boolean {
  const a = encoder.encode(left.trim());
  const b = encoder.encode(right.trim());
  if (a.length === 0 || a.length !== b.length) return false;
  let difference = 0;
  for (let index = 0; index < a.length; index += 1) difference |= a[index] ^ b[index];
  return difference === 0;
}

function mustEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} não configurado.`);
  return value;
}

function bearerToken(req: Request): string {
  const authorization = req.headers.get("authorization")?.trim() || "";
  return /^Bearer\s+/i.test(authorization) ? authorization.replace(/^Bearer\s+/i, "").trim() : "";
}

function jsonResponse(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(value));
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse(405, { success: false, error: "Método não permitido." });

  try {
    const supabaseUrl = mustEnv("SUPABASE_URL");
    const anonKey = mustEnv("SUPABASE_ANON_KEY");
    const serviceRoleKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
    const wamprUrl = mustEnv("WAMPR_API_URL");
    const wamprIntegrationKey = mustEnv("WAMPR_INTEGRATION_API_KEY");
    const sharedSecret = mustEnv("WAMPR_SYNC_SHARED_SECRET");
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const presentedSecret = req.headers.get("x-wampr-sync-secret")?.trim() || "";
    const authenticatedByServer = secureEqual(presentedSecret, sharedSecret);
    if (!authenticatedByServer) {
      const token = bearerToken(req);
      if (!token) return jsonResponse(401, { success: false, error: "Autenticação obrigatória." });
      const { data, error } = await admin.auth.getUser(token);
      if (error || !data.user) return jsonResponse(401, { success: false, error: "Sessão inválida ou expirada." });

      const caller = createClient(supabaseUrl, anonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } },
      });
      const { data: canSync, error: permissionError } = await caller.rpc("app_can_sync_wampr");
      if (permissionError) throw permissionError;
      if (canSync !== true) {
        return jsonResponse(403, { success: false, error: "Esta conta não pode executar a sincronização WAPRO → CMR." });
      }
    }

    const requestBody = await req.json().catch(() => ({}));
    if (requestBody?.mode && requestBody.mode !== "pull") {
      return jsonResponse(400, { success: false, error: "Modo de sincronização inválido." });
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 90_000);
    let snapshotResponse: Response;
    try {
      snapshotResponse = await fetch(wamprUrl, {
        headers: {
          Accept: "application/json",
          "x-cmr-integration-key": wamprIntegrationKey,
        },
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const snapshot = await snapshotResponse.json().catch(() => null);
    if (!snapshotResponse.ok || snapshot?.success !== true) {
      throw new Error(snapshot?.error || `WAMPR respondeu HTTP ${snapshotResponse.status}`);
    }
    if (!Array.isArray(snapshot.clients) || !Array.isArray(snapshot.staff)) {
      throw new Error("Snapshot WAMPR inválido.");
    }
    if (snapshot.clients.length > 5000 || snapshot.staff.length > 1000) {
      throw new Error("Snapshot WAMPR excede o limite permitido.");
    }
    if (!/^[a-f0-9]{64}$/i.test(String(snapshot.snapshotId || ""))) {
      throw new Error("Identificador do snapshot WAMPR inválido.");
    }
    const calculatedSnapshotId = await sha256Hex(JSON.stringify({
      clients: snapshot.clients,
      staff: snapshot.staff,
    }));
    if (!secureEqual(calculatedSnapshotId, String(snapshot.snapshotId))) {
      throw new Error("Integridade do snapshot WAMPR inválida.");
    }

    // Chamada como um pedido separado (transação própria já confirmada) para
    // que uma falha a meio de sync_wampr_snapshot não desfaça também este
    // registo inicial — caso contrário a corrida falhada desaparecia de
    // wampr_sync_runs em vez de ficar marcada como 'error'.
    const { error: beginError } = await admin.rpc("wampr_sync_begin", {
      sync_snapshot_id: snapshot.snapshotId,
      snapshot_generated_at: snapshot.generatedAt || null,
      p_clients_count: snapshot.clients.length,
      p_staff_count: snapshot.staff.length,
    });
    if (beginError) throw beginError;

    const { data, error } = await admin.rpc("sync_wampr_snapshot", {
      clients_data: snapshot.clients,
      staff_data: snapshot.staff,
      sync_snapshot_id: snapshot.snapshotId,
      snapshot_generated_at: snapshot.generatedAt || null,
    });
    if (error) throw error;

    return jsonResponse(200, {
      success: true,
      snapshotId: snapshot.snapshotId,
      counts: snapshot.counts || { clients: snapshot.clients.length, staff: snapshot.staff.length },
      result: data,
    });
  } catch (error) {
    console.error("[sync-wampr]", error?.message || error);
    return jsonResponse(500, { success: false, error: String(error?.message || error) });
  }
});
