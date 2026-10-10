/**
 * Supabase Edge Function: extract-ingredients
 * Extracts a skincare ingredients list from a product label image.
 * Primary: Gemini vision. Fallback: OCR.space.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';
const OCRSPACE_API_KEY = Deno.env.get('OCRSPACE_API_KEY') ?? '';

const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

async function extractWithGemini(imageBase64: string): Promise<string[]> {
  const prompt = `Look at this image of a skincare product label. 
Extract the complete ingredients list (INCI or common names).
Return ONLY a JSON array of ingredient name strings, nothing else.
Example: ["Water", "Niacinamide", "Zinc PCA", "Glycerin"]
If you cannot find an ingredients list in the image, return an empty array [].`;

  const body = {
    contents: [
      {
        parts: [
          { text: prompt },
          { inline_data: { mime_type: 'image/jpeg', data: imageBase64 } },
        ],
      },
    ],
    generationConfig: { temperature: 0.1, maxOutputTokens: 512 },
  };

  const res = await fetch(`${GEMINI_URL}?key=${GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`Gemini error ${res.status}`);
  const json = await res.json();
  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? '[]';

  // Strip markdown fences if Gemini wraps in ```json
  const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
  return JSON.parse(cleaned);
}

async function extractWithOcrSpace(imageBase64: string): Promise<string[]> {
  const formData = new FormData();
  formData.append('apikey', OCRSPACE_API_KEY);
  formData.append('base64Image', `data:image/jpeg;base64,${imageBase64}`);
  formData.append('language', 'eng');
  formData.append('isOverlayRequired', 'false');

  const res = await fetch('https://api.ocr.space/parse/image', {
    method: 'POST',
    body: formData,
  });

  if (!res.ok) throw new Error(`OCR.space error ${res.status}`);
  const json = await res.json();
  const text: string = json.ParsedResults?.[0]?.ParsedText ?? '';

  // Rough parse: split by commas and newlines, clean whitespace
  return text
    .split(/[,\n]+/)
    .map((s: string) => s.trim())
    .filter((s: string) => s.length > 1 && s.length < 60);
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

    let ingredients: string[] = [];
    let usedFallback = false;

    try {
      ingredients = await extractWithGemini(imageBase64);
    } catch {
      // Gemini failed (rate limit or error) — fall back to OCR.space
      usedFallback = true;
      ingredients = await extractWithOcrSpace(imageBase64);
    }

    return new Response(JSON.stringify({ ingredients, usedFallback }), {
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
