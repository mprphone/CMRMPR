
import { Client, AnalysisResult, AiAnalysis, AiTemplateAnalysis } from "../types";
import { ensureStoreClient } from './supabase';

export const analyzeClientWithAI = async (client: Client, analysis: AnalysisResult): Promise<AiAnalysis> => {
  const storeClient = ensureStoreClient();

  try {
    const { data, error } = await storeClient.functions.invoke('analyze-client', {
      body: { client, analysis }
    });

    if (error) {
      console.error("Erro na Edge Function 'analyze-client':", error);
      // Try to extract a more specific error message from the function's response
      if (error.context && typeof error.context.json === 'function') {
        const functionError = await error.context.json().catch(() => null);
        if (functionError && functionError.error) throw new Error(functionError.error);
      }
      throw new Error("A função de análise de cliente falhou no servidor. Verifique os logs da Edge Function.");
    }

    if (!data) {
      throw new Error("A função de análise de cliente retornou uma resposta vazia.");
    }

    return data as AiAnalysis;
  } catch (error) {
    console.error("Gemini API Error:", error);
    return { parecer: "Erro ao contactar a IA. Verifique a consola para mais detalhes.", avenca_sugerida: 0 };
  }
};

export const generateTemplateWithAI = async (topic: string, tone: string): Promise<AiTemplateAnalysis> => {
  const storeClient = ensureStoreClient();

  try {
    const { data, error } = await storeClient.functions.invoke('generate-email', {
      body: { topic, tone }
    });

    if (error) {
      console.error("Erro na Edge Function 'generate-email':", error);
      if (error.context && typeof error.context.json === 'function') {
        const functionError = await error.context.json().catch(() => null);
        if (functionError && functionError.error) throw new Error(functionError.error);
      }
      throw new Error("A função de geração de email falhou no servidor. Verifique os logs da Edge Function.");
    }

    if (!data) {
      throw new Error("A função de geração de email retornou uma resposta vazia.");
    }

    return data as AiTemplateAnalysis;
  } catch (error) {
    console.error("Gemini Template Generation Error:", error);
    return { subject: "Erro", body: "Ocorreu um erro ao tentar gerar o template. Por favor, tente novamente." };
  }
};
