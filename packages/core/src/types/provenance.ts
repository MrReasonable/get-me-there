import { z } from 'zod';
import { type IsoDate, type IsoDateTime, isoDateSchema, isoDateTimeSchema } from './ids.js';

/** Spec §5.1. Defined here (not in ports/provider.ts) so types and ports share one source. */
/** `camoufox` (spec §2 rev 32, plan decisions 68 and 69): the opt-in, self-scraped Google Flights fallback. */
export type ProviderId = 'travelpayouts' | 'searchapi' | 'camoufox' | 'fixture';
/** `scraped-self`: a page this app's own browser read (camoufox, `maxAgeHours` 0). */
export type SourceKind =
  | 'authorised-cached'
  | 'scraped-aggregate'
  | 'scraped-search'
  | 'scraped-self'
  | 'synthetic';
export type Cabin = 'economy' | 'premium_economy' | 'business' | 'first';
/** ISO 3166-1 alpha-2 of the vendor's echoed point of sale (POINT_OF_SALE), or 'unknown' when the vendor ignores it. */
export type PointOfSale = string | 'unknown';

export const providerIdSchema = z.enum(['travelpayouts', 'searchapi', 'camoufox', 'fixture']);
export const sourceKindSchema = z.enum([
  'authorised-cached',
  'scraped-aggregate',
  'scraped-search',
  'scraped-self',
  'synthetic',
]);
export const cabinSchema = z.enum(['economy', 'premium_economy', 'business', 'first']);
export const pointOfSaleSchema = z
  .string()
  .regex(/^[A-Z]{2}$/)
  .or(z.literal('unknown'));

/** Spec §3 "Provenance". `rateNano` = GBP per 1 native unit × 1e9 (spec §6.3). */
export type FxInfo =
  | { converted: false }
  | { converted: true; rateNano: number; rateDate: IsoDate; source: string };
export const fxInfoSchema: z.ZodType<FxInfo> = z.discriminatedUnion('converted', [
  z.strictObject({ converted: z.literal(false) }),
  z.strictObject({
    converted: z.literal(true),
    rateNano: z.number().int().positive(),
    rateDate: isoDateSchema,
    source: z.string().min(1),
  }),
]);

/**
 * Spec §7 rev 34: where a stored price's return date came from: the vendor's response (`vendor`), the date the camoufox
 * worker asked for and the search form showed (`asked`), or the grid cell's own name (`grid-cell`).
 */
export const RETURN_DATE_SOURCES = ['vendor', 'asked', 'grid-cell'] as const;
export const returnDateSourceSchema = z.enum(RETURN_DATE_SOURCES);
export type ReturnDateSource = z.infer<typeof returnDateSourceSchema>;
/**
 * Spec §7 rev 34: the vendor's own mark on a price, relative to the prices it showed with it: Google's grid "cheapest
 * price" or "low price", SearchApi's `is_lowest_price`; `none` where the vendor marks prices and left this one unmarked.
 * Never this app's own minimum. Absent (null when stored) where the vendor states no marks.
 */
export const VENDOR_PRICE_MARKS = ['cheapest', 'low', 'none'] as const;
export const vendorPriceMarkSchema = z.enum(VENDOR_PRICE_MARKS);
export type VendorPriceMark = z.infer<typeof vendorPriceMarkSchema>;

export interface Provenance {
  providerId: ProviderId;
  sourceKind: SourceKind;
  fetchedAt: IsoDateTime;
  providerObservedAt?: IsoDateTime;
  maxAgeHours: number | 'unknown';
  /**
   * N4 (pie-007): `maxAgeHours` is the app's own assumption about an undocumented vendor cache (SearchApi's date
   * grid), not a bound the vendor states; the labels then say "assumed". Set at read time from the provider's
   * capability; absent means the bound is stated.
   */
  maxAgeAssumed?: true;
  fx: FxInfo;
  pointOfSale: PointOfSale;
  cabin: Cabin;
  /** Calendar prices only (spec §7 rev 34). */
  returnDateSource?: ReturnDateSource;
  /** Calendar prices from a vendor that marks prices (spec §7 rev 34). */
  vendorPriceMark?: VendorPriceMark;
}

// why: `.exactOptional()` matches `providerObservedAt?: IsoDateTime` under exactOptionalPropertyTypes;
// `.optional()` would infer `| undefined` and fail the z.ZodType<Provenance> annotation. Nothing is defaulted.
export const provenanceSchema: z.ZodType<Provenance> = z.strictObject({
  providerId: providerIdSchema,
  sourceKind: sourceKindSchema,
  fetchedAt: isoDateTimeSchema,
  providerObservedAt: isoDateTimeSchema.exactOptional(),
  maxAgeHours: z.union([z.number().int().min(0), z.literal('unknown')]),
  maxAgeAssumed: z.literal(true).exactOptional(),
  fx: fxInfoSchema,
  pointOfSale: pointOfSaleSchema,
  cabin: cabinSchema,
  returnDateSource: returnDateSourceSchema.exactOptional(),
  vendorPriceMark: vendorPriceMarkSchema.exactOptional(),
});
