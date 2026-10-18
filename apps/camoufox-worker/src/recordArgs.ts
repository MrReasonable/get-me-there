import { type Iata, type IsoDate, iataSchema, isoDateSchema } from '@gmt/core';

/**
 * The recorder's command line (brief Task 14.2; split from record.ts in fix round 1, arch M15): the kinds, the page
 * bounds, and the one parser, which refuses `--grid` (decision 69) and more than one mode flag.
 */
export const KINDS = [
  'results',
  'cheapest',
  'view-more',
  'socs-stability',
  'consent-probe',
  'no-flights',
] as const;
export type RecordingKind = (typeof KINDS)[number];
export const RECORDED_BY = 'camoufox-worker record';
export const MAX_PAGES = 3;
/** The stability check's spacing between its three pages (rule 2). */
export const STABILITY_PAGES = 3;

export class RecordingRefused extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RecordingRefused';
  }
}

export interface RecordArgs {
  kind: RecordingKind;
  request: { origin: Iata; destination: Iata; departureDate: IsoDate; returnDate: IsoDate } | null;
  pages: number;
}

/** Parses the recorder's flags; throws RecordingRefused naming what is wrong. */
export function parseRecordArgs(args: readonly string[]): RecordArgs {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (['--origin', '--destination', '--depart', '--return', '--pages'].includes(a)) {
      const v = args[i + 1];
      if (v === undefined) throw new RecordingRefused(`${a} needs a value`);
      values.set(a, v);
      i++;
    } else if (
      ['--cheapest', '--view-more', '--stability', '--consent-probe', '--no-flights', '--grid'].includes(a)
    )
      flags.add(a);
    else throw new RecordingRefused(`unknown argument ${a}`);
  }
  // why: decision 69: grid mode is not built in WP14, so nothing (the recorder included) loads the grid.
  if (flags.has('--grid'))
    throw new RecordingRefused('--grid: grid mode is not built in this work package (decision 69)');
  if (flags.size > 1)
    throw new RecordingRefused(
      'pass at most one of --cheapest, --view-more, --stability, --consent-probe, --no-flights',
    );
  const kind: RecordingKind = flags.has('--cheapest')
    ? 'cheapest'
    : flags.has('--view-more')
      ? 'view-more'
      : flags.has('--stability')
        ? 'socs-stability'
        : flags.has('--consent-probe')
          ? 'consent-probe'
          : flags.has('--no-flights')
            ? 'no-flights'
            : 'results';
  const pagesRaw = values.get('--pages') ?? (kind === 'socs-stability' ? String(STABILITY_PAGES) : '1');
  const pages = Number(pagesRaw);
  if (!/^\d+$/.test(pagesRaw) || pages < 1 || pages > MAX_PAGES)
    throw new RecordingRefused(`--pages must be 1 to ${MAX_PAGES}`);
  if (kind === 'consent-probe') return { kind, request: null, pages: 1 };
  const origin = iataSchema.safeParse(values.get('--origin') ?? '');
  const destination = iataSchema.safeParse(values.get('--destination') ?? '');
  const departureDate = isoDateSchema.safeParse(values.get('--depart') ?? '');
  const returnDate = isoDateSchema.safeParse(values.get('--return') ?? '');
  if (!origin.success || !destination.success)
    throw new RecordingRefused('--origin and --destination must be IATA codes');
  if (!departureDate.success || !returnDate.success || returnDate.data <= departureDate.data)
    throw new RecordingRefused('--depart and --return must be dates, the return after the departure');
  return {
    kind,
    request: {
      origin: origin.data,
      destination: destination.data,
      departureDate: departureDate.data,
      returnDate: returnDate.data,
    },
    pages,
  };
}
