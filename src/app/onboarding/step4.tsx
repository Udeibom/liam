/**
 * Onboarding Step 4 — Budget + save profile
 */
import { useState } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { supabase } from '@/lib/supabase';
import { Button } from '@/components/ui';
import { Colors, FontSize, FontWeight, Radius, Spacing } from '@/constants';
import { onboardingData } from './step1';

const BUDGETS = [
  { value: 'low', label: 'Budget-conscious', description: 'Drugstore & affordable brands' },
  { value: 'mid', label: 'Mid-range', description: 'Mix of affordable and premium' },
  { value: 'high', label: 'Premium', description: 'Whatever works best' },
];

export default function OnboardingStep4() {
  const [selected, setSelected] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFinish = async () => {
    setLoading(true);

    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const { error } = await supabase.from('skin_profiles').upsert({
        user_id: user.id,
        skin_type: onboardingData.skin_type ?? 'unknown',
        goals: onboardingData.goals ?? [],
        sensitivities: onboardingData.sensitivities ?? [],
        budget_range: selected,
        onboarding_complete: true,
      });

      if (error) throw error;

      // Root layout will detect the completed profile and redirect to tabs
      router.replace('/(tabs)/home');
    } catch (err) {
      Alert.alert('Error', String(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll}>
        <View style={styles.progress}>
          {[1, 2, 3, 4].map((step) => (
            <View key={step} style={[styles.dot, styles.dotActive]} />
          ))}
        </View>

        <Text style={styles.stepLabel}>Step 4 of 4</Text>
        <Text style={styles.title}>Budget preference</Text>
        <Text style={styles.subtitle}>
          LIAN will tailor product suggestions to your budget. You can change this any time.
        </Text>

        <View style={styles.options}>
          {BUDGETS.map(({ value, label, description }) => (
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

        <View style={styles.allSet}>
          <Text style={styles.allSetTitle}>You&apos;re all set.</Text>
          <Text style={styles.allSetText}>
            LIAN will build a deeper understanding of your skin with each scan, 
            product, and conversation.
          </Text>
        </View>
      </ScrollView>

      <View style={styles.footer}>
        <Button
          label="Start my skin journey"
          size="lg"
          fullWidth
          loading={loading}
          onPress={handleFinish}
        />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  scroll: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing.xl },
  progress: { flexDirection: 'row', gap: Spacing.xs },
  dot: { height: 4, flex: 1, borderRadius: 2 },
  dotActive: { backgroundColor: Colors.primary },
  stepLabel: { fontSize: FontSize.sm, color: Colors.textTertiary },
  title: { fontSize: FontSize['2xl'], fontWeight: FontWeight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: FontSize.base, color: Colors.textSecondary, lineHeight: 22 },
  options: { gap: Spacing.sm },
  option: {
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  optionSelected: { borderColor: Colors.primary, backgroundColor: Colors.bgElevated },
  optionLabel: { fontSize: FontSize.md, fontWeight: FontWeight.semiBold, color: Colors.textPrimary },
  optionLabelSelected: { color: Colors.primary },
  optionDesc: { fontSize: FontSize.sm, color: Colors.textSecondary },
  allSet: {
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.lg,
    padding: Spacing.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: Spacing.sm,
  },
  allSetTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.primary,
  },
  allSetText: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  footer: { padding: Spacing.lg, paddingBottom: Spacing.xl },
});
