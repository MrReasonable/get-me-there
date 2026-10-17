/**
 * The tools reachable while the app holds app_lock (spec §7, §10): WP4b's `runRecord`, the same function the tool
 * bootstrap runs, over the app's own ports, with its output collected into the api-contract tool response. WP13 owns
 * smoke.
 */
import { existsSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { syntheticAllowed } from '@gmt/core';
import { type RecordingTarget, recordingTarget } from '../bootstrap/tool.js';
import type { HttpToolRunners, ToolRecordRequest, ToolRunResponse } from '../routes/types.js';
import { safeMessage } from '../safeMessage.js';
import { API_TEXT } from '../text.js';
import type { Ports } from '../wiring.js';
import { recordPrecheck, runRecord } from './record.js';
import type { RecordCli } from './recordPlan.js';
import { EXIT } from './types.js';

/** Every file under `root`, or none when it does not exist yet. */
function filesUnder(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true, recursive: true })
    .filter((e) => e.isFile())
    .map((e) => join(e.parentPath, e.name));
}

function refused(exitCode: number, line: string): ToolRunResponse {
  return {
    exitCode,
    summary: API_TEXT.toolSummary('record', exitCode, 0),
    lines: [line],
    fixturesWritten: [],
  };
}

/** Test seams; production passes none. `runRecord` stands in for WP4b's runner (review SEC-7's sentinel test). */
export interface InProcessOptions {
  recording?: RecordingTarget;
  runRecord?: typeof runRecord;
}

/**
 * The record runner over `runRecord`. why: the refusals mirror `runTool`'s order and exit codes (plan exit-code
 * table), which a test pins by running both over the same refusing config: an open synthetic gate (70), a route that
 * may not enter the committed tree (64), a configuration that cannot record (78); the run itself refuses for spend
 * with 65 (no `--confirm-rerun` over HTTP). Every line is URL- and secret-scrubbed with `safeMessage` before it leaves
 * the process (review SEC-7), and `fixturesWritten` lists the files the run added, relative to the recorded root.
 */
export function inProcessTools(ports: Ports, opts: InProcessOptions = {}): HttpToolRunners {
  const run = opts.runRecord ?? runRecord;
  return {
    record: async (args: ToolRecordRequest, signal: AbortSignal) => {
      if (syntheticAllowed(ports.config)) return refused(EXIT.refusedTestEnv, API_TEXT.toolSynthetic);
      const cli: RecordCli = { args, dryRun: false, confirmRerun: false, out: null };
      const target = recordingTarget(cli, opts.recording);
      if ('refusal' in target) return refused(EXIT.usage, target.refusal);
      const precheck = recordPrecheck(ports.config);
      if (precheck !== null) return refused(EXIT.badConfig, precheck);
      const lines: string[] = [];
      const keep = (l: string) => lines.push(safeMessage(l, ports.secrets));
      const before = new Set(filesUnder(target.root));
      const exitCode = await run(ports, cli, {
        signal,
        out: keep,
        err: keep,
        recordedRoot: target.root,
        recordedBy: target.recordedBy,
      });
      const fixturesWritten = filesUnder(target.root)
        .filter((f) => !before.has(f))
        .map((f) => relative(target.root, f));
      return {
        exitCode,
        summary: API_TEXT.toolSummary('record', exitCode, fixturesWritten.length),
        lines,
        fixturesWritten,
      };
    },
  };
}
