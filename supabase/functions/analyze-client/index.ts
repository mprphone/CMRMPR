import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenerativeAI } from "npm:@google/generative-ai";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function extractFirstJsonObject(text: string): unknown {
  // Strip common markdown fences
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();

  // Try to find the first JSON object in the response
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error(
      "A IA não devolveu JSON válido. Tente novamente ou ajuste o prompt para responder apenas em JSON."
    );
  }

  try {
    return JSON.parse(match[0]);
  } catch (_e) {
    throw new Error(
      "Falha ao interpretar a resposta da IA (JSON inválido). Tente novamente."
    );
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { client, analysis } = await req.json();
    if (!client || !analysis) {
      throw new Error("Client and analysis data are required.");
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not set in Supabase secrets.");
    }

    // ✅ Use ONLY the model configured in secrets (no fallback),
    // so you control the version centrally in Supabase.
    const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL");
    if (!GEMINI_MODEL) {
      throw new Error("Falta a variável GEMINI_MODEL nos Supabase secrets.");
    }

    console.log("analyze-client using GEMINI_MODEL:", GEMINI_MODEL);

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

    const prompt = `
Atue como um Consultor Sénior de Gestão para Gabinetes de Contabilidade em Portugal.
Analise o seguinte cliente e forneça uma análise estratégica e uma sugestão de avença.

DADOS DO CLIENTE:
Nome: ${client.name}
Setor: ${client.sector}
Volume Documental: ${client.documentCount}
Nº Colaboradores: ${client.employeeCount}
Avença Mensal Atual: ${client.monthlyFee}€

DADOS DE RENTABILIDADE (ANUAL):
Custo Estimado (Interno): ${Number(analysis.totalAnnualCost).toFixed(2)}€
Receita Anual: ${Number(analysis.totalAnnualRevenue).toFixed(2)}€
Margem de Lucro: ${Number(analysis.profitability).toFixed(1)}%
Preço/Hora Efetivo: ${Number(analysis.hourlyReturn).toFixed(2)}€

Responda APENAS em formato JSON com a seguinte estrutura:
{
  "parecer": "Um parecer estratégico curto (máximo 3 parágrafos) sobre a rentabilidade. Se a margem for negativa ou baixa (<20%), sugira argumentos para renegociação ou estratégias de eficiência. Se for alta, sugira como fidelizar. Seja direto, profissional e focado em ação.",
  "avenca_sugerida": 123
}
    `.trim();

    const result = await model.generateContent(prompt);
    const text = result.response.text();

    const parsed = extractFirstJsonObject(text) as any;

    // Light validation
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.parecer !== "string" ||
      (typeof parsed.avenca_sugerida !== "number" &&
        typeof parsed.avenca_sugerida !== "string")
    ) {
      throw new Error(
        "A IA devolveu um JSON fora do formato esperado. Tente novamente."
      );
    }

    // Ensure avenca_sugerida is integer number
    const fee = Math.round(Number(parsed.avenca_sugerida));
    if (!Number.isFinite(fee)) {
      throw new Error("avenca_sugerida não é um número válido.");
    }

    const normalized = {
      parecer: parsed.parecer,
      avenca_sugerida: fee,
    };

    return new Response(JSON.stringify(normalized), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: any) {
    console.error("Error in analyze-client function:", error);

    let errorMessage =
      typeof error?.message === "string" ? error.message : "Erro inesperado.";

    // Friendlier message for rate limits
    if (
      typeof errorMessage === "string" &&
      (errorMessage.includes("429") ||
        errorMessage.toLowerCase().includes("rate limit"))
    ) {
      errorMessage =
        "Limite de pedidos à IA atingido. Aguarde um minuto e tente novamente.";
    }

    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
