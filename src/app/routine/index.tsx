import { useState, useEffect } from 'react';
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
import { showAlert } from '@/lib/toast';
import { supabase, getCurrentUser } from '@/lib/supabase';
import { Card, Button } from '@/components/ui';
import { Colors, FontSize, FontWeight, Spacing, Radius } from '@/constants';
import type { Routine, RoutineStep, Product, SkinProfile, SkinScan } from '@/types';

const FREQ_LABEL: Record<string, string> = {
  daily: 'Daily',
  every_other_day: 'Every other day',
  twice_weekly: 'Twice a week',
  weekly: 'Once a week',
};

interface ContextData {
  profile: SkinProfile | null;
  latestScan: SkinScan | null;
  activeProducts: Product[];
  existingRoutine: Routine | null;
}

export default function RoutineBuilderScreen() {
  const [ctx, setCtx] = useState<ContextData | null>(null);
  const [routine, setRoutine] = useState<Routine | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const load = async () => {
      const user = await getCurrentUser();
      if (!user) return;

      const [profileRes, scanRes, productsRes, routineRes] = await Promise.all([
        supabase.from('skin_profiles').select('*').eq('user_id', user.id).single(),
        supabase
          .from('skin_scans')
          .select('*')
          .eq('user_id', user.id)
          .order('scanned_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
        supabase.from('products').select('*').eq('user_id', user.id).eq('status', 'active'),
        supabase.from('routines').select('*').eq('user_id', user.id).maybeSingle(),
      ]);

      const data: ContextData = {
        profile: profileRes.data as SkinProfile | null,
        latestScan: scanRes.data as SkinScan | null,
        activeProducts: (productsRes.data ?? []) as Product[],
        existingRoutine: routineRes.data as Routine | null,
      };
      setCtx(data);

      if (data.existingRoutine) {
        setRoutine(data.existingRoutine);
        setSaved(true);
      }

      setLoading(false);
    };
    load();
  }, []);

  const generate = async () => {
    if (!ctx) return;
    setGenerating(true);
    setSaved(false);

    try {
      const user = await getCurrentUser();
      if (!user) throw new Error('Not authenticated');

      const productList = ctx.activeProducts.map(
        (p) => `${p.name}${p.brand ? ' by ' + p.brand : ''} (${p.category})`
      ).join('\n') || 'No products in library yet';

      const topConcerns = (ctx.latestScan?.concerns ?? [])
        .sort((a, b) => (b.score as number) - (a.score as number))
        .slice(0, 5)
        .map((c) => `${c.concern}: ${c.severity}`)
        .join(', ') || 'No scan data yet';

      const prompt = `Build a minimum-effective skincare routine for this user.

User profile:
- Skin type: ${ctx.profile?.skin_type ?? 'unknown'}
- Goals: ${ctx.profile?.goals?.join(', ') || 'none specified'}
- Sensitivities: ${ctx.profile?.sensitivities?.join(', ') || 'none reported'}
- Budget: ${ctx.profile?.budget_range ?? 'not specified'}

Current skin concerns from latest scan:
${topConcerns}

Products they currently own:
${productList}

Rules:
1. Prioritise minimum effective over maximum products
2. Only recommend steps they genuinely need
3. Use their existing products where possible
4. Flag any ingredient conflicts between their products
5. Be specific about morning vs evening usage

Return ONLY valid JSON in this exact shape, no markdown fences:
{
  "steps": [
    {
      "slot": "cleanser",
      "product_id": null,
      "instruction": "Gentle cleanse to remove overnight buildup",
      "frequency": "daily",
      "time_of_day": "morning"
    }
  ],
  "ai_rationale": "One paragraph explaining the overall approach."
}

slot must be one of: cleanser, toner, serum, treatment, moisturizer, sunscreen, oil, other
frequency must be one of: daily, every_other_day, twice_weekly, weekly
time_of_day must be one of: morning, evening, both`;

      const { data: fnData, error: fnError } = await supabase.functions.invoke('groq-chat', {
        body: {
          messages: [{ role: 'user', content: prompt }],
          skinContext: null,
        },
      });

      if (fnError) throw fnError;

      const raw: string = fnData.reply ?? '';
      const cleaned = raw.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
      const parsed = JSON.parse(cleaned) as { steps: RoutineStep[]; ai_rationale: string };

      // Try to match steps to actual products by category
      const stepsWithIds = parsed.steps.map((step) => {
        if (step.product_id) return step;
        const match = ctx.activeProducts.find(
          (p) => p.category === step.slot || p.category.includes(step.slot)
        );
        return { ...step, product_id: match?.id ?? null };
      });

      setRoutine({
        id: 'preview',
        user_id: user.id,
        steps: stepsWithIds,
        ai_rationale: parsed.ai_rationale,
        created_at: '',
        updated_at: '',
      });
    } catch (err) {
      showAlert('Could not build routine', String(err));
    } finally {
      setGenerating(false);
    }
  };

  const save = async () => {
    if (!routine) return;
    setSaving(true);

    try {
      const user = await getCurrentUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase.from('routines').upsert({
        user_id: user.id,
        steps: routine.steps,
        ai_rationale: routine.ai_rationale,
      });

      if (error) throw error;

      await supabase.from('timeline_events').insert({
        user_id: user.id,
        event_type: 'routine_changed',
        title: 'Routine updated',
        description: `${routine.steps.length}-step routine saved`,
      });

      setSaved(true);
      showAlert('Saved', 'Your routine has been saved.');
    } catch (err) {
      showAlert('Save failed', String(err));
    } finally {
      setSaving(false);
    }
  };

  const morningSteps = routine?.steps.filter(
    (s) => s.time_of_day === 'morning' || s.time_of_day === 'both'
  ) ?? [];
  const eveningSteps = routine?.steps.filter(
    (s) => s.time_of_day === 'evening' || s.time_of_day === 'both'
  ) ?? [];

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
        <Text style={styles.title}>Routine Builder</Text>
        <View style={{ width: 48 }} />
      </View>

      {loading ? (
        <View style={styles.loader}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
          {/* Context summary */}
          <Card style={styles.contextCard}>
            <Text style={styles.contextTitle}>Building for your skin</Text>
            <View style={styles.contextRow}>
              <Text style={styles.contextLabel}>Skin type</Text>
              <Text style={styles.contextValue}>{ctx?.profile?.skin_type ?? 'unknown'}</Text>
            </View>
            <View style={styles.contextRow}>
              <Text style={styles.contextLabel}>Goals</Text>
              <Text style={styles.contextValue}>
                {ctx?.profile?.goals?.length
                  ? ctx.profile.goals.map((g) => g.replace(/_/g, ' ')).join(', ')
                  : 'none set'}
              </Text>
            </View>
            <View style={styles.contextRow}>
              <Text style={styles.contextLabel}>Products available</Text>
              <Text style={styles.contextValue}>{ctx?.activeProducts.length ?? 0}</Text>
            </View>
          </Card>

          {/* Generate button */}
          {!routine && !generating && (
            <View style={styles.generateSection}>
              <Text style={styles.generateHint}>
                LIAN will build the minimum effective routine for your skin using your existing
                products first, only suggesting new ones when genuinely needed.
              </Text>
              <Button label="Build my routine" size="lg" fullWidth onPress={generate} />
            </View>
          )}

          {/* Generating */}
          {generating && (
            <View style={styles.generatingBox}>
              <ActivityIndicator color={Colors.primary} />
              <Text style={styles.generatingText}>Building your routine…</Text>
              <Text style={styles.generatingSubtext}>
                Analysing your skin profile, concerns, and existing products
              </Text>
            </View>
          )}

          {/* Results */}
          {routine && !generating && (
            <>
              <Card style={styles.rationaleCard}>
                <Text style={styles.rationaleLabel}>LIAN&apos;s reasoning</Text>
                <Text style={styles.rationaleText}>{routine.ai_rationale}</Text>
              </Card>

              {morningSteps.length > 0 && (
                <View style={styles.timeBlock}>
                  <Text style={styles.timeBlockTitle}>☀️ Morning</Text>
                  {morningSteps.map((step, i) => (
                    <RoutineStepCard
                      key={`m-${i}`}
                      step={step}
                      index={i + 1}
                      products={ctx?.activeProducts ?? []}
                    />
                  ))}
                </View>
              )}

              {eveningSteps.length > 0 && (
                <View style={styles.timeBlock}>
                  <Text style={styles.timeBlockTitle}>🌙 Evening</Text>
                  {eveningSteps.map((step, i) => (
                    <RoutineStepCard
                      key={`e-${i}`}
                      step={step}
                      index={i + 1}
                      products={ctx?.activeProducts ?? []}
                    />
                  ))}
                </View>
              )}

              <View style={styles.actions}>
                {!saved && (
                  <Button
                    label="Save this routine"
                    size="lg"
                    fullWidth
                    loading={saving}
                    onPress={save}
                  />
                )}
                {saved && (
                  <View style={styles.savedBadge}>
                    <Text style={styles.savedText}>✓ Routine saved</Text>
                  </View>
                )}
                <Button label="Regenerate" variant="secondary" fullWidth onPress={generate} />
              </View>
            </>
          )}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function RoutineStepCard({
  step,
  index,
  products,
}: {
  step: RoutineStep;
  index: number;
  products: Product[];
}) {
  const matchedProduct = step.product_id
    ? products.find((p) => p.id === step.product_id)
    : null;

  return (
    <Card style={styles.stepCard}>
      <View style={styles.stepHeader}>
        <View style={styles.stepNumber}>
          <Text style={styles.stepNumberText}>{index}</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.stepSlot}>{step.slot.replace(/_/g, ' ')}</Text>
          <Text style={styles.stepFreq}>{FREQ_LABEL[step.frequency] ?? step.frequency}</Text>
        </View>
        {step.time_of_day === 'both' && (
          <Text style={styles.stepTimeBadge}>Both</Text>
        )}
      </View>
      <Text style={styles.stepInstruction}>{step.instruction}</Text>
      {matchedProduct ? (
        <View style={styles.matchedProduct}>
          <Text style={styles.matchedProductLabel}>Use:</Text>
          <Text style={styles.matchedProductName}>{matchedProduct.name}</Text>
        </View>
      ) : (
        <View style={styles.noProduct}>
          <Text style={styles.noProductText}>No product assigned — add one to your library</Text>
        </View>
      )}
    </Card>
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
  loader: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing.xl },
  contextCard: { gap: Spacing.xs },
  contextTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semiBold,
    color: Colors.textPrimary,
    marginBottom: Spacing.xs,
  },
  contextRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
  },
  contextLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  contextValue: {
    fontSize: FontSize.sm,
    color: Colors.textPrimary,
    fontWeight: FontWeight.medium,
    textTransform: 'capitalize',
    flex: 1,
    textAlign: 'right',
  },
  generateSection: { gap: Spacing.md },
  generateHint: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    lineHeight: 22,
    textAlign: 'center',
  },
  generatingBox: {
    alignItems: 'center',
    gap: Spacing.md,
    padding: Spacing.xl,
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  generatingText: { fontSize: FontSize.md, fontWeight: FontWeight.semiBold, color: Colors.textPrimary },
  generatingSubtext: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center' },
  rationaleCard: { gap: Spacing.sm },
  rationaleLabel: {
    fontSize: FontSize.xs,
    fontWeight: FontWeight.semiBold,
    color: Colors.primary,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  rationaleText: { fontSize: FontSize.base, color: Colors.textSecondary, lineHeight: 22 },
  timeBlock: { gap: Spacing.sm },
  timeBlockTitle: { fontSize: FontSize.md, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  stepCard: { gap: Spacing.sm },
  stepHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  stepNumber: {
    width: 28, height: 28, borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  stepNumberText: { fontSize: FontSize.sm, fontWeight: FontWeight.bold, color: Colors.textInverse },
  stepSlot: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semiBold,
    color: Colors.textPrimary,
    textTransform: 'capitalize',
  },
  stepFreq: { fontSize: FontSize.xs, color: Colors.textTertiary },
  stepTimeBadge: {
    fontSize: FontSize.xs, color: Colors.primary,
    backgroundColor: Colors.bgElevated,
    paddingHorizontal: Spacing.sm, paddingVertical: 2,
    borderRadius: Radius.full, borderWidth: 1, borderColor: Colors.border,
  },
  stepInstruction: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },
  matchedProduct: {
    flexDirection: 'row', gap: Spacing.xs,
    backgroundColor: Colors.successBg,
    borderRadius: Radius.sm, padding: Spacing.sm,
  },
  matchedProductLabel: { fontSize: FontSize.xs, color: Colors.success, fontWeight: FontWeight.semiBold },
  matchedProductName: { fontSize: FontSize.xs, color: Colors.success, flex: 1 },
  noProduct: { backgroundColor: Colors.bgElevated, borderRadius: Radius.sm, padding: Spacing.sm },
  noProductText: { fontSize: FontSize.xs, color: Colors.textTertiary },
  actions: { gap: Spacing.sm },
  savedBadge: {
    backgroundColor: Colors.successBg, borderRadius: Radius.md,
    padding: Spacing.md, alignItems: 'center',
  },
  savedText: { fontSize: FontSize.base, color: Colors.success, fontWeight: FontWeight.semiBold },
});
