import { RelayAssembler, RelayChannel } from './relay';
import { FileTransfer } from './file-transfer';
describe('WebSocket relay boundaries', () => {
  const packet = (sequence: number, part = 0, last = true, data = btoa('abc')) => ({
    sequence,
    part,
    last,
    data,
    channel: 'video',
    text: false,
  });
  it('reassembles fragmented compressed frames and rejects out-of-order parts', () => {
    const assembler = new RelayAssembler();
    expect(assembler.receive(packet(1, 0, false))).toBeUndefined();
    const frame = assembler.receive(packet(2, 1, true));
    expect(new TextDecoder().decode(frame?.bytes)).toBe('abcabc');
    expect(() => assembler.receive(packet(2))).toThrow();
    expect(() => assembler.receive(packet(3, 2))).toThrow();
    expect(() => new RelayAssembler().receive(packet(1, 0, true, 'A'.repeat(44001)))).toThrow();
    expect(() => new RelayAssembler().receive({ ...packet(1), channel: 'unknown' })).toThrow();
  });
  it('keeps file RPC acknowledgements working over the relay channel', async () => {
    const sent: Record<string, unknown>[] = [];
    const channel = new RelayChannel('files', (p) => sent.push(p));
    const files = new FileTransfer();
    files.attach(channel);
    channel.onopen?.(new Event('open'));
    expect(files.available).toBe(true);
    const result = files.list();
    const request = JSON.parse(atob(String(sent[0]['data'])));
    channel.receive(
      new TextEncoder().encode(
        JSON.stringify({ id: request.id, type: 'list', files: [{ name: 'test.txt', size: 3 }] }),
      ),
      true,
    );
    await result;
    expect(files.entries).toEqual([{ name: 'test.txt', size: 3 }]);
    files.close();
    channel.close();
    expect(() => channel.send('x')).toThrow('offline');
  });
});
