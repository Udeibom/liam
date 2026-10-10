/**
 * Root index — immediately replaced by _layout.tsx redirect logic.
 * This file exists so Expo Router has a matched route at "/" on web,
 * preventing the "Unmatched Route" error before the auth check completes.
 */
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import { Colors } from '@/constants';

export default function Index() {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={Colors.primary} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.bg,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
