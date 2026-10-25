#!/usr/bin/env node
// install-e2e's wait for the native app (Ian's rule on PR #11: an event, never a poll):
//   node ci/after-app-listening.mjs -- <trigger command...>
// Follows the app's log from where it stands now (macOS: ~/Library/Logs/get-me-there/app.log from its current size;
// Linux: the user journal of get-me-there-app.service since now), runs the trigger, and exits 0 on the next line whose
// msg is "listening", which the app logs once its server is bound. It exits 1 if the trigger fails, or if no such line
// comes within the backstop (BACKSTOP_MS, default 120 s), and always stops the log follower it started.
// APP_LOG overrides the macOS log path (for this script's test).
import { spawn } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const sep = process.argv.indexOf('--');
const trigger = sep === -1 ? [] : process.argv.slice(sep + 1);
if (trigger.length === 0) {
  process.stderr.write('usage: node ci/after-app-listening.mjs -- <command...>\n');
  process.exit(64);
}
const backstop = Number(process.env.BACKSTOP_MS ?? '120000');

let follow;
if (process.env.RUNNER_OS === 'macOS') {
  const log = process.env.APP_LOG ?? join(homedir(), 'Library', 'Logs', 'get-me-there', 'app.log');
  const from = existsSync(log) ? statSync(log).size : 0;
  follow = spawn('tail', ['-c', `+${from + 1}`, '-F', log], { stdio: ['ignore', 'pipe', 'ignore'] });
} else {
  // why: journalctl takes local time to the second; the trigger has not run yet, so nothing it causes is earlier
  const since = new Date().toLocaleString('sv-SE');
  follow = spawn(
    'journalctl',
    ['--user', '-u', 'get-me-there-app.service', '-f', '-o', 'cat', '--since', since],
    {
      stdio: ['ignore', 'pipe', 'ignore'],
    },
  );
}

const done = (code, message) => {
  follow.kill('SIGKILL');
  if (message !== undefined) process.stderr.write(`${message}\n`);
  process.exit(code);
};
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
