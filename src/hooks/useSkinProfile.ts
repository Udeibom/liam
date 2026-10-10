import { useState, useEffect } from 'react';
import { supabase } from '@/lib/supabase';
import type { SkinProfile } from '@/types';

export function useSkinProfile(userId: string | null) {
  const [profile, setProfile] = useState<SkinProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) {
      // Use a microtask to avoid setState in effect body
      Promise.resolve().then(() => setLoading(false));
      return;
    }

    const fetch = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('skin_profiles')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (error && error.code !== 'PGRST116') {
        // PGRST116 = no rows, which is expected for new users
        setError(error.message);
      } else {
        setProfile(data as SkinProfile | null);
      }
      setLoading(false);
    };

    fetch();
  }, [userId]);

  const updateProfile = async (updates: Partial<SkinProfile>) => {
    if (!userId) return;

    const { data, error } = await supabase
      .from('skin_profiles')
      .upsert({ user_id: userId, ...updates })
      .select()
      .single();

    if (error) throw error;
    setProfile(data as SkinProfile);
    return data as SkinProfile;
  };

  return { profile, loading, error, updateProfile };
}
