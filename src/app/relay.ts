export type RelaySender = (payload: Record<string, unknown>) => void;
export class RelayChannel {
  readyState: RTCDataChannelState = 'open';
  bufferedAmount = 0;
  binaryType: BinaryType = 'arraybuffer';
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: ((event: Event) => void) | null = null;
  onclose: ((event: Event) => void) | null = null;
  constructor(
    private name: string,
    private output: RelaySender,
  ) {}
  send(value: string | Uint8Array<ArrayBuffer>) {
    if (this.readyState !== 'open') throw new Error('offline');
    const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
    if (bytes.length > 20000) throw new Error('REQUEST_FAILED');
    this.output({
      channel: this.name,
      data: btoa(String.fromCharCode(...bytes)),
      text: typeof value === 'string',
      part: 0,
      last: true,
    });
  }
  receive(bytes: Uint8Array<ArrayBuffer>, text: boolean) {
    this.onmessage?.(
      new MessageEvent('message', { data: text ? new TextDecoder().decode(bytes) : bytes.buffer }),
    );
  }
  close() {
    this.readyState = 'closed';
    this.onmessage = null;
    this.onopen = null;
    this.onclose = null;
  }
}
// Audio WebCodecs declarations for TypeScript DOM libraries that omit them.
interface DecodedAudio {
  numberOfChannels: number;
  numberOfFrames: number;
  sampleRate: number;
  copyTo(target: Float32Array<ArrayBuffer>, options: { planeIndex: number; format: string }): void;
  close(): void;
}
declare const AudioDecoder: {
  new (options: { output: (audio: DecodedAudio) => void; error: (error: DOMException) => void }): {
    configure(config: { codec: string; sampleRate: number; numberOfChannels: number }): void;
    decode(chunk: unknown): void;
    close(): void;
    readonly state: string;
    readonly decodeQueueSize: number;
  };
};
declare const EncodedAudioChunk: {
  new (options: { type: string; timestamp: number; data: Uint8Array<ArrayBuffer> }): unknown;
};
export class RelayMedia {
  readonly stream: MediaStream;
  private canvas = document.createElement('canvas');
  private decoder?: VideoDecoder;
  private audio?: InstanceType<typeof AudioDecoder>;
  private context?: AudioContext;
  private videoTime = 0;
  readonly stats = { frames: 0, bytes: 0 };
  private audioTime = 0;
  private scheduled = 0;
  private closed = false;
  private started = false;
  constructor(private status: (status: string) => void) {
    if (typeof VideoDecoder === 'undefined') throw new Error('relayUnsupported');
    this.canvas.width = 1600;
    this.canvas.height = 900;
    this.stream = this.canvas.captureStream(30);
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('relayUnsupported');
    this.decoder = new VideoDecoder({
      output: (frame) => {
        try {
          if (this.closed) return;
          if (
            this.canvas.width !== frame.displayWidth ||
            this.canvas.height !== frame.displayHeight
          ) {
            this.canvas.width = frame.displayWidth;
            this.canvas.height = frame.displayHeight;
          }
          context.drawImage(frame, 0, 0);
          this.stats.frames++;
          if (!this.started) {
            this.started = true;
            this.status('connectedRelay');
          }
        } finally {
          frame.close();
        }
      },
      error: () => {
        if (!this.closed) this.status('relayDecodeFailed');
      },
    });
    this.decoder.configure({ codec: 'avc1.42E01F', optimizeForLatency: true });
    if (typeof AudioDecoder !== 'undefined') {
      this.context = new AudioContext({ sampleRate: 48000 });
      const ac = this.context;
      const output = ac.createMediaStreamDestination();
      for (const track of output.stream.getAudioTracks()) this.stream.addTrack(track);
      this.audio = new AudioDecoder({
        output: (audio) => {
          try {
            if (this.closed || ac.state !== 'running' || this.scheduled > ac.currentTime + 0.25)
              return;
            const buffer = ac.createBuffer(
              audio.numberOfChannels,
              audio.numberOfFrames,
              audio.sampleRate,
            );
            for (let c = 0; c < audio.numberOfChannels; c++)
              audio.copyTo(buffer.getChannelData(c), { planeIndex: c, format: 'f32-planar' });
            const source = ac.createBufferSource();
            source.buffer = buffer;
            source.connect(output);
            this.scheduled = Math.max(this.scheduled, ac.currentTime + 0.02);
            source.start(this.scheduled);
            this.scheduled += buffer.duration;
          } finally {
            audio.close();
          }
        },
        error: () => {
          if (!this.closed) this.status('audioPlayback');
        },
      });
      this.audio.configure({ codec: 'opus', sampleRate: 48000, numberOfChannels: 2 });
    }
  }
  async resumeAudio() {
    await this.context?.resume();
  }
  receive(channel: string, bytes: Uint8Array<ArrayBuffer>) {
    if (this.closed) return;
    if (channel === 'video' && this.decoder?.state === 'configured') {
      this.stats.bytes += bytes.length;
      this.videoTime = Math.max(this.videoTime + 1, Math.round(performance.now() * 1000));
      if (this.decoder.decodeQueueSize > 10) throw new Error('relayDecodeFailed');
      let key = false;
      for (let i = 0; i + 4 < bytes.length; i++)
        if (
          bytes[i] === 0 &&
          bytes[i + 1] === 0 &&
          bytes[i + 2] === 1 &&
          (bytes[i + 3] & 31) === 5
        ) {
          key = true;
          break;
        }
      this.decoder.decode(
        new EncodedVideoChunk({
          type: key ? 'key' : 'delta',
          timestamp: this.videoTime,
          data: bytes,
        }),
      );
    } else if (channel === 'audio' && this.audio?.state === 'configured') {
      if (this.audio.decodeQueueSize < 10)
        this.audio.decode(
          new EncodedAudioChunk({ type: 'key', timestamp: this.audioTime, data: bytes }),
        );
      this.audioTime += 20000;
    }
  }
  close() {
    this.closed = true;
    if (this.decoder && this.decoder.state !== 'closed') this.decoder.close();
    if (this.audio && this.audio.state !== 'closed') this.audio.close();
    void this.context?.close();
    for (const track of this.stream.getTracks()) track.stop();
  }
}
export class RelayAssembler {
  private frames = new Map<string, { parts: Uint8Array<ArrayBuffer>[]; size: number }>();
  private sequence = -1;
  receive(
    value: Record<string, unknown>,
  ): { channel: string; text: boolean; bytes: Uint8Array<ArrayBuffer> } | undefined {
    const { channel, data, part, last, sequence } = value;
    if (
      typeof channel !== 'string' ||
      !['input', 'files', 'video', 'audio'].includes(channel) ||
      typeof data !== 'string' ||
      data.length > 44000 ||
      !Number.isSafeInteger(part) ||
      typeof part !== 'number' ||
      part < 0 ||
      part >= 64 ||
      typeof last !== 'boolean' ||
      typeof sequence !== 'number' ||
      !Number.isSafeInteger(sequence) ||
      sequence <= this.sequence
    )
      throw new Error('REQUEST_FAILED');
    this.sequence = sequence;
    if (part === 0) this.frames.set(channel, { parts: [], size: 0 });
    const frame = this.frames.get(channel);
    if (!frame || frame.parts.length !== part) throw new Error('REQUEST_FAILED');
    const bytes = Uint8Array.from(atob(data), (c) => c.charCodeAt(0));
    frame.size += bytes.length;
    if (frame.size > 2 * 1024 * 1024) throw new Error('REQUEST_FAILED');
    frame.parts.push(bytes);
    if (!last) return undefined;
    this.frames.delete(channel);
    const output = new Uint8Array(frame.size);
    let offset = 0;
    for (const chunk of frame.parts) {
      output.set(chunk, offset);
      offset += chunk.length;
    }
    return { channel, bytes: output, text: value['text'] === true };
  }
}
