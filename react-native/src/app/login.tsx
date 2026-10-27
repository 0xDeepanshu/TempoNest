import { Redirect } from 'expo-router';
import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { ApiError, describeError } from '../api/errors';
import { useAuth } from '../auth/auth-context';
import { BrandMark } from '../components/brand-mark';
import { Button } from '../components/button';
import { Card } from '../components/card';
import { ErrorBanner } from '../components/error-banner';
import { LoadingScreen } from '../components/loading-screen';
import { Screen } from '../components/screen';
import { TextField } from '../components/text-field';
import { API_HOST_LABEL } from '../config/env';
import { colors, spacing, typography } from '../theme/tokens';

function loginErrorMessage(error: unknown): string {
  if (error instanceof ApiError) {
    if (error.code === 'INVALID_CREDENTIALS') {
      return 'Email or password is incorrect.';
    }
    if (error.code === 'RATE_LIMITED') {
      return 'Too many sign-in attempts. Wait a moment and try again.';
    }
  }
  return describeError(error);
}

export default function LoginScreen() {
  const { status, notice, dismissNotice, signIn } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (status === 'loading') {
    return <LoadingScreen message="Restoring your session…" />;
  }

  if (status === 'authenticated') {
    return <Redirect href="/home" />;
  }

  async function handleSubmit() {
    if (submitting) return;

    const nextEmailError = email.trim() ? null : 'Enter your work email.';
    const nextPasswordError = password ? null : 'Enter your password.';
    setEmailError(nextEmailError);
    setPasswordError(nextPasswordError);
    setFormError(null);

    if (nextEmailError || nextPasswordError) return;

    setSubmitting(true);
    try {
      await signIn(email, password);
    } catch (error) {
      setFormError(loginErrorMessage(error));
      setSubmitting(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <Screen>
        <View style={styles.hero}>
          <BrandMark size={52} />
          <Text style={styles.brandName}>TempoNest</Text>
          <Text style={styles.tagline}>Your workday, tracked in one place.</Text>
        </View>

        <View style={styles.heading}>
          <Text style={styles.title}>Welcome back</Text>
          <Text style={styles.subtitle}>
            Sign in with the work account your organization provided.
          </Text>
        </View>

        {notice ? (
          <ErrorBanner
            tone="info"
            message={notice}
            actionLabel="Dismiss"
            onAction={dismissNotice}
          />
        ) : null}

        <Card>
          <TextField
            label="Work email"
            value={email}
            onChangeText={(value) => {
              setEmail(value);
              if (emailError) setEmailError(null);
            }}
            placeholder="you@company.com"
            error={emailError}
            autoComplete="email"
            keyboardType="email-address"
            textContentType="emailAddress"
            editable={!submitting}
            testID="login-email"
          />
          <TextField
            label="Password"
            value={password}
            onChangeText={(value) => {
              setPassword(value);
              if (passwordError) setPasswordError(null);
            }}
            placeholder="Enter your password"
            error={passwordError}
            secure
            autoComplete="current-password"
            textContentType="password"
            returnKeyType="go"
            onSubmitEditing={() => void handleSubmit()}
            editable={!submitting}
            testID="login-password"
          />

          {formError ? <ErrorBanner message={formError} /> : null}

          <Button
            label="Sign in"
            loading={submitting}
            onPress={() => void handleSubmit()}
            testID="login-submit"
          />
        </Card>

        <Text style={styles.footer}>
          TempoNest accounts are created by your organization. There is no
          self-signup in the mobile app.
        </Text>
        {__DEV__ ? <Text style={styles.host}>API: {API_HOST_LABEL}</Text> : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: {
    flex: 1,
  },
  hero: {
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing['2xl'],
  },
  brandName: {
    ...typography.title,
    color: colors.text,
  },
  tagline: {
    ...typography.body,
    color: colors.textMuted,
  },
  heading: {
    gap: spacing.xs,
    marginTop: spacing.lg,
  },
  title: {
    ...typography.display,
    fontSize: 30,
    lineHeight: 36,
    color: colors.text,
  },
  subtitle: {
    ...typography.body,
    color: colors.textMuted,
  },
  footer: {
    ...typography.caption,
    color: colors.textSubtle,
    textAlign: 'center',
    paddingHorizontal: spacing.lg,
  },
  host: {
    ...typography.caption,
    color: colors.textSubtle,
    textAlign: 'center',
  },
});
