/**
 * Onboarding Step 1 — Skin type selection
 * Uses AsyncStorage to persist selections across steps (works on web + native).
 */
import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants';
import type { SkinType } from '@/types';

export const ONBOARDING_KEY = 'lian_onboarding_data';

const SKIN_TYPES: { value: SkinType; label: string; description: string }[] = [
  { value: 'oily',        label: 'Oily',          description: 'Shiny, enlarged pores, prone to breakouts' },
  { value: 'dry',         label: 'Dry',           description: 'Tight, flaky, can feel rough or dull' },
  { value: 'combination', label: 'Combination',   description: 'Oily T-zone, dry or normal cheeks' },
  { value: 'normal',      label: 'Normal',        description: 'Balanced, few imperfections' },
  { value: 'sensitive',   label: 'Sensitive',     description: 'Reacts easily, prone to redness or irritation' },
  { value: 'unknown',     label: "I'm not sure",  description: "We'll figure it out together" },
];

export default function OnboardingStep1() {
  const [selected, setSelected] = useState<SkinType | null>(null);
  const [loading, setLoading] = useState(false);

  const handleNext = async () => {
    if (!selected) return;
    setLoading(true);
    // Write to AsyncStorage so all steps share the same data safely
    await AsyncStorage.setItem(
      ONBOARDING_KEY,
      JSON.stringify({ skin_type: selected }),
    );
    setLoading(false);
    router.push('/onboarding/step2');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.progress}>
          {[1, 2, 3, 4].map((step) => (
            <View key={step} style={[styles.dot, step === 1 ? styles.dotActive : styles.dotInactive]} />
          ))}
        </View>

        <Text style={styles.stepLabel}>Step 1 of 4</Text>
        <Text style={styles.title}>What&apos;s your skin type?</Text>
        <Text style={styles.subtitle}>
          Don&apos;t worry if you&apos;re not sure — LIAN will refine this based on your scans.
        </Text>

        <View style={styles.options}>
          {SKIN_TYPES.map(({ value, label, description }) => (
            <TouchableOpacity
              key={value}
              style={[styles.option, selected === value && styles.optionSelected]}
              onPress={() => setSelected(value)}
              accessibilityRole="radio"
              accessibilityLabel={label}
              accessibilityState={{ checked: selected === value }}
            >
              <Text style={[styles.optionLabel, selected === value && styles.optionLabelSelected]}>
                {label}
              </Text>
              <Text style={styles.optionDesc}>{description}</Text>
            </TouchableOpacity>
          ))}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label="Continue"
          size="lg"
          fullWidth
          disabled={!selected}
          loading={loading}
          onPress={handleNext}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  scroll: { padding: Spacing.lg, paddingBottom: Spacing.xl, gap: Spacing.md },
  progress: { flexDirection: 'row', gap: Spacing.xs },
  dot: { height: 4, flex: 1, borderRadius: 2 },
  dotActive: { backgroundColor: Colors.primary },
  dotInactive: { backgroundColor: Colors.border },
  stepLabel: { fontSize: FontSize.sm, color: Colors.textTertiary },
  title: { fontSize: FontSize['2xl'], fontWeight: FontWeight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: FontSize.base, color: Colors.textSecondary, lineHeight: 22 },
  options: { gap: Spacing.sm },
  option: {
    backgroundColor: Colors.bgCard, borderRadius: Radius.md,
    borderWidth: 1, borderColor: Colors.border, padding: Spacing.md, gap: Spacing.xs,
  },
  optionSelected: { borderColor: Colors.primary, backgroundColor: Colors.bgElevated },
  optionLabel: { fontSize: FontSize.md, fontWeight: FontWeight.semiBold, color: Colors.textPrimary },
  optionLabelSelected: { color: Colors.primary },
  optionDesc: { fontSize: FontSize.sm, color: Colors.textSecondary },
  footer: { padding: Spacing.lg, paddingBottom: Spacing.xl },
});
