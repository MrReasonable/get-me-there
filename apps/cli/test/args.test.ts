import { describe, expect, it } from 'vitest';
import { COMMANDS, helpText, parseCommandLine, RECONFIGURE_GROUPS } from '../src/args.js';

describe('parseCommandLine (decision 72: node:util parseArgs, no new dependency)', () => {
  it.each([[[]], [['--help']], [['-h']], [['help']]])('%j prints the whole help', (argv) => {
    const p = parseCommandLine(argv);
    expect(p).toEqual({ kind: 'help', text: helpText() });
  });

  it('the whole help lists every command with its line', () => {
    const t = helpText();
    for (const c of COMMANDS) expect(t).toMatch(new RegExp(`^  ${c} +\\S`, 'm'));
  });

  it('a command’s --help is that command’s usage and flags', () => {
    const p = parseCommandLine(['setup', '--help']);
    expect(p.kind).toBe('help');
    if (p.kind !== 'help') return;
    expect(p.text).toContain('usage: pnpm gmt setup [options]');
    expect(p.text).toContain('--reconfigure <group>');
    expect(p.text).toContain(RECONFIGURE_GROUPS.join(', '));
    expect(helpText('restore')).toContain('usage: pnpm gmt restore <file> [options]');
    expect(helpText('status')).toBe(
      [
        'usage: pnpm gmt status [options]',
        '',
        '  show the services, the settings files and the app’s own report of anything that needs attention',
        '',
        '  --only <area>             show only the app’s report for one area: app, database, backups, schedule, data, provider, worker, consent or email',
        '  --json                    print the app’s report as JSON',
        '',
      ].join('\n'),
    );
  });

  it('the smoke help states its spend', () => {
    expect(helpText('smoke')).toContain(
      'spends real calls: up to 4 SearchApi credits and one browser page with today’s settings',
    );
  });

  it('parses flags, string options and the positional', () => {
    expect(parseCommandLine(['setup', '--dry-run', '--answers', 'a.json', '--reconfigure', 'port'])).toEqual({
      kind: 'command',
      command: 'setup',
      flags: { 'dry-run': true, answers: 'a.json', reconfigure: 'port' },
      positional: null,
    });
    expect(parseCommandLine(['restore', '/b/x.db'])).toEqual({
      kind: 'command',
      command: 'restore',
      flags: {},
      positional: '/b/x.db',
    });
  });

  it.each([
    [['frobnicate'], 'unknown command: frobnicate'],
    [['setup', '--nope'], "Unknown option '--nope'"],
    [['setup', '--answers'], "Option '--answers <value>' argument missing"],
    [['status', 'extra'], 'status takes no argument'],
    [['restore'], 'restore needs <file>'],
    [['setup', '--reconfigure', 'colour'], 'unknown group for --reconfigure: colour'],
    [['smoke', '--dry-run'], "Unknown option '--dry-run'"],
  ])('%j is a usage error', (argv, message) => {
    const p = parseCommandLine(argv);
    expect(p.kind).toBe('usage');
    if (p.kind === 'usage') expect(p.message).toContain(message);
  });

  it('the help names the first step, says setup generates the password, and update fast-forwards only (pf-b1-012)', () => {
    const top = helpText();
    expect(top).toContain('First time: pnpm gmt setup');
    expect(helpText('setup')).toContain('setup generates its password');
    expect(helpText('update')).toContain('fast-forward only');
  });
});
