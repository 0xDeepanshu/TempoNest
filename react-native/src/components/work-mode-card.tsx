import { Ionicons } from '@expo/vector-icons';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { AttendanceWorkMode } from '../api/types';
import { colors, radius, spacing, typography } from '../theme/tokens';

interface WorkModeMeta {
  title: string;
  description: string;
  icon: ComponentProps<typeof Ionicons>['name'];
}

const MODE_META: Record<AttendanceWorkMode, WorkModeMeta> = {
  WFO: {
    title: 'Work from office',
    description: 'Selfie check-in. Location is never requested for office work.',
    icon: 'business-outline',
  },
  WFH: {
    title: 'Work from home',
    description: 'No photo, camera, or location required.',
    icon: 'home-outline',
  },
  ON_SITE: {
    title: 'On site',
    description:
      'Selfie and current location required. Location tracking runs during your on-site session.',
    icon: 'location-outline',
  },
};

interface WorkModeCardProps {
  mode: AttendanceWorkMode;
  selected: boolean;
  onPress: () => void;
  disabled?: boolean;
}

export function WorkModeCard({ mode, selected, onPress, disabled = false }: WorkModeCardProps) {
  const meta = MODE_META[mode];

  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      accessibilityLabel={`${meta.title}. ${meta.description}`}
      style={({ pressed }) => [
        styles.card,
        selected && styles.selected,
        pressed && !disabled && styles.pressed,
        disabled && styles.disabled,
      ]}
    >
      <View style={[styles.iconWrap, selected && styles.iconWrapSelected]}>
        <Ionicons
          name={meta.icon}
          size={20}
          color={selected ? colors.primary : colors.textMuted}
        />
      </View>
      <View style={styles.copy}>
        <Text style={styles.title}>{meta.title}</Text>
        <Text style={styles.description}>{meta.description}</Text>
      </View>
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected ? <View style={styles.radioDot} /> : null}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  selected: {
    borderColor: colors.primary,
    backgroundColor: colors.primarySoft,
  },
  pressed: {
    opacity: 0.9,
  },
  disabled: {
    opacity: 0.6,
  },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceMuted,
  },
  iconWrapSelected: {
    backgroundColor: colors.white,
  },
  copy: {
    flex: 1,
    gap: 2,
  },
  title: {
    ...typography.label,
    color: colors.text,
  },
  description: {
    ...typography.caption,
    color: colors.textMuted,
  },
  radio: {
    width: 22,
    height: 22,
    borderRadius: 11,
    borderWidth: 2,
    borderColor: colors.borderStrong,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: {
    borderColor: colors.primary,
  },
  radioDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: colors.primary,
  },
});
