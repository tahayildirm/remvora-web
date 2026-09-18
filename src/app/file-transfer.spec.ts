import { FileTransfer } from './file-transfer';
import { vi } from 'vitest';
class Channel {
  readyState = 'open';
  onopen?: () => void;
  onclose?: () => void;
  onmessage?: (event: { data: string }) => void;
  sent: Record<string, unknown>[] = [];
  send(text: string) {
    this.sent.push(JSON.parse(text));
  }
  reply(value: Record<string, unknown>) {
    this.onmessage?.({ data: JSON.stringify({ ...value, id: this.sent.at(-1)!['id'] }) });
  }
}
describe('file transfer boundaries', () => {
  it('matches replies to the request and denies concurrent requests', async () => {
    const channel = new Channel();
    const transfer = new FileTransfer();
    transfer.attach(channel as unknown as RTCDataChannel);
    channel.onopen?.();
    const listing = transfer.list();
    await expect(transfer.list()).rejects.toThrow('fileUnavailable');
    channel.onmessage?.({
      data: JSON.stringify({ id: 'wrong', type: 'list', files: [{ name: 'bad', size: 1 }] }),
    });
    expect(transfer.entries).toEqual([]);
    channel.reply({
      type: 'list',
      files: [null, 42, { name: 'valid', size: 5 }, { name: 'too-large', size: 101 * 1024 * 1024 }],
    });
    await listing;
    expect(transfer.entries).toEqual([{ name: 'valid', size: 5 }]);
    transfer.close();
    expect(transfer.available).toBe(false);
  });
  it('rejects pending work on disconnect', async () => {
    const c = new Channel();
    const t = new FileTransfer();
    t.attach(c as unknown as RTCDataChannel);
    const request = t.list();
    const rejected = expect(request).rejects.toThrow('fileCancelled');
    t.close();
    await rejected;
  });
  it('rejects oversized files before reading or sending them', async () => {
    const t = new FileTransfer();
    const read = vi.fn();
    await expect(
      t.upload({ size: 101 * 1024 * 1024, arrayBuffer: read } as unknown as File),
    ).rejects.toThrow('fileLimit');
    expect(read).not.toHaveBeenCalled();
  });
  it('detaches replaced channels so stale events cannot close the new session', async () => {
    const old = new Channel();
    const current = new Channel();
    const t = new FileTransfer();
    t.attach(old as unknown as RTCDataChannel);
    t.attach(current as unknown as RTCDataChannel);
    old.onclose?.();
    current.onopen?.();
    const listing = t.list();
    current.reply({ type: 'list', files: [] });
    await listing;
    expect(t.available).toBe(true);
    expect(old.onmessage).toBeNull();
    t.close();
  });
  it('clears pending requests when sending throws and permits retry', async () => {
    const c = new Channel();
    const t = new FileTransfer();
    t.attach(c as unknown as RTCDataChannel);
    const send = vi.spyOn(c, 'send').mockImplementationOnce(() => {
      throw new Error('closed');
    });
    await expect(t.list()).rejects.toThrow('fileUnavailable');
    const retry = t.list();
    c.reply({ type: 'list', files: [] });
    await retry;
    expect(send).toHaveBeenCalledTimes(2);
    t.close();
  });
  it('keeps cancellation locked while an earlier file read unwinds', async () => {
    const c = new Channel();
    const t = new FileTransfer();
    t.attach(c as unknown as RTCDataChannel);
    let finishRead!: (value: ArrayBuffer) => void;
    const read = new Promise<ArrayBuffer>((resolve) => {
      finishRead = resolve;
    });
    const upload = t.upload({ size: 1, name: 'x', arrayBuffer: () => read } as File);
    const rejected = expect(upload).rejects.toThrow('fileCancelled');
    const cancel = t.cancel();
    finishRead(new ArrayBuffer(1));
    await rejected;
    expect(t.busy).toBe(true);
    c.reply({ type: 'cancelled' });
    await cancel;
    expect(t.busy).toBe(false);
    t.close();
  });
});
