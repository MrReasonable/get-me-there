// Synthetic SOCS values of the shape research 17.0c observed (field 1, a one-byte varint, then field 2, then field 3),
// built from bytes chosen for the tests: field 2 spells "test-only". No recorded value is ever copied into a test.
const of = (choice: number): string =>
  Buffer.from([0x08, choice, 0x12, 0x09, ...Buffer.from('test-only'), 0x1a, 0x02, 0x41, 0x42]).toString(
    'base64url',
  );
/** A value whose mark is `reject`. */
export const SYNTHETIC_REJECT = of(0x01);
/** A value whose mark is `accept`. */
export const SYNTHETIC_ACCEPT = of(0x02);
