import { describe, it, expect, vi } from 'vitest';
import {
  shouldSkipBrowserInstall,
  installWithRetry,
  main,
  DEFAULT_ATTEMPTS,
} from '../../build_js/postinstall.js';

describe('shouldSkipBrowserInstall', () => {
  it('is true only for the exact string "1"', () => {
    expect(shouldSkipBrowserInstall({ PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' })).toBe(true);
  });

  it('is false when the flag is unset', () => {
    expect(shouldSkipBrowserInstall({})).toBe(false);
  });

  it('is false for truthy-looking non-"1" values', () => {
    expect(shouldSkipBrowserInstall({ PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: 'true' })).toBe(false);
    expect(shouldSkipBrowserInstall({ PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '0' })).toBe(false);
    expect(shouldSkipBrowserInstall({ PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '' })).toBe(false);
  });

  it('tolerates a missing env object', () => {
    expect(shouldSkipBrowserInstall(undefined)).toBe(false);
  });
});

describe('installWithRetry', () => {
  it('returns 1 when the first attempt succeeds and does not retry', () => {
    const run = vi.fn();
    const log = vi.fn();
    expect(installWithRetry(run, 3, log)).toBe(1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(log).not.toHaveBeenCalled();
  });

  it('retries past failures and returns the succeeding attempt number', () => {
    let calls = 0;
    const run = vi.fn(() => { if (++calls < 3) throw new Error('stall'); });
    const log = vi.fn();
    expect(installWithRetry(run, 3, log)).toBe(3);
    expect(run).toHaveBeenCalledTimes(3);
    expect(log).toHaveBeenCalledTimes(2);
  });

  it('rethrows the final error after exhausting attempts', () => {
    const run = vi.fn(() => { throw new Error('boom'); });
    expect(() => installWithRetry(run, 2, vi.fn())).toThrow('boom');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('defaults to DEFAULT_ATTEMPTS attempts', () => {
    const run = vi.fn(() => { throw new Error('nope'); });
    expect(() => installWithRetry(run, undefined, vi.fn())).toThrow('nope');
    expect(run).toHaveBeenCalledTimes(DEFAULT_ATTEMPTS);
  });
});

describe('main', () => {
  it('skips the install when the flag is set, attempting no work', () => {
    const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const install = vi.fn();
    expect(main({ PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' }, install)).toBe(false);
    expect(install).not.toHaveBeenCalled();
    logSpy.mockRestore();
  });

  it('runs the install when the flag is not set', () => {
    const install = vi.fn();
    expect(main({}, install)).toBe(true);
    expect(install).toHaveBeenCalledTimes(1);
  });
});
