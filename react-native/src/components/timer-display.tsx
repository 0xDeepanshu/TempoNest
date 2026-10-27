import { StyleSheet, Text, View } from 'react-native';

import { formatDuration } from '../attendance/timing';
import { colors, typography } from '../theme/tokens';

interface TimerDisplayProps {
  seconds: number;
  label?: string;
  detail?: string;
  paused?: boolean;
}

export function TimerDisplay({
  seconds,
  label = 'Worked this session',
  detail,
  paused = false,
}: TimerDisplayProps) {
  const formatted = formatDuration(seconds);

  return (
    <View
      accessible
      accessibilityRole="timer"
      accessibilityLabel={`${label}: ${Math.floor(seconds / 3600)} hours ${Math.floor((seconds % 3600) / 60)} minutes ${seconds % 60} seconds`}
      style={styles.container}
    >
      <Text style={[styles.value, paused && styles.paused]}>{formatted}</Text>
      <Text style={styles.label}>{label}</Text>
      {detail ? <Text style={styles.detail}>{detail}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 2,
    paddingVertical: 4,
  },
  value: {
    ...typography.timer,
    color: colors.text,
    fontVariant: ['tabular-nums'],
  },
  paused: {
    color: colors.warning,
  },
  label: {
    ...typography.caption,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  detail: {
    ...typography.label,
    color: colors.textMuted,
  },
});
