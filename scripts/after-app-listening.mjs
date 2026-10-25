#!/usr/bin/env node
// install-e2e's wait for the native app (Ian's rule on PR #11: an event, never a poll):
//   node scripts/after-app-listening.mjs -- <trigger command...>
// Follows the app's log from where it stands now (macOS: ~/Library/Logs/get-me-there/app.log from its current end;
// Linux: the user journal of get-me-there-app.service since now, in UTC to the millisecond, so no earlier line is
// replayed), runs the trigger, and exits 0 on the next line whose msg is "listening", which the app logs once its server
// is bound. It exits 1 at once if the trigger fails or the follower cannot start or ends, and if no such line comes
// within the backstop (BACKSTOP_MS, default 120 s); the first result stands, and the follower is always stopped.
// APP_LOG overrides the macOS log path (for this script's test).
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const sep = process.argv.indexOf('--');
const trigger = sep === -1 ? [] : process.argv.slice(sep + 1);
if (trigger.length === 0) {
  process.stderr.write('usage: node scripts/after-app-listening.mjs -- <command...>\n');
  process.exit(64);
}
const backstop = Number(process.env.BACKSTOP_MS ?? '120000');

let follow;
if (process.env.RUNNER_OS === 'macOS') {
  const log = process.env.APP_LOG ?? join(homedir(), 'Library', 'Logs', 'get-me-there', 'app.log');
  const from = existsSync(log) ? statSync(log).size : 0;
  follow = spawn('tail', ['-c', `+${from + 1}`, '-F', log], { stdio: ['ignore', 'pipe', 'ignore'] });
} else {
  // why: CodeRabbit (PR #11): to the millisecond and in UTC, taken before the trigger runs, so a "listening" line from
  // earlier in the same second (a restart's old process) is never replayed and taken for the new one
  const iso = new Date().toISOString();
  const since = `${iso.slice(0, 10)} ${iso.slice(11, 23)} UTC`;
  follow = spawn(
    'journalctl',
    ['--user', '-u', 'get-me-there-app.service', '-f', '-o', 'cat', '--since', since],
    {
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
}

let finished = false;
const done = (code, message) => {
  // why: the first result stands; a later event (the follower's exit after its kill) cannot override it
  if (finished) return;
  finished = true;
  follow.kill('SIGKILL');
  if (message !== undefined) process.stderr.write(`${message}\n`);
  process.exit(code);
};
follow.once('error', (e) => done(1, `could not follow the app log: ${e.message}`));
follow.once('exit', (code, signal) => done(1, `the app log follower ended early (${signal ?? code})`));
const timer = setTimeout(
  () => done(1, `no "listening" line from the app within ${backstop} ms of ${trigger.join(' ')}`),
  backstop,
);
let buffered = '';
follow.stdout.on('data', (chunk) => {
  buffered += chunk;
  const lines = buffered.split('\n');
  buffered = lines.pop() ?? '';
  for (const line of lines) {
    let msg;
    try {
      msg = JSON.parse(line).msg;
    } catch {
      continue;
    }
    if (msg === 'listening') {
      clearTimeout(timer);
      done(0);
    }
  }
});

const t = spawn(trigger[0], trigger.slice(1), { stdio: 'inherit' });
t.once('error', (e) => done(1, `${trigger.join(' ')} could not start: ${e.message}`));
t.once('exit', (code, signal) => {
  if (code !== 0) done(1, `${trigger.join(' ')} exited with ${signal ?? code}`);
});
