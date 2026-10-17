import { useMutation } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/endpoints.js';
import type { CoverageCheckBody, CoverageCheckResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import type { Draft } from './draft.js';

type MonthCount = CoverageCheckResponse['pairs'][number]['months'][number];

/**
 * One cell of the table. A month the check could not read (`cachedRows: null`, decision 25) or a
 * month the response omits for a pair is "not checked", visibly different from a real 0, which
 * means the cache holds nothing for that pair and month (reviews po-001, prov-002, UI-1).
 */
function MonthCell({ m }: { m: MonthCount | undefined }) {
  if (m === undefined || m.cachedRows === null) {
    return <td className="p-1 text-right italic text-slate-600">{COPY.notChecked}</td>;
  }
  return <td className="p-1 text-right tabular-nums">{COPY.cachedOf(m.cachedRows, m.cellsInBand)}</td>;
}

/** Spec §10/§11: free Travelpayouts month tiles for the entered pairs, cached cells per pair per month, before saving. */
export function CoverageCheck({ draft, available }: { draft: Draft; available: boolean }) {
  const body: CoverageCheckBody = {
    origins: draft.origins,
    destinations: draft.destinations,
    window: draft.window,
    minNights: draft.minNights,
    maxNights: draft.maxNights,
  };
  const signature = JSON.stringify(body);
  const [checkedFor, setCheckedFor] = useState<string | null>(null);
  const check = useMutation({
    mutationFn: (b: CoverageCheckBody) => api.coverageCheck(b),
    onSuccess: () => setCheckedFor(signature),
  });
  if (!available) return <p className="text-sm">{COPY.coverageCheckNeedsTravelpayouts}</p>;
  const months = [...new Set((check.data?.pairs ?? []).flatMap((p) => p.months.map((m) => m.month)))].sort();
  const stale = check.data !== undefined && checkedFor !== signature;
  return (
    <section aria-label={COPY.coverageCheck} className="space-y-1 text-sm">
      <p>{COPY.coverageCheckIntro}</p>
      <button
        type="button"
        className="min-h-11 rounded border border-slate-500 px-3"
        disabled={draft.origins.length === 0 || draft.destinations.length === 0 || check.isPending}
        onClick={() => check.mutate(body)}
      >
        {COPY.coverageCheck}
      </button>
      {check.error ? <p role="alert">{COPY.actionFailed(check.error.message)}</p> : null}
      {stale ? (
        <p role="status" className="font-medium">
          {COPY.coverageCheckStale}
        </p>
      ) : null}
      {check.data !== undefined ? (
        <div className={stale ? 'opacity-60' : ''}>
          <table aria-label={COPY.coverageCheck} className="border-collapse">
            <thead>
              <tr>
                <th scope="col" className="p-1 text-left">
                  {COPY.coverageCheckMonth}
                </th>
                {months.map((m) => (
                  <th key={m} scope="col" className="p-1 text-right">
                    {m}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {check.data.pairs.map((p) => (
                <tr key={`${p.origin}-${p.destination}`}>
                  <th scope="row" className="p-1 text-left font-normal">
                    {COPY.coverageCheckPair(p.origin, p.destination)}
                  </th>
                  {months.map((m) => (
                    <MonthCell key={m} m={p.months.find((x) => x.month === m)} />
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p>{COPY.coverageCheckCalls(check.data.calls)}</p>
          {check.data.notes.map((n) => (
            <p key={n}>{n}</p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
