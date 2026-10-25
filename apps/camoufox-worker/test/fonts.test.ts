import { readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { absoluteFontsConf, writeFontsConf } from '../src/fonts.js';
import { fakeInstall, tmpDir } from './support/tmp.js';

describe('Linux fonts (spec §2 "Method"; WP17 §0)', () => {
  it('every working-directory <dir> names the bundle’s fonts/macos by absolute path; nothing else changes', () => {
    const text =
      '<fontconfig>\n<dir prefix="cwd">fonts/macos</dir>\n<dir prefix="cwd" >fonts</dir>\n<dir>/usr/share/fonts</dir>\n</fontconfig>';
    expect(absoluteFontsConf(text, '/b/x&y')).toBe(
      '<fontconfig>\n<dir>/b/x&amp;y/fonts/macos</dir>\n<dir>/b/x&amp;y/fonts/macos</dir>\n<dir>/usr/share/fonts</dir>\n</fontconfig>',
    );
    expect(absoluteFontsConf('<dir prefix="xdg">fonts</dir>', '/b')).toBe('<dir prefix="xdg">fonts</dir>');
  });
  it('writes <workerData>/fonts.conf 0600 from the bundle’s fontconfig/macos/fonts.conf, outside the bundle', () => {
    const f = fakeInstall('linux-x64');
    const data = tmpDir();
    const file = writeFontsConf(data, f.bundleDir);
    expect(file).toBe(join(data, 'fonts.conf'));
    expect(readFileSync(file, 'utf8')).toContain(`<dir>${f.bundleDir}/fonts/macos</dir>`);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(readFileSync(join(f.bundleDir, 'fontconfig', 'macos', 'fonts.conf'), 'utf8')).toContain(
      'prefix="cwd"',
    );
  });
});
