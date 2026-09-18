export interface VideoQuality {
  mode: 'auto' | 'manual';
  fps: number;
  bitrate: number;
  width: number;
}
export const DEFAULT_QUALITY: VideoQuality = {
  mode: 'auto',
  fps: 15,
  bitrate: 1200000,
  width: 1280,
};
export function validQuality(value: unknown): value is VideoQuality {
  if (!value || typeof value !== 'object') return false;
  const v = value as VideoQuality;
  return (
    ['auto', 'manual'].includes(v.mode) &&
    Number.isInteger(v.fps) &&
    v.fps >= 3 &&
    v.fps <= 30 &&
    Number.isInteger(v.bitrate) &&
    v.bitrate >= 150000 &&
    v.bitrate <= 8000000 &&
    Number.isInteger(v.width) &&
    v.width >= 640 &&
    v.width <= 1920
  );
}
export function loadQuality(device: string): VideoQuality {
  try {
    const value: unknown = JSON.parse(
      window.localStorage.getItem('remvora.video.v1.' + device) ?? 'null',
    );
    if (validQuality(value)) return { ...value };
  } catch {
    /* Corrupt or unavailable storage uses safe defaults. */
  }
  return { ...DEFAULT_QUALITY };
}
export function saveQuality(device: string, value: VideoQuality): boolean {
  if (!validQuality(value)) return false;
  try {
    window.localStorage.setItem('remvora.video.v1.' + device, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
const LEVELS = [
  { fps: 3, bitrate: 150000, width: 640 },
  { fps: 5, bitrate: 300000, width: 800 },
  { fps: 10, bitrate: 600000, width: 960 },
  { fps: 15, bitrate: 1200000, width: 1280 },
  { fps: 20, bitrate: 2500000, width: 1600 },
  { fps: 30, bitrate: 5000000, width: 1920 },
];
export class AdaptiveVideo {
  private level = 3;
  private healthy = 0;
  private grace = 2;
  current() {
    return { ...LEVELS[this.level] };
  }
  sample(rtt: number, fps: number, loss = 0) {
    if (this.grace-- > 0) return false;
    const target = this.current();
    const poor = rtt > 500 || fps < target.fps * 0.55 || loss > 0.04;
    if (poor) {
      this.healthy = 0;
      if (this.level === 0) return false;
      this.level--;
      this.grace = 2;
      return true;
    }
    if (rtt < 300 && fps >= target.fps * 0.8 && loss < 0.01) this.healthy++;
    else this.healthy = 0;
    if (this.healthy >= 5 && this.level < LEVELS.length - 1) {
      this.level++;
      this.healthy = 0;
      this.grace = 2;
      return true;
    }
    return false;
  }
}
