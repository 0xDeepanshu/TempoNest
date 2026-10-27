import { StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '../theme/tokens';

export function BrandMark({ size = 44 }: { size?: number }) {
  return (
    <View
      accessible
      accessibilityRole="image"
      accessibilityLabel="TempoNest"
      style={[
        styles.mark,
        { width: size, height: size, borderRadius: Math.round(size * 0.28) },
      ]}
    >
      <Text style={[styles.letter, { fontSize: Math.round(size * 0.52) }]}>T</Text>
    </View>
  );
}

export function BrandLockup({ subtitle }: { subtitle?: string }) {
  return (
    <View style={styles.lockup}>
      <BrandMark />
      <View style={styles.lockupText}>
        <Text style={styles.name} numberOfLines={1}>
          TempoNest
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mark: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primary,
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 3,
  },
  letter: {
    color: colors.white,
    fontWeight: '700',
  },
  lockup: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  lockupText: {
    gap: 2,
    flexShrink: 1,
  },
  name: {
    ...typography.heading,
    color: colors.text,
  },
  subtitle: {
    ...typography.caption,
    color: colors.textMuted,
  },
});
