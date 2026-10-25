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
  // why: WP17 Task 17.4 (research 17.0c): two headed sessions, the person clicking Reject all, then Accept all
  'consent-research',
  'no-flights',
  'graph-explore',
  'grid',
] as const;
export type RecordingKind = (typeof KINDS)[number];
export const RECORDED_BY = 'camoufox-worker record';
export const MAX_PAGES = 3;
/** The stability check's spacing between its three pages (rule 2). */
export const STABILITY_PAGES = 3;

/** The grid's four scroll directions (WP15; the buttons "Scroll left", "Scroll right", "Scroll up", "Scroll down"). */
export const GRID_DIRECTIONS = ['left', 'right', 'up', 'down'] as const;
export type GridDirection = (typeof GRID_DIRECTIONS)[number];
/** `--grid` without `--moves`: one move each way, so the recording measures both axes in both directions. */
export const DEFAULT_GRID_MOVES: readonly GridDirection[] = ['right', 'down', 'left', 'up'];
/** At most this many moves on one recorded page. */
export const RECORD_MAX_MOVES = 12;
const isDirection = (m: string): m is GridDirection => GRID_DIRECTIONS.some((x) => x === m);

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
  /** The scrolls a `--grid` page makes, in order; empty for every other kind. */
  moves: GridDirection[];
}

/** Parses the recorder's flags; throws RecordingRefused naming what is wrong. */
export function parseRecordArgs(args: readonly string[]): RecordArgs {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < args.length; i++) {
    const a = args[i] ?? '';
    if (['--origin', '--destination', '--depart', '--return', '--pages', '--moves'].includes(a)) {
      const v = args[i + 1];
      if (v === undefined) throw new RecordingRefused(`${a} needs a value`);
      values.set(a, v);
      i++;
    } else if (
      [
        '--cheapest',
        '--view-more',
        '--stability',
        '--consent-probe',
        '--consent-research',
        '--no-flights',
        '--graph-explore',
        '--grid',
      ].includes(a)
    )
      flags.add(a);
    else throw new RecordingRefused(`unknown argument ${a}`);
  }
  if (flags.size > 1)
    throw new RecordingRefused(
      'pass at most one of --cheapest, --view-more, --stability, --consent-probe, --consent-research, --no-flights, --graph-explore, --grid',
    );
  const movesRaw = values.get('--moves');
  if (movesRaw !== undefined && !flags.has('--grid')) throw new RecordingRefused('--moves needs --grid');
  const moveNames = movesRaw === undefined ? [...DEFAULT_GRID_MOVES] : movesRaw.split(',');
  const moves = moveNames.filter(isDirection);
  if (moves.length !== moveNames.length || moves.length > RECORD_MAX_MOVES)
    throw new RecordingRefused(`--moves takes 1 to ${RECORD_MAX_MOVES} of ${GRID_DIRECTIONS.join(', ')}`);
  const kind: RecordingKind = flags.has('--cheapest')
    ? 'cheapest'
    : flags.has('--view-more')
      ? 'view-more'
      : flags.has('--stability')
        ? 'socs-stability'
        : flags.has('--consent-probe')
          ? 'consent-probe'
          : flags.has('--consent-research')
            ? 'consent-research'
            : flags.has('--no-flights')
              ? 'no-flights'
              : flags.has('--graph-explore')
                ? 'graph-explore'
                : flags.has('--grid')
                  ? 'grid'
                  : 'results';
  const pagesRaw = values.get('--pages') ?? (kind === 'socs-stability' ? String(STABILITY_PAGES) : '1');
  const pages = Number(pagesRaw);
  if (!/^\d+$/.test(pagesRaw) || pages < 1 || pages > MAX_PAGES)
    throw new RecordingRefused(`--pages must be 1 to ${MAX_PAGES}`);
  if (kind === 'consent-probe' || kind === 'consent-research')
    return { kind, request: null, pages: 1, moves: [] };
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
    moves: kind === 'grid' ? moves : [],
  };
}
