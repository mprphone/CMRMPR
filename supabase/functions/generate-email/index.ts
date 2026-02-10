import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenerativeAI } from "npm:@google/generative-ai";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function extractJson(text: string) {
  // Remove fenced blocks if present
  const cleaned = text.replace(/```json/gi, "```").trim();
  // Try: take first {...} block
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) return null;
  return match[0];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { topic, tone } = await req.json().catch(() => ({}));
    if (!topic || !tone) {
      return new Response(JSON.stringify({ error: "Topic and tone are required." }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
        status: 400,
      });
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not set in Supabase secrets.");
    }

    // IMPORTANT: ensure this model name is valid for your account.
    // Common options include: "gemini-1.5-flash", "gemini-1.5-pro", "gemini-2.0-flash"
    const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL") || "gemini-1.5-flash";

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

    const prompt = `
Atue como um especialista em comunicacao para um gabinete de contabilidade em Portugal.
Crie um template de email (assunto e corpo) sobre o seguinte topico: "${topic}".
O tom do email deve ser: ${tone}.

Objetivo de estilo:
- Texto curto, limpo e direto (maximo ~140 palavras).
- Evitar linguagem burocratica e paragrafos longos.
- Destacar apenas o essencial com **negrito**.
- Sempre que fizer sentido, usar linhas do tipo "Campo: valor" para facilitar leitura.

Estrutura recomendada:
1) Saudacao curta.
2) Motivo em 1 frase.
3) Pontos importantes em linhas curtas.
4) Fecho cordial.

O email deve ser dirigido ao cliente e pode usar variaveis.
Variaveis disponiveis: {{name}}, {{responsible_name}}, {{nif}}, {{email}}, {{phone}}, {{address}}, {{sector}}, {{entityType}}, {{turnover}}, {{avenca_atual}}, {{nova_avenca}}.

Responda APENAS em formato JSON com a seguinte estrutura:
{
  "subject": "<Assunto do email, usando variaveis se necessario>",
  "body": "<Corpo do email em texto simples, sem HTML, usando \\n para novas linhas e **negrito** no que for mais importante.>"
}
`.trim();

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const jsonCandidate = extractJson(text);
    if (!jsonCandidate) {
      throw new Error("A IA não devolveu JSON válido. Resposta recebida: " + text.slice(0, 300));
    }

    let parsed: any;
    try {
      parsed = JSON.parse(jsonCandidate);
    } catch {
      throw new Error("Falha ao interpretar JSON da IA. Conteúdo recebido: " + jsonCandidate.slice(0, 300));
    }

    if (!parsed?.subject || !parsed?.body) {
      throw new Error("JSON inválido: faltam campos 'subject' e/ou 'body'.");
    }

    return new Response(JSON.stringify({ subject: parsed.subject, body: parsed.body }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: any) {
    console.error("Error in generate-email function:", error);

    let errorMessage = error?.message || "Erro desconhecido.";
    if (typeof errorMessage === "string" && (errorMessage.includes("429") || errorMessage.toLowerCase().includes("rate limit"))) {
      errorMessage = "Limite de pedidos à IA atingido. Por favor, aguarde um minuto antes de tentar novamente.";
    }

    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});


