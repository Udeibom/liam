/**
 * AI layer for LIAN
 *
 * Text reasoning  → Groq (Llama 3.3 70B, 1 000 req/day free)
 *                   fallback: Llama 3.1 8B (14 400 req/day)
 * Image analysis  → Gemini 2.5 Flash (250 req/day free, vision capable)
 *
 * All API calls go through Supabase Edge Functions so keys never
 * leave the server. The functions live in supabase/functions/.
 */

import { supabase } from './supabase';
import type { SkinScan, Product, SkinProfile, Routine } from '@/types';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface SkinContext {
  profile: SkinProfile | null;
  recentScans: SkinScan[];
  activeProducts: Product[];
  routine: Routine | null;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function invokeFunction<T>(
  name: string,
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, { body });
  if (error) throw new Error(error.message);
  if (!data) throw new Error(`No data returned from ${name}`);
  return data;
}

// ─── Groq text chat ───────────────────────────────────────────────────────────

/**
 * Stream a chat completion through the Groq edge function.
 * Returns the full assistant reply string.
 */
export async function chatWithGroq(
  messages: ChatMessage[],
  skinContext: SkinContext,
): Promise<string> {
  const result = await invokeFunction<{ reply: string }>('groq-chat', {
    messages,
    skinContext,
  });
  return result.reply;
}

// ─── Gemini image analysis ────────────────────────────────────────────────────

/**
 * Send an image (base64 or public URL) to Gemini for skin interpretation.
 * Returns a structured AI interpretation string.
 */
export async function analyzeImageWithGemini(
  imageBase64: string,
  prompt: string,
): Promise<string> {
  const result = await invokeFunction<{ analysis: string }>('gemini-vision', {
    imageBase64,
    prompt,
  });
  return result.analysis;
}

// ─── YouCam proxy ─────────────────────────────────────────────────────────────

/**
 * Send an image to the YouCam Skin Analysis API via Edge Function proxy.
 * Returns the raw YouCam response plus the Gemini-interpreted summary.
 */
export async function runSkinScan(imageBase64: string): Promise<{
  youcamRaw: Record<string, unknown>;
  interpretation: string;
}> {
  return invokeFunction('youcam-scan', { imageBase64 });
}

// ─── OCR ─────────────────────────────────────────────────────────────────────

/**
 * Extract text from a product ingredients label image.
 * First tries Gemini (free vision); falls back to OCR.space.
 */
export async function extractIngredients(imageBase64: string): Promise<string[]> {
  const result = await invokeFunction<{ ingredients: string[] }>(
    'extract-ingredients',
    { imageBase64 },
  );
  return result.ingredients;
}

// ─── Context builder ─────────────────────────────────────────────────────────

/**
 * Build a compact skin context string for injection into AI prompts.
 * Keeps token usage low by summarising rather than dumping raw JSON.
 */
export function buildSkinContextPrompt(ctx: SkinContext): string {
  const { profile, recentScans, activeProducts, routine } = ctx;

  const lines: string[] = [
    '=== USER SKIN PROFILE ===',
    `Skin type: ${profile?.skin_type ?? 'unknown'}`,
    `Goals: ${profile?.goals.join(', ') || 'none set'}`,
    `Sensitivities: ${profile?.sensitivities.join(', ') || 'none reported'}`,
    `Budget: ${profile?.budget_range ?? 'not specified'}`,
  ];

  if (recentScans.length > 0) {
    const latest = recentScans[0];
    lines.push('\n=== LATEST SKIN SCAN ===');
    lines.push(`Date: ${new Date(latest.scanned_at).toLocaleDateString()}`);
    for (const c of latest.concerns) {
      lines.push(`${c.concern}: ${c.severity} (score ${c.score})${c.trend ? ` — ${c.trend}` : ''}`);
    }
    lines.push(`AI summary: ${latest.ai_interpretation}`);
  }

  if (recentScans.length > 1) {
    lines.push(`\nPrevious scans: ${recentScans.length - 1} earlier records available.`);
  }

  if (activeProducts.length > 0) {
    lines.push('\n=== CURRENT ROUTINE PRODUCTS ===');
    for (const p of activeProducts) {
      lines.push(`• ${p.name}${p.brand ? ` by ${p.brand}` : ''} (${p.category})`);
    }
  }

  if (routine) {
    lines.push('\n=== ROUTINE STEPS ===');
    for (const step of routine.steps) {
      lines.push(`${step.time_of_day} — ${step.slot}: ${step.instruction}`);
    }
  }

  return lines.join('\n');
}
