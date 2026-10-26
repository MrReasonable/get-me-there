import { screen, within } from '@testing-library/react';
import type { JsonBodyType } from 'msw';
import type { DefinitionResponse } from '../../../src/api/types.js';
import { DatesView, type DatesViewProps } from '../../../src/views/Dates/DatesView.js';
import type { DatesOptions } from '../../fixtures.dates.js';
import { definition } from '../../fixtures.js';
import { type Requests, serveDates } from '../../msw/datesHandlers.js';
import { server } from '../../msw/server.js';
import { renderWithProviders } from '../../render.js';

// Rendering the Dates view for the component tests (WP19 Tasks 19.4–19.9): the worked example's definition, a body
// from fixtures.dates.ts served by msw, the URL given, and the requests recorded.

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

/** The board's table once it has drawn (its caption starts "Best dates"). */
export const findBoard = () => screen.findByRole('table', { name: /^Best dates/ });

/** The board's body rows, first to last. */
export function boardRows(table: HTMLElement): HTMLElement[] {
  return within(table).getAllByRole('row').slice(1);
}

/** A board row's cells' text, by column. */
export function cellsOf(row: HTMLElement): string[] {
  return [...row.querySelectorAll('td')].map((c) => c.textContent ?? '');
}
