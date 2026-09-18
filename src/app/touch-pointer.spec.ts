import { describe, it, expect, vi } from 'vitest';
import { TouchPointer, touchLayout } from './touch-pointer';
describe('touch control', () => {
  it('uses narrow or coarse layouts automatically and honors overrides', () => {
    expect(touchLayout('auto', false, 390)).toBe(true);
    expect(touchLayout('auto', true, 1024)).toBe(true);
    expect(touchLayout('auto', false, 1440)).toBe(false);
    expect(touchLayout('mouse', true, 390)).toBe(false);
    expect(touchLayout('touch', false, 1440)).toBe(true);
  });
  it('moves relatively, clamps bounds and never clicks after a drag', () => {
    const send = vi.fn(),
      p = new TouchPointer(send);
    p.down(1, 20, 20);
    p.move(1, 220, -200, 100, 100);
    p.up(1);
    expect(send).toHaveBeenLastCalledWith({ type: 'move', x: 1, y: 0 });
    expect(send.mock.calls.some(([v]) => v.type === 'down')).toBe(false);
  });
  it('taps at the current cursor position, not the finger position', () => {
    const send = vi.fn(),
      p = new TouchPointer(send);
    p.down(1, 90, 20);
    p.up(1);
    expect(send.mock.calls.map(([v]) => v)).toEqual([
      { type: 'move', x: 0.5, y: 0.5 },
      { type: 'down', button: 0 },
      { type: 'up', button: 0 },
    ]);
  });
  it('two finger tap right-clicks once', () => {
    const send = vi.fn(),
      p = new TouchPointer(send);
    p.down(1, 10, 10);
    p.down(2, 30, 10);
    p.up(1);
    p.up(2);
    expect(send.mock.calls.filter(([v]) => v.type === 'down').map(([v]) => v.button)).toEqual([2]);
  });
  it('two finger scroll does not click or move after one finger lifts', () => {
    const send = vi.fn(),
      p = new TouchPointer(send);
    p.down(1, 10, 10);
    p.down(2, 30, 10);
    p.move(1, 10, 40, 100, 100);
    p.up(1);
    p.move(2, 30, 60, 100, 100);
    p.up(2);
    expect(send.mock.calls.map(([v]) => v.type)).toEqual(['scroll']);
  });
  it('cancellation releases a held button and prevents a delayed click', () => {
    const send = vi.fn(),
      p = new TouchPointer(send);
    p.hold();
    p.down(1, 10, 10);
    p.cancel();
    p.up(1);
    expect(p.held).toBe(false);
    expect(send).toHaveBeenLastCalledWith({ type: 'releaseAll' });
  });
});
