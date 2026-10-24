import { createInterface } from 'node:readline/promises';

/**
 * Prompts (brief WP16b §5; decision 72: `node:readline/promises`, hidden input by raw mode on a TTY, no dependency).
 * A secret answer is never echoed, logged or kept beyond the caller's use.
 */
export interface Ask {
  text(q: string, def: string | null): Promise<string>;
  secret(q: string): Promise<string>; // raw mode on a TTY; never echoed, never logged
  confirm(q: string, def: boolean): Promise<boolean>;
  typed(q: string, word: string): Promise<boolean>; // e.g. 'yes', 'purge'
}

/** The streams a terminal `Ask` uses: process.stdin and process.stdout, passed in by main.ts. */
export interface TerminalStreams {
  input: NodeJS.ReadableStream & {
    isTTY?: boolean;
    isRaw?: boolean;
    setRawMode?: (mode: boolean) => unknown;
  };
  output: NodeJS.WritableStream;
}

/** Reads one line with nothing echoed: raw mode, byte by byte, Enter ends, Ctrl-C aborts, backspace edits. */
function hiddenLine(s: TerminalStreams, prompt: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const { input, output } = s;
    output.write(prompt);
    let value = '';
    const wasRaw = input.isRaw === true;
    const setRaw = input.setRawMode?.bind(input);
    if (setRaw === undefined) {
      reject(new Error('a hidden answer needs a terminal'));
      return;
    }
    setRaw(true);
    input.resume();
    const done = (err: Error | null) => {
      input.removeListener('data', onData);
      setRaw(wasRaw);
      input.pause();
      output.write('\n');
      if (err === null) resolve(value);
      else reject(err);
    };
    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') return done(null);
        if (ch === '\u0003') return done(new Error('cancelled'));
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    input.on('data', onData);
  });
}

/** The terminal `Ask`: questions on stdout, answers from stdin; a secret only from a TTY, by raw mode. */
export function terminalAsk(s: TerminalStreams): Ask {
  const line = async (prompt: string): Promise<string> => {
    const rl = createInterface({ input: s.input, output: s.output, terminal: s.input.isTTY === true });
    try {
      return (await rl.question(prompt)).trim();
    } finally {
      rl.close();
    }
  };
  return {
    async text(q, def) {
      const a = await line(def === null ? `${q} ` : `${q} [${def}] `);
      return a === '' && def !== null ? def : a;
    },
    async secret(q) {
      if (s.input.isTTY !== true)
        throw new Error('a hidden answer needs a terminal; use --answers with fromEnv');
      return (await hiddenLine(s, `${q} `)).trim();
    },
    async confirm(q, def) {
      const a = (await line(`${q} [${def ? 'Y/n' : 'y/N'}] `)).toLowerCase();
      return a === '' ? def : a === 'y' || a === 'yes';
    },
    async typed(q, word) {
      return (await line(`${q} (type ${word}) `)) === word;
    },
  };
}

/** An `Ask` that refuses every question: what `--non-interactive` runs with, so a planner that asks fails loudly. */
export const noAsk: Ask = {
  text: (q) => Promise.reject(new Error(`--non-interactive: would have asked "${q}"`)),
  secret: (q) => Promise.reject(new Error(`--non-interactive: would have asked "${q}"`)),
  confirm: (q) => Promise.reject(new Error(`--non-interactive: would have asked "${q}"`)),
  typed: (q) => Promise.reject(new Error(`--non-interactive: would have asked "${q}"`)),
};
