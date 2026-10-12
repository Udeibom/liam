import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { router } from 'expo-router';
import { showAlert, showConfirm } from '@/lib/toast';
import { supabase, getCurrentUser } from '@/lib/supabase';
import { Card, Button } from '@/components/ui';
import { Colors, FontSize, FontWeight, Spacing } from '@/constants';
import type { SkinProfile, SkinScan, TimelineEvent } from '@/types';

export default function ProfileScreen() {
  const [profile, setProfile] = useState<SkinProfile | null>(null);
  const [scans, setScans] = useState<SkinScan[]>([]);
  const [timeline, setTimeline] = useState<TimelineEvent[]>([]);
  const [email, setEmail] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser();
      if (!user) return;

      setEmail(user.email ?? '');

      const [profileRes, scansRes, timelineRes] = await Promise.all([
        supabase.from('skin_profiles').select('*').eq('user_id', user.id).single(),
        supabase
          .from('skin_scans')
          .select('id, scanned_at, skin_type_detected, concerns')
          .eq('user_id', user.id)
          .order('scanned_at', { ascending: false })
          .limit(6),
        supabase
          .from('timeline_events')
          .select('*')
          .eq('user_id', user.id)
          .order('occurred_at', { ascending: false })
          .limit(10),
      ]);

      setProfile(profileRes.data as SkinProfile | null);
      setScans((scansRes.data ?? []) as SkinScan[]);
      setTimeline((timelineRes.data ?? []) as TimelineEvent[]);
      setLoading(false);
    };

    load();
  }, []);

  const handleSignOut = () => {
    showConfirm(
      'Sign out',
      'Are you sure you want to sign out?',
      async () => {
        await supabase.auth.signOut();
        router.replace('/(auth)/welcome');
      },
    );
  };

  const EVENT_EMOJI: Record<string, string> = {
    scan: '🔬',
    product_added: '🧴',
    product_stopped: '🚫',
    routine_changed: '📋',
    user_note: '📝',
    reaction_reported: '⚠️',
  };

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator color={Colors.primary} size="large" />
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Your Profile</Text>

        {/* Account */}
        <Card>
          <Text style={styles.cardTitle}>Account</Text>
          <Text style={styles.emailText}>{email}</Text>
        </Card>

        {/* Skin profile */}
        {profile && (
          <Card style={styles.section}>
            <Text style={styles.cardTitle}>Skin profile</Text>
            <View style={styles.profileRow}>
              <Text style={styles.profileLabel}>Skin type</Text>
              <Text style={styles.profileValue} accessibilityLabel={`Skin type: ${profile.skin_type}`}>
                {profile.skin_type.charAt(0).toUpperCase() + profile.skin_type.slice(1)}
              </Text>
            </View>
            {profile.goals.length > 0 && (
              <View style={styles.profileRow}>
                <Text style={styles.profileLabel}>Goals</Text>
                <Text style={styles.profileValue}>
                  {profile.goals.map((g) => g.replace(/_/g, ' ')).join(', ')}
                </Text>
              </View>
            )}
            {profile.sensitivities.length > 0 && (
              <View style={styles.profileRow}>
                <Text style={styles.profileLabel}>Sensitivities</Text>
                <Text style={styles.profileValue}>{profile.sensitivities.join(', ')}</Text>
              </View>
            )}
            {profile.budget_range && (
              <View style={styles.profileRow}>
                <Text style={styles.profileLabel}>Budget</Text>
                <Text style={styles.profileValue} accessibilityLabel={`Budget: ${profile.budget_range}`}>
                  {profile.budget_range.charAt(0).toUpperCase() + profile.budget_range.slice(1)}
                </Text>
              </View>
            )}
          </Card>
        )}

        {/* Scan history mini-timeline */}
        {scans.length > 0 && (
          <Card style={styles.section}>
            <Text style={styles.cardTitle}>Scan history ({scans.length})</Text>
            {scans.map((s) => (
              <View key={s.id} style={styles.scanRow}>
                <Text style={styles.scanEmoji}>🔬</Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.scanDate}>
                    {new Date(s.scanned_at).toLocaleDateString('en-GB', {
                      day: 'numeric', month: 'short', year: 'numeric',
                    })}
                  </Text>
                  <Text style={styles.scanType}>
                    {s.skin_type_detected !== 'unknown'
                      ? `${s.skin_type_detected} skin`
                      : `${(s.concerns as any[]).length} concerns tracked`}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        )}

        {/* Timeline */}
        {timeline.length > 0 && (
          <Card style={styles.section}>
            <Text style={styles.cardTitle}>Skin timeline</Text>
            {timeline.map((event) => (
              <View key={event.id} style={styles.timelineRow}>
                <Text style={styles.timelineEmoji}>
                  {EVENT_EMOJI[event.event_type] ?? '📌'}
                </Text>
                <View style={{ flex: 1 }}>
                  <Text style={styles.timelineTitle}>{event.title}</Text>
                  {event.description && (
                    <Text style={styles.timelineDesc}>{event.description}</Text>
                  )}
                  <Text style={styles.timelineDate}>
                    {new Date(event.occurred_at).toLocaleDateString('en-GB', {
                      day: 'numeric', month: 'short',
                    })}
                  </Text>
                </View>
              </View>
            ))}
          </Card>
        )}

        {/* Feature shortcuts */}
        <Card style={styles.section}>
          <Text style={styles.cardTitle}>Tools</Text>
          {[
            { label: '📋  Routine Builder', route: '/routine' },
            { label: '📈  Skin Timeline', route: '/timeline' },
            { label: '🕵️  Skin Detective', route: '/detective' },
          ].map(({ label, route }) => (
            <TouchableOpacity
              key={route}
              style={styles.toolRow}
              onPress={() => router.push(route as never)}
              accessibilityRole="button"
              accessibilityLabel={label}
            >
              <Text style={styles.toolLabel}>{label}</Text>
              <Text style={styles.toolArrow}>→</Text>
            </TouchableOpacity>
          ))}
        </Card>

        <Button
          label="Sign out"
          variant="danger"
          fullWidth
          onPress={handleSignOut}
        />

        <Text style={styles.disclaimer}>
          LIAN is not a medical device. Outputs are for personal reference only and do not constitute medical, dermatological, or professional advice.
        </Text>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  loader: { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xl },
  title: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  cardTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semiBold,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  emailText: { fontSize: FontSize.base, color: Colors.textSecondary },
  section: { gap: Spacing.xs },
  profileRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
  },
  profileLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  profileValue: {
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    fontWeight: FontWeight.medium,
    flex: 1,
    textAlign: 'right',
    textTransform: 'capitalize',
  },
  scanRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.sm,
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
  },
  scanEmoji: { fontSize: 18 },
  scanDate: { fontSize: FontSize.sm, color: Colors.textPrimary, fontWeight: FontWeight.medium },
  scanType: { fontSize: FontSize.xs, color: Colors.textTertiary, textTransform: 'capitalize' },
  timelineRow: {
    flexDirection: 'row',
    gap: Spacing.sm,
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
  },
  timelineEmoji: { fontSize: 18, marginTop: 2 },
  timelineTitle: { fontSize: FontSize.sm, color: Colors.textPrimary, fontWeight: FontWeight.medium },
  timelineDesc: { fontSize: FontSize.xs, color: Colors.textSecondary, marginTop: 2 },
  timelineDate: { fontSize: FontSize.xs, color: Colors.textTertiary, marginTop: 2 },
  disclaimer: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    textAlign: 'center',
    lineHeight: 18,
  },
  toolRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: Spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
  },
  toolLabel: { fontSize: FontSize.base, color: Colors.textPrimary, fontWeight: FontWeight.medium },
  toolArrow: { fontSize: FontSize.base, color: Colors.textTertiary },
});
