import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { emailCorsHeaders, mustEmailEnv } from "../_shared/email.ts";

// GIF transparente 1x1 - devolvido sempre, mesmo em erro, para nunca mostrar
// uma imagem partida ao destinatário.
const PIXEL = Uint8Array.from(
  atob("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw=="),
  (char) => char.charCodeAt(0),
);

const pixelResponse = () => new Response(PIXEL, {
  status: 200,
  headers: {
    ...emailCorsHeaders,
    "Content-Type": "image/gif",
    "Cache-Control": "no-store, no-cache, must-revalidate",
  },
});

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: emailCorsHeaders });
  try {
    const token = new URL(req.url).searchParams.get("token") || "";
    if (/^[0-9a-f-]{36}$/i.test(token)) {
      const supabase = createClient(mustEmailEnv("SUPABASE_URL"), mustEmailEnv("SUPABASE_SERVICE_ROLE_KEY"), {
        auth: { persistSession: false },
      });
      await supabase.rpc("register_email_open", { p_token: token });
    }
  } catch (error) {
    console.error("email-open-track:", error);
  }
  return pixelResponse();
});
