import { asIata, canonicalCarrier, canonicalFlightNumber, type RawOffer } from '@gmt/core';
import { describe, expect, it } from 'vitest';
import {
  bookingOffers,
  type Pairing,
  statedAirline,
  step3NamesAirline,
  toRawSegment,
  toRawSegments,
} from '../../src/searchapi/offers.js';
import { bookingOptionSchema, segmentSchema } from '../../src/searchapi/shapes.js';
import { NoteCounter } from '../../src/shared/notes.js';
import { agent, POST, seg } from './support/synthetic.js';

const vendorSeg = (...a: Parameters<typeof seg>) => segmentSchema.parse(seg(...a));
const options = (raw: unknown[]) => raw.map((o) => bookingOptionSchema.parse(o));
const out = toRawSegments([vendorSeg('LHR', 'JFK', '2026-11-02', '09:05', 'X1 100', 'Synthetic Air One')]);
const inb = toRawSegments([vendorSeg('JFK', 'LHR', '2026-11-14', '18:00', 'X1 101', 'Synthetic Air One')]);
if (out === null || inb === null) throw new Error('segments');
const pairing: Pairing = { cabin: 'economy', outbound: out, inbound: inb };
const offer = (seller: string): RawOffer => ({
  outbound: out,
  inbound: inb,
  seller,
  requestedCabin: 'economy',
  amountMinor: 1,
  currency: 'GBP',
  booking: { kind: 'none' },
  verified: true,
});

describe('toRawSegment (raw only, spec §5.2), synthetic', () => {
  it('splits the carrier from the flight number, keeps vendor local times, states cabin only when given (synthetic)', () => {
    expect(
      toRawSegment(
        vendorSeg('LHR', 'JFK', '2026-11-02', '09:05', 'X1 100', 'Synthetic Air One', 'Premium economy'),
      ),
    ).toEqual({
      marketingCarrier: 'X1',
      flightNumber: '100',
      from: 'LHR',
      to: 'JFK',
      depart: '2026-11-02T09:05',
      arrive: '2026-11-02T23:00',
      timeKind: 'local',
      cabin: 'premium_economy',
      durationMinutes: 420,
      aircraft: 'Synthetic 787',
    });
  });

  it('an unrecognised class leaves cabin unstated; an unsplittable or all-digit number passes whole for core to reject (synthetic)', () => {
    const s = toRawSegment(
      vendorSeg('LHR', 'JFK', '2026-11-02', '09:05', 'Synthetic 100', 'Synthetic Air One', 'Mystery'),
    );
    expect(s?.cabin).toBeUndefined();
    expect(s?.marketingCarrier).toBe('Synthetic 100');
    expect(toRawSegment(vendorSeg('LHR', 'JFK', '2026-11-02', '09:05', '0938'))?.marketingCarrier).toBe(
      '0938',
    );
    expect(toRawSegment(vendorSeg('LHR', 'JFK', '2026-11-02', '09:05', '9X 12'))).toMatchObject({
      marketingCarrier: '9X',
      flightNumber: '12',
    });
  });

  it('a vendor place id that is not an IATA code makes the segment, and the option, unusable (synthetic)', () => {
    expect(toRawSegment(vendorSeg('/m/04jpl', 'JFK', '2026-11-02', '09:05', 'X1 100'))).toBeNull();
    expect(
      toRawSegments([
        vendorSeg('LHR', 'JFK', '2026-11-02', '09:05', 'X1 100'),
        vendorSeg('JFK', '/m/02_286', '2026-11-02', '23:00', 'X1 7'),
      ]),
    ).toBeNull();
    expect(toRawSegments([])).toBeNull();
    expect(toRawSegment(vendorSeg('lhr', 'JFK', '2026-11-02', '09:05', 'X1 100'))?.from).toBe(asIata('LHR'));
  });
});

describe('toRawSegment agrees with core (spec §6.4), synthetic', () => {
  it.each(['X1 100', '9X 12', 'BA0938', 'X1100'])(
    'the split of %s is one core canonicalises without error (synthetic)',
    (number) => {
      const s = toRawSegment(vendorSeg('LHR', 'JFK', '2026-11-02', '09:05', number));
      if (s === null) throw new Error('segment');
      // why: the adapter's designator split copies core's rule; a drift fails here, not later as unmappable-carrier.
      expect(() => canonicalFlightNumber(s.flightNumber, canonicalCarrier(s.marketingCarrier))).not.toThrow();
    },
  );
});

describe('statedAirline (never invent a seller), synthetic', () => {
  it('is the airline the vendor states on the first outbound flight, else null; never the flight number (synthetic)', () => {
    expect(
      statedAirline([vendorSeg('LHR', 'JFK', '2026-11-02', '09:05', 'X1 100', ' Synthetic Air One ')]),
    ).toBe('Synthetic Air One');
    expect(statedAirline([vendorSeg('LHR', 'JFK', '2026-11-02', '09:05', 'X1 100')])).toBeNull();
    expect(statedAirline([vendorSeg('LHR', 'JFK', '2026-11-02', '09:05', 'X1 100', '  ')])).toBeNull();
    expect(statedAirline([])).toBeNull();
  });
});

describe('bookingOffers (spec §5.4 step 3), synthetic', () => {
  it('each usable option is a verified offer with its seller, minor units, POST booking and baggage notes (synthetic)', () => {
    const notes = new NoteCounter();
    const offers = bookingOffers(
      pairing,
      options([{ ...agent(573), baggage_prices: ['1 free carry-on', '1st checked bag: 60'] }]),
      'GBP',
      notes,
    );
    expect(offers).toEqual([
      {
        outbound: out,
        inbound: inb,
        seller: 'Synthetic Travel Agent',
        requestedCabin: 'economy',
        amountMinor: 57_300,
        currency: 'GBP',
        booking: { kind: 'post', url: POST.url, postData: POST.post_data },
        baggage: { notes: ['1 free carry-on', '1st checked bag: 60'] },
        verified: true,
      },
    ]);
    expect(notes.list()).toEqual([]);
  });

  it('a phone-only option is an offer with booking none, counted (synthetic)', () => {
    const notes = new NoteCounter();
    const [o] = bookingOffers(
      pairing,
      options([{ book_with: 'Synthetic Phone Desk', price: 590, booking_phone: '+44 0000 000000' }]),
      'GBP',
      notes,
    );
    expect(o?.booking).toEqual({ kind: 'none' });
    expect(notes.list()).toEqual(['phone-only-booking:1']);
  });

  it('split bookings, unpriced, seller-less and unusable-price options are skipped and counted (synthetic)', () => {
    const notes = new NoteCounter();
    const offers = bookingOffers(
      pairing,
      options([
        { is_split_booking: true, price: 400 },
        { book_with: 'Synthetic Travel Agent' },
        { price: 500, booking_request: POST },
        { book_with: ' ', price: 500 },
        agent(573.555),
        agent(0),
      ]),
      'GBP',
      notes,
    );
    expect(offers).toEqual([]);
    expect(notes.list()).toEqual([
      'no-seller-skipped-step3:2',
      'offers-dropped:2',
      'split-booking-skipped:1',
      'unpriced-skipped-step3:1',
    ]);
  });

  it('a currency core does not know drops the options as currency-unsupported (synthetic)', () => {
    const notes = new NoteCounter();
    expect(bookingOffers(pairing, options([agent(573)]), 'XAU', notes)).toEqual([]);
    expect(notes.list()).toEqual(['offers-dropped:1']);
  });
});

describe('step3NamesAirline (spec §5.4 price-source rule), synthetic', () => {
  it('matches the step-2 airline exactly after trim and lower-case, never a near miss or another carrier (synthetic)', () => {
    expect(step3NamesAirline([offer('synthetic air one ')], 'Synthetic Air One')).toBe(true);
    expect(step3NamesAirline([offer('Synthetic Air One plc')], 'Synthetic Air One')).toBe(false);
    expect(step3NamesAirline([offer('Synthetic Air Two')], 'Synthetic Air One')).toBe(false);
    expect(step3NamesAirline([], 'Synthetic Air One')).toBe(false);
  });
});
