import { I18n } from './i18n';
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
describe('language preference', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      removeItem: (key: string) => {
        values.delete(key);
      },
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it('restores Turkish across new sessions and remembers switching back', () => {
    new I18n().setLanguage('tr');
    const next = new I18n();
    expect(next.lang()).toBe('tr');
    next.setLanguage('en');
    expect(new I18n().lang()).toBe('en');
  });
  it('ignores invalid persisted values', () => {
    window.localStorage.setItem('remvora.language', 'invalid');
    expect(new I18n().lang()).toBe('en');
  });
  it('keeps language switching usable when storage is blocked', () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    const service = new I18n();
    service.setLanguage('tr');
    expect(service.lang()).toBe('tr');
  });
});
