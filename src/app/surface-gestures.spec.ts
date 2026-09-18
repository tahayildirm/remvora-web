import { describe, it, expect, vi } from 'vitest';
import { SurfaceGestures, imagePoint, SurfaceView } from './surface-gestures';
import { TouchPointer } from './touch-pointer';
const box = { width: 400, height: 400, imageWidth: 800, imageHeight: 400 };
function setup(relative = false) {
  const send = vi.fn();
  let view: SurfaceView = { zoom: 1, x: 0, y: 0 };
  const gestures = new SurfaceGestures(
    send,
    new TouchPointer(send),
    () => view,
    (v) => (view = v),
    () => relative,
  );
  return { send, gestures, view: () => view };
}
describe('direct touch and pinch', () => {
  it('maps letterboxed image and excludes black bars', () => {
    expect(imagePoint({ x: 100, y: 150 }, box, { zoom: 1, x: 0, y: 0 })).toEqual({
      x: 0.25,
      y: 0.25,
    });
    expect(imagePoint({ x: 100, y: 20 }, box, { zoom: 1, x: 0, y: 0 })).toBeNull();
    expect(imagePoint({ x: 200, y: 200 }, box, { zoom: 2, x: 100, y: 0 })).toEqual({
      x: 0.375,
      y: 0.5,
    });
  });
  it('defers a direct tap until release and uses the touched position', () => {
    const { gestures: g, send } = setup();
    g.down(1, { x: 100, y: 150 });
    expect(send).not.toHaveBeenCalled();
    g.up(1, { x: 100, y: 150 }, box);
    expect(send.mock.calls.map((c) => c[0])).toEqual([
      { type: 'move', x: 0.25, y: 0.25 },
      { type: 'down', button: 0 },
      { type: 'up', button: 0 },
    ]);
  });
  it('pinches without clicks even after one finger lifts', () => {
    const { gestures: g, send, view } = setup();
    g.down(1, { x: 100, y: 200 });
    g.down(2, { x: 300, y: 200 });
    g.move(2, { x: 500, y: 200 }, box);
    expect(view().zoom).toBe(2);
    g.up(2, { x: 500, y: 200 }, box);
    g.move(1, { x: 150, y: 200 }, box);
    g.up(1, { x: 150, y: 200 }, box);
    expect(send.mock.calls.some((c) => c[0].type === 'down')).toBe(false);
  });
  it('limits zoom and resets translation at minimum zoom', () => {
    const { gestures: g, view } = setup();
    g.down(1, { x: 100, y: 200 });
    g.down(2, { x: 200, y: 200 });
    g.move(2, { x: 1000, y: 200 }, box);
    expect(view().zoom).toBe(4);
    g.move(2, { x: 110, y: 200 }, box);
    expect(view()).toEqual({ zoom: 1, x: 0, y: 0 });
  });
  it('releases a drag when a pinch begins', () => {
    const { gestures: g, send } = setup();
    g.down(1, { x: 100, y: 150 });
    g.move(1, { x: 140, y: 150 }, box);
    g.down(2, { x: 250, y: 150 });
    expect(send.mock.calls.map((c) => c[0].type)).toContain('up');
    g.cancel();
    expect(send.mock.calls.at(-1)?.[0]).toEqual({ type: 'releaseAll' });
  });
});
