/**
 * Supabase Edge Function: groq-chat
 * Proxies chat requests to Groq API keeping the key server-side.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const GROQ_API_KEY = Deno.env.get('GROQ_API_KEY') ?? '';
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

// Models in priority order — if 70B hits daily limit Groq returns 429,
// we immediately retry with 8B.
const PRIMARY_MODEL = 'llama-3.3-70b-versatile';
const FALLBACK_MODEL = 'llama-3.1-8b-instant';

const SYSTEM_PROMPT = `You are LIAN, a personal AI skin companion. You help users understand their skin, investigate changes, evaluate products, build routines, and track progress over time.

You are warm, knowledgeable, and honest. You always:
- Reason from the user's personal skin history, not generic advice
- Distinguish between what the data shows and what you're inferring
- Tell users when something is outside your scope and recommend a dermatologist
- Avoid recommending unnecessary products — sometimes the answer is "don't buy anything yet"
- Communicate clearly without medical jargon

You are NOT a medical diagnostic tool. Remind users of this when they ask about potential medical conditions.`;

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      },
    });
  }

  try {
    const { messages, skinContext } = await req.json();

    // Inject skin context as a system message before the conversation
    const contextMessage = skinContext
      ? {
          role: 'system',
          content: `Current user context:\n${JSON.stringify(skinContext, null, 2)}`,
        }
      : null;

    const allMessages = [
      { role: 'system', content: SYSTEM_PROMPT },
      ...(contextMessage ? [contextMessage] : []),
      ...messages,
    ];

    const callGroq = async (model: string) =>
      fetch(GROQ_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${GROQ_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model,
          messages: allMessages,
          max_tokens: 1024,
          temperature: 0.7,
        }),
      });

    let res = await callGroq(PRIMARY_MODEL);

    // Fallback to smaller model if rate limited
    if (res.status === 429) {
      res = await callGroq(FALLBACK_MODEL);
    }

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Groq error ${res.status}: ${err}`);
    }

    const json = await res.json();
    const reply = json.choices?.[0]?.message?.content ?? '';

    return new Response(JSON.stringify({ reply }), {
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
});
