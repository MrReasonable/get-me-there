// Spec revision 56 §5.1 (R-order): the ports' new fields, each optional until the task that fills its last consumer, so
// every present caller typechecks unchanged. Type-level claims, pinned by `pnpm --filter @gmt/core typecheck`.
import { describe, expectTypeOf, it } from 'vitest';
import type { DatePairFigure } from '../../src/datePairs/encode.js';
import type { FlightLimits } from '../../src/flights/choose.js';
import type { ReturnRead } from '../../src/flights/returns.js';
import type { Reservation, ReserveParams } from '../../src/ports/budget.js';
import type { FlightListQuery, FlightListResult, PreflightResult } from '../../src/ports/provider.js';
import type { Estimate, FlightListsState } from '../../src/types/execution.js';
import type { IsoDateTime } from '../../src/types/ids.js';

type ListResult = Extract<FlightListResult, { kind: 'list' }>;
type Finalise = Parameters<Reservation['finalise']>[0];

describe('the ports gain their return-phase fields, optional (spec rev 56 §5.1)', () => {
  it('ReserveParams.pages? and finalise pageCount?', () => {
    expectTypeOf<ReserveParams['pages']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<{ pages?: number }>().toMatchTypeOf<Pick<ReserveParams, 'pages'>>();
    expectTypeOf<Finalise['pageCount']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<{ outcome: 'ok'; durationMs: 1 }>().toMatchTypeOf<Finalise>();
  });
  it('FlightListQuery.returnLimits? and booking?', () => {
    expectTypeOf<FlightListQuery['returnLimits']>().toEqualTypeOf<FlightLimits | null | undefined>();
    expectTypeOf<FlightListQuery['booking']>().toEqualTypeOf<boolean | undefined>();
  });
  it("FlightListResult's returns and nextLoadNotBefore are required since Task 21.6 (the engine stores them)", () => {
    expectTypeOf<ListResult['returns']>().toEqualTypeOf<ReturnRead | null>();
    expectTypeOf<ListResult['nextLoadNotBefore']>().toEqualTypeOf<IsoDateTime | null>();
  });
  it('PreflightResult.flags?', () => {
    expectTypeOf<{ ok: true }>().toMatchTypeOf<PreflightResult>();
    expectTypeOf<PreflightResult['flags']>().toEqualTypeOf<Readonly<Record<string, boolean>> | undefined>();
  });
  it('Estimate.flightLists.pairs? (with returns?, pagesMax?, secondsMax?)', () => {
    type F = NonNullable<Estimate['flightLists']>;
    expectTypeOf<F['pairs']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<F['returns']>().toEqualTypeOf<boolean | undefined>();
    expectTypeOf<F['pagesMax']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<F['secondsMax']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<{ pages: 1; seconds: 1 }>().toMatchTypeOf<F>();
  });
  it('DatePairFigure.gridPrice? (with pairing? and pairingRead?)', () => {
    expectTypeOf<DatePairFigure['basis']>().toEqualTypeOf<'verified' | 'calendar' | 'pairing'>();
    expectTypeOf<undefined>().toMatchTypeOf<DatePairFigure['gridPrice']>();
    expectTypeOf<undefined>().toMatchTypeOf<DatePairFigure['pairingRead']>();
  });
  it('FlightListsState is total (the reader fills the defaults)', () => {
    expectTypeOf<FlightListsState['returns']>().toEqualTypeOf<boolean>();
    expectTypeOf<FlightListsState['bookingStopped']>().toEqualTypeOf<string | null>();
  });
});
