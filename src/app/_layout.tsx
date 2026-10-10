import { useEffect } from 'react';
import { Stack, router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useAuth } from '@/hooks/useAuth';
import { useSkinProfile } from '@/hooks/useSkinProfile';
import { Colors } from '@/constants';

export default function RootLayout() {
  const { session, loading: authLoading } = useAuth();
  const { profile, loading: profileLoading } = useSkinProfile(session?.user?.id ?? null);

  const loading = authLoading || (!!session && profileLoading);

  useEffect(() => {
    if (loading) return;

    if (!session) {
      router.replace('/(auth)/welcome');
      return;
    }

    if (!profile?.onboarding_complete) {
      router.replace('/onboarding/step1');
      return;
    }

    router.replace('/(tabs)/home');
  }, [loading, session, profile]);

  // Always render the SafeAreaProvider + Stack so the router is mounted
  // and router.replace() inside useEffect can actually fire on web.
  // The loading spinner overlays the Stack rather than replacing it.
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: Colors.bg },
          animation: 'fade',
        }}
      >
        <Stack.Screen name="index" options={{ animation: 'none' }} />
        <Stack.Screen name="(auth)" options={{ animation: 'none' }} />
        <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
        <Stack.Screen name="onboarding" options={{ animation: 'none' }} />
        <Stack.Screen name="routine/index" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
        <Stack.Screen name="timeline/index" options={{ animation: 'slide_from_right' }} />
        <Stack.Screen name="detective/index" options={{ animation: 'slide_from_bottom', presentation: 'modal' }} />
        <Stack.Screen name="product/[id]" options={{ animation: 'slide_from_right' }} />
      </Stack>

      {/* Full-screen loading overlay while auth resolves — sits above the Stack */}
      {loading && (
        <View style={styles.loadingOverlay} pointerEvents="none">
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      )}
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: Colors.bg,
    alignItems: 'center' as const,
    justifyContent: 'center' as const,
  },
});
