#!/usr/bin/env node
// A wait on an event in the app's own log, never a poll (Ian's rule on PR #11):
//   node scripts/until-log-line.mjs --msg <message> [--field <name>=<value>]... -- <follower command...>
// Starts the follower (a command that prints the app's JSON log lines as they are written, such as
// `docker compose logs --follow --no-log-prefix --since <instant> app`) and exits 0 on the first line whose msg is
// <message> and whose every named field has its value, printing which line it saw. It exits 1 at once if the follower
// cannot start or ends first, and if no such line comes within the backstop (BACKSTOP_MS, default 120 s); the first
// result stands, and the follower is always stopped. A malformed command line exits 64.
import { spawn } from 'node:child_process';

const USAGE =
  'usage: node scripts/until-log-line.mjs --msg <message> [--field <name>=<value>]... -- <command...>';
const sep = process.argv.indexOf('--');
const options = process.argv.slice(2, sep === -1 ? undefined : sep);
const command = sep === -1 ? [] : process.argv.slice(sep + 1);
let msg;
const fields = [];
let malformed = command.length === 0;
for (let i = 0; i < options.length; i += 2) {
  const value = options[i + 1];
  if (options[i] === '--msg' && value !== undefined) msg = value;
  else if (options[i] === '--field' && value !== undefined && value.indexOf('=') > 0) {
    const at = value.indexOf('=');
    fields.push([value.slice(0, at), value.slice(at + 1)]);
  } else malformed = true;
}
if (malformed || msg === undefined) {
  process.stderr.write(`${USAGE}\n`);
  process.exit(64);
}
const named = fields.length === 0 ? '' : ` (${fields.map(([k, v]) => `${k}=${v}`).join(', ')})`;
const backstop = Number(process.env.BACKSTOP_MS ?? '120000');

const follow = spawn(command[0], command.slice(1), { stdio: ['ignore', 'pipe', 'inherit'] });
let finished = false;
const done = (code, message, stream = process.stderr) => {
  // why: the first result stands; a later event (the follower's close after its kill) cannot override it
  if (finished) return;
  finished = true;
  clearTimeout(timer);
  follow.kill('SIGKILL');
  if (message !== undefined) stream.write(`${message}\n`);
  process.exit(code);
};
const timer = setTimeout(() => done(1, `no "${msg}" line${named} within ${backstop} ms`), backstop);
follow.once('error', (e) => done(1, `could not start the log follower ${command[0]}: ${e.message}`));
// why: 'close', not 'exit': it comes after the follower's output is read, so a line printed just before it ends counts
follow.once('close', (code, signal) => done(1, `the log follower ended before the line (${signal ?? code})`));
let buffered = '';
follow.stdout.on('data', (chunk) => {
  buffered += chunk;
  const lines = buffered.split('\n');
  buffered = lines.pop() ?? '';
  for (const line of lines) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (entry === null || typeof entry !== 'object' || entry.msg !== msg) continue;
    if (fields.every(([k, v]) => String(entry[k]) === v)) done(0, `seen: ${msg}${named}`, process.stdout);
  }
});
