import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  recordingsPresent,
  recordingsPresentForKind,
  SKIP_SUFFIX,
  skipTitle,
} from '../../src/testing/recordings.js';
import { tempDir } from '../support/tempdirs.js';

const tmp = (): string => tempDir('gmt-recpresent-');

describe('recordingsPresent', () => {
  it('reports absent on an empty directory and on a missing one', () => {
    const root = tmp();
    expect(recordingsPresent(root)).toBe(false);
    expect(recordingsPresent(join(root, 'nope'))).toBe(false);
  });

  it('ignores the tracked params-*.json and .raw.json files', () => {
    const root = tmp();
    mkdirSync(join(root, 'searchapi'), { recursive: true });
    writeFileSync(join(root, 'searchapi', 'params-2026-10-15.json'), '{}');
    writeFileSync(join(root, 'searchapi', 'x.raw.json'), '{}');
    expect(recordingsPresent(root)).toBe(false);
  });

  it('reports present once a planted recording exists', () => {
    const root = tmp();
    mkdirSync(join(root, 'searchapi', '_api_v1_search'), { recursive: true });
    writeFileSync(join(root, 'searchapi', '_api_v1_search', '2026-10-20-0123456789ab.json'), '{}');
    expect(recordingsPresent(root)).toBe(true);
  });

  it('suffixes the title only when skipped', () => {
    expect(skipTitle('t', true)).toBe('t');
    expect(skipTitle('t', false)).toBe(`t${SKIP_SUFFIX}`);
  });
});

describe('recordingsPresentForKind (TS2-12: one gate per recording kind)', () => {
  it('one kind present, the others absent, and the absent ones skip with SKIP_SUFFIX', () => {
    const root = tmp();
    mkdirSync(join(root, 'results', '2026-10-20'), { recursive: true });
    writeFileSync(join(root, 'results', '2026-10-20', '1.facts.json'), '{}');
    mkdirSync(join(root, 'cheapest'), { recursive: true });
    writeFileSync(join(root, 'cheapest', '.gitkeep'), '');
    expect(recordingsPresentForKind(root, 'results')).toBe(true);
    for (const kind of ['cheapest', 'view-more', 'consent-probe']) {
      expect(recordingsPresentForKind(root, kind)).toBe(false);
      expect(skipTitle(kind, recordingsPresentForKind(root, kind))).toBe(`${kind}${SKIP_SUFFIX}`);
    }
  });
});
