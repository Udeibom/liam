/**
 * Onboarding Step 3 — Sensitivities & reactions
 */
import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants';
import { onboardingData } from './step1';

const SENSITIVITIES = [
  'Fragrance', 'Alcohol', 'Retinol', 'AHAs / BHAs',
  'Vitamin C', 'Essential oils', 'Sulfates', 'Silicones',
  'Lanolin', 'Parabens',
];

export default function OnboardingStep3() {
  const [selected, setSelected] = useState<string[]>([]);

  const toggle = (item: string) => {
    setSelected((prev) =>
      prev.includes(item) ? prev.filter((s) => s !== item) : [...prev, item],
    );
  };

  const handleNext = () => {
    onboardingData.sensitivities = selected;
    router.push('/onboarding/step4');
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.progress}>
          {[1, 2, 3, 4].map((step) => (
            <View
              key={step}
              style={[styles.dot, step <= 3 ? styles.dotActive : styles.dotInactive]}
            />
          ))}
        </View>

        <Text style={styles.stepLabel}>Step 3 of 4</Text>
        <Text style={styles.title}>Any known sensitivities?</Text>
        <Text style={styles.subtitle}>
          LIAN will flag products containing these ingredients. Skip if you&apos;re not sure.
        </Text>

        <View style={styles.grid}>
          {SENSITIVITIES.map((item) => {
            const isSelected = selected.includes(item);
            return (
              <TouchableOpacity
                key={item}
                style={[styles.chip, isSelected && styles.chipSelected]}
                onPress={() => toggle(item)}
                accessibilityRole="checkbox"
                accessibilityLabel={item}
                accessibilityState={{ checked: isSelected }}
              >
                <Text style={[styles.chipLabel, isSelected && styles.chipLabelSelected]}>
                  {item}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button label="Continue" size="lg" fullWidth onPress={handleNext} />
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
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  chipSelected: { borderColor: Colors.primary, backgroundColor: Colors.bgElevated },
  chipLabel: { fontSize: FontSize.sm, color: Colors.textPrimary, fontWeight: FontWeight.medium },
  chipLabelSelected: { color: Colors.primary },
  footer: { padding: Spacing.lg, paddingBottom: Spacing.xl },
});
