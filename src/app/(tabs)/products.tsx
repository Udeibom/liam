/* eslint-disable react-hooks/set-state-in-effect */
import { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import { router } from 'expo-router';
import { supabase, getCurrentUser } from '@/lib/supabase';
import { imageUriToBase64 } from '@/lib/imageUtils';
import { showAlert } from '@/lib/toast';
import { Button, Card } from '@/components/ui';
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

type ScanMode = 'front' | 'ingredients' | 'analyzing' | 'result';

interface ScannedProduct {
  name: string;
  brand: string;
  ingredients: string[];
  imageUri: string;
  verdict: ProductVerdict;
  verdictReason: string;
  cautionIngredients: string[];
}

export default function ProductsScreen() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanModalVisible, setScanModalVisible] = useState(false);
  const [scanMode, setScanMode] = useState<ScanMode>('front');
  const [scannedProduct, setScannedProduct] = useState<Partial<ScannedProduct>>({});
  const [activeFilter, setActiveFilter] = useState<'active' | 'stopped' | 'all'>('active');

  const loadProducts = useCallback(async () => {
    setLoading(true);
    const user = await getCurrentUser();
    if (!user) {
      setLoading(false);
      return;
    }

    const query = supabase
      .from('products')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (activeFilter !== 'all') {
      query.eq('status', activeFilter);
    }

    const { data } = await query;
    setProducts((data ?? []) as Product[]);
    setLoading(false);
  }, [activeFilter]);

  useEffect(() => { loadProducts(); }, [loadProducts]);

  const startProductScan = () => {
    setScannedProduct({});
    setScanMode('front');
    setScanModalVisible(true);
  };

  const captureImage = async () => {
    const perm = await ImagePicker.requestCameraPermissionsAsync();
    if (!perm.granted) {
      showAlert('Permission needed', 'Camera access is required to scan products.');
      return;
    }

    const result = await ImagePicker.launchCameraAsync({
      mediaTypes: 'images',
      quality: 0.85,
      allowsEditing: false,
    });

    if (result.canceled || !result.assets[0]) return;
    const uri = result.assets[0].uri;

    if (scanMode === 'front') {
      setScanMode('analyzing');
      await identifyProduct(uri);
    } else {
      setScanMode('analyzing');
      await extractIngredients(uri);
    }
  };

  const identifyProduct = async (uri: string) => {
    try {
      const base64 = await imageUriToBase64(uri);

      const { data, error } = await supabase.functions.invoke('gemini-vision', {
        body: {
          imageBase64: base64,
          prompt: `Identify this skincare product. Return JSON only with keys: name (string), brand (string). If you cannot identify it, return { "name": "Unknown product", "brand": "" }`,
        },
      });

      if (error) throw error;

      let parsed: { name: string; brand: string } = { name: 'Unknown product', brand: '' };
      try {
        const text: string = data.analysis;
        const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        parsed = JSON.parse(cleaned);
      } catch {
        // non-fatal, use defaults
      }

      setScannedProduct((prev) => ({
        ...prev,
        name: parsed.name,
        brand: parsed.brand,
        imageUri: uri,
      }));
      setScanMode('ingredients');
    } catch {
      showAlert('Error', 'Could not identify the product. Please try again.');
      setScanMode('front');
    }
  };

  const extractIngredients = async (uri: string) => {
    try {
      const base64 = await imageUriToBase64(uri);

      const { data, error } = await supabase.functions.invoke('extract-ingredients', {
        body: { imageBase64: base64 },
      });

      if (error) throw error;

      const ingredients: string[] = data.ingredients ?? [];

      // Now get verdict from Groq, passing skin profile + previous reaction history
      const user = await getCurrentUser();

      const [profileRes, reactedProductsRes] = await Promise.all([
        supabase.from('skin_profiles').select('*').eq('user_id', user!.id).single(),
        // Fetch all products where user reported reactions — this is the blacklist
        supabase
          .from('products')
          .select('name, ingredients, reported_reactions')
          .eq('user_id', user!.id)
          .not('reported_reactions', 'eq', '{}'),
      ]);

      // Build a caution list: ingredients from previously reacted-to products
      const reactedProducts = reactedProductsRes.data ?? [];
      const cautionIngredients: string[] = [];
      const cautionContext = reactedProducts
        .filter((p) => (p.reported_reactions as string[]).length > 0)
        .map((p) => {
          const sharedIngredients = (p.ingredients as string[]).filter((ing) =>
            ingredients.some(
              (newIng) =>
                newIng.toLowerCase().includes(ing.toLowerCase()) ||
                ing.toLowerCase().includes(newIng.toLowerCase()),
            ),
          );
          if (sharedIngredients.length > 0) {
            cautionIngredients.push(...sharedIngredients);
            return `Previously reacted to "${p.name}" which contains: ${sharedIngredients.join(', ')}`;
          }
          return null;
        })
        .filter(Boolean)
        .join('\n');

      const blacklistWarning = cautionContext
        ? `\n\nIMPORTANT — INGREDIENT CAUTION:\n${cautionContext}\nThis new product shares those ingredients. Flag this prominently in your verdict.`
        : '';

      const { data: verdictData } = await supabase.functions.invoke('groq-chat', {
        body: {
          messages: [
            {
              role: 'user',
              content: `Evaluate this skincare product for the user.

Product: ${scannedProduct.name ?? 'Unknown'} by ${scannedProduct.brand ?? 'Unknown brand'}
Ingredients: ${ingredients.slice(0, 30).join(', ')}${blacklistWarning}

Return JSON only with these exact keys:
{
  "verdict": "good" | "caution" | "avoid",
  "reason": "one or two sentences explaining the verdict based on this user's specific skin profile and reaction history"
}`,
            },
          ],
          skinContext: { profile: profileRes.data },
        },
      });

      let verdict: ProductVerdict = 'unknown';
      let verdictReason = '';
      try {
        const text: string = verdictData.reply;
        const cleaned = text.replace(/```json?\n?/g, '').replace(/```/g, '').trim();
        const parsed = JSON.parse(cleaned);
        verdict = parsed.verdict ?? 'unknown';
        verdictReason = parsed.reason ?? '';
      } catch {
        // non-fatal
      }

      setScannedProduct((prev) => ({
        ...prev,
        ingredients,
        verdict,
        verdictReason,
        cautionIngredients,
      }));
      setScanMode('result');
    } catch {
      showAlert('Error', 'Could not extract ingredients. Please try again.');
      setScanMode('ingredients');
    }
  };

  const saveProduct = async () => {
    try {
      const user = await getCurrentUser();
      if (!user) return;

      const { error } = await supabase.from('products').insert({
        user_id: user.id,
        name: scannedProduct.name ?? 'Unknown',
        brand: scannedProduct.brand ?? null,
        category: 'other',
        ingredients: scannedProduct.ingredients ?? [],
        status: 'active',
        started_at: new Date().toISOString(),
        verdict: scannedProduct.verdict ?? 'unknown',
        verdict_reason: scannedProduct.verdictReason ?? null,
      });

      if (error) throw error;

      // Timeline event
      await supabase.from('timeline_events').insert({
        user_id: user.id,
        event_type: 'product_added',
        title: `Added ${scannedProduct.name}`,
        description: `Started using ${scannedProduct.brand ? scannedProduct.brand + ' ' : ''}${scannedProduct.name}`,
      });

      setScanModalVisible(false);
      loadProducts();
    } catch (_err) {
      showAlert('Error saving product', String(_err));
    }
  };

  const renderProduct = ({ item }: { item: Product }) => (
    <TouchableOpacity
      onPress={() => router.push(`/product/${item.id}` as never)}
      accessibilityRole="button"
      accessibilityLabel={`View ${item.name} details`}
    >
      <Card style={styles.productCard}>
        <View style={styles.productRow}>
          <View style={styles.productEmoji}>
            <Text style={{ fontSize: 24 }}>🧴</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.productName}>{item.name}</Text>
            {item.brand && <Text style={styles.productBrand}>{item.brand}</Text>}
            <Text style={styles.productCat}>{item.category}</Text>
          </View>
          <Text style={styles.verdictEmoji}>{VERDICT_EMOJI[item.verdict]}</Text>
        </View>
        {item.verdict_reason && (
          <Text style={[styles.verdictReason, { color: VERDICT_COLOR[item.verdict] }]}>
            {item.verdict_reason}
          </Text>
        )}
      </Card>
    </TouchableOpacity>
  );

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>Product Library</Text>
        <TouchableOpacity
          style={styles.addBtn}
          onPress={startProductScan}
          accessibilityRole="button"
          accessibilityLabel="Scan a new product"
        >
          <Text style={styles.addBtnText}>+ Scan</Text>
        </TouchableOpacity>
      </View>

      {/* Filter tabs */}
      <View style={styles.filters}>
        {(['active', 'stopped', 'all'] as const).map((f) => (
          <TouchableOpacity
            key={f}
            style={[styles.filterChip, activeFilter === f && styles.filterChipActive]}
            onPress={() => setActiveFilter(f)}
            accessibilityRole="tab"
            accessibilityLabel={f}
            accessibilityState={{ selected: activeFilter === f }}
          >
            <Text style={[styles.filterLabel, activeFilter === f && styles.filterLabelActive]}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {loading ? (
        <ActivityIndicator style={{ marginTop: Spacing.xl }} color={Colors.primary} />
      ) : (
        <FlatList
          data={products}
          renderItem={renderProduct}
          keyExtractor={(p) => p.id}
          contentContainerStyle={styles.list}
          ListEmptyComponent={
            <View style={styles.empty}>
              <Text style={styles.emptyEmoji}>🧴</Text>
              <Text style={styles.emptyTitle}>No products yet</Text>
              <Text style={styles.emptyText}>
                Scan a product to add it to your library. LIAN will evaluate whether it&apos;s right for your skin.
              </Text>
              <Button label="Scan your first product" onPress={startProductScan} />
            </View>
          }
        />
      )}

      {/* Product scan modal */}
      <Modal
        visible={scanModalVisible}
        animationType="slide"
        onRequestClose={() => setScanModalVisible(false)}
      >
        <SafeAreaView style={styles.modal}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>
              {scanMode === 'front' && 'Step 1: Photograph product'}
              {scanMode === 'ingredients' && 'Step 2: Photograph ingredients'}
              {scanMode === 'analyzing' && 'Analyzing…'}
              {scanMode === 'result' && 'Product verdict'}
            </Text>
            <TouchableOpacity
              onPress={() => setScanModalVisible(false)}
              accessibilityRole="button"
              accessibilityLabel="Close"
            >
              <Text style={styles.modalClose}>✕</Text>
            </TouchableOpacity>
          </View>

          <ScrollView contentContainerStyle={styles.modalContent}>
            {scanMode === 'front' && (
              <>
                <Text style={styles.modalDesc}>
                  Take a photo of the front of the product so LIAN can identify it.
                </Text>
                <Button label="📷  Take photo" size="lg" fullWidth onPress={captureImage} />
              </>
            )}

            {scanMode === 'ingredients' && (
              <>
                {scannedProduct.name && (
                  <Card style={{ marginBottom: Spacing.md }}>
                    <Text style={styles.productName}>{scannedProduct.name}</Text>
                    {scannedProduct.brand && (
                      <Text style={styles.productBrand}>{scannedProduct.brand}</Text>
                    )}
                  </Card>
                )}
                <Text style={styles.modalDesc}>
                  Now photograph the back/side of the product showing the ingredients list.
                </Text>
                <Button label="📷  Photograph ingredients" size="lg" fullWidth onPress={captureImage} />
              </>
            )}

            {scanMode === 'analyzing' && (
              <View style={styles.analyzingContainer}>
                <ActivityIndicator size="large" color={Colors.primary} />
                <Text style={styles.analyzingText}>Analyzing product…</Text>
                <Text style={styles.analyzingSubtext}>
                  LIAN is checking the ingredients against your skin profile
                </Text>
              </View>
            )}

            {scanMode === 'result' && (
              <>
                <View
                  style={[
                    styles.verdictBanner,
                    {
                      borderColor:
                        VERDICT_COLOR[scannedProduct.verdict ?? 'unknown'],
                      backgroundColor:
                        scannedProduct.verdict === 'good'
                          ? Colors.successBg
                          : scannedProduct.verdict === 'caution'
                          ? Colors.warningBg
                          : scannedProduct.verdict === 'avoid'
                          ? Colors.errorBg
                          : Colors.bgCard,
                    },
                  ]}
                >
                  <Text style={styles.verdictBannerEmoji}>
                    {VERDICT_EMOJI[scannedProduct.verdict ?? 'unknown']}
                  </Text>
                  <View>
                    <Text
                      style={[
                        styles.verdictLabel,
                        { color: VERDICT_COLOR[scannedProduct.verdict ?? 'unknown'] },
                      ]}
                    >
                      {scannedProduct.verdict === 'good' && 'Good fit'}
                      {scannedProduct.verdict === 'caution' && 'Consider carefully'}
                      {scannedProduct.verdict === 'avoid' && 'Probably not right now'}
                      {scannedProduct.verdict === 'unknown' && 'Unable to assess'}
                    </Text>
                    <Text style={styles.verdictReasonText}>{scannedProduct.verdictReason}</Text>
                  </View>
                </View>

                <Card>
                  <Text style={styles.ingredientsTitle}>
                    Ingredients ({scannedProduct.ingredients?.length ?? 0})
                  </Text>
                  <Text style={styles.ingredientsList}>
                    {scannedProduct.ingredients?.slice(0, 15).join(', ')}
                    {(scannedProduct.ingredients?.length ?? 0) > 15 && '…'}
                  </Text>
                </Card>

                {/* Blacklist / caution banner */}
                {(scannedProduct.cautionIngredients?.length ?? 0) > 0 && (
                  <View style={styles.blacklistBanner}>
                    <Text style={styles.blacklistTitle}>⚠️ Ingredient caution</Text>
                    <Text style={styles.blacklistText}>
                      You previously reported a reaction to a product containing{' '}
                      <Text style={styles.blacklistIngredients}>
                        {scannedProduct.cautionIngredients?.join(', ')}
                      </Text>
                      . This product also contains it. You may want to avoid it or patch-test first.
                    </Text>
                  </View>
                )}

                <View style={styles.resultActions}>
                  <Button
                    label="Add to my library"
                    fullWidth
                    onPress={saveProduct}
                  />
                  <Button
                    label="Discard"
                    variant="ghost"
                    fullWidth
                    onPress={() => setScanModalVisible(false)}
                  />
                </View>
              </>
            )}
          </ScrollView>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}



const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.bg },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.lg,
    paddingBottom: Spacing.sm,
  },
  title: { fontSize: FontSize.xl, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  addBtn: {
    backgroundColor: Colors.primary,
    borderRadius: Radius.full,
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
  },
  addBtnText: { fontSize: FontSize.sm, color: Colors.textInverse, fontWeight: FontWeight.semiBold },
  filters: {
    flexDirection: 'row',
    paddingHorizontal: Spacing.lg,
    gap: Spacing.sm,
    paddingBottom: Spacing.sm,
  },
  filterChip: {
    paddingHorizontal: Spacing.md,
    paddingVertical: Spacing.xs,
    borderRadius: Radius.full,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.bgCard,
  },
  filterChipActive: { borderColor: Colors.primary, backgroundColor: Colors.bgElevated },
  filterLabel: { fontSize: FontSize.sm, color: Colors.textSecondary },
  filterLabelActive: { color: Colors.primary, fontWeight: FontWeight.medium },
  list: { padding: Spacing.lg, gap: Spacing.sm, paddingBottom: Spacing.xl },
  empty: { alignItems: 'center', gap: Spacing.md, paddingTop: Spacing.xl },
  emptyEmoji: { fontSize: 48 },
  emptyTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  emptyText: {
    fontSize: FontSize.base,
    color: Colors.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
  },
  productCard: { gap: Spacing.xs },
  productRow: { flexDirection: 'row', alignItems: 'center', gap: Spacing.md },
  productEmoji: {
    width: 48,
    height: 48,
    borderRadius: Radius.md,
    backgroundColor: Colors.bgElevated,
    alignItems: 'center',
    justifyContent: 'center',
  },
  productName: { fontSize: FontSize.base, fontWeight: FontWeight.semiBold, color: Colors.textPrimary },
  productBrand: { fontSize: FontSize.sm, color: Colors.textTertiary },
  productCat: { fontSize: FontSize.xs, color: Colors.textTertiary, textTransform: 'capitalize' },
  verdictEmoji: { fontSize: 22 },
  verdictReason: { fontSize: FontSize.sm, lineHeight: 20 },
  modal: { flex: 1, backgroundColor: Colors.bg },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: Spacing.lg,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  modalTitle: { fontSize: FontSize.lg, fontWeight: FontWeight.bold, color: Colors.textPrimary },
  modalClose: { fontSize: FontSize.lg, color: Colors.textSecondary },
  modalContent: { padding: Spacing.lg, gap: Spacing.md },
  modalDesc: { fontSize: FontSize.base, color: Colors.textSecondary, lineHeight: 22 },
  analyzingContainer: { alignItems: 'center', gap: Spacing.md, paddingTop: Spacing.xl },
  analyzingText: { fontSize: FontSize.lg, fontWeight: FontWeight.semiBold, color: Colors.textPrimary },
  analyzingSubtext: { fontSize: FontSize.sm, color: Colors.textSecondary, textAlign: 'center' },
  verdictBanner: {
    flexDirection: 'row',
    gap: Spacing.md,
    padding: Spacing.md,
    borderRadius: Radius.lg,
    borderWidth: 1,
    alignItems: 'flex-start',
  },
  verdictBannerEmoji: { fontSize: 28 },
  verdictLabel: { fontSize: FontSize.md, fontWeight: FontWeight.bold },
  verdictReasonText: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20, marginTop: 2 },
  ingredientsTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.semiBold,
    color: Colors.textSecondary,
    marginBottom: Spacing.xs,
  },
  ingredientsList: { fontSize: FontSize.sm, color: Colors.textSecondary, lineHeight: 20 },
  resultActions: { gap: Spacing.sm },
  blacklistBanner: {
    backgroundColor: Colors.warningBg,
    borderRadius: Radius.md,
    borderWidth: 1,
    borderColor: Colors.warning,
    padding: Spacing.md,
    gap: Spacing.xs,
  },
  blacklistTitle: {
    fontSize: FontSize.sm,
    fontWeight: FontWeight.bold,
    color: Colors.warning,
  },
  blacklistText: {
    fontSize: FontSize.sm,
    color: Colors.textSecondary,
    lineHeight: 20,
  },
  blacklistIngredients: {
    color: Colors.warning,
    fontWeight: FontWeight.semiBold,
  },
});
