import { describe, expect, it } from 'vitest';

import {
  computeWorkTime,
  formatDuration,
  formatDurationWords,
  pauseSessionAt,
  serverClockOffset,
} from './timing';

const START = '2026-10-24T09:00:00.000Z';

function at(value: string): number {
  return Date.parse(value);
}

describe('computeWorkTime', () => {
  it('measures an open session with no breaks', () => {
    const result = computeWorkTime(
      { startedAt: START, endedAt: null },
      at('2026-10-24T09:30:00.000Z'),
    );

    expect(result).toEqual({
      elapsedSeconds: 1800,
      breakSeconds: 0,
      workedSeconds: 1800,
      isOnBreak: false,
    });
  });

  it('deducts a completed break', () => {
    const result = computeWorkTime(
      {
        startedAt: START,
        endedAt: null,
        breaks: [
          { startedAt: '2026-10-24T09:10:00.000Z', endedAt: '2026-10-24T09:20:00.000Z' },
        ],
      },
      at('2026-10-24T10:00:00.000Z'),
    );

    expect(result.elapsedSeconds).toBe(3600);
    expect(result.breakSeconds).toBe(600);
    expect(result.workedSeconds).toBe(3000);
    expect(result.isOnBreak).toBe(false);
  });

  it('counts an open break up to now', () => {
    const result = computeWorkTime(
      {
        startedAt: START,
        endedAt: null,
        activeBreak: { startedAt: '2026-10-24T09:50:00.000Z', endedAt: null },
      },
      at('2026-10-24T10:00:00.000Z'),
    );

    expect(result.elapsedSeconds).toBe(3600);
    expect(result.breakSeconds).toBe(600);
    expect(result.workedSeconds).toBe(3000);
    expect(result.isOnBreak).toBe(true);
  });

  it('clips breaks to the session bounds', () => {
    const result = computeWorkTime(
      {
        startedAt: START,
        endedAt: '2026-10-24T10:00:00.000Z',
        breaks: [
          { startedAt: '2026-10-24T09:50:00.000Z', endedAt: '2026-10-24T10:10:00.000Z' },
        ],
      },
      at('2026-10-24T12:00:00.000Z'),
    );

    expect(result.elapsedSeconds).toBe(3600);
    expect(result.breakSeconds).toBe(600);
    expect(result.workedSeconds).toBe(3000);
  });

  it('uses the server end time for a stopped session', () => {
    const result = computeWorkTime(
      { startedAt: START, endedAt: '2026-10-24T09:30:00.000Z' },
      at('2026-10-24T12:00:00.000Z'),
    );

    expect(result.elapsedSeconds).toBe(1800);
    expect(result.workedSeconds).toBe(1800);
  });

  it('returns zero for an unparseable start time', () => {
    expect(computeWorkTime({ startedAt: 'not-a-date', endedAt: null }, 0)).toEqual({
      elapsedSeconds: 0,
      breakSeconds: 0,
      workedSeconds: 0,
      isOnBreak: false,
    });
  });
});

describe('pauseSessionAt', () => {
  it('stops worked time accumulating at the location-loss moment', () => {
    const paused = pauseSessionAt(
      { startedAt: START, endedAt: null },
      '2026-10-24T09:30:00.000Z',
    );

    expect(paused.status).toBe('ON_BREAK');
    const result = computeWorkTime(paused, at('2026-10-24T10:00:00.000Z'));
    expect(result.isOnBreak).toBe(true);
    expect(result.elapsedSeconds).toBe(3600);
    expect(result.breakSeconds).toBe(1800);
    expect(result.workedSeconds).toBe(1800);
  });

  it('keeps the first pause and one open break on duplicate events', () => {
    const first = pauseSessionAt(
      { startedAt: START, endedAt: null },
      '2026-10-24T09:30:00.000Z',
    );
    const duplicate = pauseSessionAt(first, '2026-10-24T09:45:00.000Z');

    expect(duplicate.activeBreak.startedAt).toBe('2026-10-24T09:30:00.000Z');
    expect(duplicate.breaks).toHaveLength(1);
    const result = computeWorkTime(duplicate, at('2026-10-24T10:00:00.000Z'));
    expect(result.workedSeconds).toBe(1800);
  });

  it('reuses an open break instead of stacking a second pause', () => {
    const paused = pauseSessionAt(
      {
        startedAt: START,
        endedAt: null,
        activeBreak: { startedAt: '2026-10-24T09:20:00.000Z', endedAt: null },
      },
      '2026-10-24T09:30:00.000Z',
    );

    expect(paused.breaks).toHaveLength(1);
    expect(paused.activeBreak.startedAt).toBe('2026-10-24T09:20:00.000Z');
    expect(
      computeWorkTime(paused, at('2026-10-24T10:00:00.000Z')).workedSeconds,
    ).toBe(1200);
  });
});

describe('serverClockOffset', () => {
  it('reports the difference between the server and device clocks', () => {
    const offset = serverClockOffset(
      '2026-10-24T10:00:00.000Z',
      at('2026-10-24T09:59:55.000Z'),
    );

    expect(offset).toBe(5000);
  });

  it('returns zero for an unparseable server time', () => {
    expect(serverClockOffset('nope', 1000)).toBe(0);
  });
});

describe('duration formatting', () => {
  it('formats a timer value', () => {
    expect(formatDuration(3661)).toBe('01:01:01');
    expect(formatDuration(-5)).toBe('00:00:00');
  });

  it('formats a compact human duration', () => {
    expect(formatDurationWords(3600)).toBe('1h 00m');
    expect(formatDurationWords(3599)).toBe('59m');
    expect(formatDurationWords(0)).toBe('0m');
  });
});
