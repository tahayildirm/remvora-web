import { AdaptiveVideo, DEFAULT_QUALITY, VideoQuality, validQuality } from './video-quality';
import { RelayAssembler, RelayChannel, RelayMedia } from './relay';
import { signalingUrl } from './api-endpoint';
import { Injectable, signal, computed } from '@angular/core';
import { Api } from './api';
import { FileTransfer } from './file-transfer';
interface Signal {
  protocolVersion: number;
  messageId: string;
  timestamp: string;
  sessionId: string;
  type: string;
  payload: Record<string, unknown>;
}
@Injectable({ providedIn: 'root' })
export class Remote {
  readonly diagnostics = signal<string[]>([]);
  private diagnosticStart = 0;
  private iceTimer?: ReturnType<typeof setInterval>;
  private trace(message: string) {
    const seconds = ((performance.now() - this.diagnosticStart) / 1000).toFixed(1);
    this.diagnostics.update((rows) => [...rows.slice(-39), `${seconds}s ${message}`]);
  }
  private candidateSummary(sdp: string) {
    const types = [...sdp.matchAll(/^a=candidate:.*? typ (host|srflx|prflx|relay)\b/gm)].map(
      (m) => m[1],
    );
    return ['host', 'srflx', 'prflx', 'relay']
      .map((type) => `${type}=${types.filter((t) => t === type).length}`)
      .join(' ');
  }
  private async inspectIce(peer: RTCPeerConnection, generation: number) {
    if (!peer.getStats) return;
    const stats = await peer.getStats();
    if (generation !== this.generation) return;
    const pairs: string[] = [];
    stats.forEach((row) => {
      if (row.type === 'candidate-pair') {
        const local = stats.get(row.localCandidateId);
        const remote = stats.get(row.remoteCandidateId);
        pairs.push(
          `${local?.candidateType ?? '?'}>${remote?.candidateType ?? '?'} ${row.state} sent=${row.requestsSent ?? 0} responses=${row.responsesReceived ?? 0} received=${row.requestsReceived ?? 0}`,
        );
      }
    });
    this.trace(
      `ICE ${peer.iceConnectionState}: ${pairs.length ? pairs.slice(0, 8).join('; ') : 'no candidate pairs'}`,
    );
  }
  readonly connectionPhase = signal('connectionOffline');
  readonly connecting = computed(() =>
    [
      'connectionReconnecting',
      'connectionAuthorizing',
      'connectionSignaling',
      'connectionP2p',
      'connectionRelayConnecting',
      'connectionFallback',
    ].includes(this.connectionPhase()),
  );
  readonly files = new FileTransfer();
  readonly capabilities = signal({ audio: false, clipboard: false, files: false });
  readonly qualitySupported = signal(false);
  readonly qualityApplied = signal({ fps: 0, bitrate: 0, width: 0 });
  readonly videoMetrics = signal({ fps: 0, bitrate: 0, rtt: 0 });
  private quality: VideoQuality = { ...DEFAULT_QUALITY };
  private adaptive = new AdaptiveVideo();
  private qualityTimer?: ReturnType<typeof setInterval>;
  private qualityBusy = false;
  private pingAt = 0;
  private lastVideoProgress = 0;
  private pingNonce = 0;
  private rtt = 0;
  private previous = { time: 0, frames: 0, bytes: 0, lost: 0, packets: 0 };
  setQuality(value: VideoQuality) {
    if (!validQuality(value)) return;
    this.quality = { ...value };
    this.adaptive = new AdaptiveVideo();
    this.applyQuality();
  }
  private applyQuality() {
    if (this.qualitySupported())
      this.control({
        type: 'video.configure',
        ...(this.quality.mode === 'auto' ? this.adaptive.current() : this.quality),
      });
  }
  private async measureVideo() {
    if (this.qualityBusy || !this.qualitySupported()) return;
    this.qualityBusy = true;
    const generation = this.generation;
    try {
      const now = performance.now();
      if (this.pingAt && now - this.pingAt > 4000) this.rtt = now - this.pingAt;
      if (!this.pingAt || now - this.pingAt > 6000) {
        this.pingAt = now;
        this.control({ type: 'video.ping', nonce: ++this.pingNonce });
      }
      let frames = 0,
        bytes = 0,
        lost = 0,
        packets = 0;
      if (this.relayMedia) ({ frames, bytes } = this.relayMedia.stats);
      else if (this.peer) {
        const stats = await this.peer.getStats();
        stats.forEach((row) => {
          if (row.type === 'inbound-rtp' && row.kind === 'video') {
            frames += row.framesDecoded ?? 0;
            bytes += row.bytesReceived ?? 0;
            lost += row.packetsLost ?? 0;
            packets += row.packetsReceived ?? 0;
          }
        });
      }
      if (generation !== this.generation) return;
      const old = this.previous;
      if (!this.lastVideoProgress || frames > old.frames) this.lastVideoProgress = now;
      else if (now - this.lastVideoProgress >= 12000) {
        this.trace('Video stalled for 12 seconds; requesting a fresh authorized session');
        this.recover('NETWORK_ERROR');
        return;
      }
      this.previous = { time: now, frames, bytes, lost, packets };
      if (!old.time || frames < old.frames || bytes < old.bytes) return;
      const seconds = (now - old.time) / 1000;
      const fps = (frames - old.frames) / seconds;
      const bitrate = ((bytes - old.bytes) * 8) / seconds;
      this.videoMetrics.set({
        fps: Math.round(fps * 10) / 10,
        bitrate: Math.round(bitrate / 1000),
        rtt: Math.round(this.rtt),
      });
      const loss =
        Math.max(0, lost - old.lost) / Math.max(1, packets - old.packets + lost - old.lost);
      if (this.quality.mode === 'auto' && this.rtt > 0 && this.adaptive.sample(this.rtt, fps, loss))
        this.applyQuality();
    } finally {
      if (generation === this.generation) this.qualityBusy = false;
    }
  }
  private socket?: WebSocket;
  private peer?: RTCPeerConnection;
  private channel?: RTCDataChannel | RelayChannel;
  private relayMedia?: RelayMedia;
  private relayInput?: RelayChannel;
  private relayFiles?: RelayChannel;
  private heartbeat?: ReturnType<typeof setInterval>;
  private generation = 0;
  private timer?: ReturnType<typeof setTimeout>;
  private id = '';
  private clipboardPending = false;
  private clipboardTimer?: ReturnType<typeof setTimeout>;
  clipboardReceived?: (text: string) => void;
  displaysReceived?: (displays: { id: number; name: string }[]) => void;
  private report?: (code: string) => void;
  constructor(private api: Api) {}
  private reconnectTimer?: ReturnType<typeof setTimeout>;
  private reconnectAttempt = 0;
  private retry?: () => Promise<void>;
  private recover(code: string): boolean {
    const retryable = [
      'NETWORK_ERROR',
      'REQUEST_FAILED',
      'DEVICE_OFFLINE',
      'SESSION_BUSY',
      'connectionFailed',
      'offline',
    ].includes(code);
    if (!this.retry || !retryable) return false;
    const retry = this.retry;
    this.disconnect();
    const delay = Math.min(4000, 500 * 2 ** Math.min(this.reconnectAttempt++, 3));
    this.trace(
      `Connection interrupted (${code}); retry ${this.reconnectAttempt} in ${delay / 1000}s`,
    );
    this.connectionPhase.set('connectionReconnecting');
    this.report?.('connectionReconnecting');
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      if (this.retry === retry) void retry().catch(() => {});
    }, delay);
    return true;
  }
  async connect(
    deviceId: string,
    kind: 'Terminal' | 'Desktop',
    status: (code: string) => void,
    data: (bytes: Uint8Array) => void,
    video: (stream: MediaStream) => void,
    mode: 'auto' | 'relay' = 'auto',
    quality: VideoQuality = DEFAULT_QUALITY,
  ) {
    this.close();
    this.diagnostics.set([]);
    this.diagnosticStart = performance.now();
    this.setQuality(quality);
    const report = (code: string) => {
      if (code === 'connected' || code === 'connectedRelay') this.reconnectAttempt = 0;
      status(code);
    };
    this.report = report;
    const retry = async () => {
      try {
        await this.attempt(deviceId, kind, report, data, video, mode, this.quality);
      } catch (error) {
        if (this.retry !== retry) return;
        const code =
          error instanceof TypeError
            ? 'NETWORK_ERROR'
            : error instanceof Error
              ? error.message
              : 'connectionFailed';
        if (!this.recover(code)) {
          this.close();
          this.connectionPhase.set('connectionError');
          status(code);
          throw error;
        }
      }
    };
    this.retry = retry;
    await retry();
  }
  private async attempt(
    deviceId: string,
    kind: 'Terminal' | 'Desktop',
    status: (code: string) => void,
    data: (bytes: Uint8Array) => void,
    video: (stream: MediaStream) => void,
    mode: 'auto' | 'relay' = 'auto',
    quality: VideoQuality = DEFAULT_QUALITY,
  ) {
    this.disconnect();
    const generation = this.generation;
    this.setQuality(quality);
    this.report = status;
    this.connectionPhase.set('connectionAuthorizing');
    try {
      status('connecting');
      const ticket = await this.api.request<{ sessionId: string; token: string }>(
        'remote-sessions',
        'POST',
        { deviceId, kind },
      );
      if (generation !== this.generation) return;
      this.id = ticket.sessionId;
      const configuration = await this.api.request<{ stunServers: string[] }>('configuration');
      if (generation !== this.generation) return;
      this.peer = new RTCPeerConnection({
        iceServers: configuration.stunServers.map((url) => ({ urls: url })),
      });
      const peer = this.peer;
      this.trace(`STUN servers configured: ${configuration.stunServers.length}`);
      peer.onicecandidateerror = (event) => {
        if (this.peer === peer) this.trace(`STUN error ${event.errorCode}: ${event.errorText}`);
      };
      peer.oniceconnectionstatechange = () => {
        if (this.peer === peer) this.trace(`ICE state: ${peer.iceConnectionState}`);
      };
      this.iceTimer = setInterval(() => {
        if (this.peer === peer) void this.inspectIce(peer, generation).catch(() => {});
      }, 3000);
      this.channel = peer.createDataChannel(
        kind === 'Terminal' ? 'remvora.terminal.v1' : 'remvora.input.v1',
      );
      this.channel.binaryType = 'arraybuffer';
      this.channel.onmessage = (e) => {
        if (generation !== this.generation) return;
        if (e.data instanceof ArrayBuffer) data(new Uint8Array(e.data));
        else if (typeof e.data === 'string' && e.data.length <= 100000) {
          try {
            const message = JSON.parse(e.data);
            if (
              message.type === 'capabilities' &&
              message.videoSettings === true &&
              kind === 'Desktop'
            ) {
              this.qualitySupported.set(true);
              this.applyQuality();
              clearInterval(this.qualityTimer);
              this.qualityTimer = setInterval(() => {
                void this.measureVideo().catch(() => {
                  /* Next sample retries transient statistics failures. */
                });
              }, 2000);
            }
            if (
              message.type === 'video.applied' &&
              validQuality({ ...message.settings, mode: 'manual' })
            )
              this.qualityApplied.set(message.settings);
            if (message.type === 'video.pong' && message.nonce === this.pingNonce && this.pingAt) {
              this.rtt = performance.now() - this.pingAt;
              this.pingAt = 0;
            }
            if (message.type === 'capabilities')
              this.capabilities.set({
                audio: message.audio === true,
                clipboard: message.clipboard === true,
                files: message.files === true,
              });
            if (message.type === 'display.list' && Array.isArray(message.displays))
              this.displaysReceived?.(
                message.displays
                  .filter(
                    (d: { id: unknown; name: unknown }) =>
                      Number.isInteger(d.id) && typeof d.name === 'string',
                  )
                  .slice(0, 32),
              );
            if (
              this.clipboardPending &&
              message.type === 'clipboard.text' &&
              typeof message.text === 'string' &&
              new TextEncoder().encode(message.text).length <= 16384
            ) {
              this.clipboardPending = false;
              clearTimeout(this.clipboardTimer);
              this.clipboardReceived?.(message.text);
            }
            if (
              message.type === 'clipboard.result' &&
              ['clipboardApplied', 'clipboardDenied', 'clipboardUnavailable'].includes(message.code)
            )
              status(message.code);
          } catch {
            /* Ignore malformed optional acknowledgements. */
          }
        }
      };
      this.channel.onopen = () => {
        if (this.peer !== peer) return;
        if (kind === 'Terminal') {
          clearTimeout(this.timer);
          this.connectionPhase.set('connectionP2pReady');
          status('connected');
        }
      };
      const media = new MediaStream();
      peer.ontrack = (e) => {
        e.track.onunmute = () => {
          if (this.peer !== peer) return;
          clearTimeout(this.timer);
          this.connectionPhase.set('connectionP2pReady');
          status('connected');
        };
        media.addTrack(e.track);
        video(media);
      };
      if (kind === 'Desktop') {
        peer.addTransceiver('video', { direction: 'recvonly' });
        peer.addTransceiver('audio', { direction: 'recvonly' });
        this.files.attach(peer.createDataChannel('remvora.files.v1'));
      }
      this.connectionPhase.set('connectionSignaling');
      const ws = new WebSocket(signalingUrl());
      this.socket = ws;
      const assembler = new RelayAssembler();
      let relay = false;
      let accepted = false;
      let sequence = 0;
      let trickleIce = false;
      let offerSent = false;
      let answerApplied = false;
      const localCandidates: RTCIceCandidateInit[] = [];
      const remoteCandidates: RTCIceCandidateInit[] = [];
      const sendCandidate = (candidate: RTCIceCandidateInit) => {
        this.trace(
          `Local ICE candidate: ${candidate.candidate?.match(/ typ (\w+)/)?.[1] ?? 'complete'}`,
        );
        this.send('webrtc.iceCandidate', candidate);
      };
      peer.onicecandidate = (event) => {
        if (this.socket !== ws || relay || !trickleIce) return;
        const candidate = event.candidate?.toJSON() ?? { candidate: '' };
        if (offerSent) sendCandidate(candidate);
        else if (localCandidates.length < 64) localCandidates.push(candidate);
      };
      const fail = (code: string) => {
        if (this.socket === ws) {
          if (this.recover(code)) return;
          this.close();
          this.connectionPhase.set('connectionError');
          status(code);
        }
      };
      const startRelay = () => {
        if (this.socket !== ws || relay || !accepted) return;
        if (ws.readyState !== WebSocket.OPEN) {
          fail('NETWORK_ERROR');
          return;
        }
        this.trace(
          `Fallback trigger: peer=${peer.connectionState}, ice=${peer.iceConnectionState}, gathering=${peer.iceGatheringState}`,
        );
        clearInterval(this.iceTimer);
        relay = true;
        this.connectionPhase.set(
          mode === 'relay' ? 'connectionRelayConnecting' : 'connectionFallback',
        );
        this.previous = { time: 0, frames: 0, bytes: 0, lost: 0, packets: 0 };
        clearTimeout(this.timer);
        peer.onconnectionstatechange = null;
        const handler = this.channel!.onmessage;
        peer.close();
        this.peer = undefined;
        const send = (payload: Record<string, unknown>) => {
          if (ws.readyState !== WebSocket.OPEN || ws.bufferedAmount > 262144) {
            fail('NETWORK_ERROR');
            return;
          }
          this.send('relay.data', { ...payload, sequence: ++sequence });
        };
        this.relayInput = new RelayChannel('input', send);
        this.relayInput.onmessage = handler
          ? (event) => handler.call(this.channel as RTCDataChannel, event)
          : null;
        this.channel = this.relayInput;
        this.files.close();
        if (kind === 'Desktop') {
          try {
            this.relayMedia = new RelayMedia((code) => {
              if (this.socket !== ws) return;
              if (code === 'connectedRelay') {
                clearTimeout(this.timer);
                this.connectionPhase.set('connectionRelayReady');
              }
              status(code);
            });
            video(this.relayMedia.stream);
            this.relayFiles = new RelayChannel('files', send);
            this.files.attach(this.relayFiles);
          } catch {
            fail('relayUnsupported');
            return;
          }
        }
        status('connectingRelay');
        this.send('relay.start', {});
        this.timer = setTimeout(() => fail('connectionFailed'), 20000);
      };
      peer.onconnectionstatechange = () => {
        if (this.socket === ws && ['failed', 'disconnected'].includes(peer.connectionState))
          startRelay();
      };
      ws.onopen = () => {
        if (this.socket !== ws) return;
        this.send('session.request', { token: ticket.token });
        this.heartbeat = setInterval(() => this.send('session.heartbeat', {}), 10000);
      };
      ws.onmessage = async (event) => {
        if (this.socket !== ws) return;
        try {
          const message = JSON.parse(event.data) as Signal;
          if (message.protocolVersion !== 1 || message.sessionId !== ticket.sessionId)
            throw new Error('REQUEST_FAILED');
          if (message.type === 'session.reject') {
            fail(
              message.payload['code'] === 'SESSION_BUSY'
                ? 'SESSION_BUSY'
                : 'CAPABILITY_UNAVAILABLE',
            );
            return;
          }
          if (message.type === 'relay.ready' && relay) {
            this.relayFiles?.onopen?.(new Event('open'));
            if (kind === 'Terminal') {
              clearTimeout(this.timer);
              this.connectionPhase.set('connectionRelayReady');
              status('connectedRelay');
            }
            return;
          }
          if (message.type === 'relay.data' && relay) {
            const frame = assembler.receive(message.payload);
            if (frame) {
              if (frame.channel === 'input') this.relayInput?.receive(frame.bytes, frame.text);
              else if (frame.channel === 'files') this.relayFiles?.receive(frame.bytes, frame.text);
              else this.relayMedia?.receive(frame.channel, frame.bytes);
            }
            return;
          }
          if (message.type === 'session.accept') {
            accepted = true;
            trickleIce = message.payload['trickleIce'] === true;
            if (mode === 'relay') {
              startRelay();
              return;
            }
            this.connectionPhase.set('connectionP2p');
            clearTimeout(this.timer);
            this.timer = setTimeout(startRelay, 3000);
            try {
              await peer.setLocalDescription(await peer.createOffer());
              if (!trickleIce && peer.iceGatheringState !== 'complete')
                await new Promise<void>((resolve, reject) => {
                  const deadline = setTimeout(() => reject(new Error('connectionFailed')), 15000);
                  peer.addEventListener('icegatheringstatechange', () => {
                    if (peer.iceGatheringState === 'complete') {
                      clearTimeout(deadline);
                      resolve();
                    }
                  });
                });
              if (this.socket !== ws || relay) return;
              this.trace(`Offer sent: ${this.candidateSummary(peer.localDescription?.sdp ?? '')}`);
              this.send('webrtc.offer', { type: 'offer', sdp: peer.localDescription?.sdp });
              offerSent = true;
              for (const candidate of localCandidates.splice(0)) sendCandidate(candidate);
            } catch (error) {
              // A late ICE operation must not tear down an already usable relay.
              if (!relay) throw error;
            }
          }
          if (message.type === 'webrtc.answer' && !relay) {
            if (message.payload['error'] === 'ICE_NEGOTIATION_FAILED') {
              this.trace('Agent ICE negotiation failed; using the authorized relay session');
              if (accepted) startRelay();
              return;
            }
            this.trace(`Answer received: ${this.candidateSummary(String(message.payload['sdp']))}`);
            await peer.setRemoteDescription({
              type: 'answer',
              sdp: String(message.payload['sdp']),
            });
            if (this.socket !== ws || relay) return;
            answerApplied = true;
            for (const candidate of remoteCandidates.splice(0))
              await peer.addIceCandidate(candidate);
            this.trace('Answer applied');
          }
          if (message.type === 'webrtc.iceCandidate' && !relay) {
            const candidate = message.payload as RTCIceCandidateInit;
            if (typeof candidate.candidate !== 'string' || candidate.candidate.length > 4096)
              throw new Error('Invalid ICE candidate');
            this.trace(
              `Remote ICE candidate: ${candidate.candidate.match(/ typ (\w+)/)?.[1] ?? 'complete'}`,
            );
            if (answerApplied) await peer.addIceCandidate(candidate);
            else if (remoteCandidates.length < 64) remoteCandidates.push(candidate);
          }
          if (message.type === 'session.close') {
            if (kind === 'Desktop' && this.recover('offline')) return;
            this.close();
            status('offline');
          }
        } catch (error) {
          this.trace(
            `Negotiation error: ${error instanceof Error ? error.name + ': ' + error.message : 'unknown'}`,
          );
          if (!relay && accepted) startRelay();
          else fail('connectionFailed');
        }
      };
      ws.onclose = () => {
        if (this.socket === ws) {
          if (this.recover('offline')) return;
          this.close();
          status('offline');
        }
      };
      ws.onerror = () => fail('NETWORK_ERROR');
      this.timer = setTimeout(() => {
        if (accepted) startRelay();
        else fail('connectionFailed');
      }, 25000);
    } catch (error) {
      if (generation === this.generation) {
        this.disconnect();
        this.connectionPhase.set('connectionError');
      }
      throw error;
    }
  }
  input(data: Uint8Array) {
    if (this.writable()) {
      if (this.channel instanceof RelayChannel) this.channel.send(data as Uint8Array<ArrayBuffer>);
      else this.channel!.send(data as Uint8Array<ArrayBuffer>);
    }
  }
  control(value: unknown) {
    if (this.writable()) {
      if (
        typeof value === 'object' &&
        value !== null &&
        'type' in value &&
        typeof value.type === 'string' &&
        ['clipboard.read', 'clipboard.copy', 'clipboard.cut'].includes(value.type)
      ) {
        this.clipboardPending = true;
        clearTimeout(this.clipboardTimer);
        this.clipboardTimer = setTimeout(() => {
          this.clipboardPending = false;
        }, 5000);
      }
      this.channel!.send(JSON.stringify(value));
    }
  }
  private writable(): boolean {
    if (this.channel?.readyState !== 'open') return false;
    if (this.channel.bufferedAmount >= 262144) {
      if (this.recover('NETWORK_ERROR')) return false;
      this.close();
      this.report?.('connectionFailed');
      return false;
    }
    return true;
  }
  private send(type: string, payload: unknown) {
    if (this.socket?.readyState === WebSocket.OPEN)
      this.socket.send(
        JSON.stringify({
          protocolVersion: 1,
          messageId: crypto.randomUUID(),
          timestamp: new Date().toISOString(),
          sessionId: this.id,
          type,
          payload,
        }),
      );
  }
  resumeAudio() {
    return this.relayMedia?.resumeAudio();
  }
  close() {
    this.retry = undefined;
    this.reconnectAttempt = 0;
    clearTimeout(this.reconnectTimer);
    this.clipboardReceived = undefined;
    this.displaysReceived = undefined;
    this.disconnect();
  }
  private disconnect() {
    clearInterval(this.iceTimer);
    this.connectionPhase.set('connectionOffline');
    this.generation++;
    clearInterval(this.qualityTimer);
    this.qualitySupported.set(false);
    this.qualityApplied.set({ fps: 0, bitrate: 0, width: 0 });
    this.videoMetrics.set({ fps: 0, bitrate: 0, rtt: 0 });
    this.qualityBusy = false;
    this.pingAt = 0;
    this.lastVideoProgress = 0;
    this.rtt = 0;
    this.previous = { time: 0, frames: 0, bytes: 0, lost: 0, packets: 0 };
    clearInterval(this.heartbeat);
    this.relayMedia?.close();
    this.relayMedia = undefined;
    this.relayInput?.close();
    this.relayInput = undefined;
    this.relayFiles?.close();
    this.relayFiles = undefined;
    this.files.close();
    this.capabilities.set({ audio: false, clipboard: false, files: false });
    this.clipboardPending = false;
    clearTimeout(this.clipboardTimer);
    clearTimeout(this.timer);
    this.send('session.close', {});
    const socket = this.socket;
    this.socket = undefined;
    socket?.close();
    const peer = this.peer;
    this.peer = undefined;
    if (peer) {
      peer.onconnectionstatechange = null;
      peer.close();
    }
    this.channel = undefined;
  }
}
