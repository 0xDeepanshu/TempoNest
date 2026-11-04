import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useApi } from "@/lib/use-api";

describe("useApi", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refreshes on an interval without discarding the visible result", async () => {
    vi.useFakeTimers();
    const factory = vi.fn().mockResolvedValue({ count: 1 });

    const { result } = renderHook(() => useApi(factory, [], { refreshIntervalMs: 1_000 }));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.data).toEqual({ count: 1 });
    expect(factory).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000);
    });
    expect(factory).toHaveBeenCalledTimes(2);
    expect(result.current.data).toEqual({ count: 1 });
    expect(result.current.loading).toBe(false);
  });

  it("keeps the last result while a manual reload is pending", async () => {
    let resolveSecond: ((value: { count: number }) => void) | undefined;
    const factory = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockImplementationOnce(
        () =>
          new Promise<{ count: number }>((resolve) => {
            resolveSecond = resolve;
          }),
      );

    const { result } = renderHook(() => useApi(factory, [], { keepPreviousData: true }));

    await waitFor(() => expect(result.current.data).toEqual({ count: 1 }));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.refreshing).toBe(true));
    expect(result.current.data).toEqual({ count: 1 });

    await act(async () => {
      resolveSecond?.({ count: 2 });
    });
    await waitFor(() => expect(result.current.data).toEqual({ count: 2 }));
    expect(result.current.refreshing).toBe(false);
  });

  it("keeps the last result when a background refresh fails", async () => {
    const factory = vi
      .fn()
      .mockResolvedValueOnce({ count: 1 })
      .mockRejectedValueOnce(new Error("temporarily unavailable"));

    const { result } = renderHook(() => useApi(factory, [], { keepPreviousData: true }));

    await waitFor(() => expect(result.current.data).toEqual({ count: 1 }));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.error).toBe("temporarily unavailable"));
    expect(result.current.data).toEqual({ count: 1 });
  });
});
