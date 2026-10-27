"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { apiRequest } from "@/lib/api-client";
import { ApiError, errorMessage } from "@/lib/api-error";
import { formatDateTime } from "@/lib/format";
import { liveScreenWebSocketUrl } from "@/lib/live-screen";
import type {
  ScreenLiveSessionSummary,
  ScreenLiveStartResponse,
  ScreenLiveStopResponse,
  ScreenLiveTicketResponse,
} from "@/lib/types";
import { CloseIcon, MonitorIcon, RefreshIcon } from "./icons";
import { Alert, Badge, Button, Spinner } from "./ui";

const MAX_RECONNECT_ATTEMPTS = 3;

const END_REASONS: Record<string, string> = {
  VIEWER_STOPPED: "Live viewing was stopped.",
  ALL_VIEWERS_LEFT: "The live view was closed.",
  AGENT_DISCONNECTED: "The desktop agent disconnected, so capture stopped.",
  AGENT_FAILED: "Screen capture stopped on the desktop.",
  EXPIRED: "The live view reached its time limit. Start again if you still need it.",
  POLICY_DISABLED: "Monitoring was disabled by the organization policy.",
  SESSION_ENDED: "The employee's work session ended.",
  ORGANIZATION_SUSPENDED: "The organization was suspended.",
  AGENT_REVOKED: "The desktop agent was revoked.",
  SERVER_SHUTDOWN: "The server stopped the live view.",
};

type Phase =
  | "idle"
  | "starting"
  | "connecting"
  | "live"
  | "reconnecting"
  | "ended"
  | "unavailable"
  | "unauthorized";

const PHASE_LABELS: Record<Phase, string> = {
  idle: "Ready",
  starting: "Authorizing",
  connecting: "Connecting",
  live: "Live",
  reconnecting: "Reconnecting",
  ended: "Ended",
  unavailable: "Unavailable",
  unauthorized: "Restricted",
};

const PHASE_TONES: Record<
  Phase,
  "neutral" | "success" | "warning" | "danger" | "outline"
> = {
  idle: "outline",
  starting: "warning",
  connecting: "warning",
  live: "success",
  reconnecting: "warning",
  ended: "neutral",
  unavailable: "danger",
  unauthorized: "danger",
};

interface LiveMessage {
  type?: unknown;
  code?: unknown;
  reason?: unknown;
  message?: unknown;
}

function endedMessage(reason: unknown): string {
  return typeof reason === "string" && END_REASONS[reason]
    ? END_REASONS[reason]
    : "The live screen session ended.";
}

type TicketFailure = "retry" | "ended" | "denied";

/** Maps a ticket request failure to the viewer state the user should see. */
function classifyTicketFailure(error: unknown): TicketFailure {
  if (!(error instanceof ApiError)) return "retry";
  if (error.status === 401 || error.status === 403) return "denied";
  if (error.status === 404 || error.status === 409 || error.status === 410) return "ended";
  return error.status === 429 || error.status >= 500 ? "retry" : "denied";
}

/**
 * Administrator-only live screen viewer.
 *
 * Capture requires an explicit administrator action: either the Start button in
 * this dialog or a caller that already asked to view and passes `autoStart`.
 * Either way the backend authorizes a session and issues a one-time viewer
 * ticket. Frames are shown from an in-memory object URL and are never stored by
 * the browser.
 */
export function LiveScreenViewer({
  employeeId,
  employeeName,
  organizationId,
  timezone,
  autoStart = false,
  onClose,
  onEnded,
}: {
  employeeId: string;
  employeeName: string;
  organizationId: string;
  timezone: string;
  /** Start the authorized session immediately, for callers that already asked to view. */
  autoStart?: boolean;
  onClose: () => void;
  onEnded: () => void;
}) {
  const [phase, setPhase] = useState<Phase>(autoStart ? "starting" : "idle");
  const [message, setMessage] = useState<string | null>(null);
  const [session, setSession] = useState<ScreenLiveSessionSummary | null>(null);
  const [frameUrl, setFrameUrl] = useState<string | null>(null);
  const [lastFrameAt, setLastFrameAt] = useState<string | null>(null);

  const panelRef = useRef<HTMLDivElement>(null);
  const socketRef = useRef<WebSocket | null>(null);
  const sessionRef = useRef<ScreenLiveSessionSummary | null>(null);
  const frameUrlRef = useRef<string | null>(null);
  const stoppedRef = useRef(false);
  const startingRef = useRef(false);
  const mountedRef = useRef(true);
  const generationRef = useRef(0);
  const connectRef = useRef<(activeSession: ScreenLiveSessionSummary, attempt: number) => void>(
    () => undefined,
  );
  const reconnectTimerRef = useRef<number | null>(null);
  const autoStartedRef = useRef(false);
  const onCloseRef = useRef(onClose);
  const onEndedRef = useRef(onEnded);

  useEffect(() => {
    onCloseRef.current = onClose;
    onEndedRef.current = onEnded;
  }, [onClose, onEnded]);

  const clearReconnectTimer = useCallback(() => {
    if (reconnectTimerRef.current === null) return;
    window.clearTimeout(reconnectTimerRef.current);
    reconnectTimerRef.current = null;
  }, []);

  const closeSocket = useCallback((code = 1000, reason = "client stop") => {
    const socket = socketRef.current;
    socketRef.current = null;
    if (!socket) return;
    try {
      socket.close(code, reason);
    } catch {
      // The socket may already be closing.
    }
  }, []);

  const showFrame = useCallback((data: BlobPart) => {
    const blob = data instanceof Blob ? data : new Blob([data], { type: "image/jpeg" });
    const url = URL.createObjectURL(blob);
    const previous = frameUrlRef.current;
    frameUrlRef.current = url;
    setFrameUrl(url);
    setLastFrameAt(new Date().toISOString());
    // Delay revocation so the <img> can repaint before its previous URL is freed.
    if (previous) window.setTimeout(() => URL.revokeObjectURL(previous), 1_000);
  }, []);

  const stop = useCallback(() => {
    if (stoppedRef.current) {
      onCloseRef.current();
      return;
    }
    stoppedRef.current = true;
    generationRef.current += 1;
    clearReconnectTimer();
    closeSocket();
    startingRef.current = false;
    const current = sessionRef.current;
    sessionRef.current = null;
    onEndedRef.current();
    onCloseRef.current();
    if (current) {
      void apiRequest<ScreenLiveStopResponse>(
        `/admin/screen-live-sessions/${current.id}/stop`,
        {
          method: "POST",
          headers: { "X-Organization-Id": organizationId },
          body: {},
        },
      ).catch(() => undefined);
    }
  }, [clearReconnectTimer, closeSocket, organizationId]);

  const scheduleReconnect = useCallback(
    (activeSession: ScreenLiveSessionSummary, attempt: number) => {
      if (stoppedRef.current || !mountedRef.current) return;
      if (attempt >= MAX_RECONNECT_ATTEMPTS) {
        setPhase("unavailable");
        setMessage("The live view connection was lost. Close this window and start again.");
        return;
      }
      clearReconnectTimer();
      setPhase("reconnecting");
      const delay = 1_000 * Math.pow(2, attempt);
      reconnectTimerRef.current = window.setTimeout(() => {
        reconnectTimerRef.current = null;
        connectRef.current(activeSession, attempt + 1);
      }, delay);
    },
    [clearReconnectTimer],
  );

  const connect = useCallback(
    async (activeSession: ScreenLiveSessionSummary, attempt: number) => {
      const generation = ++generationRef.current;
      const isCurrent = () =>
        generation === generationRef.current && !stoppedRef.current && mountedRef.current;

      setMessage(null);
      setPhase(attempt > 0 ? "reconnecting" : "connecting");

      let ticket: ScreenLiveTicketResponse;
      try {
        ticket = await apiRequest<ScreenLiveTicketResponse>(
          `/admin/screen-live-sessions/${activeSession.id}/viewer-tickets`,
          {
            method: "POST",
            headers: { "X-Organization-Id": organizationId },
            body: {},
          },
        );
      } catch (error) {
        if (!isCurrent()) return;
        const outcome = classifyTicketFailure(error);
        if (outcome !== "retry") {
          setPhase(outcome === "ended" ? "ended" : "unauthorized");
          setMessage(errorMessage(error));
          if (outcome === "ended") onEndedRef.current();
          return;
        }
        if (attempt >= MAX_RECONNECT_ATTEMPTS) {
          setPhase("unavailable");
          setMessage(
            "The live view connection could not be established. Close this window and start again.",
          );
          return;
        }
        scheduleReconnect(activeSession, attempt);
        return;
      }

      if (!isCurrent()) return;

      let url: string;
      try {
        url = liveScreenWebSocketUrl(ticket.data.websocketPath);
      } catch (error) {
        setPhase("unavailable");
        setMessage(errorMessage(error));
        return;
      }

      let socket: WebSocket;
      try {
        socket = new WebSocket(url);
      } catch {
        if (attempt >= MAX_RECONNECT_ATTEMPTS) {
          setPhase("unavailable");
          setMessage("The live view connection could not be opened.");
          return;
        }
        scheduleReconnect(activeSession, attempt);
        return;
      }

      socket.binaryType = "arraybuffer";
      socketRef.current = socket;
      let authFailureMessage: string | null = null;

      socket.onopen = () => {
        if (!isCurrent()) return;
        try {
          // The ticket is single-use and stays out of the URL and access logs.
          socket.send(JSON.stringify({ type: "authenticate", ticket: ticket.data.ticket }));
        } catch {
          socket.close();
        }
      };

      socket.onmessage = (event: MessageEvent) => {
        if (!isCurrent()) return;

        if (typeof event.data === "string") {
          let payload: LiveMessage;
          try {
            payload = JSON.parse(event.data) as LiveMessage;
          } catch {
            return;
          }
          if (payload.type === "live.ready" || payload.type === "live.started") {
            setPhase("live");
            setMessage(null);
            return;
          }
          if (payload.type === "live.error") {
            if (typeof payload.message === "string" && payload.message) {
              authFailureMessage = payload.message;
            }
            return;
          }
          if (payload.type === "live.ended") {
            generationRef.current += 1;
            clearReconnectTimer();
            closeSocket(4000, "session ended");
            setPhase("ended");
            setMessage(endedMessage(payload.reason));
            onEndedRef.current();
          }
          return;
        }

        if (event.data instanceof ArrayBuffer || event.data instanceof Blob) {
          showFrame(event.data);
        }
      };

      socket.onclose = (event: CloseEvent) => {
        if (!isCurrent()) return;
        socketRef.current = null;
        if (event.code === 4000) {
          generationRef.current += 1;
          setPhase("ended");
          setMessage("The live screen session ended.");
          onEndedRef.current();
          return;
        }
        if (event.code === 4001) {
          generationRef.current += 1;
          setPhase("unauthorized");
          setMessage(authFailureMessage ?? "The live screen ticket was rejected.");
          return;
        }
        if (event.code === 4003) {
          generationRef.current += 1;
          setPhase("unauthorized");
          setMessage("Live screen access was revoked by the server.");
          onEndedRef.current();
          return;
        }
        scheduleReconnect(activeSession, attempt);
      };

      socket.onerror = () => {
        // The close handler owns retry and end states.
      };
    },
    [clearReconnectTimer, closeSocket, organizationId, scheduleReconnect, showFrame],
  );

  useEffect(() => {
    connectRef.current = connect;
  }, [connect]);

  const start = useCallback(async () => {
    if (startingRef.current || stoppedRef.current) return;
    startingRef.current = true;
    setPhase("starting");
    setMessage(null);
    sessionRef.current = null;
    setSession(null);
    if (frameUrlRef.current) {
      URL.revokeObjectURL(frameUrlRef.current);
      frameUrlRef.current = null;
    }
    setFrameUrl(null);
    setLastFrameAt(null);

    try {
      const response = await apiRequest<ScreenLiveStartResponse>(
        `/admin/employees/${employeeId}/screen-live-sessions`,
        {
          method: "POST",
          headers: { "X-Organization-Id": organizationId },
          body: {},
        },
      );
      if (stoppedRef.current || !mountedRef.current) {
        void apiRequest<ScreenLiveStopResponse>(
          `/admin/screen-live-sessions/${response.data.session.id}/stop`,
          {
            method: "POST",
            headers: { "X-Organization-Id": organizationId },
            body: {},
          },
        ).catch(() => undefined);
        return;
      }

      sessionRef.current = response.data.session;
      setSession(response.data.session);
      startingRef.current = false;
      await connect(response.data.session, 0);
    } catch (error) {
      startingRef.current = false;
      if (stoppedRef.current || !mountedRef.current) return;
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) {
        setPhase("unauthorized");
      } else {
        setPhase("unavailable");
      }
      setMessage(errorMessage(error));
    }
  }, [connect, employeeId, organizationId]);

  const retry = useCallback(() => {
    if (phase === "ended") {
      void start();
      return;
    }
    const activeSession = sessionRef.current;
    if (activeSession) {
      void connect(activeSession, 0);
      return;
    }
    void start();
  }, [connect, phase, start]);

  useEffect(() => {
    mountedRef.current = true;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      mountedRef.current = false;
      generationRef.current += 1;
      clearReconnectTimer();
      closeSocket();
      if (frameUrlRef.current) {
        URL.revokeObjectURL(frameUrlRef.current);
        frameUrlRef.current = null;
      }
      const current = sessionRef.current;
      sessionRef.current = null;
      document.body.style.overflow = previousOverflow;
      if (current) {
        void apiRequest<ScreenLiveStopResponse>(
          `/admin/screen-live-sessions/${current.id}/stop`,
          {
            method: "POST",
            headers: { "X-Organization-Id": organizationId },
            body: {},
          },
        ).catch(() => undefined);
      }
    };
  }, [clearReconnectTimer, closeSocket, organizationId]);

  useEffect(() => {
    if (!autoStart || autoStartedRef.current) return;
    // The caller already asked to view, so authorize and connect without a second click.
    autoStartedRef.current = true;
    void start();
  }, [autoStart, start]);

  useEffect(() => {
    const previouslyFocused =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const timer = window.setTimeout(() => {
      const preferred = panelRef.current?.querySelector<HTMLElement>("[data-autofocus]");
      (preferred ?? panelRef.current)?.focus();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      previouslyFocused?.focus();
    };
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        stop();
        return;
      }
      if (event.key !== "Tab" || !panelRef.current) return;
      const focusable = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((element) => element.offsetParent !== null);
      if (focusable.length === 0) {
        event.preventDefault();
        panelRef.current.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [stop]);

  const active =
    phase === "starting" ||
    phase === "connecting" ||
    phase === "live" ||
    phase === "reconnecting";
  const canStart = phase === "idle" || phase === "unavailable" || phase === "unauthorized";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-0 sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-overlay"
        aria-label="Close live screen"
        tabIndex={-1}
        onClick={stop}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="live-screen-title"
        tabIndex={-1}
        className="relative flex max-h-[100vh] w-full max-w-5xl flex-col overflow-hidden border border-line bg-surface shadow-xl outline-none sm:max-h-[calc(100vh-2rem)] sm:rounded-xl"
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="flex min-w-0 items-start gap-2.5">
            <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-line bg-surface-muted text-ink-secondary">
              <MonitorIcon className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="live-screen-title" className="text-sm font-semibold text-ink">
                  Live screen · {employeeName}
                </h2>
                <Badge tone={PHASE_TONES[phase]}>{PHASE_LABELS[phase]}</Badge>
              </div>
              <p className="mt-0.5 text-[11px] text-muted">
                {lastFrameAt
                  ? `Last frame ${formatDateTime(lastFrameAt, timezone)}`
                  : "No frames received yet"}
                {session ? ` · Session ends ${formatDateTime(session.expiresAt, timezone)}` : ""}
              </p>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1">
            {active ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={stop}
                data-autofocus
                aria-label="Stop viewing live screen"
              >
                Stop viewing
              </Button>
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              onClick={stop}
              aria-label="Close live screen"
              data-autofocus={active ? undefined : true}
            >
              <CloseIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {phase === "idle" ? (
            <div className="space-y-4 p-4">
              <Alert tone="info" title="Deliberate, audited live view">
                Capture starts only after you press Start live view. It is limited by the server,
                stops when you press Stop, close this window, or the work session ends, and is
                recorded in the audit history. Frames are shown only in this browser and are not
                recorded.
              </Alert>
              <div className="rounded-xl border border-line bg-surface-muted p-4">
                <p className="text-xs leading-5 text-muted">
                  The employee&apos;s desktop must be online with an active work session. Their
                  desktop agent receives the capture command only after the backend authorizes this
                  session.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void start()} data-autofocus>
                  Start live view
                </Button>
                <Button variant="ghost" onClick={stop}>
                  Cancel
                </Button>
              </div>
            </div>
          ) : phase === "starting" || phase === "connecting" ? (
            <div
              className="flex min-h-[18rem] flex-col items-center justify-center gap-3 p-6 text-center"
              aria-busy="true"
            >
              <Spinner className="h-5 w-5 text-ink-secondary" />
              <p className="text-xs font-medium text-ink-secondary">
                {phase === "starting"
                  ? "Authorizing a live screen session…"
                  : "Waiting for the desktop agent…"}
              </p>
              <p className="max-w-md text-[11px] leading-5 text-muted">
                {phase === "starting"
                  ? "The backend is checking the monitoring policy, your role, and the employee's active work session."
                  : "The session is authorized. Frames appear when the desktop agent connects to the binary relay."}
              </p>
            </div>
          ) : phase === "ended" || phase === "unavailable" || phase === "unauthorized" ? (
            <div className="space-y-4 p-4">
              <Alert
                tone={phase === "ended" ? "info" : phase === "unavailable" ? "danger" : "warning"}
                title={
                  phase === "ended"
                    ? "Live view ended"
                    : phase === "unavailable"
                      ? "Live view unavailable"
                      : "Live view restricted"
                }
              >
                {message ??
                  (phase === "unauthorized"
                    ? "Your role or the organization policy does not allow live viewing."
                    : "The live screen session could not continue.")}
              </Alert>
              <div className="flex flex-wrap gap-2">
                {phase !== "unauthorized" ? (
                  <Button variant="secondary" onClick={retry}>
                    <RefreshIcon className="h-3.5 w-3.5" />
                    Try again
                  </Button>
                ) : null}
                <Button variant="ghost" onClick={stop}>
                  Close
                </Button>
              </div>
            </div>
          ) : (
            <div className="relative aspect-video w-full overflow-hidden bg-media">
              {frameUrl ? (
                // Frames are ephemeral object URLs; nothing is stored or cached.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={frameUrl}
                  alt={`Live screen of ${employeeName}`}
                  className="h-full w-full object-contain"
                />
              ) : (
                <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
                  <Spinner className="h-5 w-5 text-media-foreground" />
                  <p className="text-xs text-media-foreground" aria-busy="true">
                    {phase === "reconnecting"
                      ? "Reconnecting to the live view…"
                      : "Waiting for the first frame…"}
                  </p>
                </div>
              )}
              {phase === "live" ? (
                <span className="absolute left-3 top-3 inline-flex items-center gap-1.5 rounded-md bg-black/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" aria-hidden="true" />
                  Live
                </span>
              ) : phase === "reconnecting" ? (
                <span className="absolute left-3 top-3 rounded-md bg-black/70 px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
                  Reconnecting
                </span>
              ) : null}
            </div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line bg-surface-muted px-4 py-2.5">
          <p className="text-[11px] leading-5 text-muted">
            Live frames are not stored. Stopping ends the session for this employee and notifies the
            desktop agent immediately.
          </p>
          {canStart ? (
            <span className="text-[11px] text-muted">Capture has not started.</span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
