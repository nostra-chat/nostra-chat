import {afterEach, describe, expect, it, vi} from 'vitest';
import {createProgressReporter} from '@lib/serviceWorker/update-asset-utils';

afterEach(() => {
  vi.useRealTimers();
});

describe('createProgressReporter', () => {
  it('throttles intermediate events and always emits the exact final count', async() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const callback = vi.fn();
    const reporter = createProgressReporter(callback, 100);

    reporter.report(1, 4159);
    reporter.report(2, 4159);
    reporter.report(154, 4159);
    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenLastCalledWith(1, 4159);

    await vi.advanceTimersByTimeAsync(99);
    expect(callback).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(callback).toHaveBeenLastCalledWith(154, 4159);

    reporter.report(155, 4159);
    reporter.finish(4159, 4159);
    expect(callback).toHaveBeenLastCalledWith(4159, 4159);
    expect(callback).toHaveBeenCalledTimes(3);
  });

  it('cancels a pending report without emitting stale progress', async() => {
    vi.useFakeTimers();
    vi.setSystemTime(1_000);
    const callback = vi.fn();
    const reporter = createProgressReporter(callback, 100);
    reporter.report(1, 10);
    reporter.report(2, 10);
    reporter.cancel();

    await vi.advanceTimersByTimeAsync(100);

    expect(callback).toHaveBeenCalledTimes(1);
    expect(callback).toHaveBeenLastCalledWith(1, 10);
  });
});
