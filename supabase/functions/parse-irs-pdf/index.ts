import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { GoogleGenerativeAI } from "npm:@google/generative-ai";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function extractFirstJsonObject(text: string): unknown {
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();
  const match = cleaned.match(/\{[\s\S]*\}/);
  if (!match) {
    throw new Error("A IA não devolveu JSON válido.");
  }
  return JSON.parse(match[0]);
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { firstPageText, pdfBase64, mimeType, fileName } = await req.json().catch(() => ({}));
    const hasTextInput = typeof firstPageText === "string" && firstPageText.trim().length > 0;
    const hasPdfInput = typeof pdfBase64 === "string" && pdfBase64.trim().length > 0;
    if (!hasTextInput && !hasPdfInput) {
      throw new Error("firstPageText ou pdfBase64 é obrigatório.");
    }

    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) {
      throw new Error("GEMINI_API_KEY is not set in Supabase secrets.");
    }

    const GEMINI_MODEL = Deno.env.get("GEMINI_MODEL");
    if (!GEMINI_MODEL) {
      throw new Error("Falta a variável GEMINI_MODEL nos Supabase secrets.");
    }

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL });

    const prompt = `
Extrai os NIFs de um comprovativo de IRS português (primeira página).
Objetivo:
- subjectANif = NIF do "Sujeito Passivo A"
- subjectBNif = NIF do "Sujeito Passivo B" (se existir)
- dependentNifs = array de NIFs de "Dependentes" (pode estar vazio)

Regras:
- Só números com 9 dígitos.
- Se não existir valor, devolver string vazia para subjectANif/subjectBNif.
- Não inventar NIFs.
- Responder apenas JSON.

Formato de resposta obrigatório:
{
  "subjectANif": "123456789",
  "subjectBNif": "",
  "dependentNifs": ["111111111", "222222222"]
}
    `.trim();

    const contentParts: any[] = [{ text: prompt }];
    if (hasTextInput) {
      contentParts.push({ text: `Texto extraído:\n${String(firstPageText).slice(0, 20000)}` });
    }
    if (hasPdfInput) {
      contentParts.push({
        inlineData: {
          mimeType: typeof mimeType === "string" && mimeType ? mimeType : "application/pdf",
          data: String(pdfBase64),
        },
      });
      if (typeof fileName === "string" && fileName) {
        contentParts.push({ text: `Nome do ficheiro: ${fileName}` });
      }
    }

    const result = await model.generateContent(contentParts);
    const text = result.response.text();
    const parsed = extractFirstJsonObject(text) as any;

    const normalizeNif = (value: unknown): string => {
      const nif = String(value || "").replace(/\D/g, "");
      return nif.length === 9 ? nif : "";
    };

    const dependentNifs = Array.isArray(parsed?.dependentNifs)
      ? parsed.dependentNifs.map((value: unknown) => normalizeNif(value)).filter(Boolean)
      : [];

    const response = {
      subjectANif: normalizeNif(parsed?.subjectANif),
      subjectBNif: normalizeNif(parsed?.subjectBNif),
      dependentNifs: Array.from(new Set(dependentNifs)),
    };

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error: any) {
    console.error("Error in parse-irs-pdf function:", error);
    return new Response(JSON.stringify({ error: error?.message || "Erro inesperado." }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 500,
    });
  }
});
