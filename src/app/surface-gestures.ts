import { TouchPointer } from './touch-pointer';
export interface SurfaceBox {
  width: number;
  height: number;
  imageWidth: number;
  imageHeight: number;
}
export interface SurfaceView {
  zoom: number;
  x: number;
  y: number;
}
type Point = { x: number; y: number };
export function imagePoint(p: Point, box: SurfaceBox, view: SurfaceView): Point | null {
  const scale = Math.min(box.width / box.imageWidth, box.height / box.imageHeight);
  const width = box.imageWidth * scale,
    height = box.imageHeight * scale;
  const x = ((p.x - box.width / 2 - view.x) / view.zoom + width / 2) / width;
  const y = ((p.y - box.height / 2 - view.y) / view.zoom + height / 2) / height;
  return x >= 0 && x <= 1 && y >= 0 && y <= 1 ? { x, y } : null;
}
/** Defer mouse-down until dragging: a second finger can begin a pinch without clicking. */
export class SurfaceGestures {
  private points = new Map<number, Point>();
  private start?: Point;
  private started = 0;
  private dragging = false;
  private multiple = false;
  private pinch?: { distance: number; center: Point; view: SurfaceView };
  constructor(
    private send: (value: object) => void,
    private pointer: TouchPointer,
    private view: () => SurfaceView,
    private setView: (v: SurfaceView) => void,
    private relative: () => boolean,
  ) {}
  down(id: number, p: Point) {
    if (!this.points.size) {
      this.start = p;
      this.started = Date.now();
      this.multiple = false;
    }
    this.points.set(id, p);
    if (this.points.size === 1 && this.relative()) this.pointer.down(id, p.x, p.y);
    if (this.points.size === 2) {
      this.multiple = true;
      if (this.dragging) {
        this.send({ type: 'up', button: 0 });
        this.dragging = false;
      }
      this.pointer.cancel();
      const [a, b] = [...this.points.values()];
      this.pinch = {
        distance: Math.max(1, Math.hypot(b.x - a.x, b.y - a.y)),
        center: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        view: this.view(),
      };
    }
  }
  move(id: number, p: Point, box: SurfaceBox) {
    if (!this.points.has(id)) return;
    this.points.set(id, p);
    if (this.points.size === 2 && this.pinch) {
      const [a, b] = [...this.points.values()],
        base = this.pinch;
      const zoom = Math.max(
        1,
        Math.min(4, (base.view.zoom * Math.hypot(b.x - a.x, b.y - a.y)) / base.distance),
      );
      const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const x =
        center.x -
        box.width / 2 -
        ((base.center.x - box.width / 2 - base.view.x) * zoom) / base.view.zoom;
      const y =
        center.y -
        box.height / 2 -
        ((base.center.y - box.height / 2 - base.view.y) * zoom) / base.view.zoom;
      const limitX = (box.width * (zoom - 1)) / 2,
        limitY = (box.height * (zoom - 1)) / 2;
      this.setView({
        zoom,
        x: Math.max(-limitX, Math.min(limitX, x)) || 0,
        y: Math.max(-limitY, Math.min(limitY, y)) || 0,
      });
      return;
    }
    if (this.multiple) return;
    if (this.relative()) {
      this.pointer.move(id, p.x, p.y, box.width, box.height);
      return;
    }
    if (!this.start) return;
    if (!this.dragging && Math.hypot(p.x - this.start.x, p.y - this.start.y) > 8) {
      const at = imagePoint(this.start, box, this.view());
      if (!at) return;
      this.send({ type: 'move', ...at });
      this.send({ type: 'down', button: 0 });
      this.dragging = true;
    }
    if (this.dragging) {
      const at = imagePoint(p, box, this.view());
      if (at) this.send({ type: 'move', ...at });
    }
  }
  up(id: number, p: Point, box: SurfaceBox) {
    if (!this.points.delete(id)) return false;
    if (this.multiple) {
      if (!this.points.size) this.pinch = undefined;
      return false;
    }
    if (this.relative()) this.pointer.up(id);
    else if (this.dragging) {
      this.send({ type: 'up', button: 0 });
      this.dragging = false;
    } else {
      const at = imagePoint(p, box, this.view());
      if (at) {
        const button = Date.now() - this.started > 600 ? 2 : 0;
        this.send({ type: 'move', ...at });
        this.send({ type: 'down', button });
        this.send({ type: 'up', button });
        return button === 0;
      }
    }
    return false;
  }
  cancel() {
    this.points.clear();
    this.start = undefined;
    this.pinch = undefined;
    this.dragging = false;
    this.multiple = false;
    this.pointer.cancel();
  }
}
