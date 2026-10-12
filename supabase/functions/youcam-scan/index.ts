/**
 * Supabase Edge Function: youcam-scan
 * Proxies an image to the YouCam Skin Analysis API (S2S v2.0),
 * then interprets the result with Gemini.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const YOUCAM_API_KEY = Deno.env.get('YOUCAM_API_KEY') ?? '';
const GEMINI_API_KEY = Deno.env.get('GEMINI_API_KEY') ?? '';

const YOUCAM_BASE_URL = 'https://yce-api-01.makeupar.com';
const GEMINI_URL =
  'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';

async function uploadImageToYouCam(imageBase64: string): Promise<string> {
  const imageBytes = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));
  const fileSize = imageBytes.length;

  const res = await fetch(`${YOUCAM_BASE_URL}/s2s/v2.0/file`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${YOUCAM_API_KEY}`,
    },
    body: JSON.stringify({
      files: [
        {
          content_type: 'image/jpeg',
          file_name: `scan_${Date.now()}.jpg`,
          file_size: fileSize,
        },
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`YouCam file upload error ${res.status}: ${err}`);
  }
  const data = await res.json();

  if (!data.data?.files?.[0]?.requests?.[0]?.url || !data.data?.files?.[0]?.file_id) {
    throw new Error(`YouCam file upload unexpected response: ${JSON.stringify(data)}`);
  }

  const uploadUrl = data.data.files[0].requests[0].url;
  const fileId = data.data.files[0].file_id;
  const uploadHeaders = data.data.files[0].requests[0].headers ?? {};

  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(fileSize),
      ...uploadHeaders,
    },
    body: imageBytes,
  });

  if (!putRes.ok) {
    const err = await putRes.text();
    throw new Error(`YouCam image upload error ${putRes.status}: ${err}`);
  }

  return fileId;
}

async function createSkinAnalysisTask(fileId: string): Promise<string> {
  const res = await fetch(`${YOUCAM_BASE_URL}/s2s/v2.0/task/skin-analysis`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${YOUCAM_API_KEY}`,
    },
    body: JSON.stringify({
      src_file_id: fileId,
      dst_actions: [
        'hd_acne', 'hd_wrinkle', 'hd_dark_circle', 'hd_age_spot',
        'hd_pore', 'hd_oiliness', 'hd_dullness', 'hd_redness',
        'hd_skin_type', 'hd_texture', 'hd_firmness', 'hd_radiance',
        'hd_eye_bag', 'hd_moisture', 'hd_redness',
      ],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`YouCam task creation error ${res.status}: ${err}`);
  }
  const data = await res.json();

  if (!data.data?.task_id) {
    throw new Error(`YouCam task creation unexpected response: ${JSON.stringify(data)}`);
  }

  return data.data.task_id;
}

async function pollTaskResult(taskId: string): Promise<Record<string, unknown>> {
  const maxAttempts = 30;
  const delayMs = 2000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(`${YOUCAM_BASE_URL}/s2s/v2.0/task/skin-analysis/${taskId}`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${YOUCAM_API_KEY}`,
      },
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`YouCam task poll error ${res.status}: ${err}`);
    }

    const data = await res.json();

    if (data.status === 200 && data.data?.status === 'success') {
      return data.data.result ?? data.data;
    }

    if (data.data?.status === 'failed') {
      throw new Error(`YouCam task failed: ${data.data.error ?? 'Unknown error'}`);
    }

    await new Promise((r) => setTimeout(r, delayMs));
  }

  throw new Error('YouCam task timed out');
}

async function callYouCam(imageBase64: string): Promise<Record<string, unknown>> {
  const fileId = await uploadImageToYouCam(imageBase64);
  const taskId = await createSkinAnalysisTask(fileId);
  return pollTaskResult(taskId);
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