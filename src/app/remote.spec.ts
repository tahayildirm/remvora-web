import { TestBed } from '@angular/core/testing';
import { vi } from 'vitest';
import { Api } from './api';
import { Remote } from './remote';
class FakeChannel {
  binaryType = 'arraybuffer';
  readyState = 'open';
  bufferedAmount = 0;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onopen: (() => void) | null = null;
  send = vi.fn();
}
class FakePeer {
  static instances: FakePeer[] = [];
  connectionState = 'new';
  iceConnectionState = 'checking';
  getStats = vi.fn(() =>
    Promise.resolve(
      new Map([
        ['local', { type: 'local-candidate', candidateType: 'host', address: '192.0.2.10' }],
        ['remote', { type: 'remote-candidate', candidateType: 'srflx', address: '198.51.100.20' }],
        [
          'pair',
          {
            type: 'candidate-pair',
            localCandidateId: 'local',
            remoteCandidateId: 'remote',
            state: 'in-progress',
            requestsSent: 12,
            responsesReceived: 0,
            requestsReceived: 0,
          },
        ],
      ]),
    ),
  );
  iceGatheringState = 'complete';
  localDescription = { sdp: 'test' };
  onconnectionstatechange: (() => void) | null = null;
  ontrack: unknown;
  onicecandidate?: (event: { candidate: { toJSON(): RTCIceCandidateInit } | null }) => void;
  addIceCandidate = vi.fn(() => Promise.resolve());
  channels: FakeChannel[] = [];
  constructor() {
    FakePeer.instances.push(this);
  }
  createDataChannel() {
    const channel = new FakeChannel();
    this.channels.push(channel);
    return channel;
  }
  addTransceiver() {}
  createOffer() {
    return Promise.resolve({ type: 'offer', sdp: 'test' });
  }
  setLocalDescription() {
    return Promise.resolve();
  }
  setRemoteDescription() {
    return Promise.resolve();
  }
  close() {
    this.connectionState = 'closed';
  }
}
class FakeSocket {
  static OPEN = 1;
  static instances: FakeSocket[] = [];
  readyState = 1;
  bufferedAmount = 0;
  onopen?: () => void;
  onmessage?: (event: MessageEvent) => Promise<void>;
  onerror?: () => void;
  onclose?: () => void;
  sent: { type: string; payload: Record<string, unknown> }[] = [];
  constructor() {
    FakeSocket.instances.push(this);
  }
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  close() {
    this.readyState = 3;
  }
  message(type: string, payload: Record<string, unknown> = {}) {
    return this.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({ protocolVersion: 1, sessionId: 'test', type, payload }),
      }),
    );
  }
}
describe('remote session lifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeSocket.instances = [];
    FakePeer.instances = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    vi.stubGlobal('RTCPeerConnection', FakePeer);
    vi.stubGlobal('MediaStream', class {});
    TestBed.configureTestingModule({
      providers: [
        Remote,
        {
          provide: Api,
          useValue: {
            request: vi.fn((path: string) =>
              Promise.resolve(
                path === 'configuration'
                  ? { stunServers: [] }
                  : { sessionId: 'test', token: 'ticket' },
              ),
            ),
          },
        },
      ],
    });
  });
  afterEach(() => {
    TestBed.inject(Remote).close();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
  it('uses only fresh validated text regions and clears them on disconnect', async () => {
    const remote = TestBed.inject(Remote);
    remote.textDetectionEnabled = true;
    await remote.connect('device', 'Desktop', vi.fn(), vi.fn(), vi.fn());
    const channel = FakePeer.instances[0].channels[0];
    channel.onopen?.();
    channel.onmessage?.(
      new MessageEvent('message', {
        data: JSON.stringify({
          type: 'text.regions',
          nonce: 1,
          bounds: [
            [0.4, 0.4, 0.6, 0.6],
            [-1, 0, 1, 1],
          ],
        }),
      }),
    );
    expect(remote.isTextField(0.5, 0.5)).toBe(true);
    expect(remote.isTextField(0.1, 0.1)).toBe(false);
    await vi.advanceTimersByTimeAsync(1501);
    expect(remote.isTextField(0.5, 0.5)).toBe(false);
    remote.close();
    expect(remote.isTextField(0.5, 0.5)).toBe(false);
  });
  it('opens typing only for a fresh matching accessibility rectangle', async () => {
    const remote = TestBed.inject(Remote);
    await remote.connect('device', 'Terminal', vi.fn(), vi.fn(), vi.fn());
    const channel = FakePeer.instances[0].channels[0];
    const ready = vi.fn();
    const reply = (nonce: number, bounds: unknown) =>
      channel.onmessage?.(
        new MessageEvent('message', {
          data: JSON.stringify({ type: 'text.focus', nonce, bounds }),
        }),
      );
    remote.requestTextFocus(0.5, 0.5, ready);
    reply(1, null);
    expect(ready).not.toHaveBeenCalled();
    remote.requestTextFocus(0.5, 0.5, ready);
    reply(2, [0, 0, 0.2, 0.2]);
    expect(ready).not.toHaveBeenCalled();
    remote.requestTextFocus(0.5, 0.5, ready);
    reply(2, [0, 0, 1, 1]);
    expect(ready).not.toHaveBeenCalled();
    reply(3, [0.4, 0.4, 0.6, 0.6]);
    expect(ready).toHaveBeenCalledOnce();
    remote.requestTextFocus(0.5, 0.5, ready);
    remote.cancelTextFocus();
    reply(4, [0, 0, 1, 1]);
    expect(ready).toHaveBeenCalledOnce();
  });
  it('falls back within the same authorized session and ignores events from old sockets', async () => {
    const remote = TestBed.inject(Remote);
    const status = vi.fn();
    await remote.connect('device', 'Terminal', status, vi.fn(), vi.fn());
    expect(remote.connectionPhase()).toBe('connectionSignaling');
    expect(remote.connecting()).toBe(true);
    const old = FakeSocket.instances[0];
    old.onopen?.();
    await old.message('session.accept');
    expect(remote.connectionPhase()).toBe('connectionP2p');
    const peer = FakePeer.instances[0];
    peer.connectionState = 'failed';
    peer.onconnectionstatechange?.();
    expect(old.sent.map((v) => v.type)).toContain('relay.start');
    expect(remote.connectionPhase()).toBe('connectionFallback');
    await old.message('relay.ready');
    expect(status).toHaveBeenLastCalledWith('connectedRelay');
    expect(remote.connectionPhase()).toBe('connectionRelayReady');
    expect(remote.connecting()).toBe(false);
    peer.channels[0].onopen?.();
    expect(remote.connectionPhase()).toBe('connectionRelayReady');
    remote.input(new TextEncoder().encode('hello'));
    expect(old.sent.at(-1)?.type).toBe('relay.data');
    await vi.advanceTimersByTimeAsync(10000);
    expect(old.sent.at(-1)?.type).toBe('session.heartbeat');
    remote.close();
    await remote.connect('device', 'Terminal', status, vi.fn(), vi.fn());
    const current = FakeSocket.instances[1];
    old.onerror?.();
    old.onclose?.();
    expect(current.readyState).toBe(1);
  });
  it('bounds stalled negotiation and resets retry delay after a successful session', async () => {
    const remote = TestBed.inject(Remote);
    const status = vi.fn();
    await remote.connect('device', 'Terminal', status, vi.fn(), vi.fn());
    const socket = FakeSocket.instances[0];
    await socket.message('session.accept');
    await vi.advanceTimersByTimeAsync(24999);
    expect(socket.sent.map((x) => x.type)).not.toContain('relay.start');
    await vi.advanceTimersByTimeAsync(1);
    expect(socket.sent.map((x) => x.type)).toContain('relay.start');
    await socket.message('relay.ready');
    socket.onclose?.();
    await vi.advanceTimersByTimeAsync(500);
    const second = FakeSocket.instances[1];
    second.onclose?.();
    await vi.advanceTimersByTimeAsync(1000);
    const third = FakeSocket.instances[2];
    await third.message('session.accept');
    FakePeer.instances[2].channels[0].onopen?.();
    third.onclose?.();
    await vi.advanceTimersByTimeAsync(500);
    expect(FakeSocket.instances).toHaveLength(4);
  });
  it('accepts a late trickled answer without prematurely destroying P2P', async () => {
    const remote = TestBed.inject(Remote);
    const status = vi.fn();
    await remote.connect('device', 'Terminal', status, vi.fn(), vi.fn());
    const socket = FakeSocket.instances[0];
    const peer = FakePeer.instances[0];
    await socket.message('session.accept', { trickleIce: true });
    await vi.advanceTimersByTimeAsync(6000);
    expect(peer.connectionState).not.toBe('closed');
    await socket.message('webrtc.iceCandidate', { candidate: 'candidate:1 typ host' });
    await socket.message('webrtc.answer', { sdp: 'late-answer' });
    expect(peer.addIceCandidate).toHaveBeenCalled();
    peer.channels[0].onopen?.();
    await vi.advanceTimersByTimeAsync(30000);
    expect(status).toHaveBeenLastCalledWith('connected');
    expect(socket.sent.map((x) => x.type)).not.toContain('relay.start');
    expect(peer.connectionState).not.toBe('closed');
  });
  it('keeps the authorized socket usable when agent ICE negotiation fails', async () => {
    const remote = TestBed.inject(Remote);
    const status = vi.fn();
    await remote.connect('device', 'Terminal', status, vi.fn(), vi.fn());
    const socket = FakeSocket.instances[0];
    socket.onopen?.();
    await socket.message('session.accept');
    const applyAnswer = vi.spyOn(FakePeer.instances[0], 'setRemoteDescription');
    await socket.message('webrtc.answer', { error: 'ICE_NEGOTIATION_FAILED' });
    expect(applyAnswer).not.toHaveBeenCalled();
    expect(socket.readyState).toBe(1);
    expect(socket.sent.filter((v) => v.type === 'relay.start')).toHaveLength(1);
    await socket.message('relay.ready');
    expect(status).toHaveBeenLastCalledWith('connectedRelay');
    remote.input(new TextEncoder().encode('hello'));
    expect(socket.sent.at(-1)?.type).toBe('relay.data');
  });
  it('reconnects with a fresh ticket after transport loss and ignores the old socket', async () => {
    const remote = TestBed.inject(Remote);
    const status = vi.fn();
    await remote.connect('device', 'Terminal', status, vi.fn(), vi.fn());
    const old = FakeSocket.instances[0];
    await old.message('session.accept');
    FakePeer.instances[0].channels[0].onopen?.();
    old.onclose?.();
    expect(remote.connectionPhase()).toBe('connectionReconnecting');
    await vi.advanceTimersByTimeAsync(2000);
    expect(FakeSocket.instances).toHaveLength(2);
    const current = FakeSocket.instances[1];
    await current.message('session.accept');
    FakePeer.instances[1].channels[0].onopen?.();
    old.onclose?.();
    expect(remote.connectionPhase()).toBe('connectionP2pReady');
    expect(current.readyState).toBe(1);
    expect(
      vi
        .mocked(TestBed.inject(Api).request)
        .mock.calls.filter(([path]) => path === 'remote-sessions'),
    ).toHaveLength(2);
  });
  it('cancels retry when the user closes and never retries forbidden access', async () => {
    const remote = TestBed.inject(Remote);
    await remote.connect('device', 'Terminal', vi.fn(), vi.fn(), vi.fn());
    FakeSocket.instances[0].onerror?.();
    remote.close();
    await vi.advanceTimersByTimeAsync(60000);
    expect(FakeSocket.instances).toHaveLength(1);
    vi.mocked(TestBed.inject(Api).request).mockRejectedValueOnce(new Error('FORBIDDEN'));
    await expect(remote.connect('device', 'Terminal', vi.fn(), vi.fn(), vi.fn())).rejects.toThrow(
      'FORBIDDEN',
    );
    await vi.advanceTimersByTimeAsync(60000);
    expect(FakeSocket.instances).toHaveLength(1);
  });
  it('backs off repeated failures and restores relay mode on retry', async () => {
    const remote = TestBed.inject(Remote);
    await remote.connect('device', 'Terminal', vi.fn(), vi.fn(), vi.fn(), 'relay');
    FakeSocket.instances[0].onclose?.();
    await vi.advanceTimersByTimeAsync(2000);
    const second = FakeSocket.instances[1];
    second.onclose?.();
    await vi.advanceTimersByTimeAsync(999);
    expect(FakeSocket.instances).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1);
    const third = FakeSocket.instances[2];
    await third.message('session.accept');
    expect(third.sent.map((x) => x.type)).toContain('relay.start');
    await third.message('relay.ready');
    expect(remote.connectionPhase()).toBe('connectionRelayReady');
  });
  it('recovers a stalled video stream even when the socket remains open', async () => {
    const clock = vi.spyOn(performance, 'now').mockImplementation(() => Date.now());
    try {
      const remote = TestBed.inject(Remote);
      await remote.connect('device', 'Terminal', vi.fn(), vi.fn(), vi.fn());
      remote.qualitySupported.set(true);
      // Exercise the same periodic sampler used by a capabilities-enabled desktop.
      const sample = () => (remote as unknown as { measureVideo(): Promise<void> }).measureVideo();
      await sample();
      await vi.advanceTimersByTimeAsync(12000);
      await sample();
      expect(remote.connectionPhase()).toBe('connectionReconnecting');
      await vi.advanceTimersByTimeAsync(2000);
      expect(FakeSocket.instances).toHaveLength(2);
    } finally {
      clock.mockRestore();
    }
  });
  it('sends late ICE candidates and queues remote candidates until the answer applies', async () => {
    const remote = TestBed.inject(Remote);
    await remote.connect('device', 'Terminal', vi.fn(), vi.fn(), vi.fn());
    const socket = FakeSocket.instances[0];
    const peer = FakePeer.instances[0];
    peer.iceGatheringState = 'gathering';
    await socket.message('session.accept', { trickleIce: true });
    expect(socket.sent.some((x) => x.type === 'webrtc.offer')).toBe(true);
    const candidate = { candidate: 'candidate:1 1 udp 123 192.0.2.1 50000 typ srflx', sdpMid: '0' };
    peer.onicecandidate?.({ candidate: { toJSON: () => candidate } });
    expect(socket.sent.at(-1)?.type).toBe('webrtc.iceCandidate');
    await socket.message('webrtc.iceCandidate', candidate);
    expect(peer.addIceCandidate).not.toHaveBeenCalled();
    await socket.message('webrtc.answer', { sdp: 'test' });
    expect(peer.addIceCandidate).toHaveBeenCalledWith(candidate);
    peer.connectionState = 'failed';
    peer.onconnectionstatechange?.();
    const count = socket.sent.length;
    peer.onicecandidate?.({ candidate: { toJSON: () => candidate } });
    await socket.message('webrtc.iceCandidate', candidate);
    expect(socket.sent.length).toBe(count);
    expect(peer.addIceCandidate).toHaveBeenCalledTimes(1);
  });
  it('does not reopen a terminal after its shell exits normally', async () => {
    const remote = TestBed.inject(Remote);
    await remote.connect('device', 'Terminal', vi.fn(), vi.fn(), vi.fn());
    await FakeSocket.instances[0].message('session.close');
    await vi.advanceTimersByTimeAsync(60000);
    expect(FakeSocket.instances).toHaveLength(1);
    expect(remote.connectionPhase()).toBe('connectionOffline');
  });
  it('ignores a cancelled pending ticket when a different session opens', async () => {
    const remote = TestBed.inject(Remote);
    let resolve!: (value: unknown) => void;
    vi.mocked(TestBed.inject(Api).request).mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolve = r;
        }),
    );
    const old = remote.connect('old-device', 'Terminal', vi.fn(), vi.fn(), vi.fn());
    await remote.connect('new-device', 'Terminal', vi.fn(), vi.fn(), vi.fn());
    resolve({ sessionId: 'old', token: 'old' });
    await old;
    expect(FakeSocket.instances).toHaveLength(1);
    expect(remote.connectionPhase()).toBe('connectionSignaling');
  });
  it('reports busy sessions accurately and does not attempt relay without a grant', async () => {
    const remote = TestBed.inject(Remote);
    const status = vi.fn();
    await remote.connect('device', 'Terminal', status, vi.fn(), vi.fn());
    const socket = FakeSocket.instances[0];
    socket.onopen?.();
    await socket.message('session.reject', { code: 'SESSION_BUSY' });
    expect(status).toHaveBeenLastCalledWith('connectionReconnecting');
    expect(remote.connectionPhase()).toBe('connectionReconnecting');
    expect(remote.connecting()).toBe(true);
    expect(socket.sent.map((v) => v.type)).not.toContain('relay.start');
  });
  it('shows P2P only after its channel opens and resets on disconnect', async () => {
    const remote = TestBed.inject(Remote);
    await remote.connect('device', 'Terminal', vi.fn(), vi.fn(), vi.fn());
    await FakeSocket.instances[0].message('session.accept');
    expect(remote.connectionPhase()).toBe('connectionP2p');
    FakePeer.instances[0].channels[0].onopen?.();
    expect(remote.connectionPhase()).toBe('connectionP2pReady');
    expect(remote.connecting()).toBe(false);
    remote.close();
    FakePeer.instances[0].channels[0].onopen?.();
    expect(remote.connectionPhase()).toBe('connectionOffline');
  });
  it('distinguishes forced WebSocket from failed P2P fallback', async () => {
    const remote = TestBed.inject(Remote);
    await remote.connect('device', 'Terminal', vi.fn(), vi.fn(), vi.fn(), 'relay');
    await FakeSocket.instances[0].message('session.accept');
    expect(remote.connectionPhase()).toBe('connectionRelayConnecting');
    await FakeSocket.instances[0].message('relay.ready');
    expect(remote.connectionPhase()).toBe('connectionRelayReady');
  });
  it('stops progress when authorization fails', async () => {
    const remote = TestBed.inject(Remote);
    vi.spyOn(TestBed.inject(Api), 'request').mockRejectedValueOnce(new Error('FORBIDDEN'));
    await expect(remote.connect('device', 'Terminal', vi.fn(), vi.fn(), vi.fn())).rejects.toThrow(
      'FORBIDDEN',
    );
    expect(remote.connectionPhase()).toBe('connectionError');
    expect(remote.connecting()).toBe(false);
  });
  it('records ICE packet counters without candidate addresses and stops polling after close', async () => {
    const remote = TestBed.inject(Remote);
    await remote.connect('device', 'Terminal', vi.fn(), vi.fn(), vi.fn());
    await vi.advanceTimersByTimeAsync(3000);
    const diagnostics = remote.diagnostics().join('\n');
    expect(diagnostics).toContain('host>srflx in-progress sent=12 responses=0 received=0');
    expect(diagnostics).not.toContain('192.0.2.10');
    expect(diagnostics).not.toContain('198.51.100.20');
    remote.close();
    const count = FakePeer.instances[0].getStats.mock.calls.length;
    await vi.advanceTimersByTimeAsync(6000);
    expect(FakePeer.instances[0].getStats).toHaveBeenCalledTimes(count);
  });
});
