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
    const { topic, tone } = await req.json()
    if (!topic || !tone) {
      throw new Error('Topic and tone are required.')
    }

    const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY')
    if (!GEMINI_API_KEY) {
      throw new Error('GEMINI_API_KEY is not set in Supabase secrets.')
    }
    
    const GEMINI_MODEL = Deno.env.get('GEMINI_MODEL') || 'gemini-flash-latest'

    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL })

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
    console.error('Error in generate-email function:', error)
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    })
  }
})