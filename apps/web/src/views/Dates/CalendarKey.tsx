import { COPY } from '../../copy.js';

const K = COPY.calendar.key;
const C = COPY.calendar;
/** The ramp's five steps, lowest price first. */
const STEPS = ['1', '2', '3', '4', '5'] as const;

/**
 * Ruling 18 (mockup 02's legend): the calendar's key, five items: the heat scale (lower to higher, the printed prices
 * only, which are current), the trip's dot ("other prices are calendar prices, not fares"), the cross of a day that
 * couldn't be read, "no price (not 'no flights')" and the hatching of a day not searched or not reached. Each sample is
 * drawn as the days draw it and hidden from assistive technology; the words carry the meaning.
 */
export function CalendarKey() {
  return (
    <ul className="cal-key" aria-label={K.label}>
      <li>
        <span className="sr-only">{K.scale} </span>
        {K.lower}{' '}
        <span className="cal-key-scale" aria-hidden="true">
          {STEPS.map((s) => (
            <i key={s} className="cal-key-step" data-heat={s} />
          ))}
        </span>{' '}
        {K.higher}
      </li>
      <li>
        <span className="cal-key-glyph" aria-hidden="true">
          {C.tripGlyph}
        </span>{' '}
        {K.trip}
      </li>
      <li>
        <span className="cal-key-glyph cal-key-sunk" aria-hidden="true">
          {C.couldntReadGlyph}
        </span>{' '}
        {K.couldntRead}
      </li>
      <li>
        <span className="cal-key-swatch cal-key-sunk" aria-hidden="true" />
        {K.noPrice}
      </li>
      <li>
        <span className="cal-key-swatch cal-key-hatch" aria-hidden="true" />
        {K.hatched}
      </li>
    </ul>
  );
}
