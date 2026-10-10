import { View, Text, StyleSheet, Dimensions } from 'react-native';
import { router } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/ui';
import { Colors, FontSize, FontWeight, Spacing } from '@/constants';

const { height } = Dimensions.get('window');

export default function WelcomeScreen() {
  return (
    <SafeAreaView style={styles.container}>
      {/* Hero */}
      <View style={styles.hero}>
        <View style={styles.logoMark}>
          <Text style={styles.logoText}>L</Text>
        </View>
        <Text style={styles.appName}>LIAN</Text>
        <Text style={styles.tagline}>Your personal skin companion</Text>
      </View>

      {/* Value props */}
      <View style={styles.props}>
        {[
          { emoji: '🔬', text: 'AI-powered skin analysis that improves over time' },
          { emoji: '🧴', text: 'Understand exactly what your products are doing' },
          { emoji: '📈', text: 'Track whether your routine is actually working' },
        ].map(({ emoji, text }) => (
          <View key={text} style={styles.propRow}>
            <Text style={styles.propEmoji}>{emoji}</Text>
            <Text style={styles.propText}>{text}</Text>
          </View>
        ))}
      </View>

      {/* CTAs */}
      <View style={styles.ctas}>
        <Button
          label="Get started"
          size="lg"
          fullWidth
          onPress={() => router.push('/(auth)/signup')}
        />
        <Button
          label="I already have an account"
          variant="ghost"
          size="lg"
          fullWidth
          onPress={() => router.push('/(auth)/login')}
        />
      </View>

      <Text style={styles.disclaimer}>
        Not a medical device. For reference only.
      </Text>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
    paddingHorizontal: Spacing.lg,
    justifyContent: 'space-between',
    paddingBottom: Spacing.lg,
  },
  hero: {
    alignItems: 'center',
    paddingTop: height * 0.08,
    gap: Spacing.sm,
  },
  logoMark: {
    width: 72,
    height: 72,
    borderRadius: 20,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: Spacing.sm,
  },
  logoText: {
    fontSize: 40,
    fontWeight: FontWeight.bold,
    color: Colors.textInverse,
  },
  appName: {
    fontSize: FontSize['3xl'],
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
    letterSpacing: 6,
  },
  tagline: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    textAlign: 'center',
  },
  props: {
    gap: Spacing.md,
    paddingHorizontal: Spacing.sm,
  },
  propRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: Spacing.md,
  },
  propEmoji: {
    fontSize: 22,
    lineHeight: 28,
  },
  propText: {
    flex: 1,
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    lineHeight: 22,
  },
  ctas: {
    gap: Spacing.sm,
  },
  disclaimer: {
    textAlign: 'center',
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    paddingTop: Spacing.sm,
  },
});
