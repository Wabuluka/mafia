import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { clearDeadline, scheduleDeadline } from '../scheduler';

describe('scheduleDeadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('fires at the absolute deadline, not after a fixed duration from call time', () => {
    const now = Date.now();
    const onDeadline = vi.fn();
    scheduleDeadline(now + 5000, onDeadline);

    vi.advanceTimersByTime(4999);
    expect(onDeadline).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(onDeadline).toHaveBeenCalledOnce();
  });

  it('fires immediately (next tick) if the deadline has already passed', () => {
    const now = Date.now();
    const onDeadline = vi.fn();
    scheduleDeadline(now - 10_000, onDeadline);

    vi.advanceTimersByTime(0);
    expect(onDeadline).toHaveBeenCalledOnce();
  });

  it('re-derives remaining time from the deadline rather than assuming the original duration elapsed', () => {
    // Simulate scheduling, then the clock advancing by some amount BEFORE
    // the deadline is (re-)scheduled again with the same absolute endsAt —
    // e.g. what a restart-resume replay might look like if it reused the
    // same deadline. The second schedule should only wait the REMAINING
    // time, not the full original duration again.
    const now = Date.now();
    const endsAt = now + 10_000;

    vi.advanceTimersByTime(6000); // 6s have passed

    const onDeadline = vi.fn();
    scheduleDeadline(endsAt, onDeadline);

    vi.advanceTimersByTime(3999); // total elapsed since endsAt was computed: 9.999s
    expect(onDeadline).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1); // total elapsed: 10s — deadline reached
    expect(onDeadline).toHaveBeenCalledOnce();
  });

  it('returns a handle carrying the same endsAt it was given', () => {
    const endsAt = Date.now() + 1234;
    const deadline = scheduleDeadline(endsAt, () => {});
    expect(deadline.endsAt).toBe(endsAt);
  });
});

describe('clearDeadline', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('prevents a scheduled deadline from firing', () => {
    const onDeadline = vi.fn();
    const deadline = scheduleDeadline(Date.now() + 1000, onDeadline);
    clearDeadline(deadline);

    vi.advanceTimersByTime(2000);
    expect(onDeadline).not.toHaveBeenCalled();
  });

  it('is a safe no-op when given undefined', () => {
    expect(() => clearDeadline(undefined)).not.toThrow();
  });
});
