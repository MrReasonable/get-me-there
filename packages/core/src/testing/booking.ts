// SYNTHETIC: test support only. One made-up booking address for every test, in the real shape of the booking page's
// address (design §6.3: the booking page's path, an opaque `tfs` blob, `tfu`, `curr`); it encodes no real trip and is
// never recorded output. Types and data only; check-boundaries refuses it in every package's src/.
export const SYNTHETIC_BOOKING_URL =
  'https://www.google.com/travel/flights/booking?tfs=CBwQAhoeEgoyMDI2LTExLTExagcIARIDTEhScgcIARIDSkZL&tfu=EgYIABAAGAA&curr=GBP';

/**
 * One made-up seller's booking, a GET link on an allowlisted host, as SearchApi's booking options give it after the
 * api re-validates it (decision 54); it names no real trip.
 */
export const SYNTHETIC_SELLER_BOOKING = {
  kind: 'get',
  url: 'https://www.google.com/travel/clk/f?id=1',
  host: 'www.google.com',
} as const;
