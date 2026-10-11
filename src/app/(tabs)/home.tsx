import { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase, getCurrentUser } from '@/lib/supabase';
import { Card } from '@/components/ui';
import { Colors, FontSize, FontWeight, Spacing, Radius } from '@/constants';
import type { SkinProfile, SkinScan, Product, TimelineEvent } from '@/types';

interface HomeData {
  profile: SkinProfile | null;
  latestScan: SkinScan | null;
  activeProducts: Product[];
  recentEvent: TimelineEvent | null;
  userName: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  none: Colors.concernNone,
  mild: Colors.concernLow,
  moderate: Colors.concernMedium,
  severe: Colors.concernHigh,
};

const TREND_EMOJI: Record<string, string> = {
  improving: '↓',
  stable: '→',
  worsening: '↑',
};

const TREND_COLOR: Record<string, string> = {
  improving: Colors.success,
  stable: Colors.textSecondary,
  worsening: Colors.error,
};

/** Returns "today", "yesterday", "3 days ago", "2 weeks ago", etc. */
function daysAgoLabel(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  if (days < 14) return '1 week ago';
  if (days < 30) return `${Math.floor(days / 7)} weeks ago`;
  return `${Math.floor(days / 30)} months ago`;
}

/** Recommend when to take the next scan based on last scan age */
function nextCheckInLabel(isoDate: string): string {
  const diffMs = Date.now() - new Date(isoDate).getTime();
  const days = Math.floor(diffMs / (1000 * 60 * 60 * 24));
  if (days < 14) return `In ${14 - days} days`;
  if (days < 28) return `In ${28 - days} days`;
  return 'Now — you\'re overdue for a check-in';
}

export default function HomeScreen() {
  const [data, setData] = useState<HomeData>({
    profile: null,
    latestScan: null,
    activeProducts: [],
    recentEvent: null,
    userName: '',
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser();
      if (!user) return;

      const [profileRes, scanRes, productsRes, eventRes] = await Promise.all([
        supabase.from('skin_profiles').select('*').eq('user_id', user.id).single(),
        supabase
          .from('skin_scans')
          .select('*')
          .eq('user_id', user.id)
          .order('scanned_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase
          .from('products')
          .select('*')
          .eq('user_id', user.id)
          .eq('status', 'active')
          .order('created_at', { ascending: false })
          .limit(5),
        supabase
          .from('timeline_events')
          .select('*')
          .eq('user_id', user.id)
          .order('occurred_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      setData({
        profile: profileRes.data as SkinProfile | null,
        latestScan: scanRes.data as SkinScan | null,
        activeProducts: (productsRes.data ?? []) as Product[],
        recentEvent: eventRes.data as TimelineEvent | null,
        userName: user.email?.split('@')[0] ?? 'there',
      });
      setLoading(false);
    };

    load();
  }, []);

  if (loading) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  const topConcerns = (data.latestScan?.concerns ?? [])
    .sort((a, b) => (b.score as number) - (a.score as number))
    .slice(0, 3);

  const lastScanAge = data.latestScan
    ? daysAgoLabel(data.latestScan.scanned_at)
    : null;

  const nextCheckIn = data.latestScan
    ? nextCheckInLabel(data.latestScan.scanned_at)
    : null;

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

        {/* Header */}
        <View style={styles.header}>
          <View>
            <Text style={styles.greeting}>Hello, {data.userName} 👋</Text>
            <Text style={styles.subGreeting}>What&apos;s going on with your skin?</Text>
          </View>
          <View style={styles.logoMark}>
            <Text style={styles.logoLetter}>L</Text>
          </View>
        </View>

        {/* Quick actions */}
        <View style={styles.actions}>
          {[
            { label: 'Scan my skin', emoji: '🔬', route: '/(tabs)/scan' },
            { label: 'Ask a question', emoji: '💬', route: '/(tabs)/chat' },
            { label: 'Check a product', emoji: '🧴', route: '/(tabs)/products' },
            { label: 'Build routine', emoji: '📋', route: '/routine' },
            { label: 'My timeline', emoji: '📈', route: '/timeline' },
            { label: 'Investigate issue', emoji: '🕵️', route: '/detective' },
          ].map(({ label, emoji, route }) => (
            <TouchableOpacity
              key={label}
              style={styles.actionChip}
              onPress={() => router.push(route as never)}
              accessibilityRole="button"
              accessibilityLabel={label}
            >
              <Text style={styles.actionEmoji}>{emoji}</Text>
              <Text style={styles.actionLabel}>{label}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {/* ── Skin status card ── */}
        {data.latestScan ? (
          <Card style={styles.section}>
            {/* Header row with scan age */}
            <View style={styles.sectionHeader}>
              <Text style={styles.sectionTitle}>Current skin status</Text>
              <Text style={styles.scanAge}>🔬 {lastScanAge}</Text>
            </View>

            {/* Top concerns with trend */}
            {topConcerns.map((c) => (
              <View key={c.concern} style={styles.concernRow}>
                <View style={styles.concernLeft}>
                  <View
                    style={[
                      styles.concernDot,
                      { backgroundColor: SEVERITY_COLOR[c.severity] ?? Colors.textTertiary },
                    ]}
                  />
                  <Text style={styles.concernName}>
                    {c.concern.replace(/_/g, ' ')}
                  </Text>
                </View>
                <Text
                  style={[
                    styles.concernSeverity,
                    c.trend ? { color: TREND_COLOR[c.trend] } : null,
                  ]}
                >
                  {c.severity}
                  {c.trend ? ` ${TREND_EMOJI[c.trend]}` : ''}
                </Text>
              </View>
            ))}

            {/* Next check-in */}
            <View style={styles.checkInRow}>
              <Text style={styles.checkInLabel}>Next check-in</Text>
              <Text
                style={[
                  styles.checkInValue,
                  nextCheckIn?.startsWith('Now') ? { color: Colors.warning } : null,
                ]}
              >
                {nextCheckIn}
              </Text>
            </View>

            <TouchableOpacity
              onPress={() => router.push('/(tabs)/scan')}
              accessibilityRole="button"
              accessibilityLabel="Take a new scan"
            >
              <Text style={styles.seeMore}>Take a new scan →</Text>
            </TouchableOpacity>
          </Card>
        ) : (
          <Card style={styles.section}>
            <Text style={styles.sectionTitle}>Start with a skin scan</Text>
            <Text style={styles.emptyText}>
              Take your first scan and LIAN will begin building a picture of your skin.
            </Text>
            <TouchableOpacity
              style={styles.scanCta}
              onPress={() => router.push('/(tabs)/scan')}
              accessibilityRole="button"
              accessibilityLabel="Take your first skin scan"
            >
              <Text style={styles.scanCtaText}>🔬  Scan my skin now</Text>
            </TouchableOpacity>
          </Card>
        )}

        {/* ── Current routine card ── */}
        <Card style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Current routine</Text>
            <TouchableOpacity
              onPress={() => router.push('/(tabs)/products')}
              accessibilityRole="button"
              accessibilityLabel="See all products"
            >
              <Text style={styles.seeMore}>See all</Text>
            </TouchableOpacity>
          </View>

          {/* Active product count summary */}
          {data.activeProducts.length > 0 && (
            <Text style={styles.routineSummary}>
              {data.activeProducts.length} active product{data.activeProducts.length !== 1 ? 's' : ''}
            </Text>
          )}

          {data.activeProducts.length === 0 ? (
            <Text style={styles.emptyText}>
              No products added yet. Add a product to let LIAN track your routine.
            </Text>
          ) : (
            data.activeProducts.map((p) => (
              <TouchableOpacity
                key={p.id}
                style={styles.productRow}
                onPress={() => router.push(`/product/${p.id}` as never)}
                accessibilityRole="button"
                accessibilityLabel={`View ${p.name}`}
              >
                <View style={styles.productIcon}>
                  <Text style={{ fontSize: 18 }}>🧴</Text>
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.productName}>{p.name}</Text>
                  <Text style={styles.productCat}>{p.category}</Text>
                </View>
                <Text style={styles.productArrow}>›</Text>
              </TouchableOpacity>
            ))
          )}
        </Card>

        {/* ── Recent change card ── */}
        {data.recentEvent && (
          <TouchableOpacity
            style={styles.recentChangeBanner}
            onPress={() => router.push('/timeline')}
            accessibilityRole="button"
            accessibilityLabel="View skin timeline"
          >
            <Text style={styles.recentChangeEmoji}>📅</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.recentChangeTitle}>Recent change</Text>
              <Text style={styles.recentChangeDesc} numberOfLines={1}>
                {data.recentEvent.title}
              </Text>
              <Text style={styles.recentChangeAge}>
                {daysAgoLabel(data.recentEvent.occurred_at)}
              </Text>
            </View>
            <Text style={styles.recentChangeArrow}>→</Text>
          </TouchableOpacity>
        )}

        {/* ── Skin Detective shortcut ── */}
        <TouchableOpacity
          style={styles.detectiveBanner}
          onPress={() => router.push('/detective')}
          accessibilityRole="button"
          accessibilityLabel="Start a skin detective investigation"
        >
          <Text style={styles.detectiveEmoji}>🕵️</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.detectiveTitle}>Something irritating your skin?</Text>
            <Text style={styles.detectiveSubtitle}>Let LIAN help you investigate.</Text>
          </View>
          <Text style={styles.detectiveArrow}>→</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  loader: { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing.xl },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  greeting: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  subGreeting: { fontSize: FontSize.base, color: Colors.textSecondary, marginTop: 2 },
  logoMark: {
    width: 40, height: 40, borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  logoLetter: { fontSize: 22, fontWeight: FontWeight.bold, color: Colors.textInverse },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  actionChip: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    backgroundColor: Colors.bgCard, borderRadius: Radius.full,
    borderWidth: 1, borderColor: Colors.border,
  },
  actionEmoji: { fontSize: 16 },
  actionLabel: { fontSize: FontSize.sm, color: Colors.textPrimary, fontWeight: FontWeight.medium },
  section: { gap: Spacing.sm },
  sectionHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
  },
  sectionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semiBold, color: Colors.textPrimary },
  scanAge: { fontSize: FontSize.xs, color: Colors.textTertiary },
  concernRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1, borderBottomColor: Colors.borderSubtle,
  },
  concernLeft: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  concernDot: { width: 8, height: 8, borderRadius: 4 },
  concernName: { fontSize: FontSize.base, color: Colors.textPrimary, textTransform: 'capitalize' },
  concernSeverity: { fontSize: FontSize.sm, color: Colors.textSecondary, textTransform: 'capitalize' },
  checkInRow: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: Spacing.xs,
  },
  checkInLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  checkInValue: { fontSize: FontSize.sm, fontWeight: FontWeight.semiBold, color: Colors.primary },
  seeMore: { fontSize: FontSize.sm, color: Colors.primary, fontWeight: FontWeight.medium },
  emptyText: { fontSize: FontSize.base, color: Colors.textSecondary, lineHeight: 22 },
  scanCta: {
    backgroundColor: Colors.primaryDark, borderRadius: Radius.md,
    padding: Spacing.md, alignItems: 'center', marginTop: Spacing.xs,
  },
  scanCtaText: { fontSize: FontSize.base, color: Colors.primary, fontWeight: FontWeight.semiBold },
  routineSummary: { fontSize: FontSize.xs, color: Colors.textTertiary },
  productRow: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.sm, paddingVertical: Spacing.xs,
  },
  productIcon: {
    width: 36, height: 36, borderRadius: Radius.sm,
    backgroundColor: Colors.bgElevated, alignItems: 'center', justifyContent: 'center',
  },
  productName: { fontSize: FontSize.base, color: Colors.textPrimary, fontWeight: FontWeight.medium },
  productCat: { fontSize: FontSize.xs, color: Colors.textTertiary, textTransform: 'capitalize' },
  productArrow: { fontSize: FontSize.lg, color: Colors.textTertiary },
  recentChangeBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.bgCard, borderRadius: Radius.lg,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  recentChangeEmoji: { fontSize: 24 },
  recentChangeTitle: { fontSize: FontSize.xs, color: Colors.textTertiary, fontWeight: FontWeight.medium },
  recentChangeDesc: { fontSize: FontSize.base, color: Colors.textPrimary, fontWeight: FontWeight.semiBold },
  recentChangeAge: { fontSize: FontSize.xs, color: Colors.textTertiary, marginTop: 2 },
  recentChangeArrow: { fontSize: FontSize.lg, color: Colors.textTertiary },
  detectiveBanner: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.md,
    backgroundColor: Colors.bgCard, borderRadius: Radius.lg,
    padding: Spacing.md, borderWidth: 1, borderColor: Colors.border,
  },
  detectiveEmoji: { fontSize: 28 },
  detectiveTitle: { fontSize: FontSize.base, fontWeight: FontWeight.semiBold, color: Colors.textPrimary },
  detectiveSubtitle: { fontSize: FontSize.sm, color: Colors.textSecondary },
  detectiveArrow: { fontSize: FontSize.lg, color: Colors.textTertiary },
});
