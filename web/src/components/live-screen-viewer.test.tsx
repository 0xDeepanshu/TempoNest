import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LiveScreenViewer } from "@/components/live-screen-viewer";
import { apiRequest } from "@/lib/api-client";
import { ApiError } from "@/lib/api-error";
import type {
  ScreenLiveSessionSummary,
  ScreenLiveStartResponse,
  ScreenLiveStopResponse,
  ScreenLiveTicketResponse,
} from "@/lib/types";

vi.mock("@/lib/api-client", () => ({
  apiRequest: vi.fn(),
}));

const mockedApiRequest = vi.mocked(apiRequest);

const NOW = "2026-10-26T10:00:00.000Z";

function liveSession(overrides: Partial<ScreenLiveSessionSummary> = {}): ScreenLiveSessionSummary {
  return {
    id: "live-1",
    organizationId: "org-1",
    employeeId: "employee-1",
    desktopAgentId: "agent-1",
    timeSessionId: "time-1",
    startedByUserId: "admin-1",
    status: "ACTIVE",
    startedAt: NOW,
    expiresAt: "2026-10-26T10:15:00.000Z",
    endedAt: null,
    terminationReason: null,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function startResponse(): ScreenLiveStartResponse {
  return {
    data: {
      session: liveSession(),
      delivery: { agentOnline: true, delivered: true, note: "delivered" },
      reused: false,
    },
    serverTime: NOW,
  };
}

function ticketResponse(ticket = "ticket-1"): ScreenLiveTicketResponse {
  return {
    data: {
      ticket,
      expiresAt: "2026-10-26T10:01:00.000Z",
      websocketPath: "/api/v1/ws/screen-live",
      session: liveSession(),
      viewer: {
        id: "viewer-1",
        screenLiveSessionId: "live-1",
        userId: "admin-1",
        joinedAt: null,
        leftAt: null,
        lastSeenAt: null,
        disconnectedReason: null,
      },
    },
    serverTime: NOW,
  };
}

function stopResponse(): ScreenLiveStopResponse {
  return {
    data: { session: liveSession({ status: "ENDED", terminationReason: "VIEWER_STOPPED" }), stopped: true },
    serverTime: NOW,
  };
}

class FakeWebSocket {
  static instances: FakeWebSocket[] = [];

  url: string;
  binaryType = "blob";
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  closeCalls: Array<{ code?: number; reason?: string }> = [];
  sent: string[] = [];

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
  }

  send(data: string | ArrayBuffer) {
    this.sent.push(String(data));
  }

  close(code?: number, reason?: string) {
    this.readyState = 3;
    this.closeCalls.push({ code, reason });
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  receive(data: string | ArrayBuffer) {
    this.onmessage?.({ data } as MessageEvent);
  }

  serverClose(code: number) {
    this.readyState = 3;
    this.onclose?.({ code } as CloseEvent);
  }
}

let objectUrlCounter = 0;
let createObjectUrl: ReturnType<typeof vi.fn>;
let revokeObjectUrl: ReturnType<typeof vi.fn>;

function renderViewer(
  overrides: { onClose?: () => void; onEnded?: () => void; autoStart?: boolean } = {},
) {
  const onClose = overrides.onClose ?? vi.fn();
  const onEnded = overrides.onEnded ?? vi.fn();
  const view = render(
    <LiveScreenViewer
      employeeId="employee-1"
      employeeName="Ada Lovelace"
      organizationId="org-1"
      timezone="UTC"
      autoStart={overrides.autoStart}
      onClose={onClose}
      onEnded={onEnded}
    />,
  );
  return { ...view, onClose, onEnded };
}

function routeApi(options: { ticketError?: unknown; startError?: unknown } = {}) {
  mockedApiRequest.mockImplementation((async (path: string) => {
    if (path.endsWith("/viewer-tickets")) {
      if (options.ticketError) throw options.ticketError;
      return ticketResponse();
    }
    if (path.endsWith("/stop")) return stopResponse();
    if (path.includes("/screen-live-sessions")) {
      if (options.startError) throw options.startError;
      return startResponse();
    }
    throw new Error(`Unexpected API call: ${path}`);
  }) as never);
}

async function startViewer() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Start live view" }));
  await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
  return user;
}

beforeEach(() => {
  vi.stubEnv("NEXT_PUBLIC_API_WS_URL", "ws://localhost:4000");
  FakeWebSocket.instances = [];
  vi.stubGlobal("WebSocket", FakeWebSocket);
  objectUrlCounter = 0;
  createObjectUrl = vi.fn(() => `blob:frame-${++objectUrlCounter}`);
  revokeObjectUrl = vi.fn();
  Object.defineProperty(URL, "createObjectURL", { value: createObjectUrl, configurable: true });
  Object.defineProperty(URL, "revokeObjectURL", { value: revokeObjectUrl, configurable: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("LiveScreenViewer", () => {
  it("does nothing until Start is pressed, then uses a one-time ticket", async () => {
    routeApi();
    renderViewer();

    expect(mockedApiRequest).not.toHaveBeenCalled();
    expect(FakeWebSocket.instances).toHaveLength(0);

    await startViewer();

    expect(mockedApiRequest).toHaveBeenNthCalledWith(
      1,
      "/admin/employees/employee-1/screen-live-sessions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mockedApiRequest).toHaveBeenNthCalledWith(
      2,
      "/admin/screen-live-sessions/live-1/viewer-tickets",
      expect.objectContaining({ method: "POST" }),
    );
    expect(FakeWebSocket.instances[0].url).toBe(
      "ws://localhost:4000/api/v1/ws/screen-live",
    );
    expect(FakeWebSocket.instances[0].url).not.toMatch(/ticket|token/);

    act(() => {
      FakeWebSocket.instances[0].open();
    });
    expect(JSON.parse(FakeWebSocket.instances[0].sent[0])).toEqual({
      type: "authenticate",
      ticket: "ticket-1",
    });
    expect(screen.getByText("Waiting for the desktop agent…")).toBeInTheDocument();
  });

  it("starts immediately when the caller already asked to view", async () => {
    routeApi();
    renderViewer({ autoStart: true });

    await waitFor(() => expect(FakeWebSocket.instances).toHaveLength(1));
    expect(mockedApiRequest).toHaveBeenCalledTimes(2);
    expect(mockedApiRequest).toHaveBeenNthCalledWith(
      1,
      "/admin/employees/employee-1/screen-live-sessions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(mockedApiRequest).toHaveBeenNthCalledWith(
      2,
      "/admin/screen-live-sessions/live-1/viewer-tickets",
      expect.objectContaining({ method: "POST" }),
    );

    const socket = FakeWebSocket.instances[0];
    expect(socket.url).toBe("ws://localhost:4000/api/v1/ws/screen-live");
    expect(socket.url).not.toMatch(/ticket|token/);

    act(() => {
      socket.open();
    });
    expect(socket.sent).toEqual([JSON.stringify({ type: "authenticate", ticket: "ticket-1" })]);
  });

  it("shows frames as ephemeral object URLs and reports the last frame", async () => {
    routeApi();
    const { onEnded } = renderViewer();
    await startViewer();
    const socket = FakeWebSocket.instances[0];

    act(() => {
      socket.open();
      socket.receive(JSON.stringify({ type: "live.ready" }));
    });
    expect(screen.getByText("Waiting for the first frame…")).toBeInTheDocument();

    act(() => {
      socket.receive(new ArrayBuffer(8));
    });

    const image = screen.getByRole("img", { name: "Live screen of Ada Lovelace" });
    expect(image).toHaveAttribute("src", "blob:frame-1");
    expect(createObjectUrl).toHaveBeenCalledTimes(1);
    expect(screen.getByText(/Last frame/)).toBeInTheDocument();

    act(() => {
      socket.receive(new ArrayBuffer(8));
    });
    expect(screen.getByRole("img", { name: "Live screen of Ada Lovelace" })).toHaveAttribute(
      "src",
      "blob:frame-2",
    );

    fireEvent.click(screen.getByRole("button", { name: "Stop viewing live screen" }));
    await waitFor(() =>
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/admin/screen-live-sessions/live-1/stop",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(onEnded).toHaveBeenCalled();
  });

  it("revokes the last frame and stops the session on unmount", async () => {
    routeApi();
    const onEnded = vi.fn();
    const view = renderViewer({ onEnded });
    await startViewer();
    const socket = FakeWebSocket.instances[0];

    act(() => {
      socket.open();
      socket.receive(JSON.stringify({ type: "live.ready" }));
      socket.receive(new ArrayBuffer(8));
    });
    expect(createObjectUrl).toHaveBeenCalled();

    view.unmount();

    expect(revokeObjectUrl).toHaveBeenCalledWith("blob:frame-1");
    await waitFor(() =>
      expect(mockedApiRequest).toHaveBeenCalledWith(
        "/admin/screen-live-sessions/live-1/stop",
        expect.objectContaining({ method: "POST" }),
      ),
    );
    expect(onEnded).not.toHaveBeenCalled();
  });

  it("shows a restricted state when the ticket is refused", async () => {
    routeApi({
      ticketError: new ApiError({
        status: 403,
        code: "SCREEN_LIVE_ROLE_NOT_ALLOWED",
        message: "The monitoring policy does not permit your role to view live screens.",
      }),
    });
    const onClose = vi.fn();
    renderViewer({ onClose });
    await userEvent.setup().click(screen.getByRole("button", { name: "Start live view" }));

    expect(await screen.findByText("Live view restricted")).toBeInTheDocument();
    expect(
      screen.getByText("The monitoring policy does not permit your role to view live screens."),
    ).toBeInTheDocument();
    expect(screen.getByText("Live view restricted")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /try again/i })).not.toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("ends the view when the server reports the session ended", async () => {
    routeApi();
    const { onEnded } = renderViewer();
    await startViewer();
    const socket = FakeWebSocket.instances[0];

    act(() => {
      socket.open();
      socket.receive(JSON.stringify({ type: "live.ready" }));
      socket.receive(JSON.stringify({ type: "live.ended", reason: "EXPIRED" }));
    });

    expect(
      screen.getByText("The live view reached its time limit. Start again if you still need it."),
    ).toBeInTheDocument();
    expect(onEnded).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Stop viewing live screen" })).not.toBeInTheDocument();
  });

  it("reconnects with a fresh ticket after an unexpected close", async () => {
    vi.useFakeTimers();
    routeApi();
    renderViewer();
    fireEvent.click(screen.getByRole("button", { name: "Start live view" }));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(FakeWebSocket.instances).toHaveLength(1);

    act(() => {
      FakeWebSocket.instances[0].serverClose(1006);
    });
    expect(screen.getAllByText("Reconnecting").length).toBeGreaterThan(0);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });

    expect(FakeWebSocket.instances).toHaveLength(2);
    expect(
      mockedApiRequest.mock.calls.filter(([path]) => String(path).endsWith("/viewer-tickets")),
    ).toHaveLength(2);
    expect(FakeWebSocket.instances[1].url).toBe(
      "ws://localhost:4000/api/v1/ws/screen-live",
    );

    act(() => {
      FakeWebSocket.instances[1].open();
    });
    expect(JSON.parse(FakeWebSocket.instances[1].sent[0])).toEqual({
      type: "authenticate",
      ticket: "ticket-1",
    });
  });

  it("shows the server reason when the ticket is rejected after connecting", async () => {
    routeApi();
    const { onEnded } = renderViewer();
    await startViewer();
    const socket = FakeWebSocket.instances[0];

    act(() => {
      socket.open();
      socket.receive(
        JSON.stringify({
          type: "live.error",
          code: "SCREEN_LIVE_TICKET_EXPIRED",
          message: "Live screen ticket has expired",
        }),
      );
      socket.serverClose(4001);
    });

    expect(screen.getByText("Live view restricted")).toBeInTheDocument();
    expect(screen.getByText("Live screen ticket has expired")).toBeInTheDocument();
    expect(onEnded).not.toHaveBeenCalled();
  });
});
