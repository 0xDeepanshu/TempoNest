import { Ionicons } from '@expo/vector-icons';
import { Modal, StyleSheet, Text, View } from 'react-native';

import type { LocationRecoveryView } from '../location/location-recovery';
import { colors, radius, spacing, typography } from '../theme/tokens';
import { Button } from './button';

interface LocationRecoveryModalProps {
  view: LocationRecoveryView | null;
  busy?: boolean;
  message?: string | null;
  onEnable: () => void;
  onCheckAgain: () => void;
  onResume: () => void;
}

/**
 * Rendered once for the tracker screen. It stays open until location is
 * verified and the employee explicitly resumes; it never dismisses itself.
 */
export function LocationRecoveryModal({
  view,
  busy = false,
  message = null,
  onEnable,
  onCheckAgain,
  onResume,
}: LocationRecoveryModalProps) {
  const visible = view !== null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={() => undefined}
    >
      <View style={styles.backdrop}>
        <View style={styles.card} accessibilityViewIsModal>
          <View style={styles.iconWrap}>
            <Ionicons name="location-outline" size={26} color={colors.primary} />
          </View>
          <Text style={styles.title}>{view?.title}</Text>
          <Text style={styles.message}>{view?.message}</Text>

          {message ? <Text style={styles.error}>{message}</Text> : null}

          {view?.kind === 'ready' ? (
            <>
              <Button
                label={view.primaryLabel}
                loading={busy}
                onPress={onResume}
              />
              <Button
                label="Check Again"
                variant="ghost"
                disabled={busy}
                onPress={onCheckAgain}
              />
            </>
          ) : (
            <>
              <Button
                label={view?.primaryLabel ?? 'Enable Location'}
                loading={busy}
                onPress={onEnable}
              />
              <Button
                label="Check Again"
                variant="secondary"
                disabled={busy}
                onPress={onCheckAgain}
              />
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: colors.overlay,
    justifyContent: 'center',
    padding: spacing.xl,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  iconWrap: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    ...typography.title,
    color: colors.text,
  },
  message: {
    ...typography.body,
    color: colors.textMuted,
  },
  error: {
    ...typography.caption,
    color: colors.danger,
  },
});
