import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Redirect, router, useLocalSearchParams } from 'expo-router';
import type { ComponentProps } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  Image,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import {
  checkInAttendance,
  createAttendanceEvidence,
  reauthorizeAttendanceEvidence,
  uploadAttendanceEvidence,
  type LocalImage,
} from '../api/attendance';
import { isApiErrorCode, describeError } from '../api/errors';
import type {
  AttendanceLocation,
  AttendanceWorkMode,
} from '../api/types';
import {
  buildCheckInPayload,
  checkInRequirements,
  checkLocationFix,
  classifyCheckInFailure,
  isPendingCheckInExpired,
  type CheckInFailure,
  type PendingCheckIn,
} from '../attendance/check-in';
import {
  clearPendingCheckIn,
  createPendingCheckIn,
  readPendingCheckIn,
  savePendingCheckIn,
  withNewRequestId,
} from '../attendance/pending-check-in';
import { formatClockTime } from '../attendance/timing';
import { useAuth } from '../auth/auth-context';
import { toLocalImage } from '../capture/capture-image';
import { deleteLocalCapture } from '../capture/temp-files';
import { BrandLockup } from '../components/brand-mark';
import { Button } from '../components/button';
import { Card } from '../components/card';
import { ErrorBanner } from '../components/error-banner';
import { LoadingScreen } from '../components/loading-screen';
import { Screen } from '../components/screen';
import { StatusBadge } from '../components/status-badge';
import { useMobileAgent } from '../device/use-mobile-agent';
import {
  collectForegroundLocation,
  getForegroundLocationPermission,
  type ForegroundLocationPermission,
} from '../location/foreground-location';
import { colors, radius, spacing, typography } from '../theme/tokens';

const WORK_MODE_LABELS: Record<AttendanceWorkMode, string> = {
  WFO: 'Work from office',
  WFH: 'Work from home',
  ON_SITE: 'On site',
};

const MODE_META: Record<
  AttendanceWorkMode,
  { icon: ComponentProps<typeof Ionicons>['name']; description: string }
> = {
  WFO: {
    icon: 'business-outline',
    description:
      'A selfie is required. Location is never requested for office work.',
  },
  WFH: {
    icon: 'home-outline',
    description:
      'No selfie, camera, or location is collected for home check-in.',
  },
  ON_SITE: {
    icon: 'location-outline',
    description:
      'A selfie and one current location fix are required. After check-in, location tracking continues during your on-site session.',
  },
};

type Phase = 'loading' | 'form' | 'submitting' | 'error' | 'success';

function normalizeMode(value: string | string[] | undefined): AttendanceWorkMode {
  const mode = Array.isArray(value) ? value[0] : value;
  return mode === 'WFH' || mode === 'ON_SITE' || mode === 'WFO' ? mode : 'WFO';
}

function earliestExpiry(current: string | undefined, next: string): string {
  if (!current) return next;
  return Date.parse(next) < Date.parse(current) ? next : current;
}

function permissionLabel(permission: ForegroundLocationPermission | null): string {
  if (!permission) return 'Checking location access…';
  if (permission.status === 'granted') return 'Location access granted';
  if (permission.status === 'undetermined') {
    return 'Location access has not been requested yet';
  }
  if (permission.status === 'denied') {
    return permission.canAskAgain
      ? 'Location access not granted'
      : 'Location access blocked in device settings';
  }
  return 'Location access is unavailable on this device';
}

export default function CheckInScreen() {
  const { status: authStatus, user, activeOrganization } = useAuth();
  const agentState = useMobileAgent();
  const params = useLocalSearchParams<{ mode?: string }>();
  const modeParam = Array.isArray(params.mode) ? params.mode[0] : params.mode;
  const hasRequestedMode =
    modeParam === 'WFO' || modeParam === 'WFH' || modeParam === 'ON_SITE';
  const requestedMode = normalizeMode(modeParam);

  const [cameraPermission, requestCameraPermission, refreshCameraPermission] =
    useCameraPermissions();
  const cameraRef = useRef<CameraView | null>(null);
  const initialized = useRef(false);
  const mounted = useRef(true);
  const cameraPrompted = useRef(false);
  const submitLock = useRef(false);

  const [phase, setPhase] = useState<Phase>('loading');
  const [pending, setPending] = useState<PendingCheckIn | null>(null);
  const [selfie, setSelfie] = useState<LocalImage | null>(null);
  const [location, setLocation] = useState<AttendanceLocation | null>(null);
  const [locationPermission, setLocationPermission] =
    useState<ForegroundLocationPermission | null>(null);
  const [locationMessage, setLocationMessage] = useState<string | null>(null);
  const [locationLoading, setLocationLoading] = useState(false);
  const [failure, setFailure] = useState<CheckInFailure | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [capturing, setCapturing] = useState(false);

  const agent = agentState.agent;
  const organizationId = activeOrganization?.id ?? null;
  const userId = user?.id ?? null;
  const mode = pending?.workMode ?? requestedMode;
  const { needsSelfie, needsLocation } = checkInRequirements(mode);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Camera cache files are removed as soon as the image is replaced, uploaded,
  // or the screen is left.
  useEffect(() => () => deleteLocalCapture(selfie?.uri), [selfie]);

  // Returning to the pushed home screen keeps a single instance in the stack;
  // deep links still have a fallback route.
  const goHome = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/home');
  }, []);

  const completeSuccess = useCallback(async () => {
    if (organizationId && userId) {
      await clearPendingCheckIn(organizationId, userId);
    }
    setPhase('success');
  }, [organizationId, userId]);

  const refreshLocationPermission = useCallback(async () => {
    const permission = await getForegroundLocationPermission();
    if (mounted.current) setLocationPermission(permission);
  }, []);

  useEffect(() => {
    if (
      authStatus !== 'authenticated' ||
      !activeOrganization ||
      !needsLocation
    ) {
      return;
    }
    void refreshLocationPermission();
  }, [activeOrganization, authStatus, needsLocation, refreshLocationPermission]);

  // Ask for the camera once, and only for modes that require a selfie.
  useEffect(() => {
    if (authStatus !== 'authenticated' || !activeOrganization) return;
    if (!needsSelfie || !cameraPermission) return;
    if (cameraPermission.granted || !cameraPermission.canAskAgain) return;
    if (cameraPrompted.current) return;
    cameraPrompted.current = true;
    void requestCameraPermission();
  }, [
    activeOrganization,
    authStatus,
    cameraPermission,
    needsSelfie,
    requestCameraPermission,
  ]);

  // Coming back from device settings should replace a blocked state.
  useEffect(() => {
    if (authStatus !== 'authenticated' || !activeOrganization) return;
    const subscription = AppState.addEventListener('change', (nextState) => {
      if (nextState !== 'active') return;
      if (needsSelfie) void refreshCameraPermission();
      if (needsLocation) void refreshLocationPermission();
    });
    return () => subscription.remove();
  }, [
    activeOrganization,
    authStatus,
    needsLocation,
    needsSelfie,
    refreshCameraPermission,
    refreshLocationPermission,
  ]);

  const uploadSelfie = useCallback(
    async (record: PendingCheckIn, image: LocalImage): Promise<PendingCheckIn> => {
      if (!agent || !organizationId || !userId) {
        throw new Error('This device is not ready yet.');
      }

      const created = await createAttendanceEvidence(organizationId, agent, {
        kind: 'SELFIE',
        contentType: image.contentType,
        capturedAt: image.capturedAt,
      });

      const target = created.data.upload;
      try {
        await uploadAttendanceEvidence({ agent, target, image });
      } catch (error) {
        if (isApiErrorCode(error, 'ATTENDANCE_UPLOAD_AUTHORIZATION_EXPIRED')) {
          try {
            const renewed = await reauthorizeAttendanceEvidence(
              organizationId,
              created.data.evidence.id,
              agent,
            );
            await uploadAttendanceEvidence({
              agent,
              target: renewed.data.upload,
              image,
            });
          } catch (renewError) {
            // The first upload may have succeeded even though its response was
            // lost; reauthorization then reports it as already uploaded.
            if (!isApiErrorCode(renewError, 'ATTENDANCE_EVIDENCE_ALREADY_UPLOADED')) {
              throw renewError;
            }
          }
        } else if (!isApiErrorCode(error, 'ATTENDANCE_EVIDENCE_ALREADY_UPLOADED')) {
          throw error;
        }
      }

      const next: PendingCheckIn = {
        ...record,
        selfieEvidenceId: created.data.evidence.id,
        evidenceExpiresAt: earliestExpiry(
          record.evidenceExpiresAt,
          created.data.evidence.expiresAt,
        ),
      };
      await savePendingCheckIn(organizationId, userId, next);
      setPending(next);

      // The uploaded copy is now the source of truth for this attempt.
      setSelfie(null);
      return next;
    },
    [agent, organizationId, userId],
  );

  const ensureEvidence = useCallback(
    async (record: PendingCheckIn): Promise<PendingCheckIn | null> => {
      if (!checkInRequirements(record.workMode).needsSelfie) return record;
      if (record.selfieEvidenceId) return record;

      if (!selfie) {
        setFailure({
          action: 'restart',
          message: 'The selfie is no longer on this device. Capture it again.',
        });
        setPhase('error');
        return null;
      }

      return uploadSelfie(record, selfie);
    },
    [selfie, uploadSelfie],
  );

  const submitPending = useCallback(
    async (record: PendingCheckIn) => {
      if (!agent || !organizationId || !userId || submitLock.current) return;

      submitLock.current = true;
      setPhase('submitting');
      setFailure(null);

      try {
        const ready = await ensureEvidence(record);
        if (!ready) return;

        const payload = buildCheckInPayload(ready);
        if (!payload) {
          await clearPendingCheckIn(organizationId, userId);
          setFailure({
            action: 'restart',
            message: 'The check-in details were incomplete. Capture your attendance again.',
          });
          setPhase('error');
          return;
        }

        const response = await checkInAttendance(organizationId, agent, payload);

        // A stale resumed request can replay an old check-in whose session has
        // already ended. That is not a new check-in, so do not claim success.
        if (response.data.session.status === 'STOPPED') {
          await clearPendingCheckIn(organizationId, userId);
          setFailure({
            action: 'refresh',
            message:
              'This check-in was already completed earlier and its session has ended. Start a new check-in if you are working now.',
          });
          setPhase('error');
          return;
        }

        await completeSuccess();
      } catch (error) {
        const classified = classifyCheckInFailure(error);

        if (
          classified.action === 'refresh' ||
          classified.action === 'restart' ||
          classified.action === 'fatal'
        ) {
          await clearPendingCheckIn(organizationId, userId);
        }

        if (!mounted.current) return;
        setFailure(classified);
        setPhase('error');
      } finally {
        submitLock.current = false;
      }
    },
    [agent, completeSuccess, ensureEvidence, organizationId, userId],
  );

  useEffect(() => {
    if (initialized.current) return;
    if (agentState.status !== 'ready' || !agent || !organizationId || !userId) return;

    initialized.current = true;

    async function initialize() {
      try {
        const existing = await readPendingCheckIn(organizationId!, userId!);
        let record: PendingCheckIn;

        if (
          existing &&
          (!hasRequestedMode || existing.workMode === requestedMode) &&
          !isPendingCheckInExpired(existing, Date.now())
        ) {
          // Resume the same attempt, including any evidence already uploaded.
          record = existing;
        } else {
          if (existing) await clearPendingCheckIn(organizationId!, userId!);
          record = await createPendingCheckIn(organizationId!, userId!, requestedMode);
        }

        if (!mounted.current) return;
        setPending(record);
        setLocation(record.location ?? null);
        setPhase('form');
      } catch (error) {
        if (!mounted.current) return;
        setFailure({ action: 'fatal', message: describeError(error) });
        setPhase('error');
      }
    }

    void initialize();
  }, [
    agent,
    agentState.status,
    hasRequestedMode,
    organizationId,
    requestedMode,
    userId,
  ]);

  const handleCapture = useCallback(async () => {
    if (!cameraRef.current || capturing) return;

    setCapturing(true);
    setCameraError(null);
    try {
      const picture = await cameraRef.current.takePictureAsync({
        quality: 0.5,
        base64: Platform.OS === 'web',
        exif: false,
      });
      if (!picture) throw new Error('The camera did not return a photo.');

      setSelfie(toLocalImage(picture));
    } catch (error) {
      setCameraError(describeError(error));
    } finally {
      if (mounted.current) setCapturing(false);
    }
  }, [capturing]);

  const handleRetakeSelfie = useCallback(async () => {
    if (!pending || !organizationId || !userId) return;

    // The next submission has different evidence, so it needs a fresh
    // idempotency key. A stale site photo from an older build is dropped too.
    const next = withNewRequestId({
      ...pending,
      selfieEvidenceId: undefined,
      sitePhotoEvidenceId: undefined,
      evidenceExpiresAt: undefined,
    });
    setPending(next);
    setSelfie(null);
    setFailure(null);
    setCameraReady(false);
    setCameraError(null);
    await savePendingCheckIn(organizationId, userId, next);
  }, [organizationId, pending, userId]);

  const handleLocation = useCallback(async () => {
    if (!pending || !needsLocation || locationLoading) return;

    setLocationLoading(true);
    setLocationMessage(null);
    const result = await collectForegroundLocation();
    if (!mounted.current) return;
    setLocationLoading(false);

    await refreshLocationPermission();
    if (!mounted.current) return;

    if (result.status === 'ok') {
      const next = withNewRequestId({ ...pending, location: result.location });
      setPending(next);
      setLocation(result.location);
      if (organizationId && userId) {
        await savePendingCheckIn(organizationId, userId, next);
      }
      return;
    }

    if (result.status === 'denied') {
      setLocationMessage(
        result.canAskAgain
          ? 'Location permission is needed for on-site check-in. Allow it and try again.'
          : 'Location permission is blocked. Open device settings to allow it, then try again.',
      );
      return;
    }

    if (result.status === 'services_disabled') {
      setLocationMessage(
        'Location services are turned off. Turn them on in device settings, then try again.',
      );
      return;
    }

    setLocationMessage(result.message);
  }, [
    locationLoading,
    needsLocation,
    organizationId,
    pending,
    refreshLocationPermission,
    userId,
  ]);

  const handleLocationPress = useCallback(() => {
    if (
      locationPermission?.status === 'denied' &&
      !locationPermission.canAskAgain
    ) {
      void Linking.openSettings();
      return;
    }
    void handleLocation();
  }, [handleLocation, locationPermission]);

  const handleCheckIn = useCallback(async () => {
    if (!pending || submitLock.current) return;

    if (needsSelfie && !pending.selfieEvidenceId && !selfie) {
      setFailure({
        action: 'restart',
        message: 'Take your selfie before checking in.',
      });
      setPhase('error');
      return;
    }

    if (needsLocation) {
      if (!location) {
        setLocationMessage('Get your current location before checking in.');
        return;
      }

      const check = checkLocationFix(location, Date.now());
      if (!check.ok) {
        // Never submit an old or implausible fix; ask for a new one instead.
        if (organizationId && userId) {
          const next = withNewRequestId({ ...pending, location: undefined });
          setPending(next);
          await savePendingCheckIn(organizationId, userId, next);
        }
        setLocation(null);
        setLocationMessage(check.message);
        return;
      }
    }

    await submitPending(pending);
  }, [
    location,
    needsLocation,
    needsSelfie,
    organizationId,
    pending,
    selfie,
    submitPending,
    userId,
  ]);

  const handleRelocate = useCallback(async () => {
    if (!pending || !organizationId || !userId) return;

    const next = withNewRequestId({ ...pending, location: undefined });
    setPending(next);
    setLocation(null);
    setLocationMessage(null);
    setFailure(null);
    await savePendingCheckIn(organizationId, userId, next);
    setPhase('form');
  }, [organizationId, pending, userId]);

  const handleStartOver = useCallback(async () => {
    if (!organizationId || !userId) return;

    await clearPendingCheckIn(organizationId, userId);
    const fresh = await createPendingCheckIn(organizationId, userId, requestedMode);
    setPending(fresh);
    setSelfie(null);
    setLocation(null);
    setLocationMessage(null);
    setFailure(null);
    setCameraReady(false);
    setCameraError(null);
    setPhase('form');
  }, [organizationId, requestedMode, userId]);

  const handleCancel = useCallback(async () => {
    if (organizationId && userId) {
      await clearPendingCheckIn(organizationId, userId);
    }
    goHome();
  }, [goHome, organizationId, userId]);

  useEffect(() => {
    if (phase !== 'success') return;
    const timer = setTimeout(goHome, 1_400);
    return () => clearTimeout(timer);
  }, [goHome, phase]);

  if (authStatus === 'loading') {
    return <LoadingScreen message="Restoring your session…" />;
  }

  if (authStatus !== 'authenticated' || !user) {
    return <Redirect href="/login" />;
  }

  if (!activeOrganization) {
    return (
      <Screen>
        <BrandLockup subtitle="TempoNest" />
        <Card>
          <Text style={styles.cardTitle}>No active organization</Text>
          <Text style={styles.body}>
            Ask your administrator to activate your TempoNest membership before
            checking in.
          </Text>
          <Button label="Back to home" variant="secondary" onPress={goHome} />
        </Card>
      </Screen>
    );
  }

  if (agentState.status === 'idle' || agentState.status === 'loading') {
    return <LoadingScreen message="Preparing this device…" />;
  }

  if (agentState.status === 'error') {
    return (
      <Screen>
        <BrandLockup subtitle={activeOrganization.name} />
        <Card>
          <Text style={styles.cardTitle}>This device isn’t ready</Text>
          <ErrorBanner message={agentState.error ?? 'Device registration failed.'} />
          <Button label="Try again" onPress={agentState.retry} />
          <Button label="Back to home" variant="secondary" onPress={goHome} />
        </Card>
      </Screen>
    );
  }

  const header = (
    <View style={styles.header}>
      <BrandLockup subtitle={activeOrganization.name} />
      <Pressable
        onPress={() => void handleCancel()}
        disabled={phase === 'submitting'}
        accessibilityRole="button"
        accessibilityLabel="Cancel check-in"
        hitSlop={10}
        style={({ pressed }) => [styles.cancel, pressed && styles.pressed]}
      >
        <Text style={[styles.cancelLabel, phase === 'submitting' && styles.disabledText]}>
          Cancel
        </Text>
      </Pressable>
    </View>
  );

  if (phase === 'loading') {
    return <LoadingScreen message="Preparing your check-in…" />;
  }

  if (phase === 'success') {
    return (
      <Screen>
        {header}
        <Card>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark" size={30} color={colors.success} />
          </View>
          <Text style={styles.cardTitle}>You’re checked in</Text>
          <Text style={styles.body}>
            {WORK_MODE_LABELS[mode]} · started at server time. Your timer is now
            running.
          </Text>
          <Button label="Back to home" onPress={goHome} />
        </Card>
      </Screen>
    );
  }

  if (phase === 'error' && failure) {
    const action = failure.action;
    return (
      <Screen>
        {header}
        <Card>
          <Text style={styles.cardTitle}>Check-in not completed</Text>
          <ErrorBanner message={failure.message} />

          {action === 'retry' && pending ? (
            <Button label="Retry check-in" onPress={() => void submitPending(pending)} />
          ) : null}

          {action === 'relocate' ? (
            <>
              <Text style={styles.helper}>
                Location problems need a new check-in attempt. Your uploaded
                selfie can be reused.
              </Text>
              <Button label="Update location" onPress={() => void handleRelocate()} />
            </>
          ) : null}

          {action === 'restart' ? (
            <Button label="Start over" onPress={() => void handleStartOver()} />
          ) : null}

          {action === 'refresh' ? (
            <Text style={styles.helper}>
              TempoNest has already recorded something different for your day.
              Return home to see the current server state.
            </Text>
          ) : null}

          {action === 'fatal' ? (
            <Text style={styles.helper}>
              Return home and try again. If this keeps happening, contact your
              TempoNest administrator.
            </Text>
          ) : null}

          {action === 'refresh' || action === 'fatal' ? (
            <Button label="Back to home" variant="secondary" onPress={goHome} />
          ) : null}
        </Card>
      </Screen>
    );
  }

  if (phase === 'submitting') {
    return (
      <Screen>
        {header}
        <Card>
          <View style={styles.loadingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.loadingText}>Checking you in…</Text>
          </View>
          <Text style={styles.helper}>
            {mode === 'WFH'
              ? 'Starting your server timer. Keep the app open.'
              : mode === 'ON_SITE'
                ? 'Uploading your selfie privately and starting your server timer. Allow background location when prompted so on-site tracking can continue while the app is closed.'
                : 'Uploading your selfie privately and starting your server timer. Keep the app open.'}
          </Text>
        </Card>
      </Screen>
    );
  }

  const selfieUploaded = Boolean(pending?.selfieEvidenceId) && !selfie;
  const hasSelfie = Boolean(selfie || pending?.selfieEvidenceId);
  // Exact freshness is re-checked at submission, where an old fix is rejected.
  const locationReady = Boolean(location);
  const canCheckIn =
    Boolean(pending) &&
    (!needsSelfie || hasSelfie) &&
    (!needsLocation || locationReady) &&
    !locationLoading;

  const readiness =
    needsSelfie && !hasSelfie
      ? needsLocation && !locationReady
        ? 'Take a selfie and get your current location to enable check-in.'
        : 'Take a selfie to enable check-in.'
      : needsLocation && !locationReady
        ? 'Get your current location to enable check-in.'
        : needsSelfie
          ? 'Your selfie is stored privately. Location is never requested for this mode.'
          : 'No selfie or location is collected for work from home.';

  const locationActionLabel =
    locationPermission?.status === 'denied' && !locationPermission.canAskAgain
      ? 'Open settings'
      : locationPermission?.status === 'granted'
        ? location
          ? 'Update location'
          : 'Get my location'
        : 'Allow location';

  return (
    <Screen>
      {header}

      <Card muted>
        <View style={styles.modeRow}>
          <View style={styles.modeIcon}>
            <Ionicons name={MODE_META[mode].icon} size={22} color={colors.primary} />
          </View>
          <View style={styles.modeCopy}>
            <Text style={styles.eyebrow}>Checking in</Text>
            <Text style={styles.modeTitle}>{WORK_MODE_LABELS[mode]}</Text>
          </View>
          <StatusBadge label="Selected" tone="primary" />
        </View>
        <Text style={styles.body}>{MODE_META[mode].description}</Text>
      </Card>

      {needsSelfie ? (
        <Card>
          <View style={styles.sectionHeader}>
            <Ionicons name="camera-outline" size={18} color={colors.textMuted} />
            <Text style={styles.sectionTitle}>Selfie</Text>
            <StatusBadge
              label={hasSelfie ? 'Ready' : 'Required'}
              tone={hasSelfie ? 'success' : 'warning'}
            />
          </View>

          {selfie ? (
            <>
              <Image
                source={{ uri: selfie.uri }}
                style={styles.selfiePreview}
                accessibilityLabel="Live selfie preview"
              />
              <Text style={styles.helper}>
                This selfie is stored privately as attendance evidence. It is not
                used for facial recognition or identity verification.
              </Text>
              <Button
                label="Retake selfie"
                variant="secondary"
                onPress={() => void handleRetakeSelfie()}
                testID="retake-selfie"
              />
            </>
          ) : selfieUploaded ? (
            <>
              <View style={styles.uploadedRow}>
                <View style={styles.uploadedIcon}>
                  <Ionicons name="checkmark" size={20} color={colors.success} />
                </View>
                <View style={styles.uploadedCopy}>
                  <Text style={styles.uploadedTitle}>Selfie uploaded</Text>
                  <Text style={styles.helper}>
                    Stored privately for this check-in.
                  </Text>
                </View>
              </View>
              <Button
                label="Retake selfie"
                variant="secondary"
                onPress={() => void handleRetakeSelfie()}
                testID="retake-selfie"
              />
            </>
          ) : !cameraPermission ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.loadingText}>Checking camera access…</Text>
            </View>
          ) : !cameraPermission.granted ? (
            <View style={styles.stack}>
              <ErrorBanner
                message={
                  cameraPermission.canAskAgain
                    ? 'Camera access is needed to take your check-in selfie.'
                    : 'Camera access is blocked. Allow it in device settings, then return here.'
                }
              />
              {cameraPermission.canAskAgain ? (
                <Button
                  label="Allow camera"
                  onPress={() => void requestCameraPermission()}
                />
              ) : (
                <Button
                  label="Open settings"
                  variant="secondary"
                  onPress={() => void Linking.openSettings()}
                />
              )}
            </View>
          ) : (
            <>
              <View style={styles.cameraFrame}>
                <CameraView
                  ref={cameraRef}
                  style={styles.camera}
                  facing="front"
                  onCameraReady={() => setCameraReady(true)}
                  onMountError={({ message }) => setCameraError(message)}
                />
              </View>

              {cameraError ? <ErrorBanner message={cameraError} /> : null}
              {!cameraReady ? (
                <Text style={styles.helper}>Starting the camera…</Text>
              ) : null}

              <Button
                label="Capture selfie"
                onPress={() => void handleCapture()}
                loading={capturing}
                disabled={!cameraReady}
                testID="capture-photo"
              />
            </>
          )}
        </Card>
      ) : null}

      {needsLocation ? (
        <Card>
          <View style={styles.sectionHeader}>
            <Ionicons name="location-outline" size={18} color={colors.textMuted} />
            <Text style={styles.sectionTitle}>Location</Text>
            <StatusBadge
              label={location ? 'Ready' : 'Required'}
              tone={location ? 'success' : 'warning'}
            />
          </View>

          {location ? (
            <>
              <View style={styles.locationGrid}>
                <View style={styles.locationCell}>
                  <Text style={styles.locationLabel}>Latitude</Text>
                  <Text style={styles.locationValue}>
                    {location.latitude.toFixed(6)}
                  </Text>
                </View>
                <View style={styles.locationCell}>
                  <Text style={styles.locationLabel}>Longitude</Text>
                  <Text style={styles.locationValue}>
                    {location.longitude.toFixed(6)}
                  </Text>
                </View>
                <View style={styles.locationCell}>
                  <Text style={styles.locationLabel}>Accuracy</Text>
                  <Text style={styles.locationValue}>
                    ±{Math.round(location.accuracyMeters)} m
                  </Text>
                </View>
                <View style={styles.locationCell}>
                  <Text style={styles.locationLabel}>Fixed at</Text>
                  <Text style={styles.locationValue}>
                    {formatClockTime(location.recordedAt)}
                  </Text>
                </View>
              </View>

              <Text style={styles.helper}>
                This fix starts your on-site check-in. TempoNest then records
                location during the session, pauses on breaks, and stops at
                checkout.
              </Text>
            </>
          ) : (
            <Text style={styles.helper}>
              On-site check-in needs one current location fix with an accuracy of
              500 m or better. Tracking starts after check-in and stops at
              checkout.
            </Text>
          )}

          <View style={styles.permissionRow}>
            <Ionicons
              name={
                locationPermission?.status === 'granted'
                  ? 'checkmark-circle-outline'
                  : 'alert-circle-outline'
              }
              size={16}
              color={
                locationPermission?.status === 'granted'
                  ? colors.success
                  : colors.textMuted
              }
            />
            <Text style={styles.permissionText}>
              {permissionLabel(locationPermission)}
            </Text>
          </View>

          {locationMessage ? <ErrorBanner message={locationMessage} /> : null}

          {locationLoading ? (
            <View style={styles.loadingRow}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.loadingText}>Getting your location…</Text>
            </View>
          ) : (
            <Button
              label={locationActionLabel}
              variant={
                locationPermission?.status === 'denied' &&
                !locationPermission.canAskAgain
                  ? 'secondary'
                  : 'primary'
              }
              onPress={handleLocationPress}
              disabled={!pending}
              testID="get-location"
            />
          )}
        </Card>
      ) : null}

      <Card>
        <Text style={styles.sectionTitle}>Ready to start?</Text>
        <Text style={styles.helper}>{readiness}</Text>
        <Button
          label="Check in"
          onPress={() => void handleCheckIn()}
          disabled={!canCheckIn}
          testID="confirm-check-in"
        />
        <Text style={styles.helper}>
          Check-in is idempotent: if the network drops, retrying will not create a
          second session.
        </Text>
      </Card>
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
  cancel: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
  },
  cancelLabel: {
    ...typography.label,
    color: colors.textMuted,
  },
  pressed: {
    opacity: 0.6,
  },
  disabledText: {
    opacity: 0.4,
  },
  cardTitle: {
    ...typography.heading,
    color: colors.text,
  },
  eyebrow: {
    ...typography.caption,
    color: colors.textMuted,
    textTransform: 'uppercase',
    letterSpacing: 1,
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
  stack: {
    gap: spacing.md,
  },
  modeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  modeIcon: {
    width: 44,
    height: 44,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.primarySoft,
  },
  modeCopy: {
    flex: 1,
    gap: 2,
  },
  modeTitle: {
    ...typography.heading,
    color: colors.text,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  sectionTitle: {
    ...typography.label,
    color: colors.text,
    flex: 1,
  },
  cameraFrame: {
    borderRadius: radius.lg,
    overflow: 'hidden',
    backgroundColor: colors.surfaceMuted,
    aspectRatio: 3 / 4,
  },
  camera: {
    flex: 1,
  },
  selfiePreview: {
    width: '100%',
    aspectRatio: 3 / 4,
    borderRadius: radius.lg,
    backgroundColor: colors.surfaceMuted,
  },
  uploadedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  uploadedIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.successSoft,
  },
  uploadedCopy: {
    flex: 1,
    gap: 2,
  },
  uploadedTitle: {
    ...typography.label,
    color: colors.text,
  },
  locationGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
  },
  locationCell: {
    flexBasis: '45%',
    flexGrow: 1,
    gap: 2,
  },
  locationLabel: {
    ...typography.caption,
    color: colors.textSubtle,
  },
  locationValue: {
    ...typography.body,
    color: colors.text,
    fontWeight: '600',
  },
  permissionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  permissionText: {
    ...typography.caption,
    color: colors.textMuted,
    flex: 1,
  },
  successIcon: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
