import { fetch as expoFetch } from 'expo/fetch';
import { File } from 'expo-file-system';
import { Platform } from 'react-native';

import { refreshSession } from './auth';
import { apiRequest, getValidAccessToken, type AgentCredentials } from './client';
import { ApiError, NetworkError } from './errors';
import type {
  AttendanceCheckInInput,
  AttendanceLocationSamplesInput,
  AttendanceLocationStatusInput,
  AttendanceLocationStatusResponse,
  AttendanceUploadTarget,
  BreakActionResponse,
  CheckInResponse,
  CheckoutResponse,
  CreateAttendanceEvidenceInput,
  CreateEvidenceResponse,
  CurrentAttendanceResponse,
  HeartbeatResponse,
  IngestAttendanceLocationSamplesResponse,
  ReportAttendanceLocationStatusResponse,
} from './types';

export interface LocalImage {
  uri: string;
  contentType: 'image/jpeg' | 'image/png';
  sizeBytes: number;
  capturedAt: string;
  /** Web-only fallback; native uploads read the file directly. */
  base64?: string | null;
}

export function fetchCurrentAttendance(
  organizationId: string,
): Promise<CurrentAttendanceResponse> {
  return apiRequest<CurrentAttendanceResponse>(
    `/organizations/${organizationId}/attendance/check-ins/current`,
    { method: 'GET', auth: true, timeoutMs: 12_000 },
  );
}

export function sendSessionHeartbeat(
  organizationId: string,
  sessionId: string,
  agent: AgentCredentials,
): Promise<HeartbeatResponse> {
  return apiRequest<HeartbeatResponse>(
    `/organizations/${organizationId}/time-sessions/${sessionId}/heartbeat`,
    {
      method: 'POST',
      auth: true,
      agent,
      organizationId,
      timeoutMs: 10_000,
      retryNetwork: false,
    },
  );
}

export function createAttendanceEvidence(
  organizationId: string,
  agent: AgentCredentials,
  input: CreateAttendanceEvidenceInput,
): Promise<CreateEvidenceResponse> {
  return apiRequest<CreateEvidenceResponse>(
    `/organizations/${organizationId}/attendance/evidence`,
    {
      method: 'POST',
      auth: true,
      agent,
      body: input,
      timeoutMs: 15_000,
      retryNetwork: false,
    },
  );
}

export function reauthorizeAttendanceEvidence(
  organizationId: string,
  evidenceId: string,
  agent: AgentCredentials,
): Promise<CreateEvidenceResponse> {
  return apiRequest<CreateEvidenceResponse>(
    `/organizations/${organizationId}/attendance/evidence/${evidenceId}/upload-authorization`,
    {
      method: 'POST',
      auth: true,
      agent,
      timeoutMs: 15_000,
      retryNetwork: false,
    },
  );
}

export function checkInAttendance(
  organizationId: string,
  agent: AgentCredentials,
  input: AttendanceCheckInInput,
): Promise<CheckInResponse> {
  return apiRequest<CheckInResponse>(
    `/organizations/${organizationId}/attendance/check-ins`,
    {
      method: 'POST',
      auth: true,
      agent,
      body: input,
      timeoutMs: 25_000,
      retryNetwork: false,
    },
  );
}

export function startBreak(
  organizationId: string,
  sessionId: string,
  agent: AgentCredentials,
): Promise<BreakActionResponse> {
  return apiRequest<BreakActionResponse>(
    `/organizations/${organizationId}/time-sessions/${sessionId}/breaks`,
    {
      method: 'POST',
      auth: true,
      agent,
      timeoutMs: 15_000,
      retryNetwork: false,
    },
  );
}

export function endBreak(
  organizationId: string,
  sessionId: string,
  agent: AgentCredentials,
): Promise<BreakActionResponse> {
  return apiRequest<BreakActionResponse>(
    `/organizations/${organizationId}/time-sessions/${sessionId}/breaks/end`,
    {
      method: 'POST',
      auth: true,
      agent,
      timeoutMs: 15_000,
      retryNetwork: false,
    },
  );
}

export function checkoutSession(
  organizationId: string,
  sessionId: string,
  agent: AgentCredentials,
): Promise<CheckoutResponse> {
  return apiRequest<CheckoutResponse>(
    `/organizations/${organizationId}/time-sessions/${sessionId}/stop`,
    {
      method: 'POST',
      auth: true,
      agent,
      timeoutMs: 15_000,
      retryNetwork: false,
    },
  );
}

export function fetchAttendanceLocationStatus(
  organizationId: string,
  agent: AgentCredentials,
): Promise<AttendanceLocationStatusResponse> {
  return apiRequest<AttendanceLocationStatusResponse>(
    `/organizations/${organizationId}/attendance/location/status`,
    {
      method: 'GET',
      auth: true,
      agent,
      organizationId,
      timeoutMs: 12_000,
    },
  );
}

export function reportAttendanceLocationStatus(
  organizationId: string,
  agent: AgentCredentials,
  input: AttendanceLocationStatusInput,
): Promise<ReportAttendanceLocationStatusResponse> {
  return apiRequest<ReportAttendanceLocationStatusResponse>(
    `/organizations/${organizationId}/attendance/location/status`,
    {
      method: 'POST',
      auth: true,
      agent,
      organizationId,
      body: input,
      timeoutMs: 12_000,
      retryNetwork: false,
    },
  );
}

export function ingestAttendanceLocationSamples(
  organizationId: string,
  agent: AgentCredentials,
  input: AttendanceLocationSamplesInput,
): Promise<IngestAttendanceLocationSamplesResponse> {
  return apiRequest<IngestAttendanceLocationSamplesResponse>(
    `/organizations/${organizationId}/attendance/location/samples`,
    {
      method: 'POST',
      auth: true,
      agent,
      organizationId,
      body: input,
      timeoutMs: 20_000,
      retryNetwork: false,
    },
  );
}

function parseErrorBody(text: string): {
  code: string;
  message: string;
  details?: unknown;
  requestId?: string;
} {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = null;
  }

  const body = (parsed ?? {}) as {
    error?: { code?: string; message?: string; details?: unknown };
    requestId?: string;
  };

  return {
    code: body.error?.code ?? 'ATTENDANCE_UPLOAD_FAILED',
    message:
      body.error?.message ?? 'The attendance photo could not be uploaded. Please try again.',
    details: body.error?.details,
    requestId: body.requestId,
  };
}

const UPLOAD_AGENT_AUTH_CODES = new Set([
  'AGENT_AUTH_REQUIRED',
  'AGENT_CREDENTIALS_INVALID',
  'AGENT_REVOKED',
  'MOBILE_AGENT_REQUIRED',
]);

function uploadHeaders(
  target: AttendanceUploadTarget,
  accessToken: string,
  agent: AgentCredentials,
): Record<string, string> {
  return {
    ...target.headers,
    ...target.requiredHeaders,
    Authorization: `Bearer ${accessToken}`,
    'X-Agent-Id': agent.id,
    'X-Agent-Key': agent.key,
  };
}

async function buildUploadBody(
  image: LocalImage,
  maxBytes: number,
): Promise<{ body: BodyInit; sizeBytes: number }> {
  if (Platform.OS === 'web') {
    if (image.base64 || image.uri.startsWith('data:')) {
      const dataUri = image.uri.startsWith('data:')
        ? image.uri
        : `data:${image.contentType};base64,${image.base64}`;
      const blob = await (await fetch(dataUri)).blob();
      if (blob.size > maxBytes) {
        throw new ApiError({
          status: 413,
          code: 'ATTENDANCE_EVIDENCE_TOO_LARGE',
          message: 'This photo is larger than the server allows. Capture it again.',
        });
      }
      return { body: blob, sizeBytes: blob.size };
    }
    const blob = await (await fetch(image.uri)).blob();
    if (blob.size > maxBytes) {
      throw new ApiError({
        status: 413,
        code: 'ATTENDANCE_EVIDENCE_TOO_LARGE',
        message: 'This photo is larger than the server allows. Capture it again.',
      });
    }
    return { body: blob, sizeBytes: blob.size };
  }

  const file = new File(image.uri);
  if (!file.exists) {
    throw new ApiError({
      status: 0,
      code: 'ATTENDANCE_EVIDENCE_FILE_MISSING',
      message: 'The captured photo is no longer on this device. Capture it again.',
    });
  }
  if (file.size > maxBytes) {
    throw new ApiError({
      status: 413,
      code: 'ATTENDANCE_EVIDENCE_TOO_LARGE',
      message: 'This photo is larger than the server allows. Capture it again.',
    });
  }
  return { body: file as unknown as BodyInit, sizeBytes: file.size };
}

/**
 * Uploads raw image bytes to the private evidence target. A lost response is
 * safe to retry: the server reports ALREADY_UPLOADED, which is treated as
 * success. A 401 is refreshed and retried once.
 */
export async function uploadAttendanceEvidence(options: {
  agent: AgentCredentials;
  target: AttendanceUploadTarget;
  image: LocalImage;
}): Promise<void> {
  const { agent, target, image } = options;
  const { body, sizeBytes } = await buildUploadBody(image, target.maxBytes);
  if (sizeBytes <= 0) {
    throw new ApiError({
      status: 422,
      code: 'INVALID_ATTENDANCE_EVIDENCE_FILE',
      message: 'The captured photo is empty. Capture it again.',
    });
  }

  let retriedAuth = false;

  for (;;) {
    const controller = new AbortController();
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, 60_000);

    let response: Response;
    try {
      const accessToken = await getValidAccessToken();
      const headers = uploadHeaders(target, accessToken, agent);
      const fetchImpl = Platform.OS === 'web' ? fetch : expoFetch;
      response = (await fetchImpl(target.url, {
        method: target.method || 'PUT',
        headers,
        body,
        signal: controller.signal,
      })) as Response;
    } catch {
      clearTimeout(timeout);
      throw new NetworkError(timedOut);
    }

    let text: string;
    try {
      text = await response.text();
    } catch {
      clearTimeout(timeout);
      throw new NetworkError(timedOut);
    }
    clearTimeout(timeout);

    if (response.ok) return;

    const error = parseErrorBody(text);
    if (
      response.status === 401 &&
      !retriedAuth &&
      !UPLOAD_AGENT_AUTH_CODES.has(error.code)
    ) {
      retriedAuth = true;
      await refreshSession();
      continue;
    }

    if (error.code === 'ATTENDANCE_EVIDENCE_ALREADY_UPLOADED') return;

    throw new ApiError({
      status: response.status,
      code: error.code,
      message: error.message,
      details: error.details,
      requestId: error.requestId,
    });
  }
}
