import { RelayChannel } from './relay';
export interface SharedFile {
  name: string;
  size: number;
}
const LIMIT = 100 * 1024 * 1024;
export class FileTransfer {
  private channel?: RTCDataChannel | RelayChannel;
  private pending?: {
    id: string;
    resolve: (v: Record<string, unknown>) => void;
    reject: (e: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  };
  private generation = 0;
  busy = false;
  progress = 0;
  entries: SharedFile[] = [];
  available = false;
  changed?: () => void;
  attach(channel: RTCDataChannel | RelayChannel) {
    this.close();
    this.channel = channel;
    channel.onopen = () => {
      this.available = true;
      this.changed?.();
    };
    channel.onclose = () => this.close();
    channel.onmessage = (event) => {
      if (typeof event.data !== 'string' || event.data.length > 60000) return;
      try {
        const value = JSON.parse(event.data);
        if (!this.pending || value.id !== this.pending.id) return;
        const pending = this.pending;
        this.pending = undefined;
        clearTimeout(pending.timer);
        if (value.type === 'error') pending.reject(new Error('fileRejected'));
        else pending.resolve(value);
      } catch {
        /* Invalid optional frames do not resolve a request. */
      }
    };
  }
  private request(value: Record<string, unknown>): Promise<Record<string, unknown>> {
    if (this.channel?.readyState !== 'open' || this.pending)
      return Promise.reject(new Error('fileUnavailable'));
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending = undefined;
        reject(new Error('fileUnavailable'));
      }, 15000);
      this.pending = { id, resolve, reject, timer };
      try {
        this.channel!.send(JSON.stringify({ ...value, id }));
      } catch {
        clearTimeout(timer);
        this.pending = undefined;
        reject(new Error('fileUnavailable'));
      }
    });
  }
  async list() {
    if (this.busy) return;
    const generation = this.generation;
    const reply = await this.request({ type: 'list' });
    this.check(generation);
    if (!Array.isArray(reply['files'])) throw new Error('fileRejected');
    this.entries = reply['files']
      .filter(
        (f): f is SharedFile =>
          f !== null &&
          typeof f === 'object' &&
          typeof f.name === 'string' &&
          Number.isSafeInteger(f.size) &&
          f.size >= 0 &&
          f.size <= LIMIT,
      )
      .slice(0, 200);
    this.changed?.();
  }
  async upload(file: File) {
    if (this.busy || file.size > LIMIT) throw new Error('fileLimit');
    this.busy = true;
    this.progress = 0;
    this.changed?.();
    const generation = this.generation;
    try {
      const content = await file.arrayBuffer();
      this.check(generation);
      const digest = await hash(content);
      this.check(generation);
      const ready = await this.request({ type: 'upload', name: file.name, size: file.size });
      if (ready['type'] !== 'ready') throw new Error('fileRejected');
      for (let offset = 0; offset < file.size; offset += 12288) {
        this.check(generation);
        const bytes = new Uint8Array(content.slice(offset, offset + 12288));
        const reply = await this.request({
          type: 'chunk',
          offset,
          data: btoa(String.fromCharCode(...bytes)),
        });
        if (reply['offset'] !== offset + bytes.length) throw new Error('fileRejected');
        this.progress = Math.floor(((offset + bytes.length) / file.size) * 100);
        this.changed?.();
      }
      this.check(generation);
      const done = await this.request({ type: 'finish', sha256: digest });
      if (done['sha256'] !== digest) throw new Error('fileRejected');
      this.progress = 100;
    } catch (error) {
      if (generation === this.generation) await this.cancel().catch(() => {});
      throw error;
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        this.changed?.();
      }
    }
  }
  async download(file: SharedFile): Promise<Blob> {
    if (this.busy) throw new Error('fileUnavailable');
    this.busy = true;
    this.progress = 0;
    this.changed?.();
    const generation = this.generation;
    try {
      const reply = await this.request({ type: 'download', name: file.name });
      const size = reply['size'];
      if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0 || size > LIMIT)
        throw new Error('fileLimit');
      const output = new Uint8Array(size);
      let offset = 0;
      while (offset < size) {
        this.check(generation);
        const chunk = await this.request({ type: 'next', offset });
        if (
          chunk['offset'] !== offset ||
          typeof chunk['data'] !== 'string' ||
          chunk['data'].length > 16384
        )
          throw new Error('fileRejected');
        const bytes = Uint8Array.from(atob(chunk['data']), (c) => c.charCodeAt(0));
        if (!bytes.length || offset + bytes.length > size) throw new Error('fileRejected');
        output.set(bytes, offset);
        offset += bytes.length;
        this.progress = Math.floor((offset / size) * 100);
        this.changed?.();
      }
      this.check(generation);
      const done = await this.request({ type: 'next', offset });
      if (done['sha256'] !== (await hash(output.buffer))) throw new Error('fileRejected');
      this.check(generation);
      return new Blob([output], { type: 'application/octet-stream' });
    } catch (error) {
      if (generation === this.generation) await this.cancel().catch(() => {});
      throw error;
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        this.changed?.();
      }
    }
  }
  private check(generation: number) {
    if (generation !== this.generation) throw new Error('fileCancelled');
  }
  async cancel() {
    const generation = ++this.generation;
    this.reject();
    this.busy = true;
    this.changed?.();
    try {
      if (this.channel?.readyState === 'open') await this.request({ type: 'cancel' });
    } finally {
      if (generation === this.generation) {
        this.busy = false;
        this.changed?.();
      }
    }
  }
  private reject() {
    if (this.pending) {
      clearTimeout(this.pending.timer);
      this.pending.reject(new Error('fileCancelled'));
      this.pending = undefined;
    }
  }
  close() {
    this.generation++;
    this.reject();
    if (this.channel) {
      this.channel.onopen = null;
      this.channel.onclose = null;
      this.channel.onmessage = null;
    }
    this.channel = undefined;
    this.busy = false;
    this.available = false;
    this.entries = [];
    this.changed?.();
  }
}
async function hash(bytes: ArrayBuffer): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
}
