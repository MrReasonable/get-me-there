import { act, screen, within } from '@testing-library/react';
import { HttpResponse, http } from 'msw';
import { expect, vi } from 'vitest';
import type { ProvidersResponse } from '../../../src/api/types.js';
import { PLAN_COPY } from '../../../src/copy/plan.js';
import { NewSearchForm } from '../../../src/views/Searches/NewSearchForm.js';
import { API, estimateResponse, providersResponse } from '../../fixtures.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';
import { airportRows } from './support.js';

// The new-search form's test support (WP20 Task 20.5): the form on Vitest's fake clock, its estimate requests held on a
// promise the test releases, and the second worked example (Birmingham → Frankfurt) typed in. Each test file that
// uses `renderForm` restores the real clock in its own afterEach.

/** The worked example's free sources, the browser worker among them (spec rev 55 §8.2 presets). */
export function freeProviders(): ProvidersResponse {
  const base = providersResponse();
  const tp = base.providers[0];
  if (tp === undefined) throw new Error('the fixture names Travelpayouts first');
  return providersResponse({
    providers: [
      tp,
      {
        ...tp,
        providerId: 'camoufox',
        displayName: 'Camoufox',
        capabilities: {
          discovery: {
            sourceKind: 'scraped-self',
            provenanceNote: 'Google Flights read in a browser on this machine',
            maxAgeHours: 0,
          },
          verification: null,
        },
        usage: [],
      },
    ],
    presets: {
      ...base.presets,
      providers: {
        discovery: ['travelpayouts', 'camoufox'],
        verification: [],
        discoveryRefreshHours: { travelpayouts: 168, camoufox: 168 },
      },
    },
  });
}

/**
 * Holds every estimate request on a promise the test releases, counting them. `answer` is what a released request
 * returns.
 */
export function holdEstimates(answer = () => HttpResponse.json(estimateResponse())) {
  const bodies: unknown[] = [];
  let release: () => void = () => undefined;
  let gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  server.use(
    airportRows(),
    http.post(`${API}/definitions/estimate`, async ({ request }) => {
      bodies.push(await request.json());
      await gate;
      return answer();
    }),
  );
  return {
    bodies,
    release: () => {
      release();
      gate = Promise.resolve();
    },
  };
}

/** Renders the form on Vitest's fake clock (the AirportListInput tests' pattern). */
export function renderForm(providers = freeProviders()) {
  // why: fake the clear functions too, or a cleared debounce timer still fires on the real clock
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  // why: Testing Library steps its own setTimeout(0) waits only when a global `jest` says fake timers are on
  vi.stubGlobal('jest', { advanceTimersByTime: (ms: number) => vi.advanceTimersByTime(ms) });
  return renderWithProviders(<NewSearchForm providers={providers} />, { fakeTimers: true });
}

export type User = ReturnType<typeof renderForm>['user'];
export const searchNow = () => screen.getByRole('button', { name: /^Search now/ });
export const step = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms));
export const field = (label: string) => {
  const el = screen.getByLabelText(label);
  if (!(el instanceof HTMLInputElement)) throw new Error(`${label} is not an input`);
  return el;
};

/** The codes of the chips in the From or To group. */
export const chipCodes = (name: string) =>
  within(within(screen.getByRole('group', { name })).getByRole('list'))
    .queryAllByRole('listitem')
    .map((li) => li.firstChild?.textContent);

/** Types a code into From or To and presses Enter, then waits for its chip (the table is asked for it first). */
export async function addAirport(user: User, name: string, code: string) {
  await user.type(screen.getByRole('combobox', { name }), `${code}{Enter}`);
  await vi.waitFor(() => expect(chipCodes(name)).toContain(code));
}

/** Fills From, To and Leave between with the second worked example, and lets the airport lookups answer. */
export async function fill(user: User) {
  await addAirport(user, PLAN_COPY.from, 'BHX');
  await addAirport(user, PLAN_COPY.to, 'FRA');
  await user.type(field(PLAN_COPY.earliest), '10 Jan 2027');
  await user.type(field(PLAN_COPY.latest), '31 Mar 2027');
  // why: the airports' lookups answer, so the suggested name joins the draft before the debounce is measured
  await step(0);
}
