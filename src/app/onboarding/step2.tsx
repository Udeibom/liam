/**
 * Onboarding Step 2 — Skin goals (multi-select)
 */
import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants';
import { ONBOARDING_KEY } from './step1';
import type { SkinGoal } from '@/types';

const GOALS: { value: SkinGoal; emoji: string; label: string }[] = [
  { value: 'clear_acne',        emoji: '🌿', label: 'Clear acne' },
  { value: 'reduce_dark_spots', emoji: '✨', label: 'Reduce dark spots' },
  { value: 'anti_aging',        emoji: '⏳', label: 'Anti-aging' },
  { value: 'hydration',         emoji: '💧', label: 'Better hydration' },
  { value: 'even_tone',         emoji: '🎨', label: 'Even skin tone' },
  { value: 'reduce_redness',    emoji: '🌸', label: 'Reduce redness' },
  { value: 'minimize_pores',    emoji: '🔬', label: 'Minimize pores' },
  { value: 'brightening',       emoji: '☀️', label: 'Brightening & glow' },
];

export default function OnboardingStep2() {
  const [selected, setSelected] = useState<SkinGoal[]>([]);
  const [loading, setLoading] = useState(false);

  const toggle = (goal: SkinGoal) =>
    setSelected((prev) =>
      prev.includes(goal) ? prev.filter((g) => g !== goal) : [...prev, goal],
    );

  const handleNext = async () => {
    setLoading(true);
    const raw = await AsyncStorage.getItem(ONBOARDING_KEY);
    const existing = raw ? JSON.parse(raw) : {};
    await AsyncStorage.setItem(ONBOARDING_KEY, JSON.stringify({ ...existing, goals: selected }));
    setLoading(false);
    router.push('/onboarding/step3');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.progress}>
          {[1, 2, 3, 4].map((step) => (
            <View key={step} style={[styles.dot, step <= 2 ? styles.dotActive : styles.dotInactive]} />
          ))}
        </View>

        <Text style={styles.stepLabel}>Step 2 of 4</Text>
        <Text style={styles.title}>What are your skin goals?</Text>
        <Text style={styles.subtitle}>Pick as many as apply. You can change these any time.</Text>

        <View style={styles.grid}>
          {GOALS.map(({ value, emoji, label }) => {
            const isSelected = selected.includes(value);
            return (
              <TouchableOpacity
                key={value}
                style={[styles.chip, isSelected && styles.chipSelected]}
                onPress={() => toggle(value)}
                accessibilityRole="checkbox"
                accessibilityLabel={label}
                accessibilityState={{ checked: isSelected }}
              >
                <Text style={styles.chipEmoji}>{emoji}</Text>
                <Text style={[styles.chipLabel, isSelected && styles.chipLabelSelected]}>{label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label={selected.length === 0 ? 'Skip for now' : 'Continue'}
          size="lg"
          fullWidth
          loading={loading}
          onPress={handleNext}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  scroll: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xl },
  progress: { flexDirection: 'row', gap: Spacing.xs },
  dot: { height: 4, flex: 1, borderRadius: 2 },
  dotActive: { backgroundColor: Colors.primary },
  dotInactive: { backgroundColor: Colors.border },
  stepLabel: { fontSize: FontSize.sm, color: Colors.textTertiary },
  title: { fontSize: FontSize['2xl'], fontWeight: FontWeight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: FontSize.base, color: Colors.textSecondary, lineHeight: 22 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.xs,
    paddingHorizontal: Spacing.md, paddingVertical: Spacing.sm,
    borderRadius: Radius.full, backgroundColor: Colors.bgCard,
    borderWidth: 1, borderColor: Colors.border,
  },
  chipSelected: { borderColor: Colors.primary, backgroundColor: Colors.bgElevated },
  chipEmoji: { fontSize: 16 },
  chipLabel: { fontSize: FontSize.sm, color: Colors.textPrimary, fontWeight: FontWeight.medium },
  chipLabelSelected: { color: Colors.primary },
  footer: { padding: Spacing.lg, paddingBottom: Spacing.xl },
});
