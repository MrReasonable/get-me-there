// The camoufox adapter's public names (brief WP14 §5): the provider, its constants, tiling and HTTP limits.
export { BLOCKED_WORDS, classifyWorkerAnswer, coolingDownWords } from './answer.js';
export { gridBlocks, gridTileEstimate, planGridTiles } from './grid.js';
export { camoufoxHttpLimits, camoufoxStatusHttpLimits, pageClassOf, scrollCountOf } from './limits.js';
export { SIGNED_IN_REFUSED, UNREACHABLE } from './preflight.js';
export {
  CAMOUFOX_CABINS,
  CAMOUFOX_DISCOVERY_INFO,
  CAMOUFOX_DISPLAY_NAME,
  CAMOUFOX_GRID_INFO,
  CAMOUFOX_SUPPLIED_FIELDS,
  camoufoxProvider,
  RETURN_DATE_LABEL,
} from './provider.js';
export { planSingleCells } from './tiles.js';
