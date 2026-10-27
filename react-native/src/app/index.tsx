import { Redirect } from 'expo-router';
import { StyleSheet, Text, View } from 'react-native';

import { useAuth } from '../auth/auth-context';
import { BrandMark } from '../components/brand-mark';
import { Button } from '../components/button';
import { ErrorBanner } from '../components/error-banner';
import { LoadingScreen } from '../components/loading-screen';
import { Screen } from '../components/screen';
import { colors, radius, spacing, typography } from '../theme/tokens';

export default function IndexScreen() {
  const { status, restoreError, retryRestore, signOut } = useAuth();

  if (status === 'loading') {
    return <LoadingScreen message="Restoring your session…" />;
  }

  if (status === 'restore_error') {
    return (
      <Screen scroll={false} contentStyle={styles.centered}>
        <View style={styles.brand}>
          <BrandMark size={56} />
          <Text style={styles.brandName}>TempoNest</Text>
        </View>

        <View style={styles.panel}>
          <Text style={styles.title}>We couldn’t restore your session</Text>
          <Text style={styles.message}>
            Your saved sign-in was kept on this device. Retrying is safe and will
            not create a duplicate session.
          </Text>
          {restoreError ? <ErrorBanner message={restoreError} /> : null}
          <Button label="Try again" onPress={retryRestore} />
          <Button
            label="Sign in with another account"
            variant="secondary"
            onPress={() => void signOut()}
          />
        </View>
      </Screen>
    );
  }

  return <Redirect href={status === 'authenticated' ? '/home' : '/login'} />;
}

const styles = StyleSheet.create({
  centered: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xl,
  },
  brand: {
    alignItems: 'center',
    gap: spacing.md,
  },
  brandName: {
    ...typography.title,
    color: colors.text,
  },
  panel: {
    width: '100%',
    maxWidth: 440,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.lg,
    padding: spacing.xl,
    gap: spacing.md,
  },
  title: {
    ...typography.heading,
    color: colors.text,
  },
  message: {
    ...typography.body,
    color: colors.textMuted,
  },
});
