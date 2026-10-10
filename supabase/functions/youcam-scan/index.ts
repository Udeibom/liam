/**
 * Supabase Edge Function: youcam-scan
 * Proxies an image to the YouCam Skin Analysis API,
 * then interprets the result with Gemini.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const YOUCAM_API_KEY = Deno.env.get('YOUCAM_API_KEY') ?? '';
const YOUCAM_API_SECRET = Deno.env.get('YOUCAM_API_SECRET') ?? '';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';

// YouCam Skin Analysis API endpoint
const YOUCAM_URL = 'https://ai.perfectcorp.com/api/yce/v1.0/skin_analyze';
const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

async function callYouCam(imageBase64: string): Promise<Record<string, unknown>> {
  const res = await fetch(YOUCAM_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': YOUCAM_API_KEY,
      'x-api-secret': YOUCAM_API_SECRET,
    },
    body: JSON.stringify({
      image: imageBase64,
      // Request all supported concerns
      features: [
        'acne', 'wrinkles', 'dark_circles', 'dark_spots',
        'pores', 'oiliness', 'dullness', 'redness',
        'skin_tone', 'texture', 'firmness', 'radiance',
        'eye_bags', 'moisture', 'sensitivity',
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`YouCam error ${res.status}: ${err}`);
  }
  return res.json();
}

async function interpretWithGemini(
  youcamData: Record<string, unknown>,
): Promise<string> {
  const prompt = `You are a skin analysis expert for the LIAN app. Below are raw skin analysis scores from the YouCam AI API. 
  
Convert these into clear, empathetic, plain-language findings for the user. Format as:
1. A one-paragraph overview of their skin right now
2. A list of their top 3 concerns with a brief explanation of each
3. One key recommendation or takeaway

Do NOT just repeat the scores. Interpret what they mean for a real person.
Do NOT claim to diagnose any medical condition.

YouCam data:
${JSON.stringify(youcamData, null, 2)}`;

  const body = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.4, maxOutputTokens: 800 },
  };

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Gemini error ${res.status}`);
  const json = await res.json();
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

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
    const { imageBase64 } = await req.json();

    const youcamRaw = await callYouCam(imageBase64);
    const interpretation = await interpretWithGemini(youcamRaw);

    return new Response(JSON.stringify({ youcamRaw, interpretation }), {
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
