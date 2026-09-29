import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { PrivateControlPipe } from '../src/private-control-pipe';

describe('private control channel', () => {
  it('frames split/coalesced packets without exposing them on ACP', async () => {
    const stream = new PassThrough();
    const pipe = new PrivateControlPipe(stream);
    const pending = pipe.read();
    stream.write('{"version":');
    stream.write('1}\n{"type":"credential","apiKey":"synthetic"}\n');
    expect(await pending).toEqual({ version: 1 });
    expect(await pipe.read()).toEqual({ type: 'credential', apiKey: 'synthetic' });
    pipe.close();
    expect(stream.destroyed).toBe(true);
  });

  it('retires the channel on cancel; a late grant cannot bind another run', async () => {
    const stream = new PassThrough();
    const pipe = new PrivateControlPipe(stream);
    const controller = new AbortController();
    const pending = expect(pipe.read(controller.signal)).rejects.toThrow('harness_control_closed');
    controller.abort();
    await pending;
    await expect(pipe.read()).rejects.toThrow('harness_control_closed');
    expect(stream.destroyed).toBe(true);
  });

  it.each(['invalid-json\n', 'x'.repeat(1024 * 1024 + 1), '{}\n'.repeat(9)])(
    'rejects malformed or unbounded input %#',
    async (packet) => {
      const stream = new PassThrough();
      const pipe = new PrivateControlPipe(stream);
      stream.write(packet);
      await expect(pipe.read()).rejects.toThrow('harness_control_closed');
      expect(stream.destroyed).toBe(true);
    }
  );

  it('settles a waiting reader on EOF and refuses overlapping reads', async () => {
    const stream = new PassThrough();
    const pipe = new PrivateControlPipe(stream);
    const pending = expect(pipe.read()).rejects.toThrow('harness_control_closed');
    await expect(pipe.read()).rejects.toThrow('harness_control_concurrent_read');
    stream.end();
    await pending;
  });
});
