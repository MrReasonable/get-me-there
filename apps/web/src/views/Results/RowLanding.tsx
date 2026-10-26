import { DETAIL_LINK_PARAMS } from '@gmt/core';
import { useEffect } from 'react';
import { useResults } from '../../api/queries.js';
import type { DefinitionResponse } from '../../api/types.js';
import { LoadError, Loading } from '../../components/LoadState.js';
import { COPY } from '../../copy.js';
import { BACK_TO_DATES } from '../../state/resultsState.js';
import { rowId } from './ResultsTable.js';

export interface RowLandingProps {
  definition: DefinitionResponse;
  /** The link's `row=`: a results row key (an itinerary hash, or `calendar:<id>`). */
  row: string;
  /** The link's `basis=`, or null for §6.9's default. */
  basis: 'verified' | 'calendar' | null;
  /** Rewrites the URL (with replace) and, when the row is not found, says why on the Dates view it lands on. */
  onLand: (patch: Record<string, string | null>, notice: string | null) => void;
}

/**
 * Spec §11 URLs (WP19 Task 19.7): an alert email sent before revision 48 links to `?view=results&…&row=` without a date
 * pair. This reads the whole-space `/results` on the link's basis: a row found opens its date pair's detail with `row=`
 * kept; a row not found opens Dates with a line saying the result is no longer in this search's results, or, when the
 * read was truncated, that it is not among the first rows read (it may still exist beyond them).
 */
export function RowLanding({ definition, row, basis, onLand }: RowLandingProps) {
  const results = useResults(definition.id, basis);
  const data = results.data;
  useEffect(() => {
    if (data === undefined) return;
    const found = data.rows.find((r) => rowId(r) === row);
    if (found !== undefined)
      onLand(
        {
          [DETAIL_LINK_PARAMS.depart]: found.cell.departureDate,
          [DETAIL_LINK_PARAMS.return]: found.cell.returnDate,
          // why: the basis of the read that holds the row, so the detail opens on a page that holds it too
          [DETAIL_LINK_PARAMS.basis]: data.basis,
        },
        null,
      );
    else
      onLand(
        BACK_TO_DATES,
        data.truncated ? COPY.landing.rowNotRead(data.rows.length) : COPY.landing.rowGone,
      );
  }, [data, row, onLand]);
  if (results.error) return <LoadError error={results.error} retry={() => void results.refetch()} />;
  return <Loading />;
}
