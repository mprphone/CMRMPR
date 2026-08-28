import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export class AppAuthorizationError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "AppAuthorizationError";
    this.status = status;
  }
}

const mustEnv = (name: string): string => {
  const value = Deno.env.get(name)?.trim();
  if (!value) throw new Error(`${name} não configurado.`);
  return value;
};

export const requireAppPermission = async (
  req: Request,
  moduleName: string,
  actionName: string,
  specialPermissionRpc?: string,
): Promise<void> => {
  const authorization = req.headers.get("authorization")?.trim() || "";
  const token = authorization.replace(/^Bearer\s+/i, "").trim();
  if (!token || token === authorization) {
    throw new AppAuthorizationError("Autenticação obrigatória.", 401);
  }

  const client = createClient(mustEnv("SUPABASE_URL"), mustEnv("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userError } = await client.auth.getUser(token);
  if (userError || !userData.user) {
    throw new AppAuthorizationError("Sessão inválida ou expirada.", 401);
  }

  const { data: allowed, error: permissionError } = await client.rpc("app_has_permission", {
    p_module: moduleName,
    p_action: actionName,
  });
  if (permissionError) throw permissionError;
  if (allowed !== true) {
    throw new AppAuthorizationError("Esta conta não tem permissão para esta operação.", 403);
  }

  if (specialPermissionRpc) {
    const { data: specialAllowed, error: specialError } = await client.rpc(specialPermissionRpc);
    if (specialError) throw specialError;
    if (specialAllowed !== true) {
      throw new AppAuthorizationError("Esta conta não tem permissão para aceder a estes dados.", 403);
    }
  }
};
