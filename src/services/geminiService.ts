
import { GoogleGenerativeAI } from "@google/generative-ai";
import { Client, AnalysisResult, AiAnalysis, AiTemplateAnalysis } from "../types";

// Singleton instance to avoid re-initializing on every call
let genAI: GoogleGenerativeAI | null = null;

const initGenAI = () => {
  // Return existing instance if already initialized
  if (genAI) return genAI;

  if (!process.env.GEMINI_API_KEY) {
    console.warn("Gemini API Key missing. Make sure GEMINI_API_KEY is set in your environment.");
    return null;
  }
  // The constructor for GoogleGenerativeAI takes the API key as a string.
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  return genAI;
};

export const analyzeClientWithAI = async (client: Client, analysis: AnalysisResult): Promise<AiAnalysis> => {
  const ai = initGenAI();
  if (!ai) return { parecer: "Erro: Chave API não configurada. Configure a API Key no ambiente.", avenca_sugerida: 0 };

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
    Custo Estimado (Interno): ${analysis.totalAnnualCost.toFixed(2)}€
    Receita Anual: ${analysis.totalAnnualRevenue.toFixed(2)}€
    Margem de Lucro: ${analysis.profitability.toFixed(1)}%
    Preço/Hora Efetivo: ${analysis.hourlyReturn.toFixed(2)}€

    Responda APENAS em formato JSON com a seguinte estrutura:
    {
      "parecer": "Um parecer estratégico curto (máximo 3 parágrafos) sobre a rentabilidade. Se a margem for negativa ou baixa (<20%), sugira argumentos para renegociação ou estratégias de eficiência. Se for alta, sugira como fidelizar. Seja direto, profissional e focado em ação.",
      "avenca_sugerida": <um número inteiro representando a avença mensal sugerida em euros, baseado nos dados e na sua experiência de mercado>
    }
  `;

  try {
    // Get the generative model. 'gemini-1.5-flash' is a great choice for this kind of task.
    // Use environment variable or fallback to 1.5-flash
    const modelName = process.env.GEMINI_MODEL || "gemini-flash-latest";
    const model = ai.getGenerativeModel({ model: modelName });

    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();

    // Clean up the text to make sure it's valid JSON
    const jsonString = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsedResponse: AiAnalysis = JSON.parse(jsonString);

    return parsedResponse || { parecer: "Não foi possível gerar uma análise.", avenca_sugerida: 0 };
  } catch (error) {
    console.error("Gemini API Error:", error);
    return { parecer: "Erro ao contactar a IA. Verifique a consola para mais detalhes.", avenca_sugerida: 0 };
  }
};

export const generateTemplateWithAI = async (topic: string, tone: string): Promise<AiTemplateAnalysis> => {
  const ai = initGenAI();
  if (!ai) return { subject: "Erro", body: "Erro: Chave API não configurada." };

  const prompt = `
    Atue como um especialista em comunicação para um gabinete de contabilidade em Portugal.
    Crie um template de email (assunto e corpo) sobre o seguinte tópico: "${topic}".
    O tom do email deve ser: ${tone}.

    O email deve ser dirigido a um cliente. Utilize as variáveis {{name}} e {{responsible_name}} onde for apropriado.
    As variáveis de cliente disponíveis são: {{name}}, {{nif}}, {{email}}, {{phone}}, {{address}}, {{sector}}, {{entityType}}, {{turnover}}, {{avenca_atual}}, {{nova_avenca}}.
    Termine o email de forma cordial, em nome da equipa do gabinete.

    Responda APENAS em formato JSON com a seguinte estrutura:
    {
      "subject": "<Assunto do email, usando variáveis se necessário>",
      "body": "<Corpo do email, em texto simples, usando \\n para novas linhas.>"
    }
  `;

  try {
    const modelName = process.env.GEMINI_MODEL || "gemini-flash-latest";
    const model = ai.getGenerativeModel({ model: modelName });
    const result = await model.generateContent(prompt);
    const response = result.response;
    const text = response.text();
    const jsonString = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsedResponse: AiTemplateAnalysis = JSON.parse(jsonString);
    return parsedResponse || { subject: "Erro", body: "Não foi possível gerar o template." };
  } catch (error) {
    console.error("Gemini Template Generation Error:", error);
    return { subject: "Erro", body: "Ocorreu um erro ao tentar gerar o template. Por favor, tente novamente." };
  }
};
