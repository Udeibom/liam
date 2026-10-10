// ─── User & Profile ──────────────────────────────────────────────────────────

export type SkinType = 'oily' | 'dry' | 'combination' | 'normal' | 'sensitive' | 'unknown';

export type SkinGoal =
  | 'clear_acne'
  | 'reduce_dark_spots'
  | 'anti_aging'
  | 'hydration'
  | 'even_tone'
  | 'reduce_redness'
  | 'minimize_pores'
  | 'brightening';

export interface SkinProfile {
  id: string;
  user_id: string;
  skin_type: SkinType;
  goals: SkinGoal[];
  sensitivities: string[];      // e.g. ['fragrance', 'alcohol', 'retinol']
  budget_range: 'low' | 'mid' | 'high' | null;
  onboarding_complete: boolean;
  created_at: string;
  updated_at: string;
}

// ─── Skin Scans ──────────────────────────────────────────────────────────────

export interface SkinConcernScore {
  concern: string;              // e.g. 'acne', 'wrinkles', 'dark_spots'
  score: number;                // 0–100 from YouCam
  severity: 'none' | 'mild' | 'moderate' | 'severe';
  trend?: 'improving' | 'stable' | 'worsening';
}

export interface SkinScan {
  id: string;
  user_id: string;
  image_url: string;
  youcam_raw: Record<string, unknown>;   // raw YouCam API response
  concerns: SkinConcernScore[];
  ai_interpretation: string;             // Gemini's plain-language reading
  skin_type_detected: SkinType;
  scanned_at: string;
}

// ─── Products ────────────────────────────────────────────────────────────────

export type ProductCategory =
  | 'cleanser'
  | 'moisturizer'
  | 'sunscreen'
  | 'serum'
  | 'toner'
  | 'exfoliant'
  | 'treatment'
  | 'mask'
  | 'eye_cream'
  | 'oil'
  | 'other';

export type ProductStatus = 'active' | 'paused' | 'stopped' | 'wishlist';

export type ProductVerdict = 'good' | 'caution' | 'avoid' | 'unknown';

export interface Product {
  id: string;
  user_id: string;
  name: string;
  brand: string | null;
  category: ProductCategory;
  ingredients: string[];
  image_url: string | null;
  status: ProductStatus;
  started_at: string | null;
  stopped_at: string | null;
  stop_reason: string | null;
  reported_reactions: string[];
  reported_improvements: string[];
  verdict: ProductVerdict;
  verdict_reason: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// ─── Routine ─────────────────────────────────────────────────────────────────

export type RoutineSlot =
  | 'cleanser'
  | 'toner'
  | 'serum'
  | 'treatment'
  | 'moisturizer'
  | 'sunscreen'
  | 'oil'
  | 'other';

export interface RoutineStep {
  slot: RoutineSlot;
  product_id: string | null;   // null = step recommended but no product assigned
  product?: Product;
  instruction: string;
  frequency: 'daily' | 'every_other_day' | 'twice_weekly' | 'weekly';
  time_of_day: 'morning' | 'evening' | 'both';
}

export interface Routine {
  id: string;
  user_id: string;
  steps: RoutineStep[];
  ai_rationale: string;
  created_at: string;
  updated_at: string;
}

// ─── Conversations ────────────────────────────────────────────────────────────

export type ConversationType =
  | 'general'
  | 'skin_detective'
  | 'product_analysis'
  | 'routine_builder';

export interface ChatMessage {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  created_at: string;
}

export interface Conversation {
  id: string;
  user_id: string;
  type: ConversationType;
  title: string | null;
  messages: ChatMessage[];
  created_at: string;
  updated_at: string;
}

// ─── Timeline Events ──────────────────────────────────────────────────────────

export type TimelineEventType =
  | 'scan'
  | 'product_added'
  | 'product_stopped'
  | 'routine_changed'
  | 'user_note'
  | 'reaction_reported';

export interface TimelineEvent {
  id: string;
  user_id: string;
  event_type: TimelineEventType;
  title: string;
  description: string | null;
  related_product_id: string | null;
  related_scan_id: string | null;
  occurred_at: string;
  created_at: string;
}

// ─── API Responses ───────────────────────────────────────────────────────────

export interface ApiResult<T> {
  data: T | null;
  error: string | null;
}
