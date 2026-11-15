import { screen, within } from '@testing-library/react';
import type { JsonBodyType } from 'msw';
import type { DefinitionResponse } from '../../../src/api/types.js';
import { COPY } from '../../../src/copy.js';
import { DatesView, type DatesViewProps } from '../../../src/views/Dates/DatesView.js';
import type { DatesOptions } from '../../fixtures.dates.js';
import { definition } from '../../fixtures.js';
import { type Requests, serveDates } from '../../msw/datesHandlers.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

// Rendering a search's page for the component tests: the worked example's definition, a body from fixtures.dates.ts
// served by msw, the URL given, and the requests recorded.

export interface RenderDates {
  body?: DatesOptions | JsonBodyType;
  search?: string;
  def?: DefinitionResponse | null;
  props?: Omit<DatesViewProps, 'definition'>;
}

export function renderDates(o: RenderDates = {}) {
  const requests: Requests = [];
  if (o.body !== undefined) server.use(serveDates(o.body, requests));
  const r = renderWithProviders(
    <DatesView definition={o.def === undefined ? definition() : o.def} {...o.props} />,
    { search: o.search ?? '?view=dates&def=def-0001' },
  );
  return { ...r, requests };
}

const P = COPY.searchPage;

/** The "Cheapest trips" section once it has drawn (a region named by its heading). */
export const findTrips = () => screen.findByRole('region', { name: P.cheapestHeading });
/** The "Lower on the calendar" section once it has drawn. */
export const findLower = () => screen.findByRole('region', { name: P.lowerHeading });

/** A section's trip rows (`TripRow`), first to last. */
export const tripRows = (section: HTMLElement): HTMLElement[] => within(section).queryAllByTestId('trip-row');
/** A section's calendar rows (`CalendarRow`), first to last. */
export const calendarRows = (section: HTMLElement): HTMLElement[] =>
  within(section).queryAllByTestId('calendar-row');
/** A row's text as the eye reads it, whitespace collapsed. */
export const rowText = (row: HTMLElement): string => (row.textContent ?? '').replace(/\s+/g, ' ').trim();
/** The calendar (the overview until Task 9) once it has drawn. */
export const findCalendar = () => screen.findByTestId('dates-overview');
