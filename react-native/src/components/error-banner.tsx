import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '../theme/tokens';

type BannerTone = 'error' | 'info' | 'success';

const TONES: Record<
  BannerTone,
  { background: string; foreground: string; icon: ComponentProps<typeof Ionicons>['name'] }
> = {
  error: {
    background: colors.dangerSoft,
    foreground: colors.danger,
    icon: 'alert-circle-outline',
  },
  info: {
    background: colors.infoSoft,
    foreground: colors.info,
    icon: 'information-circle-outline',
  },
  success: {
    background: colors.successSoft,
    foreground: colors.success,
    icon: 'checkmark-circle-outline',
  },
};

interface ErrorBannerProps {
  message: string;
  tone?: BannerTone;
  actionLabel?: string;
  onAction?: () => void;
}

export function ErrorBanner({
  message,
  tone = 'error',
  actionLabel,
  onAction,
}: ErrorBannerProps) {
  const palette = TONES[tone];

  return (
    <View
      accessibilityRole="alert"
      style={[styles.banner, { backgroundColor: palette.background }]}
    >
      <Ionicons name={palette.icon} size={20} color={palette.foreground} />
      <Text style={[styles.message, { color: palette.foreground }]}>{message}</Text>
      {actionLabel && onAction ? (
        <Pressable onPress={onAction} accessibilityRole="button" hitSlop={8}>
          <Text style={[styles.action, { color: palette.foreground }]}>{actionLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.md,
  },
  message: {
    ...typography.body,
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  action: {
    ...typography.label,
    textDecorationLine: 'underline',
  },
});
