import { Client, AnalysisResult, AiAnalysis, AiTemplateAnalysis } from "../types";
import { ensureStoreClient } from "./supabaseClient";

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

const isJwtError = (message: string): boolean => {
  const normalized = (message || '').toLowerCase();
  return normalized.includes('invalid jwt') || normalized.includes('jwt') || normalized.includes('token');
};

async function invokeWithJwtRefreshRetry<T = any>(
  storeClient: any,
  functionName: string,
  body: Record<string, unknown>
): Promise<{ data: T | null; error: any }> {
  await setFunctionsAuthIfSessionExists(storeClient);
  let response = await storeClient.functions.invoke(functionName, { body });

  const rawMessage = String(response?.error?.message || '');
  if (!response?.error || !isJwtError(rawMessage)) {
    return response;
  }

  try {
    const { data: refreshed, error: refreshError } = await storeClient.auth.refreshSession();
    if (!refreshError && refreshed?.session?.access_token) {
      storeClient.functions.setAuth(refreshed.session.access_token);
      response = await storeClient.functions.invoke(functionName, { body });
    }
  } catch {
    // ignore and return original error below
  }

  return response;
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

export interface IrsPdfAiParseResult {
  subjectANif: string;
  subjectBNif: string;
  dependentNifs: string[];
}

const getParseIrsFunctionConfig = (): { url: string; key: string } => {
  const envUrl = (import.meta as any).env?.VITE_SUPABASE_URL_CMR || "";
  const envKey = (import.meta as any).env?.VITE_SUPABASE_KEY_CMR || "";
  if (envUrl && envKey) return { url: envUrl, key: envKey };

  try {
    const raw = localStorage.getItem("globalSettings");
    if (raw) {
      const parsed = JSON.parse(raw);
      const url = String(parsed?.supabaseStoreUrl || "");
      const key = String(parsed?.supabaseStoreKey || "");
      if (url && key) return { url, key };
    }
  } catch {
    // ignore
  }

  throw new Error("Configuração Supabase em falta para chamar parse-irs-pdf.");
};

const callParseIrsPdfNoAuth = async (body: Record<string, unknown>): Promise<any> => {
  const { url, key } = getParseIrsFunctionConfig();
  const endpoint = `${String(url).replace(/\/+$/, "")}/functions/v1/parse-irs-pdf`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
    body: JSON.stringify(body),
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(String(data?.error || data?.message || `HTTP ${response.status}`));
  }
  return data;
};

export const parseIrsPdfNifsWithAI = async (
  firstPageText: string
): Promise<IrsPdfAiParseResult> => {
  const data = await callParseIrsPdfNoAuth({ firstPageText });
  if (!data || typeof data !== "object") {
    throw new Error("A IA devolveu uma resposta vazia para o PDF.");
  }

  return {
    subjectANif: String((data as any).subjectANif || "").replace(/\D/g, ""),
    subjectBNif: String((data as any).subjectBNif || "").replace(/\D/g, ""),
    dependentNifs: Array.isArray((data as any).dependentNifs)
      ? (data as any).dependentNifs
          .map((value: unknown) => String(value || "").replace(/\D/g, ""))
          .filter((value: string) => value.length === 9)
      : [],
  };
};

export const parseIrsPdfNifsFromPdfWithAI = async (
  file: File
): Promise<IrsPdfAiParseResult> => {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  const pdfBase64 = btoa(binary);

  const data = await callParseIrsPdfNoAuth({
    pdfBase64,
    mimeType: file.type || "application/pdf",
    fileName: file.name || "",
  });

  if (!data || typeof data !== "object") {
    throw new Error("A IA devolveu resposta vazia ao processar o PDF.");
  }

  return {
    subjectANif: String((data as any).subjectANif || "").replace(/\D/g, ""),
    subjectBNif: String((data as any).subjectBNif || "").replace(/\D/g, ""),
    dependentNifs: Array.isArray((data as any).dependentNifs)
      ? (data as any).dependentNifs
          .map((value: unknown) => String(value || "").replace(/\D/g, ""))
          .filter((value: string) => value.length === 9)
      : [],
  };
};
