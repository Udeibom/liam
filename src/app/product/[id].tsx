/**
 * Product Detail Screen
 *
 * Lets the user:
 * - See the full product info and ingredient list
 * - Mark the product as stopped (with reason)
 * - Log a reaction they experienced
 * - Log an observed improvement
 * - Re-evaluate the product verdict with updated context
 */
import { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showAlert } from '@/lib/toast';
import { supabase } from '@/lib/supabase';
import { Card, Button } from '@/components/ui';
import { Colors, FontSize, FontWeight, Spacing, Radius } from '@/constants';
import type { Product, ProductVerdict } from '@/types';

const VERDICT_COLOR: Record<ProductVerdict, string> = {
  good: Colors.verdictGood,
  caution: Colors.verdictCaution,
  avoid: Colors.verdictBad,
  unknown: Colors.textTertiary,
};

const VERDICT_EMOJI: Record<ProductVerdict, string> = {
  good: '🟢',
  caution: '🟡',
  avoid: '🔴',
  unknown: '⚪',
};

const REACTION_PRESETS = [
  'Skin became red',
  'Breakouts increased',
  'Burning or stinging',
  'Dry and tight feeling',
  'Itching or rash',
  'Skin became oily',
  'Purging (initial breakouts)',
  'No visible reaction',
];

const IMPROVEMENT_PRESETS = [
  'Skin looks clearer',
  'Dark spots fading',
  'Skin feels more hydrated',
  'Redness reduced',
  'Pores appear smaller',
  'Skin texture improved',
  'More even skin tone',
  'Skin looks brighter',
];

type ModalType = 'stop' | 'reaction' | 'improvement' | null;

export default function ProductDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const [product, setProduct] = useState<Product | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [textInput, setTextInput] = useState('');
  const [selectedPreset, setSelectedPreset] = useState('');

  useEffect(() => {
    const load = async () => {
      if (!id) return;
      const { data } = await supabase
        .from('products')
        .select('*')
        .eq('id', id)
        .single();
      setProduct(data as Product | null);
      setLoading(false);
    };
    load();
  }, [id]);

  const openModal = (type: ModalType) => {
    setTextInput('');
    setSelectedPreset('');
    setActiveModal(type);
  };

  const closeModal = () => {
    setActiveModal(null);
    setTextInput('');
    setSelectedPreset('');
  };

  const getFinalText = () => selectedPreset || textInput.trim();

  const handleStop = async () => {
    const reason = getFinalText();
    if (!product) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('products')
        .update({
          status: 'stopped',
          stopped_at: new Date().toISOString(),
          stop_reason: reason || null,
        })
        .eq('id', product.id);
      if (error) throw error;

      await supabase.from('timeline_events').insert({
        user_id: product.user_id,
        event_type: 'product_stopped',
        title: `Stopped ${product.name}`,
        description: reason ? `Reason: ${reason}` : null,
        related_product_id: product.id,
      });

      setProduct((p) => p ? { ...p, status: 'stopped', stop_reason: reason || null } : p);
      closeModal();
      showAlert('Done', `${product.name} marked as stopped.`);
    } catch (err) {
      showAlert('Error', String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleLogReaction = async () => {
    const reaction = getFinalText();
    if (!reaction || !product) return;
    setSaving(true);
    try {
      const updated = [...(product.reported_reactions ?? []), reaction];
      const { error } = await supabase
        .from('products')
        .update({ reported_reactions: updated })
        .eq('id', product.id);
      if (error) throw error;

      await supabase.from('timeline_events').insert({
        user_id: product.user_id,
        event_type: 'reaction_reported',
        title: `Reaction reported for ${product.name}`,
        description: reaction,
        related_product_id: product.id,
      });

      setProduct((p) => p ? { ...p, reported_reactions: updated } : p);
      closeModal();
    } catch (err) {
      showAlert('Error', String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleLogImprovement = async () => {
    const improvement = getFinalText();
    if (!improvement || !product) return;
    setSaving(true);
    try {
      const updated = [...(product.reported_improvements ?? []), improvement];
      const { error } = await supabase
        .from('products')
        .update({ reported_improvements: updated })
        .eq('id', product.id);
      if (error) throw error;

      setProduct((p) => p ? { ...p, reported_improvements: updated } : p);
      closeModal();
    } catch (err) {
      showAlert('Error', String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleReactivate = async () => {
    if (!product) return;
    setSaving(true);
    try {
      const { error } = await supabase
        .from('products')
        .update({
          status: 'active',
          stopped_at: null,
          stop_reason: null,
          started_at: new Date().toISOString(),
        })
        .eq('id', product.id);
      if (error) throw error;

      await supabase.from('timeline_events').insert({
        user_id: product.user_id,
        event_type: 'product_added',
        title: `Restarted ${product.name}`,
        related_product_id: product.id,
      });

      setProduct((p) => p ? { ...p, status: 'active' } : p);
      showAlert('Done', `${product.name} is now active again.`);
    } catch (err) {
      showAlert('Error', String(err));
    } finally {
      setSaving(false);
    }
  };

  if (loading || !product) {
    return (
      <View style={styles.loader}>
        <ActivityIndicator size="large" color={Colors.primary} />
      </View>
    );
  }

  const isActive = product.status === 'active';

  return (
    <SafeAreaView style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Go back"
        >
          <Text style={styles.backBtn}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={1}>{product.name}</Text>
        <View style={{ width: 48 }} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        {/* Identity */}
        <View style={styles.identity}>
          <View style={styles.productIcon}>
            <Text style={{ fontSize: 36 }}>🧴</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.productName}>{product.name}</Text>
            {product.brand && <Text style={styles.productBrand}>{product.brand}</Text>}
            <View style={styles.metaRow}>
              <Text style={styles.metaChip}>{product.category}</Text>
              <Text
                style={[
                  styles.metaChip,
                  { color: product.status === 'active' ? Colors.success : Colors.textTertiary },
                ]}
              >
                {product.status}
              </Text>
            </View>
          </View>
          <Text style={styles.verdictBig}>{VERDICT_EMOJI[product.verdict]}</Text>
        </View>

        {/* Verdict */}
        {product.verdict_reason && (
          <Card style={styles.verdictCard}>
            <Text style={[styles.verdictLabel, { color: VERDICT_COLOR[product.verdict] }]}>
              {VERDICT_EMOJI[product.verdict]}{' '}
              {product.verdict === 'good' && 'Good fit'}
              {product.verdict === 'caution' && 'Consider carefully'}
              {product.verdict === 'avoid' && 'Probably not right now'}
              {product.verdict === 'unknown' && 'Not yet assessed'}
            </Text>
            <Text style={styles.verdictReason}>{product.verdict_reason}</Text>
          </Card>
        )}

        {/* Dates */}
        <Card>
          {product.started_at && (
            <View style={styles.dateRow}>
              <Text style={styles.dateLabel}>Started using</Text>
              <Text style={styles.dateValue}>
                {new Date(product.started_at).toLocaleDateString('en-GB', {
                  day: 'numeric', month: 'short', year: 'numeric',
                })}
              </Text>
            </View>
          )}
          {product.stopped_at && (
            <View style={styles.dateRow}>
              <Text style={styles.dateLabel}>Stopped</Text>
              <Text style={styles.dateValue}>
                {new Date(product.stopped_at).toLocaleDateString('en-GB', {
                  day: 'numeric', month: 'short', year: 'numeric',
                })}
              </Text>
            </View>
          )}
          {product.stop_reason && (
            <View style={styles.dateRow}>
              <Text style={styles.dateLabel}>Reason stopped</Text>
              <Text style={[styles.dateValue, { flex: 1, textAlign: 'right' }]}>
                {product.stop_reason}
              </Text>
            </View>
          )}
        </Card>

        {/* Reactions */}
        {product.reported_reactions.length > 0 && (
          <Card>
            <Text style={styles.sectionTitle}>⚠️ Reported reactions</Text>
            {product.reported_reactions.map((r, i) => (
              <Text key={i} style={styles.tagItem}>• {r}</Text>
            ))}
          </Card>
        )}

        {/* Improvements */}
        {product.reported_improvements.length > 0 && (
          <Card>
            <Text style={styles.sectionTitle}>✅ Observed improvements</Text>
            {product.reported_improvements.map((r, i) => (
              <Text key={i} style={styles.tagItem}>• {r}</Text>
            ))}
          </Card>
        )}

        {/* Ingredients */}
        {product.ingredients.length > 0 && (
          <Card>
            <Text style={styles.sectionTitle}>Ingredients ({product.ingredients.length})</Text>
            <Text style={styles.ingredientsList}>{product.ingredients.join(', ')}</Text>
          </Card>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          <Button
            label="⚠️  Log a reaction"
            variant="secondary"
            fullWidth
            onPress={() => openModal('reaction')}
          />
          <Button
            label="✅  Log an improvement"
            variant="secondary"
            fullWidth
            onPress={() => openModal('improvement')}
          />
          {isActive ? (
            <Button
              label="🚫  Mark as stopped"
              variant="danger"
              fullWidth
              onPress={() => openModal('stop')}
            />
          ) : (
            <Button
              label="▶️  Reactivate"
              variant="secondary"
              fullWidth
              loading={saving}
              onPress={handleReactivate}
            />
          )}
        </View>
      </ScrollView>

      {/* ── Modal ── */}
      <Modal
        visible={activeModal !== null}
        animationType="slide"
        transparent
        onRequestClose={closeModal}
      >
        <View style={styles.modalOverlay}>
          <SafeAreaView style={styles.modalSheet}>
            <View style={styles.modalHandle} />

            <Text style={styles.modalTitle}>
              {activeModal === 'stop' && 'Why are you stopping this product?'}
              {activeModal === 'reaction' && 'What reaction did you notice?'}
              {activeModal === 'improvement' && 'What improvement did you observe?'}
            </Text>
            <Text style={styles.modalSubtitle}>
              {activeModal === 'stop' && 'This helps LIAN understand your reaction history.'}
              {activeModal === 'reaction' && 'LIAN will flag products with similar ingredients in the future.'}
              {activeModal === 'improvement' && 'LIAN will track which products are helping your skin.'}
            </Text>

            <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
              {/* Preset options */}
              <View style={styles.presets}>
                {(activeModal === 'reaction'
                  ? REACTION_PRESETS
                  : activeModal === 'improvement'
                  ? IMPROVEMENT_PRESETS
                  : ['Finished the product', 'Caused irritation', 'No visible results', 'Too expensive', 'Switching to something else']
                ).map((opt) => (
                  <TouchableOpacity
                    key={opt}
                    style={[styles.preset, selectedPreset === opt && styles.presetSelected]}
                    onPress={() => { setSelectedPreset(opt); setTextInput(''); }}
                    accessibilityRole="radio"
                    accessibilityLabel={opt}
                    accessibilityState={{ checked: selectedPreset === opt }}
                  >
                    <Text style={[styles.presetText, selectedPreset === opt && styles.presetTextSelected]}>
                      {opt}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>

              <TextInput
                style={[styles.textInput, !selectedPreset && textInput && styles.textInputActive]}
                value={textInput}
                onChangeText={(t) => { setTextInput(t); setSelectedPreset(''); }}
                placeholder="Or describe it in your own words…"
                placeholderTextColor={Colors.textTertiary}
                multiline
              />
            </ScrollView>

            <View style={styles.modalActions}>
              <Button
                label={saving ? 'Saving…' : (
                  activeModal === 'stop' ? 'Mark as stopped' :
                  activeModal === 'reaction' ? 'Log reaction' : 'Log improvement'
                )}
                fullWidth
                loading={saving}
                disabled={!getFinalText() && activeModal !== 'stop'}
                onPress={
                  activeModal === 'stop' ? handleStop :
                  activeModal === 'reaction' ? handleLogReaction : handleLogImprovement
                }
              />
              <Button label="Cancel" variant="ghost" fullWidth onPress={closeModal} />
            </View>
          </SafeAreaView>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  loader: { flex: 1, backgroundColor: Colors.bg, alignItems: 'center', justifyContent: 'center' },
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
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: FontSize.md,
    fontWeight: FontWeight.semiBold,
    color: Colors.textPrimary,
    marginHorizontal: Spacing.sm,
  },
  scroll: { padding: Spacing.lg, gap: Spacing.md, paddingBottom: Spacing.xl },
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.md,
  },
  productIcon: {
    width: 64,
    height: 64,
    borderRadius: Radius.lg,
    backgroundColor: Colors.bgCard,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productName: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  productBrand: { fontSize: FontSize.sm, color: Colors.textTertiary, marginTop: 2 },
  metaRow: { flexDirection: 'row', gap: Spacing.xs, marginTop: Spacing.xs },
  metaChip: {
    fontSize: FontSize.xs,
    color: Colors.textTertiary,
    backgroundColor: Colors.bgElevated,
    paddingHorizontal: Spacing.sm,
    paddingVertical: 2,
    borderRadius: Radius.full,
    textTransform: 'capitalize',
    overflow: 'hidden',
  },
  verdictBig: { fontSize: 32 },
  verdictCard: { gap: Spacing.xs },
  verdictLabel: { fontSize: FontSize.md, fontWeight: FontWeight.bold },
  verdictReason: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },
  dateRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: Spacing.xs,
    borderBottomWidth: 1,
    borderBottomColor: Colors.borderSubtle,
  },
  dateLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  dateValue: { fontSize: FontSize.sm, color: Colors.textPrimary, fontWeight: FontWeight.medium },
  sectionTitle: {
    fontSize: FontSize.base,
    fontWeight: FontWeight.semiBold,
    color: Colors.textPrimary,
    marginBottom: Spacing.sm,
  },
  tagItem: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 22 },
  ingredientsList: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },
  actions: { gap: Spacing.sm },
  modalOverlay: {
    flex: 1,
    backgroundColor: Colors.overlay,
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: Colors.bgElevated,
    borderTopLeftRadius: Radius.xl,
    borderTopRightRadius: Radius.xl,
    paddingHorizontal: Spacing.lg,
    paddingBottom: Spacing.lg,
    maxHeight: '85%',
    gap: Spacing.md,
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginTop: Spacing.md,
  },
  modalTitle: {
    fontSize: FontSize.lg,
    fontWeight: FontWeight.bold,
    color: Colors.textPrimary,
  },
  modalSubtitle: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20, marginTop: -Spacing.sm },
  presets: { flexDirection: 'row', flexWrap: 'wrap', gap: Spacing.sm, marginBottom: Spacing.md },
  preset: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bgCard,
  },
  presetSelected: { borderColor: Colors.primary, backgroundColor: Colors.bgCard },
  presetText: { fontSize: FontSize.sm, color: Colors.textSecondary },
  presetTextSelected: { color: Colors.primary, fontWeight: FontWeight.medium },
  textInput: {
    backgroundColor: Colors.bgInput,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.border,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.sm,
    fontSize: FontSize.base,
    color: Colors.textPrimary,
    minHeight: 80,
    marginBottom: Spacing.md,
  },
  textInputActive: { borderColor: Colors.primary },
  modalActions: { gap: Spacing.sm },
});
