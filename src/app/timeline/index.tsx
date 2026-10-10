/**
 * Skin Timeline Screen
 *
 * Three views:
 * 1. Progress   — scan-over-scan comparison, "is my routine working?"
 * 2. SpotCheck  — track a single concern over time with photo + score history
 * 3. Timeline   — chronological event log (products, routine changes, reactions)
 */
import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  Alert,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { Card, Button } from '@/components/ui';
import { Colors, FontSize, FontWeight, Spacing, Radius } from '@/constants';
import type { SkinScan, TimelineEvent, SkinConcernScore } from '@/types';

const EVENT_EMOJI: Record<string, string> = {
  scan: '🔬',
  product_added: '🧴',
  product_stopped: '🚫',
  routine_changed: '📋',
  user_note: '📝',
  reaction_reported: '⚠️',
};

type ActiveView = 'progress' | 'spotcheck' | 'timeline';

export default function TimelineScreen() {
  const [scans, setScans] = useState<SkinScan[]>([]);
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [analysis, setAnalysis] = useState<string | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [activeView, setActiveView] = useState<ActiveView>('progress');

  // SpotCheck state
  const [pinnedConcern, setPinnedConcern] = useState<string | null>(null);
  const [spotAnalysis, setSpotAnalysis] = useState<string | null>(null);
  const [spotAnalysing, setSpotAnalysing] = useState(false);

  useEffect(() => {
    const load = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const [scansRes, eventsRes] = await Promise.all([
        supabase
          .from('skin_scans')
          .select('*')
          .eq('user_id', user.id)
          .order('scanned_at', { ascending: false })
          .limit(10),
        supabase
          .from('timeline_events')
          .select('*')
          .eq('user_id', user.id)
          .order('occurred_at', { ascending: false })
          .limit(30),
      ]);

      setScans((scansRes.data ?? []) as SkinScan[]);
      setEvents((eventsRes.data ?? []) as TimelineEvent[]);
      setLoading(false);
    };
    load();
  }, []);

  // ── Helpers ───────────────────────────────────────────────────────────────

  const getConcernTrend = (concern: string): { scores: number[]; dates: string[]; trend: string } => {
    const chronological = [...scans].reverse();
    const scores = chronological.map((s) => {
      const c = (s.concerns as SkinConcernScore[]).find((x) => x.concern === concern);
      return c?.score ?? 0;
    });
    const dates = chronological.map((s) =>
      new Date(s.scanned_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    );

    if (scores.length < 2) return { scores, dates, trend: 'stable' };
    const delta = scores[scores.length - 1] - scores[0];
    if (delta < -8) return { scores, dates, trend: 'improving' };
    if (delta > 8) return { scores, dates, trend: 'worsening' };
    return { scores, dates, trend: 'stable' };
  };

  const allConcerns = Array.from(
    new Set(scans.flatMap((s) => (s.concerns as SkinConcernScore[]).map((c) => c.concern))),
  ).slice(0, 10);

  const TREND_COLOR: Record<string, string> = {
    improving: Colors.success,
    stable: Colors.textSecondary,
    worsening: Colors.error,
  };
  const TREND_ARROW: Record<string, string> = {
    improving: '↓',
    stable: '→',
    worsening: '↑',
  };

  // ── "Is my routine working?" ───────────────────────────────────────────────

  const analyseProgress = async () => {
    if (scans.length < 2) {
      Alert.alert('Need more scans', 'Take another scan after a few weeks to compare.');
      return;
    }
    setAnalysing(true);
    try {
      const scanSummaries = scans
        .slice(0, 4)
        .map((s, i) => {
          const concerns = (s.concerns as SkinConcernScore[])
            .sort((a, b) => b.score - a.score)
            .slice(0, 6)
            .map((c) => `${c.concern}: ${c.severity} (${c.score})`)
            .join(', ');
          return `Scan ${scans.length - i} (${new Date(s.scanned_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}): ${concerns}`;
        })
        .reverse()
        .join('\n');

      const recentEvents = events
        .slice(0, 10)
        .map((e) => `${new Date(e.occurred_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}: ${e.title}`)
        .join('\n');

      const { data: fnData, error: fnError } = await supabase.functions.invoke('groq-chat', {
        body: {
          messages: [{
            role: 'user',
            content: `You are analysing a user's skin progress for the LIAN app.

Scan history (oldest to newest):
${scanSummaries}

Recent changes:
${recentEvents || 'No events recorded'}

Is their skin improving, staying the same, or getting worse?

Answer as:
1. Overall verdict (one sentence)
2. What is actually changing — specific concerns with direction
3. What is NOT changing that needs attention
4. One concrete next-step recommendation

Be honest. If there's insufficient data, say so clearly.`,
          }],
          skinContext: null,
        },
      });
      if (fnError) throw fnError;
      setAnalysis(fnData.reply);
    } catch (err) {
      Alert.alert('Analysis failed', String(err));
    } finally {
      setAnalysing(false);
    }
  };

  // ── SpotCheck analysis ────────────────────────────────────────────────────

  const analyseSpot = async (concern: string) => {
    setPinnedConcern(concern);
    setSpotAnalysis(null);
    setSpotAnalysing(true);

    try {
      const { scores, dates } = getConcernTrend(concern);
      const history = scores
        .map((s, i) => `${dates[i]}: score ${s}/100`)
        .join('\n');

      const relatedEvents = events
        .slice(0, 15)
        .map((e) => `${new Date(e.occurred_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}: ${e.title}`)
        .join('\n');

      const { data: fnData, error: fnError } = await supabase.functions.invoke('groq-chat', {
        body: {
          messages: [{
            role: 'user',
            content: `The user is tracking a specific skin concern: "${concern.replace(/_/g, ' ')}".

Score history (lower = better):
${history}

Routine and product changes in same period:
${relatedEvents || 'None recorded'}

Answer these questions:
1. Is this concern actually improving, stable, or getting worse? (use the numbers, not just the trend label)
2. Is the rate of change meaningful or is this normal variation?
3. Are any of the recorded events correlated with changes in this concern? (be careful about correlation vs causation)
4. What should the user do or watch for next?

Keep it concise and direct. Don't pad the answer.`,
          }],
          skinContext: null,
        },
      });
      if (fnError) throw fnError;
      setSpotAnalysis(fnData.reply);
    } catch (err) {
      Alert.alert('Analysis failed', String(err));
    } finally {
      setSpotAnalysing(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const TABS: { key: ActiveView; label: string }[] = [
    { key: 'progress', label: '📈 Progress' },
    { key: 'spotcheck', label: '🔍 SpotCheck' },
    { key: 'timeline', label: '📅 Timeline' },
  ];

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Go back">
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Skin Timeline</Text>
        <View style={{ width: 48 }} />
      </View>

      <View style={styles.toggle}>
        {TABS.map(({ key, label }) => (
          <TouchableOpacity
            key={key}
            style={[styles.toggleBtn, activeView === key && styles.toggleBtnActive]}
            onPress={() => setActiveView(key)}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: activeView === key }}
          >
            <Text style={[styles.toggleLabel, activeView === key && styles.toggleLabelActive]}>
              {label}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>

          {/* ════════════ PROGRESS VIEW ════════════ */}
          {activeView === 'progress' && (
            <>
              {scans.length === 0 ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyEmoji}>🔬</Text>
                  <Text style={styles.emptyTitle}>No scans yet</Text>
                  <Text style={styles.emptyText}>
                    Take your first skin scan. After a few weeks and another scan, LIAN can tell you
                    whether your routine is working.
                  </Text>
                  <Button label="Take a scan" onPress={() => router.push('/(tabs)/scan')} />
                </View>
              ) : (
                <>
                  <Card style={styles.progressCta}>
                    <Text style={styles.progressCtaTitle}>Is my routine working?</Text>
                    <Text style={styles.progressCtaSubtitle}>
                      {scans.length < 2
                        ? 'Take another scan after a few weeks to compare.'
                        : `Based on ${scans.length} scans`}
                    </Text>
                    {scans.length >= 2 && (
                      <Button
                        label={analysing ? 'Analysing…' : 'Analyse my progress'}
                        loading={analysing}
                        onPress={analyseProgress}
                        style={{ marginTop: Spacing.sm }}
                      />
                    )}
                  </Card>

                  {analysis && (
                    <Card style={styles.analysisCard}>
                      <Text style={styles.analysisLabel}>LIAN&apos;s assessment</Text>
                      <Text style={styles.analysisText}>{analysis}</Text>
                    </Card>
                  )}

                  {allConcerns.length > 0 && (
                    <>
                      <Text style={styles.sectionTitle}>Concern trends</Text>
                      {allConcerns.map((concern) => {
                        const { scores, trend } = getConcernTrend(concern);
                        const latestScore = scores[scores.length - 1] ?? 0;
                        return (
                          <TouchableOpacity
                            key={concern}
                            onPress={() => { setActiveView('spotcheck'); analyseSpot(concern); }}
                            accessibilityRole="button"
                            accessibilityLabel={`View SpotCheck for ${concern.replace(/_/g, ' ')}`}
                          >
                            <Card style={styles.concernCard}>
                              <View style={styles.concernHeader}>
                                <Text style={styles.concernName}>{concern.replace(/_/g, ' ')}</Text>
                                <View style={styles.concernRight}>
                                  <Text style={[styles.trendBadge, { color: TREND_COLOR[trend] }]}>
                                    {TREND_ARROW[trend]} {trend}
                                  </Text>
                                  <Text style={styles.spotCheckHint}>Track →</Text>
                                </View>
                              </View>
                              <View style={styles.sparkline}>
                                {scores.map((score, i) => (
                                  <View
                                    key={i}
                                    style={[
                                      styles.sparkBar,
                                      {
                                        height: Math.max(4, (score / 100) * 40),
                                        backgroundColor: i === scores.length - 1 ? TREND_COLOR[trend] : Colors.border,
                                      },
                                    ]}
                                  />
                                ))}
                              </View>
                              <Text style={styles.latestScore}>Latest: {latestScore}/100</Text>
                            </Card>
                          </TouchableOpacity>
                        );
                      })}
                    </>
                  )}

                  <Text style={styles.sectionTitle}>Scan history</Text>
                  <View style={styles.scanGrid}>
                    {scans.map((scan, i) => (
                      <View key={scan.id} style={styles.scanThumb}>
                        <Image
                          source={{ uri: scan.image_url }}
                          style={styles.scanThumbImage}
                          accessibilityLabel={`Scan from ${new Date(scan.scanned_at).toLocaleDateString()}`}
                        />
                        {i === 0 && (
                          <View style={styles.latestBadge}>
                            <Text style={styles.latestBadgeText}>Latest</Text>
                          </View>
                        )}
                        <Text style={styles.scanDate}>
                          {new Date(scan.scanned_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                        </Text>
                      </View>
                    ))}
                  </View>
                </>
              )}
            </>
          )}

          {/* ════════════ SPOTCHECK VIEW ════════════ */}
          {activeView === 'spotcheck' && (
            <>
              {scans.length === 0 ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyEmoji}>🔍</Text>
                  <Text style={styles.emptyTitle}>No scans yet</Text>
                  <Text style={styles.emptyText}>
                    Take your first scan to start tracking individual concerns over time.
                  </Text>
                  <Button label="Take a scan" onPress={() => router.push('/(tabs)/scan')} />
                </View>
              ) : (
                <>
                  {/* Concern picker */}
                  <View>
                    <Text style={styles.sectionTitle}>Choose a concern to track</Text>
                    <Text style={styles.spotCheckSubtitle}>
                      Tap any concern to see its full history and get LIAN&apos;s assessment.
                    </Text>
                    <View style={styles.concernPills}>
                      {allConcerns.length === 0 ? (
                        <Text style={styles.noConcernsText}>No concerns tracked yet. Take a scan first.</Text>
                      ) : (
                        allConcerns.map((concern) => (
                          <TouchableOpacity
                            key={concern}
                            style={[
                              styles.concernPill,
                              pinnedConcern === concern && styles.concernPillActive,
                            ]}
                            onPress={() => analyseSpot(concern)}
                            accessibilityRole="button"
                            accessibilityLabel={`Track ${concern.replace(/_/g, ' ')}`}
                            accessibilityState={{ selected: pinnedConcern === concern }}
                          >
                            <Text
                              style={[
                                styles.concernPillText,
                                pinnedConcern === concern && styles.concernPillTextActive,
                              ]}
                            >
                              {concern.replace(/_/g, ' ')}
                            </Text>
                          </TouchableOpacity>
                        ))
                      )}
                    </View>
                  </View>

                  {/* SpotCheck detail */}
                  {pinnedConcern && (
                    <>
                      <Text style={styles.pinnedTitle}>
                        {pinnedConcern.replace(/_/g, ' ')} — over time
                      </Text>

                      {/* Score + photo timeline */}
                      {(() => {
                        const { scores, dates } = getConcernTrend(pinnedConcern);
                        const chronoScans = [...scans].reverse();
                        return (
                          <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            contentContainerStyle={styles.spotTimeline}
                          >
                            {chronoScans.map((scan, i) => {
                              const score = scores[i] ?? 0;
                              const date = dates[i] ?? '';
                              const prevScore = i > 0 ? scores[i - 1] : null;
                              const delta = prevScore !== null ? score - prevScore : null;
                              return (
                                <View key={scan.id} style={styles.spotEntry}>
                                  <Image
                                    source={{ uri: scan.image_url }}
                                    style={styles.spotImage}
                                    accessibilityLabel={`Scan from ${date}`}
                                  />
                                  <Text style={styles.spotDate}>{date}</Text>
                                  <Text style={styles.spotScore}>{score}/100</Text>
                                  {delta !== null && (
                                    <Text
                                      style={[
                                        styles.spotDelta,
                                        {
                                          color:
                                            delta < 0 ? Colors.success
                                            : delta > 0 ? Colors.error
                                            : Colors.textTertiary,
                                        },
                                      ]}
                                    >
                                      {delta < 0 ? `↓ ${Math.abs(delta)}` : delta > 0 ? `↑ ${delta}` : '→ 0'}
                                    </Text>
                                  )}
                                </View>
                              );
                            })}
                          </ScrollView>
                        );
                      })()}

                      {/* AI analysis */}
                      {spotAnalysing ? (
                        <View style={styles.spotAnalysingBox}>
                          <ActivityIndicator color={Colors.primary} />
                          <Text style={styles.spotAnalysingText}>LIAN is analysing this concern…</Text>
                        </View>
                      ) : spotAnalysis ? (
                        <Card style={styles.analysisCard}>
                          <Text style={styles.analysisLabel}>
                            LIAN on {pinnedConcern.replace(/_/g, ' ')}
                          </Text>
                          <Text style={styles.analysisText}>{spotAnalysis}</Text>
                        </Card>
                      ) : null}
                    </>
                  )}
                </>
              )}
            </>
          )}

          {/* ════════════ TIMELINE VIEW ════════════ */}
          {activeView === 'timeline' && (
            <>
              {events.length === 0 ? (
                <View style={styles.empty}>
                  <Text style={styles.emptyEmoji}>📅</Text>
                  <Text style={styles.emptyTitle}>Your skin story starts here</Text>
                  <Text style={styles.emptyText}>
                    Every scan, product you add, and change you make will appear here — building the
                    context LIAN needs to detect patterns.
                  </Text>
                </View>
              ) : (
                <View style={styles.eventList}>
                  {events.map((event, i) => (
                    <View key={event.id} style={styles.eventRow}>
                      <View style={styles.eventLineCol}>
                        <View style={styles.eventDot} />
                        {i < events.length - 1 && <View style={styles.eventLine} />}
                      </View>
                      <View style={styles.eventContent}>
                        <Text style={styles.eventDate}>
                          {new Date(event.occurred_at).toLocaleDateString('en-GB', {
                            day: 'numeric', month: 'short', year: 'numeric',
                          })}
                        </Text>
                        <Card style={styles.eventCard}>
                          <View style={styles.eventCardHeader}>
                            <Text style={styles.eventEmoji}>{EVENT_EMOJI[event.event_type] ?? '📌'}</Text>
                            <Text style={styles.eventTitle}>{event.title}</Text>
                          </View>
                          {event.description && (
                            <Text style={styles.eventDesc}>{event.description}</Text>
                          )}
                        </Card>
                      </View>
                    </View>
                  ))}
                </View>
              )}
            </>
          )}

        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg, paddingVertical: Spacing.md,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  backBtn: { fontSize: FontSize.base, color: Colors.textSecondary },
  title: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  toggle: {
    flexDirection: 'row', padding: Spacing.md, gap: Spacing.sm,
    borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  toggleBtn: {
    flex: 1, paddingVertical: Spacing.sm, borderRadius: Radius.md,
    alignItems: 'center', backgroundColor: Colors.bgCard,
    borderWidth: 1, borderColor: Colors.border,
  },
  toggleBtnActive: { backgroundColor: Colors.bgElevated, borderColor: Colors.primary },
  toggleLabel: { fontSize: FontSize.xs, color: Colors.textSecondary, fontWeight: FontWeight.medium },
  toggleLabelActive: { color: Colors.primary },
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing.xl },
  empty: { alignItems: 'center', gap: Spacing.md, paddingTop: Spacing.xl },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  emptyText: { fontSize: FontSize.base, color: Colors.textSecondary, textAlign: 'center', lineHeight: 22 },
  progressCta: { gap: Spacing.sm },
  progressCtaTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  progressCtaSubtitle: { fontSize: FontSize.sm, color: Colors.textSecondary },
  analysisCard: { gap: Spacing.sm, borderColor: Colors.primary },
  analysisLabel: {
    fontSize: FontSize.xs, fontWeight: FontWeight.semiBold, color: Colors.primary,
    textTransform: 'uppercase', letterSpacing: 1,
  },
  analysisText: { fontSize: FontSize.base, color: Colors.textSecondary, lineHeight: 24 },
  sectionTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semiBold, color: Colors.textPrimary },
  concernCard: { gap: Spacing.sm },
  concernHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  concernRight: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  concernName: {
    fontSize: FontSize.base, color: Colors.textPrimary,
    fontWeight: FontWeight.medium, textTransform: 'capitalize', flex: 1,
  },
  trendBadge: { fontSize: FontSize.sm, fontWeight: FontWeight.semiBold, textTransform: 'capitalize' },
  spotCheckHint: { fontSize: FontSize.xs, color: Colors.primary },
  sparkline: { flexDirection: 'row', alignItems: 'flex-end', gap: 4, height: 44, paddingVertical: 2 },
  sparkBar: { flex: 1, borderRadius: 2, minHeight: 4 },
  latestScore: { fontSize: FontSize.xs, color: Colors.textTertiary },
  scanGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  scanThumb: { width: '30%', gap: Spacing.xs },
  scanThumbImage: { width: '100%', aspectRatio: 1, borderRadius: Radius.md, backgroundColor: Colors.bgCard },
  latestBadge: {
    position: 'absolute', top: 4, left: 4,
    backgroundColor: Colors.primary, borderRadius: Radius.sm,
    paddingHorizontal: 6, paddingVertical: 2,
  },
  latestBadgeText: { fontSize: 9, color: Colors.textInverse, fontWeight: FontWeight.bold },
  scanDate: { fontSize: FontSize.xs, color: Colors.textSecondary, textAlign: 'center' },
  // SpotCheck
  spotCheckSubtitle: { fontSize: FontSize.sm, color: Colors.textSecondary, marginTop: 4, marginBottom: Spacing.md, lineHeight: 20 },
  concernPills: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  concernPill: {
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, borderWidth: 1,
    borderColor: Colors.border, backgroundColor: Colors.bgCard,
  },
  concernPillActive: { borderColor: Colors.primary, backgroundColor: Colors.bgElevated },
  concernPillText: { fontSize: FontSize.sm, color: Colors.textSecondary, textTransform: 'capitalize' },
  concernPillTextActive: { color: Colors.primary, fontWeight: FontWeight.semiBold },
  noConcernsText: { fontSize: FontSize.sm, color: Colors.textTertiary },
  pinnedTitle: {
    fontSize: FontSize.md, fontWeight: FontWeight.bold,
    color: Colors.textPrimary, textTransform: 'capitalize',
  },
  spotTimeline: { gap: Spacing.md, paddingVertical: Spacing.sm, paddingHorizontal: 2 },
  spotEntry: { width: 90, alignItems: 'center', gap: Spacing.xs },
  spotImage: { width: 80, height: 80, borderRadius: Radius.md, backgroundColor: Colors.bgCard },
  spotDate: { fontSize: FontSize.xs, color: Colors.textSecondary, textAlign: 'center' },
  spotScore: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  spotDelta: { fontSize: FontSize.xs, fontWeight: FontWeight.semiBold },
  spotAnalysingBox: { alignItems: 'center', gap: Spacing.sm, padding: Spacing.lg },
  spotAnalysingText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  // Timeline
  eventList: { gap: 0 },
  eventRow: { flexDirection: 'row', gap: Spacing.md, minHeight: 60 },
  eventLineCol: { width: 24, alignItems: 'center' },
  eventDot: { width: 12, height: 12, borderRadius: 6, backgroundColor: Colors.primary, marginTop: Spacing.md },
  eventLine: { width: 2, flex: 1, backgroundColor: Colors.border, marginTop: 4, marginBottom: -4 },
  eventContent: { flex: 1, paddingBottom: Spacing.md },
  eventDate: { fontSize: FontSize.xs, color: Colors.textTertiary, marginBottom: Spacing.xs, marginTop: Spacing.sm },
  eventCard: { gap: Spacing.xs },
  eventCardHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  eventEmoji: { fontSize: 18 },
  eventTitle: { fontSize: FontSize.base, color: Colors.textPrimary, fontWeight: FontWeight.medium, flex: 1 },
  eventDesc: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },
});
