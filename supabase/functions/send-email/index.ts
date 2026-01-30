import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'

// This line imports the Resend library.
// Deno (the Supabase functions environment) can import modules directly from URLs.
import { Resend } from 'npm:resend';

// Main function that runs when the function is called
serve(async (req) => {
  // Block to handle 'OPTIONS' requests (necessary for calls from the browser)
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: { 
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST',
      'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    } })
  }

  try {
    // Gets the Resend API key from Supabase secrets
    const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY');
    if (!RESEND_API_KEY) {
      throw new Error("Chave da API do Resend não configurada nos segredos do Supabase.");
    }

    // Extracts email data from the request body
    const { to, from, subject, html } = await req.json();
    
    if (!to || !from || !subject || !html) {
      return new Response(JSON.stringify({ error: 'Campos em falta: to, from, subject, html' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Initializes the Resend client with the API key
    const resend = new Resend(RESEND_API_KEY);

    // Sends the email
    const { data, error } = await resend.emails.send({
      from: from,
      to: to,
      subject: subject,
      html: html,
    });

    if (error) {
      console.error({ error });
      return new Response(JSON.stringify({ error: error.message }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Returns a success response
    return new Response(JSON.stringify(data), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (err) {
    // Returns an error if something fails
    return new Response(String(err?.message ?? err), { 
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }
})