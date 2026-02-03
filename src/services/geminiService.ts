import { Client, AnalysisResult, AiAnalysis, AiTemplateAnalysis } from "../types";
import { ensureStoreClient } from "./supabase";

/**
 * Sets the Authorization token for Supabase Edge Functions IF a session exists.
 *
 * Why optional?
 * - If your Edge Functions are configured with verify_jwt = true, you need a valid session/JWT.
 * - If verify_jwt = false, you can call them without a session, so we shouldn't block the user.
 */
async function setFunctionsAuthIfSessionExists(storeClient: any) {
  try {
    const { data: { session } } = await storeClient.auth.getSession();
    if (session?.access_token) {
      storeClient.functions.setAuth(session.access_token);
    }
  } catch {
    // ignore: we'll attempt the call without JWT
  }
}

export const analyzeClientWithAI = async (
  client: Client,
  analysis: AnalysisResult
): Promise<AiAnalysis> => {
  const storeClient = ensureStoreClient();

  await setFunctionsAuthIfSessionExists(storeClient);

  const { data, error } = await storeClient.functions.invoke("analyze-client", {
    body: { client, analysis },
  });

  if (error) {
    console.error("Erro na Edge Function 'analyze-client':", error);

    // Try to surface function error body when available
    if (error.context && typeof (error.context as any).json === "function") {
      const functionError = await (error.context as any).json().catch(() => null);
      if (functionError?.error) throw new Error(functionError.error);
      if (functionError?.message) throw new Error(functionError.message);
    }

    throw new Error(
      "A função de análise de cliente falhou no servidor. Verifique os logs da Edge Function."
    );
  }

  if (!data) throw new Error("A função de análise de cliente retornou uma resposta vazia.");

  return data as AiAnalysis;
};

export const generateTemplateWithAI = async (
  topic: string,
  tone: string
): Promise<AiTemplateAnalysis> => {
  const storeClient = ensureStoreClient();

  await setFunctionsAuthIfSessionExists(storeClient);

  const { data, error } = await storeClient.functions.invoke("generate-email", {
    body: { topic, tone },
  });

  if (error) {
    console.error("Erro na Edge Function 'generate-email':", error);

    if (error.context && typeof (error.context as any).json === "function") {
      const functionError = await (error.context as any).json().catch(() => null);
      if (functionError?.error) throw new Error(functionError.error);
      if (functionError?.message) throw new Error(functionError.message);
    }

    throw new Error(
      "A função de geração de email falhou no servidor. Verifique os logs da Edge Function."
    );
  }

  if (!data) throw new Error("A função de geração de email retornou uma resposta vazia.");

  return data as AiTemplateAnalysis;
};
