import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { AppAuthorizationError, requireAppPermission } from "../_shared/authorization.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const jsonResponse = (status: number, body: Record<string, unknown>) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

const mustEnv = (name: string): string => {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} não configurado.`);
  return value;
};

const normalizeEmail = (value: unknown): string => String(value || "").trim().toLowerCase();

const validatePassword = (value: unknown): string => {
  const password = String(value || "");
  if (password.length < 12 || password.length > 128) {
    throw new AppAuthorizationError("A palavra-passe deve ter entre 12 e 128 caracteres.", 400);
  }
  if (!/[a-z]/.test(password) || !/[A-Z]/.test(password) || !/[0-9]/.test(password)) {
    throw new AppAuthorizationError(
      "A palavra-passe deve incluir maiúscula, minúscula e número.",
      400,
    );
  }
  return password;
};

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    if (req.method !== "POST") {
      throw new AppAuthorizationError("Método não permitido.", 405);
    }

    await requireAppPermission(req, "settings", "edit", "app_can_manage_users");

    const body = await req.json().catch(() => ({}));
    const action = String(body?.action || "");
    const supabaseUrl = mustEnv("SUPABASE_URL");
    const serviceRoleKey = mustEnv("SUPABASE_SERVICE_ROLE_KEY");
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    if (action === "disable_mfa") {
      const userId = String(body?.userId || "").trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
        throw new AppAuthorizationError("Utilizador inválido.", 400);
      }

      // Um admin não pode usar esta via de recuperação para desativar o
      // próprio MFA — isso exige provar posse de um código atual em
      // "Configurações → Segurança da sua conta". Esta ação serve apenas
      // para desbloquear OUTRA conta que perdeu o acesso ao autenticador.
      const callerToken = (req.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
      const { data: callerData } = await admin.auth.getUser(callerToken);
      if (callerData?.user?.id && callerData.user.id === userId) {
        throw new AppAuthorizationError(
          "Não pode desativar o seu próprio MFA por aqui. Use Configurações → Segurança da sua conta.",
          400,
        );
      }

      const { data: userData, error: userError } = await admin.auth.admin.getUserById(userId);
      if (userError) throw userError;
      const factors = ((userData?.user as any)?.factors || []) as Array<{ id: string }>;

      let removedFactors = 0;
      for (const factor of factors) {
        const response = await fetch(
          `${supabaseUrl}/auth/v1/admin/users/${userId}/factors/${factor.id}`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${serviceRoleKey}`, apikey: serviceRoleKey },
          },
        );
        if (response.ok) {
          removedFactors += 1;
        } else {
          console.error("[manage-users] Falha ao remover fator MFA", factor.id, await response.text().catch(() => ""));
        }
      }

      return jsonResponse(200, { success: true, userId, removedFactors });
    }

    const password = validatePassword(body?.password);

    if (action === "create") {
      const email = normalizeEmail(body?.email);
      const displayName = String(body?.displayName || "").trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
        throw new AppAuthorizationError("Indique um email válido.", 400);
      }
      if (!displayName || displayName.length > 120) {
        throw new AppAuthorizationError("Indique um nome com até 120 caracteres.", 400);
      }

      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name: displayName, display_name: displayName },
      });
      if (error) throw error;
      if (!data.user) throw new Error("O servidor não devolveu o novo utilizador.");

      return jsonResponse(200, {
        success: true,
        user: { id: data.user.id, email: data.user.email || email },
      });
    }

    if (action === "reset_password") {
      const userId = String(body?.userId || "").trim();
      if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
        throw new AppAuthorizationError("Utilizador inválido.", 400);
      }

      const { data, error } = await admin.auth.admin.updateUserById(userId, { password });
      if (error) throw error;
      if (!data.user) throw new Error("Utilizador não encontrado.");

      return jsonResponse(200, { success: true, userId: data.user.id });
    }

    throw new AppAuthorizationError("Operação inválida.", 400);
  } catch (error: any) {
    console.error("[manage-users]", error?.message || error);
    const reportedStatus = Number(error?.status || 0);
    const status = error instanceof AppAuthorizationError
      ? error.status
      : reportedStatus >= 400 && reportedStatus < 500
        ? reportedStatus
        : 500;
    const message = status >= 500
      ? "Não foi possível concluir a operação de utilizadores."
      : String(error?.message || "Pedido inválido.");
    return jsonResponse(status, { success: false, error: message });
  }
});
