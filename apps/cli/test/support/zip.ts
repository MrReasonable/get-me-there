import { deflateRawSync } from 'node:zlib';

/** CRC-32 (the zip format's), table-driven. */
const TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(b: Buffer): number {
  let c = 0xffffffff;
  for (const x of b) c = (TABLE[(c ^ x) & 0xff] ?? 0) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/**
 * A zip archive in memory with exactly the entry names given (an absolute or `..` name included, which no zip tool
 * will write), each deflated; a name ending in `/` is a directory. Unix modes ride in the external attributes, so an
 * executable entry unpacks executable. For the install tests' fixture archives only.
 */
export function makeZip(entries: ReadonlyArray<{ name: string; data?: string; mode?: number }>): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const name = Buffer.from(e.name, 'utf8');
    const raw = Buffer.from(e.data ?? '', 'utf8');
    const dir = e.name.endsWith('/');
    const body = dir ? Buffer.alloc(0) : deflateRawSync(raw);
    const crc = dir ? 0 : crc32(raw);
    const method = dir ? 0 : 8;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(dir ? 0 : raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    locals.push(local, name, body);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    // why: version made by 3 (Unix) << 8, so unzip reads the mode from the high external attributes
    central.writeUInt16LE((3 << 8) | 20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(dir ? 0 : raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    const mode = (dir ? 0o40755 : 0o100000 | (e.mode ?? 0o644)) >>> 0;
    central.writeUInt32LE((mode << 16) >>> 0, 38);
    central.writeUInt32LE(offset, 42);
    centrals.push(central, name);
    offset += local.length + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(cd.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

/** The macOS asset's shape (WP17 §0: `Camoufox.app/…`, no version.json), cut down to what the layout check reads. */
export const MAC_ENTRIES = [
  { name: 'Camoufox.app/' },
  { name: 'Camoufox.app/Contents/' },
  { name: 'Camoufox.app/Contents/MacOS/' },
  { name: 'Camoufox.app/Contents/MacOS/camoufox', data: '#!/bin/sh\n', mode: 0o755 },
  { name: 'Camoufox.app/Contents/Resources/' },
  { name: 'Camoufox.app/Contents/Resources/properties.json', data: '{}' },
];
/** The Linux asset's flat shape (WP17 §0), cut down likewise. */
export const LINUX_ENTRIES = [
  { name: 'camoufox-bin', data: 'ELF', mode: 0o755 },
  { name: 'camoufox', data: '#!/bin/sh\n', mode: 0o755 },
  { name: 'properties.json', data: '{}' },
  { name: 'libxul.so', data: 'ELF' },
  { name: 'omni.ja', data: 'PK' },
  { name: 'fontconfig/' },
  { name: 'fontconfig/linux/fonts.conf', data: '<fontconfig/>' },
  {
    name: 'fontconfig/macos/fonts.conf',
    data: '<fontconfig><dir prefix="cwd">fonts/macos</dir></fontconfig>',
  },
  { name: 'fontconfig/windows/fonts.conf', data: '<fontconfig/>' },
  { name: 'fonts/macos/Helvetica.ttf', data: 'font' },
];
