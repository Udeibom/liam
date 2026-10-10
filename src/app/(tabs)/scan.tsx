import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Alert,
  Image,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { supabase } from '@/lib/supabase';
import { Button, Card } from '@/components/ui';
import { Colors, FontSize, FontWeight, Spacing, Radius } from '@/constants';
import type { SkinScan } from '@/types';

type ScanStep = 'idle' | 'captured' | 'analyzing' | 'result';

const SEVERITY_COLOR: Record<string, string> = {
  none: Colors.concernNone,
  mild: Colors.concernLow,
  moderate: Colors.concernMedium,
  severe: Colors.concernHigh,
};

export default function ScanScreen() {
  const [step, setStep] = useState<ScanStep>('idle');
  const [imageUri, setImageUri] = useState<string | null>(null);
  const [result, setResult] = useState<SkinScan | null>(null);

  const pickImage = async (fromCamera: boolean) => {
    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      Alert.alert(
        'Permission required',
        `LIAN needs ${fromCamera ? 'camera' : 'photo library'} access to scan your skin.`,
      );
      return;
    }

    const result = fromCamera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: 'images',
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.8,
          cameraType: ImagePicker.CameraType.front,
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: 'images',
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.8,
        });

    if (!result.canceled && result.assets[0]) {
      setImageUri(result.assets[0].uri);
      setStep('captured');
    }
  };

  const runScan = async () => {
    if (!imageUri) return;
    setStep('analyzing');

    try {
      // Convert image to base64
      const response = await fetch(imageUri);
      const blob = await response.blob();
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]); // strip data:image/...;base64, prefix
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
      });

      // Call YouCam + Gemini via edge function
      const { data: fnData, error: fnError } = await supabase.functions.invoke('youcam-scan', {
        body: { imageBase64: base64 },
      });

      if (fnError) throw fnError;

      const { youcamRaw, interpretation } = fnData;

      // Upload image to storage
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Not authenticated');

      const fileName = `${user.id}/${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from('scan-images')
        .upload(fileName, blob, { contentType: 'image/jpeg' });

      if (uploadError) throw uploadError;

      const { data: { publicUrl } } = supabase.storage
        .from('scan-images')
        .getPublicUrl(fileName);

      // Parse YouCam concerns into our schema
      const concerns = parseConcerns(youcamRaw);

      // Save scan to database
      const { data: scanData, error: dbError } = await supabase
        .from('skin_scans')
        .insert({
          user_id: user.id,
          image_url: publicUrl,
          youcam_raw: youcamRaw,
          concerns,
          ai_interpretation: interpretation,
          skin_type_detected: (youcamRaw as any)?.skin_type ?? 'unknown',
        })
        .select()
        .single();

      if (dbError) throw dbError;

      // Log timeline event
      await supabase.from('timeline_events').insert({
        user_id: user.id,
        event_type: 'scan',
        title: 'Skin scan completed',
        description: 'New skin analysis recorded',
        related_scan_id: scanData.id,
      });

      setResult(scanData as SkinScan);
      setStep('result');
    } catch (err) {
      Alert.alert('Scan failed', String(err));
      setStep('captured');
    }
  };

  const reset = () => {
    setStep('idle');
    setImageUri(null);
    setResult(null);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Skin Scan</Text>
        <Text style={styles.subtitle}>
          Take a well-lit, front-facing photo for the most accurate results.
        </Text>

        {/* Idle state */}
        {step === 'idle' && (
          <View style={styles.photoOptions}>
            <TouchableOpacity
              style={styles.photoOption}
              onPress={() => pickImage(true)}
              accessibilityRole="button"
              accessibilityLabel="Take a photo with your camera"
            >
              <Text style={styles.photoOptionEmoji}>📷</Text>
              <Text style={styles.photoOptionLabel}>Take photo</Text>
              <Text style={styles.photoOptionDesc}>Use front camera</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.photoOption}
              onPress={() => pickImage(false)}
              accessibilityRole="button"
              accessibilityLabel="Upload a photo from your library"
            >
              <Text style={styles.photoOptionEmoji}>🖼️</Text>
              <Text style={styles.photoOptionLabel}>Upload photo</Text>
              <Text style={styles.photoOptionDesc}>From your library</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Photo tips */}
        {step === 'idle' && (
          <Card>
            <Text style={styles.tipTitle}>Tips for accurate results</Text>
            {[
              '💡 Good, natural lighting — face a window',
              '📱 Hold the camera at face level',
              '😐 Neutral expression, no glasses',
              '🚿 Clean, bare skin (no makeup)',
            ].map((tip) => (
              <Text key={tip} style={styles.tip}>{tip}</Text>
            ))}
          </Card>
        )}

        {/* Captured — preview */}
        {(step === 'captured' || step === 'analyzing') && imageUri && (
          <View style={styles.preview}>
            <Image source={{ uri: imageUri }} style={styles.previewImage} />
            {step === 'analyzing' && (
              <View style={styles.analyzingOverlay}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={styles.analyzingText}>Analyzing your skin…</Text>
                <Text style={styles.analyzingSubtext}>This takes about 10 seconds</Text>
              </View>
            )}
          </View>
        )}

        {step === 'captured' && (
          <View style={styles.captureActions}>
            <Button label="Retake" variant="secondary" onPress={reset} style={{ flex: 1 }} />
            <Button label="Analyze skin" onPress={runScan} style={{ flex: 2 }} />
          </View>
        )}

        {/* Results */}
        {step === 'result' && result && (
          <View style={styles.results}>
            <Card>
              <Text style={styles.resultTitle}>Your skin right now</Text>
              <Text style={styles.interpretation}>{result.ai_interpretation}</Text>
            </Card>

            <Text style={styles.concernsTitle}>Concern breakdown</Text>
            {result.concerns.map((c) => (
              <Card key={c.concern} style={styles.concernCard}>
                <View style={styles.concernHeader}>
                  <View
                    style={[
                      styles.concernBar,
                      { backgroundColor: SEVERITY_COLOR[c.severity] ?? Colors.textTertiary },
                    ]}
                  />
                  <Text style={styles.concernName}>
                    {c.concern.replace(/_/g, ' ')}
                  </Text>
                  <Text
                    style={[
                      styles.concernSeverity,
                      { color: SEVERITY_COLOR[c.severity] ?? Colors.textSecondary },
                    ]}
                  >
                    {c.severity}
                  </Text>
                </View>
                <View style={styles.scoreBar}>
                  <View
                    style={[
                      styles.scoreBarFill,
                      {
                        width: `${c.score}%` as unknown as number,
                        backgroundColor: SEVERITY_COLOR[c.severity] ?? Colors.primary,
                      },
                    ]}
                  />
                </View>
              </Card>
            ))}

            <Button label="Scan again" variant="secondary" fullWidth onPress={reset} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function parseConcerns(youcamRaw: Record<string, unknown>) {
  // YouCam returns different structures depending on API version.
  // This handles the most common shape.
  const concerns = [];
  const scoreMap = (youcamRaw?.scores ?? youcamRaw?.results ?? {}) as Record<string, number>;

  for (const [key, score] of Object.entries(scoreMap)) {
    if (typeof score !== 'number') continue;
    const normalised = Math.min(100, Math.max(0, score));
    concerns.push({
      concern: key,
      score: normalised,
      severity:
        normalised >= 70 ? 'severe'
        : normalised >= 45 ? 'moderate'
        : normalised >= 20 ? 'mild'
        : 'none',
    });
  }

  return concerns.sort((a, b) => b.score - a.score);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  scroll: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing.xl },
  title: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: FontSize.base, color: Colors.textSecondary, lineHeight: 22, marginTop: -Spacing.sm },
  photoOptions: { flexDirection: 'row', gap: Spacing.md },
  photoOption: {
    flex: 1,
    backgroundColor: Colors.bgCard,
    borderRadius: Radius.lg,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: Spacing.md,
    alignItems: 'center',
    gap: Spacing.xs,
  },
  photoOptionEmoji: { fontSize: 32 },
  photoOptionLabel: { fontSize: FontSize.md, fontWeight: FontWeight.semiBold, color: Colors.textPrimary },
  photoOptionDesc: { fontSize: FontSize.xs, color: Colors.textSecondary },
  tipTitle: { fontSize: FontSize.base, fontWeight: FontWeight.semiBold, color: Colors.textPrimary, marginBottom: Spacing.sm },
  tip: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 22 },
  preview: { borderRadius: Radius.lg, overflow: 'hidden', position: 'relative' },
  previewImage: { width: '100%', aspectRatio: 1, borderRadius: Radius.lg },
  analyzingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: Colors.overlay,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
    gap: Spacing.sm,
    borderRadius: Radius.lg,
  },
  analyzingText: { color: Colors.textPrimary, fontSize: FontSize.md, fontWeight: FontWeight.semiBold },
  analyzingSubtext: { color: Colors.textSecondary, fontSize: FontSize.sm },
  captureActions: { flexDirection: 'row', gap: Spacing.sm },
  results: { gap: Spacing.md },
  resultTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textPrimary, marginBottom: Spacing.sm },
  interpretation: { fontSize: FontSize.base, color: Colors.textSecondary, lineHeight: 24 },
  concernsTitle: { fontSize: FontSize.md, fontWeight: FontWeight.semiBold, color: Colors.textPrimary },
  concernCard: { gap: Spacing.sm },
  concernHeader: { flexDirection: 'row', alignItems: 'center', gap: Spacing.sm },
  concernBar: { width: 4, height: 20, borderRadius: 2 },
  concernName: { flex: 1, fontSize: FontSize.base, color: Colors.textPrimary, textTransform: 'capitalize' },
  concernSeverity: { fontSize: FontSize.sm, fontWeight: FontWeight.medium, textTransform: 'capitalize' },
  scoreBar: {
    height: 6,
    backgroundColor: Colors.border,
    borderRadius: 3,
    overflow: 'hidden',
  },
  scoreBarFill: { height: '100%', borderRadius: 3 },
});
