import { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Image,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { supabase, getCurrentUser } from '@/lib/supabase';
import { imageUriToBase64, uploadImageToSupabase } from '@/lib/imageUtils';
import { showAlert } from '@/lib/toast';
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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const pickImage = async (fromCamera: boolean) => {
    setErrorMsg(null);

    // Camera is native-only — on web always fall back to library picker
    if (fromCamera && Platform.OS === 'web') {
      showAlert('Camera not available', 'Please upload a photo from your library instead.');
      fromCamera = false;
    }

    const permission = fromCamera
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();

    if (!permission.granted) {
      showAlert(
        'Permission required',
        `LIAN needs ${fromCamera ? 'camera' : 'photo library'} access to scan your skin.`,
      );
      return;
    }

    const picked = fromCamera
      ? await ImagePicker.launchCameraAsync({
          mediaTypes: 'images',
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.8,
          // No cameraType — deprecated in SDK 57; front/back chosen by user
        })
      : await ImagePicker.launchImageLibraryAsync({
          mediaTypes: 'images',
          allowsEditing: true,
          aspect: [1, 1],
          quality: 0.8,
        });

    if (!picked.canceled && picked.assets[0]) {
      setImageUri(picked.assets[0].uri);
      setStep('captured');
    }
  };

  const runScan = async () => {
    if (!imageUri) return;
    setStep('analyzing');
    setErrorMsg(null);

    try {
      const user = await getCurrentUser();
      if (!user) throw new Error('Session expired — please sign in again.');

      // ── 1. Convert image to base64 (cross-platform) ──────────────────────
      const base64 = await imageUriToBase64(imageUri);

      // ── 2. Start YouCam analysis (returns task_id immediately) ────────────
      const { data: startData, error: startError } = await supabase.functions.invoke('youcam-scan', {
        body: { action: 'start', imageBase64: base64 },
      });
      if (startError) throw new Error(`Failed to start analysis: ${startError.message}`);
      const taskId = startData?.task_id;
      if (!taskId) throw new Error('No task_id returned from YouCam');

      // ── 3. Poll for YouCam result ─────────────────────────────────────────
      let youcamRaw: Record<string, unknown> | null = null;
      const maxPolls = 30;
      const pollIntervalMs = 2000;

      for (let attempt = 0; attempt < maxPolls; attempt++) {
        const { data: pollData, error: pollError } = await supabase.functions.invoke('youcam-scan', {
          body: { action: 'poll', task_id: taskId },
        });
        if (pollError) throw new Error(`Polling failed: ${pollError.message}`);

        if (pollData?.status === 'completed') {
          youcamRaw = pollData.result as Record<string, unknown>;
          break;
        }
        if (pollData?.status === 'failed') {
          throw new Error(`YouCam analysis failed: ${pollData.error}`);
        }

        // Still processing, wait before next poll
        await new Promise((r) => setTimeout(r, pollIntervalMs));
      }

      if (!youcamRaw) {
        throw new Error('YouCam analysis timed out');
      }

      // ── 4. Get Gemini interpretation ──────────────────────────────────────
      const { data: geminiData, error: geminiError } = await supabase.functions.invoke('gemini-vision', {
        body: {
          imageBase64: base64,
          prompt: `You are a skin analysis expert for the LIAN app. Below are raw skin analysis scores from the YouCam AI API.

Convert these into clear, empathetic, plain-language findings for the user. Format as:
1. A one-paragraph overview of their skin right now
2. A list of their top 3 concerns with a brief explanation of each
3. One key recommendation or takeaway

Do NOT just repeat the scores. Interpret what they mean for a real person.
Do NOT claim to diagnose any medical condition.

YouCam data:
${JSON.stringify(youcamRaw, null, 2)}`,
        },
      });
      if (geminiError) throw new Error(`Interpretation failed: ${geminiError.message}`);
      const interpretation = geminiData?.analysis ?? '';

      // ── 5. Upload image to private storage (cross-platform) ───────────────
      const fileName = `${user.id}/${Date.now()}.jpg`;
      const { signedUrl } = await uploadImageToSupabase(
        imageUri,
        'scan-images',
        fileName,
        supabase,
      );

      // ── 6. Parse YouCam concerns ──────────────────────────────────────────
      const concerns = parseConcerns(youcamRaw);

      // ── 7. Save scan to database ──────────────────────────────────────────
      const { data: scanData, error: dbError } = await supabase
        .from('skin_scans')
        .insert({
          user_id: user.id,
          image_url: signedUrl,
          youcam_raw: youcamRaw,
          concerns,
          ai_interpretation: interpretation,
          skin_type_detected: (youcamRaw as Record<string, string>)?.skin_type ?? 'unknown',
        })
        .select()
        .single();

      if (dbError) throw new Error(`Failed to save scan: ${dbError.message}`);

      // ── 8. Timeline event ─────────────────────────────────────────────────
      await supabase.from('timeline_events').insert({
        user_id: user.id,
        event_type: 'scan',
        title: 'Skin scan completed',
        description: `${concerns.length} concerns tracked`,
        related_scan_id: scanData.id,
      });

      setResult(scanData as SkinScan);
      setStep('result');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMsg(msg);
      setStep('captured'); // go back so they can retry
    }
  };

  const reset = () => {
    setStep('idle');
    setImageUri(null);
    setResult(null);
    setErrorMsg(null);
  };

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Skin Scan</Text>
        <Text style={styles.subtitle}>
          Use a well-lit, front-facing photo for accurate results.
        </Text>

        {/* ── Error banner ── */}
        {errorMsg && (
          <View style={styles.errorBanner}>
            <Text style={styles.errorText}>⚠️ {errorMsg}</Text>
            <TouchableOpacity onPress={() => setErrorMsg(null)} accessibilityRole="button" accessibilityLabel="Dismiss error">
              <Text style={styles.errorDismiss}>✕</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* ── Idle: pick method ── */}
        {step === 'idle' && (
          <>
            <View style={styles.photoOptions}>
              {/* Camera only on native */}
              {Platform.OS !== 'web' && (
                <TouchableOpacity
                  style={styles.photoOption}
                  onPress={() => pickImage(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Take a photo with your camera"
                >
                  <Text style={styles.photoEmoji}>📷</Text>
                  <Text style={styles.photoLabel}>Take photo</Text>
                  <Text style={styles.photoDesc}>Use camera</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.photoOption, Platform.OS === 'web' && styles.photoOptionFull]}
                onPress={() => pickImage(false)}
                accessibilityRole="button"
                accessibilityLabel="Upload a photo from your library"
              >
                <Text style={styles.photoEmoji}>🖼️</Text>
                <Text style={styles.photoLabel}>Upload photo</Text>
                <Text style={styles.photoDesc}>From your library</Text>
              </TouchableOpacity>
            </View>

            <Card>
              <Text style={styles.tipTitle}>Tips for accurate results</Text>
              {[
                '💡 Natural light — face a window',
                '📱 Camera at face level',
                '😐 Neutral expression, no glasses',
                '🚿 Clean bare skin, no makeup',
              ].map((tip) => (
                <Text key={tip} style={styles.tip}>{tip}</Text>
              ))}
            </Card>
          </>
        )}

        {/* ── Captured: preview ── */}
        {(step === 'captured' || step === 'analyzing') && imageUri && (
          <View style={styles.preview}>
            <Image
              source={{ uri: imageUri }}
              style={styles.previewImage}
              accessibilityLabel="Selected skin scan photo"
            />
            {step === 'analyzing' && (
              <View style={styles.analyzingOverlay}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={styles.analyzingText}>Analysing your skin…</Text>
                <Text style={styles.analyzingSubtext}>This takes about 10 seconds</Text>
              </View>
            )}
          </View>
        )}

        {step === 'captured' && (
          <View style={styles.captureActions}>
            <Button label="Retake" variant="secondary" onPress={reset} style={{ flex: 1 }} />
            <Button label="Analyse skin" onPress={runScan} style={{ flex: 2 }} />
          </View>
        )}

        {/* ── Results ── */}
        {step === 'result' && result && (
          <View style={styles.results}>
            <Card>
              <Text style={styles.resultTitle}>Your skin right now</Text>
              <Text style={styles.interpretation}>{result.ai_interpretation}</Text>
            </Card>

            <Text style={styles.concernsTitle}>Concern breakdown</Text>

            {(result.concerns as { concern: string; score: number; severity: string }[]).map((c) => (
              <Card key={c.concern} style={styles.concernCard}>
                <View style={styles.concernHeader}>
                  <View
                    style={[
                      styles.concernBar,
                      { backgroundColor: SEVERITY_COLOR[c.severity] ?? Colors.textTertiary },
                    ]}
                  />
                  <Text style={styles.concernName}>{c.concern.replace(/_/g, ' ')}</Text>
                  <Text
                    style={[
                      styles.concernSeverity,
                      { color: SEVERITY_COLOR[c.severity] ?? Colors.textSecondary },
                    ]}
                  >
                    {c.severity}
                  </Text>
                </View>
                <View style={styles.scoreBarBg}>
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

// ─── Parse YouCam raw response into our concern schema ────────────────────────
function parseConcerns(youcamRaw: Record<string, unknown>) {
  // YouCam SD API shape: { output: [{ type: 'acne', ui_score: 68, raw_score: 57.33 }, ...] }
  const output = youcamRaw?.output as { type: string; ui_score?: number; raw_score?: number }[] | undefined;

  if (Array.isArray(output) && output.length > 0) {
    return output
      .filter((item) => item?.type && (item.ui_score != null || item.raw_score != null))
      .map((item) => {
        const score = Math.min(100, Math.max(0, item.ui_score ?? item.raw_score ?? 0));
        return {
          concern: item.type,
          score,
          severity:
            score >= 70 ? 'severe' :
            score >= 45 ? 'moderate' :
            score >= 20 ? 'mild' : 'none',
        };
      })
      .sort((a, b) => b.score - a.score);
  }

  // Fallback: try flat score map (e.g. { acne: 68, wrinkle: 45 })
  const scoreMap = (
    (youcamRaw?.scores ?? youcamRaw?.results ?? youcamRaw?.data ?? youcamRaw) as Record<string, number>
  );
  return Object.entries(scoreMap)
    .filter(([, score]) => typeof score === 'number')
    .map(([key, score]) => {
      const normalised = Math.min(100, Math.max(0, score));
      return {
        concern: key,
        score: normalised,
        severity:
          normalised >= 70 ? 'severe' :
          normalised >= 45 ? 'moderate' :
          normalised >= 20 ? 'mild' : 'none',
      };
    })
    .sort((a, b) => b.score - a.score);
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  scroll: { padding: Spacing.lg, gap: Spacing.lg, paddingBottom: Spacing.xl },
  title: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  subtitle: { fontSize: FontSize.base, color: Colors.textSecondary, lineHeight: 22, marginTop: -Spacing.sm },
  errorBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    backgroundColor: Colors.errorBg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.error,
    padding: Spacing.md,
    gap: Spacing.sm,
  },
  errorText: { flex: 1, fontSize: FontSize.sm, color: Colors.error, lineHeight: 20 },
  errorDismiss: { fontSize: FontSize.base, color: Colors.error, fontWeight: FontWeight.bold },
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
  photoOptionFull: { flex: undefined, width: '100%' },
  photoEmoji: { fontSize: 32 },
  photoLabel: { fontSize: FontSize.md, fontWeight: FontWeight.semiBold, color: Colors.textPrimary },
  photoDesc: { fontSize: FontSize.xs, color: Colors.textSecondary },
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
  scoreBarBg: { height: 6, backgroundColor: Colors.border, borderRadius: 3, overflow: 'hidden' },
  scoreBarFill: { height: '100%', borderRadius: 3 },
});
