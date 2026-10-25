// The camoufox-install CI job's entry (decision 77; brief WP17 Task 17.9): this machine's pinned Camoufox installed
// exactly as `gmt setup` installs it (camoufox/install.ts, layout.ts and, on Linux, the library check), and nothing else:
// no settings file, no service, no consent. It prints one line naming the bundle, and exits non-zero on any refusal.
import { randomBytes } from 'node:crypto';
import { homedir } from 'node:os';
import { CAMOUFOX_BUILDS } from '@gmt/core';
import { freeBytesAt, osArchOf, planInstall } from './camoufox/install.js';
import { planLayout } from './camoufox/layout.js';
import { libraryProblem, unzipProblem } from './camoufox/libs.js';
import { systemFiles } from './exec/files.js';
import { systemRunner } from './exec/runner.js';
import { systemExecutor } from './exec/system.js';
import { apply } from './plan/apply.js';
import { describeResult } from './plan/describe.js';
import { currentPlatform } from './platform/current.js';

async function main(): Promise<number> {
  const platform = currentPlatform({
    platform: process.platform,
    arch: process.arch,
    uid: process.getuid?.() ?? -1,
    env: { HOME: homedir() },
  });
  const osArch = osArchOf(platform);
  if (osArch === null || platform.os === 'win32') {
    process.stderr.write(`no Camoufox build is pinned for ${process.platform}-${process.arch}\n`);
    return 78;
  }
  const os = platform.os;
  const unzip = await unzipProblem(systemRunner, os);
  if (unzip !== null) {
    process.stderr.write(`${unzip}\n`);
    return 78;
  }
  const entry = CAMOUFOX_BUILDS[osArch];
  const root = platform.paths.camoufoxRoot;
  const random = randomBytes(4).toString('hex');
  const plan = planInstall({
    root,
    entry,
    files: systemFiles,
    freeBytes: await freeBytesAt(systemRunner, systemFiles, root),
    random,
  });
  if (plan.kind === 'refused') {
    process.stderr.write(`${plan.message}\n`);
    return 78;
  }
  const layout = planLayout({ os, root, bundle: plan.bundle, entry, files: systemFiles, random });
  if (layout.kind === 'refused') {
    process.stderr.write(`${layout.message}\n`);
    return 78;
  }
  const actions = [...(plan.kind === 'install' ? plan.actions : []), ...layout.actions];
  const r = await apply({ command: 'install Camoufox', actions, notes: [] }, systemExecutor(systemRunner));
  if (r.failed !== null) {
    process.stderr.write(describeResult('install Camoufox', r));
    return 1;
  }
  if (os === 'linux') {
    const libs = await libraryProblem(systemRunner, systemFiles, plan.bundle);
    if (libs !== null) {
      process.stderr.write(`${libs}\n`);
      return 78;
    }
  }
  process.stdout.write(
    `${JSON.stringify({ osArch, build: entry.build, sha256: entry.sha256, bundle: plan.bundle })}\n`,
  );
  return 0;
}

process.exitCode = await main();
