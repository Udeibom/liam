import { createClient } from '@supabase/supabase-js';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';
import type { User } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? 'placeholder-anon-key';

// ─── Web localStorage adapter ─────────────────────────────────────────────────
// On web, Supabase needs localStorage to persist sessions between page loads.
// SecureStore is native-only so we provide a proper web fallback.
const webStorageAdapter = {
  getItem: (key: string): string | null => {
    try { return localStorage.getItem(key); } catch { return null; }
  },
  setItem: (key: string, value: string): void => {
    try { localStorage.setItem(key, value); } catch { /* ignore */ }
  },
  removeItem: (key: string): void => {
    try { localStorage.removeItem(key); } catch { /* ignore */ }
  },
};

// ─── Native SecureStore adapter ───────────────────────────────────────────────
const nativeStorageAdapter = {
  getItem: (key: string) => SecureStore.getItemAsync(key),
  setItem: (key: string, value: string) => { SecureStore.setItemAsync(key, value); },
  removeItem: (key: string) => { SecureStore.deleteItemAsync(key); },
};

const storage = Platform.OS === 'web' ? webStorageAdapter : nativeStorageAdapter;

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    storage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: Platform.OS === 'web',
  },
});

// ─── Safe user getter ─────────────────────────────────────────────────────────
/**
 * Get the current user from the local session cache.
 * Uses getSession() which reads from storage without a network call —
 * avoids "Not authenticated" errors caused by getUser() making a
 * server-side JWT verification that fails with newer publishable keys.
 */
export async function getCurrentUser(): Promise<User | null> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.user ?? null;
}
