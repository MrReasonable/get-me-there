import { PassThrough } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { noAsk, terminalAsk } from '../src/ask.js';

/** A fake terminal: what the CLI wrote, and a way to type into it. */
function terminal(tty: boolean) {
  const input = Object.assign(new PassThrough(), {
    isTTY: tty,
    isRaw: false,
    rawCalls: new Array<boolean>(),
    setRawMode(mode: boolean) {
      input.rawCalls.push(mode);
      input.isRaw = mode;
    },
  });
  const output = new PassThrough();
  let written = '';
  output.on('data', (c: Buffer) => {
    written += c.toString('utf8');
  });
  return { input, output, written: () => written };
}

describe('terminalAsk (decision 72: readline, raw mode for hidden input)', () => {
  it('text returns the answer, or the default on Enter, and shows the default', async () => {
    const t = terminal(false);
    const ask = terminalAsk(t);
    const p = ask.text('Port', '3000');
    t.input.write('\n');
    expect(await p).toBe('3000');
    const q = ask.text('Port', '3000');
    t.input.write(' 3917 \n');
    expect(await q).toBe('3917');
    const r = ask.text('Name', null);
    t.input.write('\n');
    expect(await r).toBe('');
    expect(t.written()).toContain('Port [3000] ');
  });

  it('confirm reads y, yes, n and Enter as the default', async () => {
    const t = terminal(false);
    const ask = terminalAsk(t);
    for (const [typed, def, want] of [
      ['y', false, true],
      ['YES', false, true],
      ['n', true, false],
      ['', true, true],
      ['', false, false],
    ] as const) {
      const p = ask.confirm('Go?', def);
      t.input.write(`${typed}\n`);
      expect(await p).toBe(want);
    }
    expect(t.written()).toContain('Go? [Y/n] ');
    expect(t.written()).toContain('Go? [y/N] ');
  });

  it('typed is true only for the exact word', async () => {
    const t = terminal(false);
    const ask = terminalAsk(t);
    const p = ask.typed('Delete?', 'purge');
    t.input.write('purge\n');
    expect(await p).toBe(true);
    const q = ask.typed('Delete?', 'purge');
    t.input.write('Purge\n');
    expect(await q).toBe(false);
    expect(t.written()).toContain('(type purge)');
  });

  it('secret reads in raw mode, echoes nothing, handles backspace, and restores the mode', async () => {
    const t = terminal(true);
    const ask = terminalAsk(t);
    const p = ask.secret('Token (hidden):');
    t.input.write('s3cr3tX\u007f\r');
    expect(await p).toBe('s3cr3t');
    expect(t.written()).toBe('Token (hidden): \n');
    expect(t.input.rawCalls).toEqual([true, false]);
  });

  it('secret is cancelled by Ctrl-C and refused off a terminal', async () => {
    const t = terminal(true);
    const p = terminalAsk(t).secret('Key:');
    t.input.write('ab\u0003');
    await expect(p).rejects.toThrow('cancelled');
    await expect(terminalAsk(terminal(false)).secret('Key:')).rejects.toThrow('needs a terminal');
    const noRaw = { input: new PassThrough(), output: new PassThrough() };
    await expect(
      terminalAsk({ ...noRaw, input: Object.assign(noRaw.input, { isTTY: true }) }).secret('Key:'),
    ).rejects.toThrow('needs a terminal');
  });

  it('noAsk refuses every question, naming it', async () => {
    await expect(noAsk.text('Port', '1')).rejects.toThrow('--non-interactive: would have asked "Port"');
    await expect(noAsk.secret('K')).rejects.toThrow('K');
    await expect(noAsk.confirm('C', true)).rejects.toThrow('C');
    await expect(noAsk.typed('T', 'yes')).rejects.toThrow('T');
  });
});
