/**
 * Skin Detective Screen
 *
 * Structured investigation flow:
 * 1. User reports a symptom ("something is irritating my skin")
 * 2. LIAN pulls before/after product state from the timeline
 * 3. Compares scan data around the suspected change
 * 4. Identifies new variables (products added in that window)
 * 5. Guides the user through a systematic elimination process
 *
 * This is a guided chat — not a free-form conversation.
 * The structured questions give Groq maximum context.
 */
import { useState, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showAlert } from '@/lib/toast';
import { supabase, getCurrentUser } from '@/lib/supabase';
import { Card, Button } from '@/components/ui';
import { Colors, FontSize, FontWeight, Spacing, Radius } from '@/constants';
import type { Product, SkinScan, TimelineEvent, SkinConcernScore } from '@/types';

type DetectiveStep = 'intro' | 'symptom' | 'timeframe' | 'investigating' | 'report' | 'follow_up';

interface InvestigationData {
  symptom: string;
  timeframe: string;
  suspectedProducts: Product[];
  beforeScans: SkinScan[];
  afterScans: SkinScan[];
  recentEvents: TimelineEvent[];
  report: string;
}

interface Message {
  id: string;
  role: 'lian' | 'user';
  content: string;
}

const TIMEFRAME_OPTIONS = [
  { label: 'In the last week', days: 7 },
  { label: 'In the last 2 weeks', days: 14 },
  { label: '2–4 weeks ago', days: 28 },
  { label: 'About a month ago', days: 35 },
  { label: 'More than a month ago', days: 60 },
];

const SYMPTOM_OPTIONS = [
  'My skin is breaking out more than usual',
  'My skin is red and irritated',
  'My skin feels dry and tight',
  'I have a burning or stinging sensation',
  'My skin looks dull or uneven',
  'I have new dark spots or marks',
  'My skin is suddenly oily',
  'I have a rash or unusual texture',
];

export default function DetectiveScreen() {
  const [step, setStep] = useState<DetectiveStep>('intro');
  const [symptom, setSymptom] = useState('');
  const [customSymptom, setCustomSymptom] = useState('');
  const [timeframeDays, setTimeframeDays] = useState<number | null>(null);
  const [investigation, setInvestigation] = useState<InvestigationData | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [followUpInput, setFollowUpInput] = useState('');
  const [loading, setLoading] = useState(false);

  const scrollRef = useRef<ScrollView>(null);

  const addMessage = (role: 'lian' | 'user', content: string) => {
    setMessages((prev) => [
      ...prev,
      { id: Date.now().toString() + Math.random(), role, content },
    ]);
    setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 100);
  };

  const startInvestigation = async () => {
    const finalSymptom = symptom || customSymptom;
    if (!finalSymptom.trim() || !timeframeDays) return;

    setStep('investigating');
    setLoading(true);

    addMessage('lian', `I'm looking at your skin history around the time you noticed "${finalSymptom}"…`);

    try {
      const user = await getCurrentUser();
      if (!user) throw new Error('Not authenticated');

      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - timeframeDays);

      // Pull all the data we need in parallel
      const [allProductsRes, allScansRes, recentEventsRes] = await Promise.all([
        supabase.from('products').select('*').eq('user_id', user.id),
        supabase
          .from('skin_scans')
          .select('*')
          .eq('user_id', user.id)
          .order('scanned_at', { ascending: false })
          .limit(8),
        supabase
          .from('timeline_events')
          .select('*')
          .eq('user_id', user.id)
          .order('occurred_at', { ascending: false })
          .limit(20),
      ]);

      const allProducts = (allProductsRes.data ?? []) as Product[];
      const allScans = (allScansRes.data ?? []) as SkinScan[];
      const allEvents = (recentEventsRes.data ?? []) as TimelineEvent[];

      // Products added AFTER the cutoff date (new variables)
      const suspectedProducts = allProducts.filter(
        (p) => p.started_at && new Date(p.started_at) >= cutoffDate,
      );

      // Scans before and after cutoff
      const beforeScans = allScans.filter(
        (s) => new Date(s.scanned_at) < cutoffDate,
      ).slice(0, 3);

      const afterScans = allScans.filter(
        (s) => new Date(s.scanned_at) >= cutoffDate,
      ).slice(0, 3);

      // Events in the timeframe
      const recentEvents = allEvents.filter(
        (e) => new Date(e.occurred_at) >= cutoffDate,
      );

      const data: InvestigationData = {
        symptom: finalSymptom,
        timeframe: `${timeframeDays} days`,
        suspectedProducts,
        beforeScans,
        afterScans,
        recentEvents,
        report: '',
      };

      // Now build context for Groq
      const beforeConcerns = beforeScans.length > 0
        ? (beforeScans[0].concerns as SkinConcernScore[])
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map((c) => `${c.concern}: ${c.severity} (${c.score})`)
          .join(', ')
        : 'No scan data before this period';

      const afterConcerns = afterScans.length > 0
        ? (afterScans[0].concerns as SkinConcernScore[])
          .sort((a, b) => b.score - a.score)
          .slice(0, 5)
          .map((c) => `${c.concern}: ${c.severity} (${c.score})`)
          .join(', ')
        : 'No scan data after this period';

      const suspectedList = suspectedProducts.length > 0
        ? suspectedProducts.map((p) => `- ${p.name}${p.brand ? ' by ' + p.brand : ''} (added ${p.started_at ? new Date(p.started_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }) : 'recently'})`).join('\n')
        : 'No new products added in this period';

      const eventsList = recentEvents.length > 0
        ? recentEvents.map((e) => `- ${new Date(e.occurred_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}: ${e.title}`).join('\n')
        : 'No recorded changes in this period';

      const prompt = `You are LIAN's Skin Detective. A user is reporting a skin problem and you need to help investigate the cause.

User's reported problem: "${finalSymptom}"
Reported timeframe: Started approximately ${timeframeDays} days ago

SKIN DATA BEFORE THIS PERIOD:
${beforeConcerns}

SKIN DATA AFTER / DURING THIS PERIOD:
${afterConcerns}

NEW PRODUCTS ADDED IN THIS PERIOD (main suspects):
${suspectedList}

ALL CHANGES RECORDED IN THIS PERIOD:
${eventsList}

Your job:
1. Compare the before/after scan data to confirm whether something actually changed in their skin
2. Identify the most likely culprits from the new variables
3. Distinguish between correlation and causation — be honest about what you can and cannot confirm from data alone
4. Give a clear, structured investigation report

Format your response as:
**What the data shows**: [2-3 sentences on what actually changed in the scan data]
**The new variables**: [Which products/changes are most likely candidates and why]
**What I can't confirm**: [What would require more evidence]
**Recommended next steps**: [A specific, actionable plan — likely an elimination protocol]

If the data doesn't clearly point to a cause, say so plainly. Don't invent explanations.`;

      const { data: fnData, error: fnError } = await supabase.functions.invoke('groq-chat', {
        body: {
          messages: [{ role: 'user', content: prompt }],
          skinContext: null,
        },
      });

      if (fnError) throw fnError;

      data.report = fnData.reply;
      setInvestigation(data);
      setStep('report');
      addMessage('lian', fnData.reply);
    } catch (err) {
      showAlert('Investigation failed', String(err));
      setStep('symptom');
    } finally {
      setLoading(false);
    }
  };

  const sendFollowUp = async () => {
    if (!followUpInput.trim() || !investigation) return;

    const userText = followUpInput.trim();
    setFollowUpInput('');
    addMessage('user', userText);
    setLoading(true);
    setStep('follow_up');

    try {
      const history = messages.map((m) => ({
        role: m.role === 'lian' ? 'assistant' : 'user' as 'assistant' | 'user',
        content: m.content,
      }));
      history.push({ role: 'user', content: userText });

      const { data: fnData, error: fnError } = await supabase.functions.invoke('groq-chat', {
        body: {
          messages: history,
          skinContext: {
            investigation: {
              symptom: investigation.symptom,
              suspectedProducts: investigation.suspectedProducts.map((p) => p.name),
            },
          },
        },
      });

      if (fnError) throw fnError;
      addMessage('lian', fnData.reply);
    } catch (err) {
      showAlert('Error', String(err));
    } finally {
      setLoading(false);
      setStep('follow_up');
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>🕵️ Skin Detective</Text>
        <View style={{ width: 48 }} />
      </View>

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 0 : 20}
      >
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.scroll}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >

          {/* ── INTRO ── */}
          {step === 'intro' && (
            <View style={styles.introSection}>
              <Text style={styles.introTitle}>Something not right with your skin?</Text>
              <Text style={styles.introText}>
                LIAN will investigate by comparing your scan history, product timeline, and recent
                changes to identify the most likely culprits.
              </Text>
              <Text style={styles.introText}>
                This isn&apos;t a diagnosis — it&apos;s a structured way to narrow down what changed.
              </Text>
              <Button
                label="Start investigation"
                size="lg"
                fullWidth
                onPress={() => setStep('symptom')}
              />
            </View>
          )}

          {/* ── SYMPTOM SELECTION ── */}
          {step === 'symptom' && (
            <View style={styles.stepSection}>
              <Text style={styles.stepTitle}>What&apos;s the problem?</Text>
              <Text style={styles.stepSubtitle}>Select the closest description or write your own.</Text>

              {SYMPTOM_OPTIONS.map((opt) => (
                <TouchableOpacity
                  key={opt}
                  style={[styles.option, symptom === opt && styles.optionSelected]}
                  onPress={() => { setSymptom(opt); setCustomSymptom(''); }}
                  accessibilityRole="radio"
                  accessibilityLabel={opt}
                  accessibilityState={{ checked: symptom === opt }}
                >
                  <Text style={[styles.optionText, symptom === opt && styles.optionTextSelected]}>
                    {opt}
                  </Text>
                </TouchableOpacity>
              ))}

              <TextInput
                style={[styles.customInput, !symptom && customSymptom && styles.customInputActive]}
                value={customSymptom}
                onChangeText={(t) => { setCustomSymptom(t); setSymptom(''); }}
                placeholder="Or describe it in your own words…"
                placeholderTextColor={Colors.textTertiary}
                multiline
              />

              <Button
                label="Continue"
                size="lg"
                fullWidth
                disabled={!symptom && !customSymptom.trim()}
                onPress={() => setStep('timeframe')}
              />
            </View>
          )}

          {/* ── TIMEFRAME ── */}
          {step === 'timeframe' && (
            <View style={styles.stepSection}>
              <Text style={styles.stepTitle}>When did it start?</Text>
              <Text style={styles.stepSubtitle}>
                LIAN will look at what changed in your routine around that time.
              </Text>

              {TIMEFRAME_OPTIONS.map(({ label, days }) => (
                <TouchableOpacity
                  key={days}
                  style={[styles.option, timeframeDays === days && styles.optionSelected]}
                  onPress={() => setTimeframeDays(days)}
                  accessibilityRole="radio"
                  accessibilityLabel={label}
                  accessibilityState={{ checked: timeframeDays === days }}
                >
                  <Text style={[styles.optionText, timeframeDays === days && styles.optionTextSelected]}>
                    {label}
                  </Text>
                </TouchableOpacity>
              ))}

              <Button
                label="Investigate"
                size="lg"
                fullWidth
                disabled={!timeframeDays}
                onPress={startInvestigation}
              />
            </View>
          )}

          {/* ── INVESTIGATING ── */}
          {step === 'investigating' && (
            <View style={styles.investigatingBox}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={styles.investigatingTitle}>Investigating…</Text>
              <Text style={styles.investigatingSubtext}>
                Comparing scan data and product history from the past {timeframeDays} days
              </Text>
            </View>
          )}

          {/* ── REPORT + FOLLOW UP ── */}
          {(step === 'report' || step === 'follow_up') && (
            <>
              {/* Suspected products summary */}
              {investigation && investigation.suspectedProducts.length > 0 && (
                <Card style={styles.suspectsCard}>
                  <Text style={styles.suspectsTitle}>New products in this window</Text>
                  {investigation.suspectedProducts.map((p) => (
                    <View key={p.id} style={styles.suspectRow}>
                      <Text style={styles.suspectEmoji}>🧴</Text>
                      <View>
                        <Text style={styles.suspectName}>{p.name}</Text>
                        {p.brand && <Text style={styles.suspectBrand}>{p.brand}</Text>}
                      </View>
                    </View>
                  ))}
                </Card>
              )}

              {/* Messages */}
              {messages.map((msg) => (
                <View
                  key={msg.id}
                  style={[styles.bubble, msg.role === 'user' ? styles.userBubble : styles.liaiBubble]}
                >
                  {msg.role === 'lian' && <Text style={styles.lianLabel}>LIAN</Text>}
                  <Text style={[styles.bubbleText, msg.role === 'user' ? styles.userText : styles.lianText]}>
                    {msg.content}
                  </Text>
                </View>
              ))}

              {loading && (
                <View style={[styles.bubble, styles.liaiBubble]}>
                  <Text style={styles.lianLabel}>LIAN</Text>
                  <ActivityIndicator size="small" color={Colors.primary} />
                </View>
              )}

              <Text style={styles.followUpLabel}>Ask a follow-up question</Text>
            </>
          )}
        </ScrollView>

        {/* Follow-up input */}
        {(step === 'report' || step === 'follow_up') && (
          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              value={followUpInput}
              onChangeText={setFollowUpInput}
              placeholder="Ask a follow-up…"
              placeholderTextColor={Colors.textTertiary}
              multiline
              maxLength={400}
              accessibilityLabel="Follow-up question input"
            />
            <TouchableOpacity
              style={[styles.sendBtn, (!followUpInput.trim() || loading) && styles.sendBtnDisabled]}
              onPress={sendFollowUp}
              disabled={!followUpInput.trim() || loading}
              accessibilityRole="button"
              accessibilityLabel="Send follow-up"
            >
              <Text style={styles.sendBtnText}>↑</Text>
            </TouchableOpacity>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: Spacing.lg,
    paddingVertical: Spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  backBtn: { fontSize: FontSize.base, color: Colors.textSecondary },
  title: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  scroll: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xl, flexGrow: 1 },
  introSection: { gap: Spacing.md },
  introTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  introText: { fontSize: FontSize.base, color: Colors.textSecondary, lineHeight: 22 },
  stepSection: { gap: Spacing.md },
  stepTitle: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  stepSubtitle: { fontSize: FontSize.base, color: Colors.textSecondary, lineHeight: 22 },
  option: {
    padding: Spacing.md,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bgCard,
  },
  optionSelected: { borderColor: Colors.primary, backgroundColor: Colors.bgElevated },
  optionText: { fontSize: FontSize.base, color: Colors.textPrimary },
  optionTextSelected: { color: Colors.primary, fontWeight: FontWeight.medium },
  customInput: {
    backgroundColor: Colors.bgInput,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.base,
    color: Colors.textPrimary,
    minHeight: 72,
  },
  customInputActive: { borderColor: Colors.primary },
  investigatingBox: {
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.xl,
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  investigatingTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.semiBold,
    color: Colors.textPrimary,
  },
  investigatingSubtext: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center' },
  suspectsCard: { gap: Spacing.sm },
  suspectsTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semiBold,
    color: Colors.warning,
    marginBottom: Spacing.xs,
  },
  suspectRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  suspectEmoji: { fontSize: 18 },
  suspectName: { fontSize: FontSize.base, color: Colors.textPrimary, fontWeight: FontWeight.medium },
  suspectBrand: { fontSize: FontSize.xs, color: Colors.textTertiary },
  bubble: {
    maxWidth: '90%',
    borderRadius: Radius.lg,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  liaiBubble: {
    alignSelf: 'flex-start',
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
    borderBottomLeftRadius: 4,
  },
  userBubble: {
    alignSelf: 'flex-end',
    backgroundColor: Colors.primary,
    borderBottomRightRadius: 4,
  },
  lianLabel: { fontSize: FontSize.xs, color: Colors.primary, fontWeight: FontWeight.semiBold },
  bubbleText: { fontSize: FontSize.base, lineHeight: 22 },
  lianText: { color: Colors.textPrimary },
  userText: { color: Colors.textInverse },
  followUpLabel: {
    fontSize: FontSize.sm,
    color: Colors.textTertiary,
    textAlign: 'center',
    marginTop: Spacing.sm,
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    padding: Spacing.md,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
    gap: Spacing.sm,
    backgroundColor: Colors.bgCard,
  },
  input: {
    flex: 1,
    backgroundColor: Colors.bgInput,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.base,
    color: Colors.textPrimary,
    maxHeight: 100,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.4 },
  sendBtnText: { fontSize: 20, color: Colors.textInverse, fontWeight: FontWeight.bold },
});
