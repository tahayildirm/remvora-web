export type InputMode = 'auto' | 'touch' | 'touchpad' | 'mouse';
export function touchLayout(mode: InputMode, coarse: boolean, width: number) {
  return mode === 'touchpad' || mode === 'touch' || (mode === 'auto' && (coarse || width < 760));
}
export class TouchPointer {
  x = 0.5;
  y = 0.5;
  held = false;
  private points = new Map<number, { x: number; y: number }>();
  private distance = 0;
  private fingers = 0;
  private started = 0;
  constructor(private send: (value: object) => void) {}
  down(id: number, x: number, y: number) {
    if (!this.points.size) {
      this.distance = 0;
      this.fingers = 0;
      this.started = Date.now();
    }
    this.points.set(id, { x, y });
    this.fingers = Math.max(this.fingers, this.points.size);
  }
  move(id: number, x: number, y: number, width: number, height: number) {
    const old = this.points.get(id);
    if (!old) return;
    const dx = x - old.x,
      dy = y - old.y;
    this.distance += Math.abs(dx) + Math.abs(dy);
    this.points.set(id, { x, y });
    if (this.points.size > 1) {
      if (Math.abs(dy) >= 2) this.send({ type: 'scroll', delta: Math.sign(dy) * -3 });
    } else if (this.fingers === 1) {
      this.x = Math.max(0, Math.min(1, this.x + dx / Math.max(1, width)));
      this.y = Math.max(0, Math.min(1, this.y + dy / Math.max(1, height)));
      this.send({ type: 'move', x: this.x, y: this.y });
    }
  }
  up(id: number) {
    if (!this.points.delete(id)) return;
    if (!this.points.size && this.distance < 12 && Date.now() - this.started < 450 && !this.held)
      this.click(this.fingers > 1 ? 2 : 0);
  }
  click(button: number) {
    this.send({ type: 'move', x: this.x, y: this.y });
    this.send({ type: 'down', button });
    this.send({ type: 'up', button });
  }
  hold() {
    this.held = !this.held;
    this.send({ type: 'move', x: this.x, y: this.y });
    this.send({ type: this.held ? 'down' : 'up', button: 0 });
  }
  cancel() {
    this.points.clear();
    this.held = false;
    this.send({ type: 'releaseAll' });
  }
}
