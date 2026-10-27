import { asIata } from '@gmt/core';
import { act, screen, waitFor, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AirportsResponse } from '../../../src/api/types.js';
import { PLAN_COPY } from '../../../src/copy/plan.js';
import { COPY } from '../../../src/copy.js';
import { AIRPORT_DEBOUNCE_MS, AirportListInput } from '../../../src/views/Definitions/AirportListInput.js';
import {
  airportChoices,
  shortAirportName,
  suggestedName,
  useAirportDetails,
} from '../../../src/views/Definitions/airports.js';
import { API, airports } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

// The worked example's places (London → New York), as the airports table words them.
type Row = AirportsResponse[number];
const row = (iata: string, name: string, city: string, metro: string | null): Row => ({
  iata: asIata(iata),
  name,
  city,
  country: city === 'Londrina' ? 'BR' : city === 'New York' || city === 'Newark' ? 'US' : 'GB',
  tz: 'Europe/London',
  metro,
});
const LGW = row('LGW', 'London Gatwick Airport', 'London', 'LON');
const LHR = row('LHR', 'London Heathrow Airport', 'London', 'LON');
const SEN = row('SEN', 'Southend Airport', 'Southend', 'LON');
const LDB = row('LDB', 'Governador Jose Richa Airport', 'Londrina', null);
const JFK = row('JFK', 'John F Kennedy International Airport', 'New York', 'NYC');
const EWR = row('EWR', 'Newark Liberty International Airport', 'Newark', 'NYC');
const LGA = row('LGA', 'La Guardia Airport', 'New York', 'NYC');
const NYS = row('NYS', 'New York Skyports Seaplane Base', 'New York', null);
const HAT = row('HAT', 'Heathlands Airport', 'Heathlands', null);
const ANSWERS: Record<string, Row[]> = {
  lond: [LGW, LHR, SEN, LDB],
  LON: [LGW, LHR, SEN],
  // as the search answers: a matched metro comes whole, the matching airport first in its block
  heathrow: [LHR, LGW, SEN],
  heath: [LHR, LGW, SEN, HAT],
  'new y': [JFK, LGA, EWR, NYS],
  LHR: [LHR],
  LGW: [LGW],
  SEN: [SEN],
};

/** Every q the airports route was asked, answered from ANSWERS ([] for any other text, 500 for "boom"). */
function airportsRoute(): string[] {
  const asked: string[] = [];
  server.use(
    http.get(`${API}/airports`, ({ request }) => {
      const q = new URL(request.url).searchParams.get('q') ?? '';
      asked.push(q);
      if (q === 'boom')
        return HttpResponse.json({ error: { code: 'internal', message: 'x' } }, { status: 500 });
      return HttpResponse.json(ANSWERS[q] ?? []);
    }),
  );
  return asked;
}

function Harness({ initial = [] }: { initial?: string[] }) {
  const [codes, setCodes] = useState<string[]>(initial);
  const details = useAirportDetails(codes);
  return (
    <AirportListInput
      id="origins"
      label="From"
      placeholder="City, airport or code"
      codes={codes}
      details={details.rows}
      onChange={setCodes}
      errors={[]}
    />
  );
}
const input = () => screen.getByRole('combobox', { name: 'From' });
const chipCodes = () =>
  within(within(screen.getByRole('group', { name: 'From' })).getByRole('list'))
    .queryAllByRole('listitem')
    .map((li) => li.firstChild?.textContent);
const optionNames = () => screen.queryAllByRole('option').map((o) => o.getAttribute('aria-label'));

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Renders the harness on Vitest's fake clock, so the debounce is stepped, never waited for. */
function renderOnFakeClock(initial: string[] = []) {
  // why: fake the clear functions too, or a cleared debounce timer still fires on the real clock.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  // why: Testing Library steps its own setTimeout(0) waits only when a global `jest` says fake timers are on.
  vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
  return renderWithProviders(<Harness initial={initial} />, { fakeTimers: true });
}
/** Types into the box, steps past the debounce and waits for the list (or its message) to answer. */
async function typeAndAnswer(user: ReturnType<typeof renderOnFakeClock>['user'], text: string) {
  await user.type(input(), text);
  await act(() => vi.advanceTimersByTimeAsync(AIRPORT_DEBOUNCE_MS));
  await vi.waitFor(() => expect(screen.queryByText(PLAN_COPY.searching)).toBeNull());
}

describe('airport picker: a WAI-ARIA combobox over GET /api/airports?q= (plan a search)', () => {
  it('lists the answers after the debounce, the shared metro first, and says it is searching meanwhile', async () => {
    const asked = airportsRoute();
    const { user } = renderOnFakeClock();
    await user.type(input(), 'lond');
    expect(asked).toEqual([]);
    expect(screen.getByText(PLAN_COPY.searching)).toBeInTheDocument();
    expect(input()).toHaveAttribute('aria-expanded', 'false');
    await act(() => vi.advanceTimersByTimeAsync(AIRPORT_DEBOUNCE_MS));
    await vi.waitFor(() => expect(screen.getByRole('listbox')).toBeVisible());
    expect(asked).toEqual(['lond']);
    expect(optionNames()).toEqual([
      'London, all airports (LGW, LHR, SEN)',
      'London Gatwick (LGW) · London, GB',
      'London Heathrow (LHR) · London, GB',
      'Southend (SEN) · Southend, GB',
      'Governador Jose Richa (LDB) · Londrina, BR',
    ]);
    expect(input()).toHaveAttribute('aria-expanded', 'true');
    expect(input()).toHaveAttribute('aria-controls', screen.getByRole('listbox').id);
  });

  it('arrow keys move the highlight (wrapping) and Enter picks it: a chip, a cleared box and a status', async () => {
    airportsRoute();
    const { user } = renderOnFakeClock();
    await typeAndAnswer(user, 'lond');
    const active = () => document.getElementById(input().getAttribute('aria-activedescendant') ?? '');
    // automatic selection: the first option is highlighted until the operator moves
    expect(active()).toHaveAttribute('aria-label', 'London, all airports (LGW, LHR, SEN)');
    expect(active()).toHaveAttribute('aria-selected', 'true');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(active()).toHaveAttribute('aria-label', 'London Heathrow (LHR) · London, GB');
    await user.keyboard('{ArrowUp}{ArrowUp}{ArrowUp}');
    expect(active()).toHaveAttribute('aria-label', 'Governador Jose Richa (LDB) · Londrina, BR');
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}{Enter}');
    expect(chipCodes()).toEqual(['LHR']);
    expect(input()).toHaveValue('');
    expect(input()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('status')).toHaveTextContent('Added London Heathrow (LHR) · London, GB.');
    // the chip names the airport once the table answers for its code
    await vi.waitFor(() => expect(screen.getByText('London Heathrow')).toBeInTheDocument());
    expect(screen.getByRole('button', { name: 'Remove LHR' })).toHaveClass('min-h-11');
  });

  it('the arrow keys scroll the highlighted option into view; a pointer over the options does not', async () => {
    airportsRoute();
    const scrolled = vi.spyOn(Element.prototype, 'scrollIntoView');
    const { user } = renderOnFakeClock();
    await typeAndAnswer(user, 'lond');
    await user.hover(screen.getByRole('option', { name: 'London Heathrow (LHR) · London, GB' }));
    expect(input()).toHaveAttribute('aria-activedescendant', 'origins-option-2');
    expect(scrolled).not.toHaveBeenCalled();
    await user.keyboard('{ArrowDown}');
    expect(scrolled).toHaveBeenCalledTimes(1);
    expect(scrolled.mock.contexts[0]).toHaveAttribute('id', 'origins-option-3');
  });

  it('a metro in the answer leads, from the metro column not the city: New York includes Newark', async () => {
    airportsRoute();
    const { user } = renderOnFakeClock();
    await typeAndAnswer(user, 'new y');
    expect(optionNames()).toEqual([
      'New York, all airports (JFK, LGA, EWR)',
      'John F Kennedy (JFK) · New York, US',
      'La Guardia (LGA) · New York, US',
      'Newark Liberty (EWR) · Newark, US',
      'New York Skyports Seaplane Base (NYS) · New York, US',
    ]);
    // the text names the city, so the whole metro is highlighted
    expect(input()).toHaveAttribute('aria-activedescendant', 'origins-option-0');
  });

  it('when the text names an airport, not its city, the airport is highlighted and Enter adds only it', async () => {
    airportsRoute();
    const { user } = renderOnFakeClock();
    await typeAndAnswer(user, 'heath');
    expect(optionNames()[0]).toBe('London, all airports (LHR, LGW, SEN)');
    expect(input()).toHaveAttribute('aria-activedescendant', 'origins-option-1');
    await user.keyboard('{Enter}');
    expect(chipCodes()).toEqual(['LHR']);
  });

  it('typing the same text again opens on the preferred option, not where the arrows were left', async () => {
    airportsRoute();
    const { user } = renderOnFakeClock();
    await typeAndAnswer(user, 'heath');
    await user.keyboard('{ArrowDown}{ArrowDown}');
    expect(input()).toHaveAttribute('aria-activedescendant', 'origins-option-3');
    await user.clear(input());
    await typeAndAnswer(user, 'heath');
    expect(input()).toHaveAttribute('aria-activedescendant', 'origins-option-1');
  });

  it('the metro option adds every airport of that metro, as the table lists them for the metro code', async () => {
    const asked = airportsRoute();
    const { user } = renderOnFakeClock();
    await typeAndAnswer(user, 'lond');
    await user.keyboard('{Enter}');
    await vi.waitFor(() => expect(chipCodes()).toEqual(['LGW', 'LHR', 'SEN']));
    expect(asked).toContain('LON');
    expect(screen.getByRole('status')).toHaveTextContent('Added London, all airports (LGW, LHR, SEN).');
  });

  it('a click or tap picks an option and leaves focus in the box for the next airport', async () => {
    airportsRoute();
    const { user } = renderOnFakeClock();
    await typeAndAnswer(user, 'heathrow');
    expect(optionNames()).toEqual([
      'London, all airports (LHR, LGW, SEN)',
      'London Heathrow (LHR) · London, GB',
      'London Gatwick (LGW) · London, GB',
      'Southend (SEN) · Southend, GB',
    ]);
    await user.click(screen.getByRole('option', { name: 'London Heathrow (LHR) · London, GB' }));
    expect(chipCodes()).toEqual(['LHR']);
    expect(input()).toHaveFocus();
    expect(input()).toHaveValue('');
  });

  it('Escape closes the list, a second Escape clears the box; Tab leaves without picking', async () => {
    airportsRoute();
    const { user } = renderOnFakeClock();
    await typeAndAnswer(user, 'lond');
    await user.keyboard('{Escape}');
    expect(input()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.getByRole('listbox', { hidden: true })).not.toBeVisible();
    expect(input()).toHaveValue('lond');
    await user.keyboard('{Escape}');
    expect(input()).toHaveValue('');
    await typeAndAnswer(user, 'lond');
    expect(input()).toHaveAttribute('aria-expanded', 'true');
    await user.tab();
    expect(input()).not.toHaveFocus();
    expect(input()).toHaveAttribute('aria-expanded', 'false');
    expect(chipCodes()).toEqual([]);
  });

  it('a duplicate pick is refused with a message and the list stays as it was', async () => {
    airportsRoute();
    const { user } = renderOnFakeClock(['LHR']);
    await typeAndAnswer(user, 'heathrow');
    await user.keyboard('{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent('LHR is already in the list.');
    expect(input()).toHaveAttribute('aria-invalid', 'true');
    expect(chipCodes()).toEqual(['LHR']);
  });

  it('says when nothing matches, offering a three-letter code as a code; a failed search says so', async () => {
    airportsRoute();
    const { user } = renderOnFakeClock();
    await typeAndAnswer(user, 'qwerty');
    expect(screen.getByText('No airport matches "qwerty".')).toBeInTheDocument();
    expect(input()).toHaveAttribute('aria-expanded', 'false');
    await user.clear(input());
    await typeAndAnswer(user, 'qqq');
    expect(screen.getByText(PLAN_COPY.noMatchCode('qqq'))).toBeInTheDocument();
    await user.clear(input());
    await typeAndAnswer(user, 'boom');
    expect(screen.getByText(PLAN_COPY.lookupFailed)).toBeInTheDocument();
  });

  it('a bare code typed before the list answers is added on Enter; other text asks for a pick or a code', async () => {
    airportsRoute();
    const { user } = renderWithProviders(<Harness />);
    await user.type(input(), 'lgw{Enter}');
    await waitFor(() => expect(chipCodes()).toEqual(['LGW']));
    await user.type(input(), 'L1{Enter}');
    expect(screen.getByRole('alert')).toHaveTextContent(PLAN_COPY.pickOrCode);
    expect(input().getAttribute('aria-describedby')).toContain('origins-errors');
  });

  it('a removed chip leaves the list', async () => {
    const { user } = renderWithProviders(<Harness initial={['LHR', 'LGW']} />);
    await user.click(screen.getByRole('button', { name: 'Remove LHR' }));
    expect(chipCodes()).toEqual(['LGW']);
  });

  it('a code added while an earlier lookup is pending does not drop it, nor does the earlier one drop it', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(`${API}/airports`, async ({ request }) => {
        // why: the first typed code's lookup is held while the second is typed and answered
        if (new URL(request.url).searchParams.get('q') === 'LHR') await gate;
        return HttpResponse.json(airports);
      }),
    );
    const { user } = renderWithProviders(<Harness />);
    await user.type(input(), 'LHR{Enter}');
    // why: the box still holds the pending code until its lookup answers, so the operator clears it and types the next
    await user.clear(input());
    await user.type(input(), 'JFK{Enter}');
    await waitFor(() => expect(chipCodes()).toEqual(['JFK']));
    release();
    await waitFor(() => expect(chipCodes()).toEqual(['JFK', 'LHR']));
  });

  it('a metro code whose airports are all in the list adds nothing and does not claim it expanded', async () => {
    const { user } = renderWithProviders(<Harness initial={['LHR', 'LGW']} />);
    await user.type(input(), 'LON{Enter}');
    expect(await screen.findByText(COPY.duplicateAirport('LHR, LGW'))).toBeInTheDocument();
    expect(screen.queryByRole('status')).toBeNull();
    expect(chipCodes()).toEqual(['LHR', 'LGW']);
  });
});

describe('airport wording', () => {
  it('drops a trailing "Airport" and keeps the rest of the name, the city included', () => {
    expect(shortAirportName('London Heathrow Airport')).toBe('London Heathrow');
    expect(shortAirportName('Newark Liberty International Airport')).toBe('Newark Liberty');
    expect(shortAirportName('Skyports Seaplane Base')).toBe('Skyports Seaplane Base');
    expect(shortAirportName('Airport')).toBe('Airport');
  });

  it('offers a metro only when two or more answers share it, named by the city most of them give', () => {
    expect(airportChoices([LHR, LDB]).map((c) => c.kind)).toEqual(['airport', 'airport']);
    expect(airportChoices([EWR, JFK, row('LGA', 'La Guardia Airport', 'New York', 'NYC')])[0]).toEqual({
      kind: 'metro',
      metro: 'NYC',
      city: 'New York',
      codes: ['EWR', 'JFK', 'LGA'],
    });
  });

  it('suggests a name from the places, one per metro, falling back to a code the table did not answer for', () => {
    const details = new Map([
      ['LHR', LHR],
      ['LGW', LGW],
      ['JFK', JFK],
      ['EWR', EWR],
    ]);
    expect(suggestedName(['LHR', 'LGW'], ['JFK', 'EWR'], details)).toBe('London → New York');
    expect(suggestedName(['LHR', 'XXA'], ['EWR'], details)).toBe('London, XXA → Newark');
    // a tie between a metro's cities goes to the first alphabetically, whatever order they were picked in
    expect(suggestedName(['LHR'], ['EWR', 'JFK'], details)).toBe('London → New York');
    expect(suggestedName(['LHR'], ['JFK', 'EWR'], details)).toBe('London → New York');
    expect(suggestedName(['LHR'], [], details)).toBe('');
  });
});
