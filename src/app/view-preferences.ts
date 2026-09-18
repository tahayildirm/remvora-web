export interface ViewPreferences {
  fontSize: number;
  muted: boolean;
  volume: number;
}
export const DEFAULT_VIEW: ViewPreferences = { fontSize: 14, muted: true, volume: 0.7 };
export function loadView(): ViewPreferences {
  try {
    const saved = JSON.parse(window.localStorage.getItem('remvora.view.v1') ?? '{}');
    return {
      fontSize:
        Number.isInteger(saved?.fontSize) && saved.fontSize >= 8 && saved.fontSize <= 24
          ? saved.fontSize
          : DEFAULT_VIEW.fontSize,
      muted: typeof saved?.muted === 'boolean' ? saved.muted : DEFAULT_VIEW.muted,
      volume:
        typeof saved?.volume === 'number' &&
        Number.isFinite(saved.volume) &&
        saved.volume >= 0 &&
        saved.volume <= 1
          ? saved.volume
          : DEFAULT_VIEW.volume,
    };
  } catch {
    return { ...DEFAULT_VIEW };
  }
}
export function saveView(value: ViewPreferences): boolean {
  try {
    window.localStorage.setItem('remvora.view.v1', JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
