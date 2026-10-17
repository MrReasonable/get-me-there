import { COPY } from '../copy.js';

/**
 * Route body for a view another work package owns (WP10: Calendar, Duration, History; WP11: Alerts).
 * `hint` names what to use meanwhile (the Calendar's month slicing is the Results departure filter).
 */
// why: no Phase 1–3 view renders it after WP11; kept for the Phase 4 views (WP11 brief §12).
export function Placeholder({ hint = null }: { hint?: string | null }) {
  return (
    <div className="space-y-1 p-4 text-slate-700">
      <p>{COPY.placeholder}</p>
      {hint !== null ? <p className="text-sm">{hint}</p> : null}
    </div>
  );
}
