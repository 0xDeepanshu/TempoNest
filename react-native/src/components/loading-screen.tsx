import { ActivityIndicator, StyleSheet, Text } from 'react-native';

import { colors, spacing, typography } from '../theme/tokens';
import { BrandMark } from './brand-mark';
import { Screen } from './screen';

export function LoadingScreen({ message = 'Loading TempoNest…' }: { message?: string }) {
  return (
    <Screen scroll={false} contentStyle={styles.centered}>
      <BrandMark size={56} />
      <ActivityIndicator color={colors.primary} />
      <Text style={styles.message}>{message}</Text>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.lg,
  },
  message: {
    ...typography.body,
    color: colors.textMuted,
    textAlign: 'center',
  },
});
