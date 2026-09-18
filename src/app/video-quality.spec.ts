import {
  AdaptiveVideo,
  DEFAULT_QUALITY,
  loadQuality,
  saveQuality,
  validQuality,
} from './video-quality';
import { vi } from 'vitest';
describe('device video preferences', () => {
  beforeEach(() => {
    const values = new Map<string, string>();
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => {
        values.set(key, value);
      },
      clear: () => values.clear(),
    });
  });
  afterEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
  it('restores separate preferences after creating a new reader', () => {
    const manual = { mode: 'manual' as const, fps: 20, bitrate: 2500000, width: 1600 };
    expect(saveQuality('device-a', manual)).toBe(true);
    expect(loadQuality('device-a')).toEqual(manual);
    expect(loadQuality('device-b')).toEqual(DEFAULT_QUALITY);
    saveQuality('device-a', { ...manual, mode: 'auto' });
    expect(loadQuality('device-a').mode).toBe('auto');
  });
  it('rejects corrupt and out-of-range persisted values', () => {
    window.localStorage.setItem('remvora.video.v1.a', '{broken');
    expect(loadQuality('a')).toEqual(DEFAULT_QUALITY);
    expect(validQuality({ ...DEFAULT_QUALITY, fps: 100 })).toBe(false);
    expect(validQuality({ ...DEFAULT_QUALITY, bitrate: -1 })).toBe(false);
    expect(validQuality({ ...DEFAULT_QUALITY, width: 10000 })).toBe(false);
    expect(validQuality({ ...DEFAULT_QUALITY, mode: 'fake' })).toBe(false);
  });
  it('reports failed persistence without crashing', () => {
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    expect(saveQuality('a', DEFAULT_QUALITY)).toBe(false);
  });
});
describe('adaptive video control', () => {
  it('reduces quality on high latency and increases only after sustained recovery', () => {
    const adaptive = new AdaptiveVideo();
    adaptive.sample(900, 15);
    adaptive.sample(900, 15);
    expect(adaptive.sample(900, 15)).toBe(true);
    expect(adaptive.current().fps).toBe(10);
    for (let i = 0; i < 6; i++) adaptive.sample(60, 10);
    expect(adaptive.current().fps).toBe(10);
    expect(adaptive.sample(60, 10)).toBe(true);
    expect(adaptive.current().fps).toBe(15);
  });
  it('reduces quality for low delivery FPS or packet loss and respects bounds', () => {
    const adaptive = new AdaptiveVideo();
    for (let i = 0; i < 30; i++) adaptive.sample(100, 1, 0.1);
    expect(adaptive.current().fps).toBe(3);
    for (let i = 0; i < 80; i++) adaptive.sample(60, 30);
    expect(adaptive.current().fps).toBe(30);
  });
});
