import { vi } from 'vitest';
import { DEFAULT_VIEW, loadView, saveView } from './view-preferences';
import { App } from './app';

describe('persistent remote view preferences', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it('restores smaller text, unmuted audio and volume on a fresh load', () => {
    expect(loadView()).toEqual(DEFAULT_VIEW);
    expect(saveView({ fontSize: 10, muted: false, volume: 0.35 })).toBe(true);
    expect(loadView()).toEqual({ fontSize: 10, muted: false, volume: 0.35 });
  });
  it('rejects invalid stored values and tolerates unavailable storage', () => {
    localStorage.setItem('remvora.view.v1', '{broken');
    expect(loadView()).toEqual(DEFAULT_VIEW);
    localStorage.setItem(
      'remvora.view.v1',
      JSON.stringify({ fontSize: 1, muted: 'false', volume: 2 }),
    );
    expect(loadView()).toEqual(DEFAULT_VIEW);
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    expect(saveView(DEFAULT_VIEW)).toBe(false);
  });
  it('refits the live terminal when its text size changes', () => {
    const fitTerminal = vi.fn();
    const saveViewPreferences = vi.fn();
    const app = {
      terminal: { options: { fontSize: 14 } },
      terminalFontSize: 14,
      fitTerminal,
      saveViewPreferences,
    };
    App.prototype.setTerminalFontSize.call(app as unknown as App, 10);
    expect(app.terminal.options.fontSize).toBe(10);
    expect(fitTerminal).toHaveBeenCalledOnce();
    expect(saveViewPreferences).toHaveBeenCalledOnce();
    App.prototype.setTerminalFontSize.call(app as unknown as App, 0);
    expect(app.terminalFontSize).toBe(10);
  });
});
