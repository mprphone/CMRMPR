import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { GoogleGenerativeAI } from 'npm:@google/generative-ai'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { client, analysis } = await req.json()
    if (!client || !analysis) {
      throw new Error('Client and analysis data are required.')
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not set in Supabase secrets.')
    }
    
    const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-flash-latest'

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL })

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
    `

    const result = await model.generateContent(prompt)
    const response = result.response
    const text = response.text()
    
    const jsonString = text.replace(/```json/g, '').replace(/```/g, '').trim();
    const parsedResponse = JSON.parse(jsonString);

    return new Response(JSON.stringify(parsedResponse), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    })
  } catch (error) {
    console.error('Error in analyze-client function:', error);
    let errorMessage = error.message;
    // Check for rate limit error from Gemini API
    if (error.message && (error.message.includes('429') || error.message.toLowerCase().includes('rate limit'))) {
        errorMessage = "Limite de pedidos à IA atingido. Por favor, aguarde um minuto antes de tentar novamente.";
    }
    return new Response(JSON.stringify({ error: errorMessage }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})