import { Client, AnalysisResult, AiAnalysis, AiTemplateAnalysis } from "../types";
import { ensureStoreClient } from './supabase';

/**
 * IMPORTANT:
 * Many Supabase Edge Functions run with JWT verification ON by default.
 * If you invoke them from the browser without setting the Authorization token,
 * you will get 401 / "Invalid JWT" and the function won't even execute.
 *
 * This helper mirrors what you already do in "send test email":
 * - getSession()
 * - functions.setAuth(access_token)
 */
async function ensureFunctionAuth(storeClient: any) {
  const { data: { session }, error } = await storeClient.auth.getSession();
  if (error || !session?.access_token) {
    throw new Error("Sessão inválida ou expirada. Faça login novamente e recarregue a página.");
  }
  storeClient.functions.setAuth(session.access_token);
}

export const analyzeClientWithAI = async (client: Client, analysis: AnalysisResult): Promise<AiAnalysis> => {
  const storeClient = ensureStoreClient();

  try {
    await ensureFunctionAuth(storeClient);

    const { data, error } = await storeClient.functions.invoke('analyze-client', {
      body: { client, analysis },
    });

    if (error) {
      console.error("Erro na Edge Function 'analyze-client':", error);
      if (error.context && typeof (error.context as any).json === 'function') {
        const functionError = await (error.context as any).json().catch(() => null);
        if (functionError?.error) throw new Error(functionError.error);
        if (functionError?.message) throw new Error(functionError.message);
      }
      throw new Error("A função de análise de cliente falhou no servidor. Verifique os logs da Edge Function.");
    }

    if (!data) throw new Error("A função de análise de cliente retornou uma resposta vazia.");

    return data as AiAnalysis;
  } catch (err: any) {
    console.error("AI analyze error:", err);
    throw err;
  }
};

export const generateTemplateWithAI = async (topic: string, tone: string): Promise<AiTemplateAnalysis> => {
  const storeClient = ensureStoreClient();

  try {
    await ensureFunctionAuth(storeClient);

    const { data, error } = await storeClient.functions.invoke('generate-email', {
      body: { topic, tone },
    });

    if (error) {
      console.error("Erro na Edge Function 'generate-email':", error);
      if (error.context && typeof (error.context as any).json === 'function') {
        const functionError = await (error.context as any).json().catch(() => null);
        if (functionError?.error) throw new Error(functionError.error);
        if (functionError?.message) throw new Error(functionError.message);
      }
      throw new Error("A função de geração de email falhou no servidor. Verifique os logs da Edge Function.");
    }

    if (!data) throw new Error("A função de geração de email retornou uma resposta vazia.");

    return data as AiTemplateAnalysis;
  } catch (err: any) {
    console.error("AI template generation error:", err);
    throw err;
  }
};
