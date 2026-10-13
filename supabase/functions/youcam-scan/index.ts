/**
 * Supabase Edge Function: youcam-scan
 * Async pattern: POST { action: 'start', imageBase64 } -> { task_id }
 *                 POST { action: 'poll', task_id } -> { status, result?, error? }
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

const YOUCAM_API_KEY = Deno.env.get('YOUCAM_API_KEY') ?? '';
const YOUCAM_BASE_URL = 'https://yce-api-01.makeupar.com';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

async function uploadImageToYouCam(imageBase64: string): Promise<string> {
  const imageBytes = Uint8Array.from(atob(imageBase64), (c) => c.charCodeAt(0));
  const fileSize = imageBytes.length;
  const res = await fetch(`${YOUCAM_BASE_URL}/s2s/v2.0/file`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${YOUCAM_API_KEY}`,
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
      Authorization: `Bearer ${YOUCAM_API_KEY}`,
    },
    body: JSON.stringify({
      src_file_id: fileId,
      dst_actions: [
        'hd_acne',
        'hd_wrinkle',
        'hd_dark_circle',
        'hd_age_spot',
        'hd_pore',
        'hd_oiliness',
        'hd_dullness',
        'hd_redness',
        'hd_skin_type',
        'hd_texture',
        'hd_firmness',
        'hd_radiance',
        'hd_eye_bag',
        'hd_moisture',
        'hd_redness',
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

async function checkTaskResult(taskId: string): Promise<{ status: string; result?: unknown; error?: string }> {
  const res = await fetch(`${YOUCAM_BASE_URL}/s2s/v2.0/task/skin-analysis/${taskId}`, {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${YOUCAM_API_KEY}`,
    },
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`YouCam task poll error ${res.status}: ${err}`);
  }
  const data = await res.json();
  if (data.status === 200 && data.data?.status === 'success') {
    return { status: 'completed', result: data.data.result ?? data.data };
  }
  if (data.data?.status === 'failed') {
    return { status: 'failed', error: data.data.error ?? 'Unknown error' };
  }
  return { status: 'processing' };
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { action } = body;

    if (action === 'start') {
      const { imageBase64 } = body;
      if (!imageBase64) {
        return new Response(JSON.stringify({ error: 'imageBase64 required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const fileId = await uploadImageToYouCam(imageBase64);
      const taskId = await createSkinAnalysisTask(fileId);

      return new Response(JSON.stringify({ task_id: taskId }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (action === 'poll') {
      const { task_id } = body;
      if (!task_id) {
        return new Response(JSON.stringify({ error: 'task_id required' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const result = await checkTaskResult(task_id);
      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify({ error: 'Invalid action. Use "start" or "poll"' }), {
      status: 400,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});