import { Ionicons } from '@expo/vector-icons';
import { Redirect, router, useFocusEffect } from 'expo-router';
import type { ComponentProps } from 'react';
import { useCallback, useState } from 'react';
import {
  ActivityIndicator,
  Linking,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import type {
  AttendanceWorkMode,
  Organization,
  PublicUser,
} from '../api/types';
import {
  HEARTBEAT_STALE_MS,
  formatClockTime,
  formatDurationWords,
} from '../attendance/timing';
import { useAttendance } from '../attendance/use-attendance';
import { useOnSiteTracking } from '../attendance/use-on-site-tracking';
import { useSessionActions } from '../attendance/use-session-actions';
import { useAuth } from '../auth/auth-context';
import { BrandLockup } from '../components/brand-mark';
import { Button } from '../components/button';
import { Card } from '../components/card';
import { ErrorBanner } from '../components/error-banner';
import { LoadingScreen } from '../components/loading-screen';
import { Screen } from '../components/screen';
import { StatusBadge } from '../components/status-badge';
import { TimerDisplay } from '../components/timer-display';
import { WorkModeCard } from '../components/work-mode-card';
import { useMobileAgent } from '../device/use-mobile-agent';
import { trackingPhasePresentation } from '../location/tracking-core';
import { colors, spacing, typography } from '../theme/tokens';

const WORK_MODE_LABELS: Record<AttendanceWorkMode, string> = {
  WFO: 'Work from office',
  WFH: 'Work from home',
  ON_SITE: 'On site',
};

const WORK_MODES: AttendanceWorkMode[] = ['WFO', 'WFH', 'ON_SITE'];

function formatLocalTime(ms: number | null): string {
  if (!ms) return '—';
  return formatClockTime(new Date(ms).toISOString());
}

function SignOutButton({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel="Sign out"
      hitSlop={10}
      style={({ pressed }) => [styles.signOut, pressed && styles.signOutPressed]}
    >
      <Ionicons name="log-out-outline" size={18} color={colors.textMuted} />
      <Text style={styles.signOutLabel}>Sign out</Text>
    </Pressable>
  );
}

function InfoRow({
  icon,
  label,
  value,
}: {
  icon: ComponentProps<typeof Ionicons>['name'];
  label: string;
  value: string;
}) {
  return (
    <View style={styles.infoRow}>
      <Ionicons name={icon} size={16} color={colors.textSubtle} />
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

export default function HomeScreen() {
  const { status, user, activeOrganization, signOut } = useAuth();

  if (status === 'loading') {
    return <LoadingScreen message="Restoring your session…" />;
  }

  if (status !== 'authenticated' || !user) {
    return <Redirect href="/login" />;
  }

  if (!activeOrganization) {
    return (
      <Screen>
        <View style={styles.header}>
          <BrandLockup subtitle="TempoNest" />
          <SignOutButton onPress={() => void signOut()} />
        </View>
        <Card>
          <Text style={styles.cardTitle}>No active organization</Text>
          <Text style={styles.body}>
            You’re signed in as {user.email}, but your account has no active
            TempoNest organization. Ask your administrator to activate your
            membership.
          </Text>
          <Button
            label="Sign out"
            variant="secondary"
            onPress={() => void signOut()}
          />
        </Card>
      </Screen>
    );
  }

  return <HomeContent user={user} organization={activeOrganization} />;
}

function HomeContent({
  user,
  organization,
}: {
  user: PublicUser;
  organization: Organization;
}) {
  const { signOut } = useAuth();
  const agentState = useMobileAgent();
  const attendance = useAttendance(agentState.agent);
  const [selectedMode, setSelectedMode] = useState<AttendanceWorkMode>('WFO');
  const [confirmCheckout, setConfirmCheckout] = useState(false);

  const refresh = attendance.refresh;
  const handleRefresh = useCallback(() => {
    void refresh();
  }, [refresh]);

  const session = attendance.session;
  const workTime = attendance.workTime;
  const checkIn = attendance.attendance?.checkIn ?? null;
  const isOnBreak = workTime?.isOnBreak ?? false;

  useFocusEffect(
    useCallback(() => {
      if (agentState.status !== 'ready') return;
      void refresh();
    }, [agentState.status, refresh]),
  );

  const sessionActions = useSessionActions({
    agent: agentState.agent,
    organizationId: organization.id,
    session,
    ownsSession: attendance.ownsSession,
    refresh,
    applySession: attendance.applySession,
    clearSession: attendance.clearSession,
  });
  const sessionActionPending = sessionActions.action !== null;

  const tracking = useOnSiteTracking({
    agent: agentState.agent,
    organizationId: organization.id,
    userId: user.id,
    session,
    checkIn,
    ownsSession: attendance.ownsSession,
  });
  const trackingPresentation = trackingPhasePresentation(tracking.phase);
  const showTracking =
    Boolean(session) && checkIn?.workMode === 'ON_SITE' && attendance.ownsSession;
  const trackingBanner = !showTracking
    ? null
    : tracking.phase === 'active-foreground'
      ? { tone: 'info' as const, message: trackingPresentation.detail ?? '' }
      : tracking.phase === 'permission-denied' ||
          tracking.phase === 'unavailable' ||
          tracking.phase === 'stale' ||
          tracking.phase === 'error'
        ? {
            tone: tracking.phase === 'stale' ? ('info' as const) : ('error' as const),
            message: trackingPresentation.detail ?? '',
          }
        : null;

  const handleToggleBreak = useCallback(() => {
    setConfirmCheckout(false);
    if (isOnBreak) void sessionActions.resume();
    else void sessionActions.start();
  }, [isOnBreak, sessionActions]);

  const handleCheckout = useCallback(() => {
    setConfirmCheckout(false);
    void sessionActions.checkout();
  }, [sessionActions]);

  const firstName = user.name.split(' ')[0] ?? user.name;

  const heartbeatAgeMs = session
    ? attendance.nowMs + attendance.serverOffsetMs - Date.parse(session.lastHeartbeatAt)
    : 0;
  const heartbeatStale =
    Boolean(session) &&
    Number.isFinite(heartbeatAgeMs) &&
    heartbeatAgeMs > HEARTBEAT_STALE_MS;

  const deviceLabel = attendance.ownsSession
    ? agentState.agent?.name ?? session?.desktopAgent?.name ?? 'This device'
    : session?.desktopAgent?.name ?? 'Another device';

  const showAgentCard = agentState.status === 'idle' || agentState.status === 'loading';
  const showAttendanceError =
    agentState.status === 'ready' &&
    attendance.status === 'error' &&
    !attendance.attendance;
  const showAttendanceLoading =
    agentState.status === 'ready' &&
    (attendance.status === 'idle' || attendance.status === 'loading');

  return (
    <Screen
      refreshing={attendance.refreshing}
      onRefresh={agentState.status === 'ready' ? handleRefresh : undefined}
    >
      <View style={styles.header}>
        <BrandLockup subtitle={organization.name} />
        <SignOutButton onPress={() => void signOut()} />
      </View>

      <View style={styles.greeting}>
        <Text style={styles.greetingTitle}>Hi, {firstName}</Text>
        <Text style={styles.greetingSubtitle}>
          {session
            ? 'Keep TempoNest open while you work so your session stays in sync.'
            : 'Ready when you are.'}
        </Text>
      </View>

      {agentState.status === 'error' ? (
        <Card>
          <Text style={styles.cardTitle}>This device isn’t ready</Text>
          <ErrorBanner
            message={agentState.error ?? 'Device registration failed.'}
          />
          <Text style={styles.helper}>
            Time tracking writes are bound to this registered mobile device.
            {agentState.revoked
              ? ' A revoked device must be restored by an administrator.'
              : ''}
          </Text>
          <Button
            label="Try again"
            variant="secondary"
            onPress={agentState.retry}
          />
        </Card>
      ) : null}

      {showAgentCard ? (
        <Card>
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Preparing this device…</Text>
          </View>
          <Text style={styles.helper}>
            Registering a secure mobile identity for your TempoNest account.
          </Text>
        </Card>
      ) : null}

      {showAttendanceLoading ? (
        <Card>
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Loading your attendance…</Text>
          </View>
        </Card>
      ) : null}

      {showAttendanceError ? (
        <Card>
          <Text style={styles.cardTitle}>Couldn’t load your day</Text>
          <ErrorBanner
            message={attendance.error ?? 'Attendance could not be loaded.'}
          />
          <Button label="Try again" onPress={attendance.retry} />
        </Card>
      ) : null}

      {agentState.status === 'ready' && attendance.status === 'ready' && session ? (
        <>
          {attendance.error ? (
            <ErrorBanner
              tone="info"
              message={`Couldn't refresh just now. ${attendance.error}`}
              actionLabel="Retry"
              onAction={handleRefresh}
            />
          ) : null}

          <Card>
            <View style={styles.sessionHeader}>
              <View style={styles.sessionTitleGroup}>
                <Text style={styles.eyebrow}>Active session</Text>
                <Text style={styles.sessionTitle}>
                  {checkIn ? WORK_MODE_LABELS[checkIn.workMode] : 'Working'}
                </Text>
              </View>
              <StatusBadge
                label={isOnBreak ? 'On break' : 'Working'}
                tone={isOnBreak ? 'warning' : 'success'}
              />
            </View>

            <TimerDisplay
              seconds={workTime?.workedSeconds ?? 0}
              detail={
                workTime && workTime.breakSeconds > 0
                  ? `${formatDurationWords(workTime.breakSeconds)} on break`
                  : undefined
              }
              paused={isOnBreak}
            />

            <View style={styles.divider} />

            <InfoRow
              icon="play-circle-outline"
              label="Started"
              value={formatClockTime(session.startedAt)}
            />
            <InfoRow
              icon="briefcase-outline"
              label="Work mode"
              value={checkIn ? WORK_MODE_LABELS[checkIn.workMode] : 'Not recorded'}
            />
            {showTracking ? (
              <View style={styles.infoRow}>
                <Ionicons name="navigate-outline" size={16} color={colors.textSubtle} />
                <Text style={styles.infoLabel}>Location</Text>
                <View style={styles.infoBadge}>
                  <StatusBadge
                    label={trackingPresentation.label}
                    tone={trackingPresentation.tone}
                  />
                </View>
              </View>
            ) : null}
            <InfoRow icon="laptop-outline" label="Device" value={deviceLabel} />
            <InfoRow
              icon="sync-outline"
              label="Last sync"
              value={formatLocalTime(attendance.lastSyncedAt)}
            />
            {isOnBreak && session.activeBreak ? (
              <InfoRow
                icon="pause-circle-outline"
                label="Break started"
                value={formatClockTime(session.activeBreak.startedAt)}
              />
            ) : null}

            {trackingBanner ? (
              <ErrorBanner
                tone={trackingBanner.tone}
                message={trackingBanner.message}
                actionLabel={
                  tracking.phase === 'permission-denied' || tracking.phase === 'unavailable'
                    ? 'Settings'
                    : tracking.phase === 'error'
                      ? 'Retry'
                      : undefined
                }
                onAction={
                  tracking.phase === 'permission-denied' || tracking.phase === 'unavailable'
                    ? () => void Linking.openSettings()
                    : tracking.phase === 'error'
                      ? tracking.retry
                      : undefined
                }
              />
            ) : null}

            {!attendance.ownsSession ? (
              <ErrorBanner
                tone="info"
                message={`This session is running on ${deviceLabel}. You can follow it here, but only that device can update it.`}
              />
            ) : null}

            {heartbeatStale ? (
              <ErrorBanner
                tone="info"
                message="No recent heartbeat from the device. If the app stays closed, the session may close automatically."
              />
            ) : null}

            {attendance.ownsSession ? (
              <View style={styles.sessionActions}>
                {sessionActions.message ? (
                  <ErrorBanner
                    tone={sessionActions.message.tone}
                    message={sessionActions.message.text}
                    actionLabel="Dismiss"
                    onAction={sessionActions.clearMessage}
                  />
                ) : null}

                {confirmCheckout ? (
                  <View style={styles.confirm}>
                    <Text style={styles.body}>
                      End this work session now? Your timer stops and the session
                      is closed.
                    </Text>
                    <Button
                      label="Check out now"
                      variant="secondary"
                      loading={sessionActions.action === 'checkout'}
                      onPress={handleCheckout}
                    />
                    <Button
                      label="Keep working"
                      variant="ghost"
                      disabled={sessionActions.action === 'checkout'}
                      onPress={() => setConfirmCheckout(false)}
                    />
                  </View>
                ) : (
                  <>
                    <Button
                      label={isOnBreak ? 'Resume work' : 'Take a break'}
                      variant={isOnBreak ? 'primary' : 'secondary'}
                      disabled={sessionActionPending}
                      loading={
                        sessionActions.action === 'break-start' ||
                        sessionActions.action === 'break-end'
                      }
                      onPress={handleToggleBreak}
                    />
                    <Button
                      label="Check out"
                      variant="ghost"
                      disabled={sessionActionPending}
                      onPress={() => setConfirmCheckout(true)}
                    />
                  </>
                )}
              </View>
            ) : null}
          </Card>
        </>
      ) : null}

      {agentState.status === 'ready' &&
      attendance.status === 'ready' &&
      !session ? (
        <>
          {attendance.error ? (
            <ErrorBanner
              tone="info"
              message={`Couldn't refresh just now. ${attendance.error}`}
              actionLabel="Retry"
              onAction={handleRefresh}
            />
          ) : null}

          <Card>
            <Text style={styles.cardTitle}>Start your day</Text>
            <Text style={styles.body}>Choose where you’re working today.</Text>

            <View
              accessibilityRole="radiogroup"
              accessibilityLabel="Work mode"
              style={styles.modeList}
            >
              {WORK_MODES.map((mode) => (
                <WorkModeCard
                  key={mode}
                  mode={mode}
                  selected={selectedMode === mode}
                  onPress={() => setSelectedMode(mode)}
                />
              ))}
            </View>

            <Button
              label="Check in"
              disabled={agentState.status !== 'ready'}
              onPress={() =>
                router.push({
                  pathname: '/check-in',
                  params: { mode: selectedMode },
                })
              }
            />
            <Text style={styles.helper}>
              {selectedMode === 'WFO'
                ? 'A selfie is required for office check-in. Location is never requested.'
                : selectedMode === 'WFH'
                  ? 'No photo, camera, or location is requested for home check-in.'
                  : 'On-site check-in needs a selfie and one current location reading. Location tracking continues during your on-site session, pauses on breaks, and stops at checkout.'}
            </Text>
          </Card>
        </>
      ) : null}

      <Text style={styles.footer}>Signed in as {user.email}</Text>
      {agentState.agent ? (
        <Text style={styles.footer}>Device: {agentState.agent.name}</Text>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  signOut: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  signOutPressed: {
    opacity: 0.6,
  },
  signOutLabel: {
    ...typography.label,
    color: colors.textMuted,
  },
  greeting: {
    gap: spacing.xs,
    marginTop: spacing.sm,
  },
  greetingTitle: {
    ...typography.title,
    color: colors.text,
  },
  greetingSubtitle: {
    ...typography.body,
    color: colors.textMuted,
  },
  cardTitle: {
    ...typography.heading,
    color: colors.text,
  },
  body: {
    ...typography.body,
    color: colors.textMuted,
  },
  helper: {
    ...typography.caption,
    color: colors.textMuted,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  loadingText: {
    ...typography.body,
    color: colors.textMuted,
  },
  sessionHeader: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: spacing.md,
  },
  sessionTitleGroup: {
    flex: 1,
    gap: 2,
  },
  eyebrow: {
    ...typography.caption,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  sessionTitle: {
    ...typography.heading,
    color: colors.text,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
    marginVertical: spacing.xs,
  },
  sessionActions: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  confirm: {
    gap: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: 12,
    padding: spacing.md,
    backgroundColor: colors.surfaceMuted,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  infoLabel: {
    ...typography.body,
    color: colors.textMuted,
    width: 96,
  },
  infoValue: {
    ...typography.body,
    color: colors.text,
    flex: 1,
    textAlign: 'right',
    fontWeight: '600',
  },
  infoBadge: {
    flex: 1,
    alignItems: 'flex-end',
  },
  modeList: {
    gap: spacing.sm,
    marginTop: spacing.xs,
  },
  footer: {
    ...typography.caption,
    color: colors.textSubtle,
    textAlign: 'center',
  },
});
