/**
 * The Camoufox pin: each `<os>-<arch>`'s release asset and the verification flags it earned (spec §2 rev 36; decisions
 * 73, 76, 81). Data only, with no import, so `gmt update` can read the next commit's copy of this one file before it
 * stops the app (`git show origin/main:<this file>`, run alone) and download the new bundle while the app still runs;
 * builds.ts validates it and holds the rules.
 */

const ASSET =
  'https://github.com/daijro/camoufox/releases/download/v152.0.4-beta.28/camoufox-152.0.4-beta.28-';

/**
 * WP17 §0 (research 17.0a and 17.0b, 2026-10-19): release `v152.0.4-beta.28`, the digests GitHub publishes per asset.
 * why: the unpacked sizes are the research's own round figures (about 670 MB for the macOS app, about 1.25 GB for the
 * flat Linux tree), used only for the planner's free-space check, which adds the download's own size.
 */
const BUILDS = {
  'darwin-arm64': {
    build: '152.0.4-beta.28',
    url: `${ASSET}mac.arm64.zip`,
    sha256: '8b7680a61818245cf4eb0150edab811d4ed937b6723514569e74c3e7df9685bd',
    bytes: 312_626_286,
    unpackedBytes: 670_000_000,
    hashedOn: '2026-10-19',
  },
  'darwin-x64': {
    build: '152.0.4-beta.28',
    url: `${ASSET}mac.x86_64.zip`,
    sha256: '6e0efd66f6db46bece072827cb2c5a4851bca822ff4fed95b8a0c2fb6f61a3d4',
    bytes: 319_866_512,
    unpackedBytes: 670_000_000,
    hashedOn: '2026-10-19',
  },
  'linux-arm64': {
    build: '152.0.4-beta.28',
    url: `${ASSET}lin.arm64.zip`,
    sha256: '3a105a2fc929e80a79b4b7fce2c93ed62c4fb2c877f3c1ed2a5d66a1c4fe968f',
    bytes: 653_814_950,
    unpackedBytes: 1_250_000_000,
    hashedOn: '2026-10-19',
  },
  'linux-x64': {
    build: '152.0.4-beta.28',
    url: `${ASSET}lin.x86_64.zip`,
    sha256: '924f3109ccd6d47cd6a0384d67a345fadf975d48b6319f8dbbd5954c588982bd',
    bytes: 663_387_175,
    unpackedBytes: 1_250_000_000,
    hashedOn: '2026-10-19',
  },
} as const;

/**
 * The verified flags per `<os>-<arch>` (spec §2 rev 36). darwin-arm64 carries the 2026-10-18 recordings' values (and
 * the landing view from 2026-10-25's) on the operator's Mac; the other three carry their own from WP17 Task 17.8's
 * recording sessions of 2026-10-26. The worker's PROOFS name each one.
 */
const FLAGS = {
  'darwin-arm64': {
    build: '152.0.4-beta.28',
    flags: {
      RESULTS_VERIFIED: true,
      FORM_VERIFIED: true,
      CHEAPEST_FLOW_VERIFIED: true,
      // why: the view-more recording's minimum was no lower than the results page's
      VIEW_MORE_ADDS_CHEAPER: false,
      NO_FLIGHTS_VERIFIED: true,
      SOCS_STABLE: true,
      GRID_VERIFIED: true,
      // why: research 17.0c's recording of 2026-10-25 (consent-research/2026-10-25/1): both sessions' views after the
      // choice read as the landing view
      LANDING_VERIFIED: true,
      // why: grid/2026-10-26/7 and 8 (the operator's Mac): every unpriced cell of ten views read as "no flights, <d>
      // <Mon> to <d> <Mon>" or "price unknown, <d> <Mon> to <d> <Mon>", each a button naming its pair
      GRID_UNPRICED_VERIFIED: true,
    },
  },
  // why: WP17 Task 17.8's darwin-x64 session of 2026-10-26 (the operator's Mac under Rosetta, an x86_64 Node, a
  // throwaway HOME); the worker's PROOFS name each recording
  'darwin-x64': {
    build: '152.0.4-beta.28',
    flags: {
      RESULTS_VERIFIED: true,
      FORM_VERIFIED: true,
      CHEAPEST_FLOW_VERIFIED: true,
      // why: the view-more recording's minimum (71 links) equalled the results page's
      VIEW_MORE_ADDS_CHEAPER: false,
      NO_FLIGHTS_VERIFIED: true,
      SOCS_STABLE: true,
      // why: grid/2026-10-26/5 and 6, recorded on 2026-10-26 under the settle that takes a view only once every cell
      // its lines call for has drawn (spec §2 rev 46): every view of both pages read whole, 49 cells each, and each
      // scroll moved one day. The earlier grid/2026-10-26/3 and 4 hold views the old settle took before their cells had
      // drawn, which the reading refused
      GRID_VERIFIED: true,
      LANDING_VERIFIED: true,
      // why: no grid recording of this entry shows an unpriced cell (its pages were all priced)
      GRID_UNPRICED_VERIFIED: false,
    },
  },
  // why: WP17 Task 17.8's linux-arm64 session of 2026-10-26 (a Linux arm64 container on the operator's Mac, headless,
  // the generated fonts.conf); the worker's PROOFS name each recording
  'linux-arm64': {
    build: '152.0.4-beta.28',
    flags: {
      RESULTS_VERIFIED: true,
      FORM_VERIFIED: true,
      CHEAPEST_FLOW_VERIFIED: true,
      // why: the view-more recording's minimum (78 links) equalled the results page's
      VIEW_MORE_ADDS_CHEAPER: false,
      NO_FLIGHTS_VERIFIED: true,
      SOCS_STABLE: true,
      GRID_VERIFIED: true,
      LANDING_VERIFIED: true,
      // why: no grid recording of this entry shows an unpriced cell (its pages were all priced)
      GRID_UNPRICED_VERIFIED: false,
    },
  },
  // why: WP17 Task 17.8's linux-x64 session of 2026-10-26 (a Linux x86_64 container under emulation on the operator's
  // Mac, headless, the generated fonts.conf); the worker's PROOFS name each recording
  'linux-x64': {
    build: '152.0.4-beta.28',
    flags: {
      RESULTS_VERIFIED: true,
      FORM_VERIFIED: true,
      CHEAPEST_FLOW_VERIFIED: true,
      // why: the view-more recording's minimum (71 links) equalled the results page's
      VIEW_MORE_ADDS_CHEAPER: false,
      NO_FLIGHTS_VERIFIED: true,
      SOCS_STABLE: true,
      GRID_VERIFIED: true,
      LANDING_VERIFIED: true,
      // why: no grid recording of this entry shows an unpriced cell (its pages were all priced)
      GRID_UNPRICED_VERIFIED: false,
    },
  },
} as const;

/** The pin as data: the builds and the flags, validated by builds.ts's `pinSchema`. */
export const CAMOUFOX_PIN = { builds: BUILDS, flags: FLAGS } as const;
