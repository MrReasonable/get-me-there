import {
  budgetScopeLabel,
  type CapabilityInfo,
  formatDuration,
  type ProviderId,
  sourceLabel,
} from '@gmt/core';
import { useProviders } from '../../api/queries.js';
import type { UsageRow } from '../../api/types.js';
import { LoadError, Loading } from '../../components/LoadState.js';
import { COPY } from '../../copy.js';
import { formatIsoDate } from '../../format.js';

function maxAgeText(h: CapabilityInfo['maxAgeHours']): string {
  if (h === 'unknown') return COPY.maxAgeUnknown;
  return h === 0 ? COPY.maxAgeAtFetch : COPY.maxAge(formatDuration(h));
}

function Capability({ title, info }: { title: string; info: CapabilityInfo }) {
  return (
    <div>
      <p>{COPY.capability(title, sourceLabel(info), maxAgeText(info.maxAgeHours))}</p>
      <p className="text-slate-700">{info.provenanceNote}</p>
    </div>
  );
}

/** Only a `provider-lifetime:` scope is a lifetime allowance; any other row without bounds states no window (review prov-020). */
function usageText(u: UsageRow, providerId: ProviderId): string {
  const cap = u.cap === null ? COPY.noCap : String(u.cap);
  if (u.scope === budgetScopeLabel({ kind: 'provider-lifetime', providerId }))
    return COPY.usageLifetime(u.calls, cap);
  // why: the scope is named (core's label decides), so "12 of 100 calls" never leaves the reader guessing which cap it is (UI-16).
  const scope = u.scope === budgetScopeLabel({ kind: 'provider-month', providerId }) ? COPY.usageMonth : '';
  const text = usageBody(u, cap);
  return scope === '' ? text : `${scope}${text}`;
}

function usageBody(u: UsageRow, cap: string): string {
  if (u.windowStart === null || u.windowEnd === null) return COPY.usageNoWindow(u.calls, cap);
  return COPY.usageWindow(
    u.calls,
    cap,
    formatIsoDate(u.windowStart.slice(0, 10)),
    formatIsoDate(u.windowEnd.slice(0, 10)),
  );
}

/**
 * Spec §11 Providers: capabilities, plan in words, usage vs caps with window bounds, and the API's
 * notices (the zero-cap message). It shows configuration, not a run, so it has no run header; the
 * status bar names the run on this view too.
 */
export function ProvidersView() {
  const q = useProviders();
  if (q.error) return <LoadError error={q.error} retry={() => void q.refetch()} />;
  if (q.data === undefined) return <Loading />;
  return (
    <div className="space-y-3 text-sm">
      <h2 className="text-xl font-semibold">{COPY.providersHeading}</h2>
      {q.data.providers.map((p) => (
        <section
          key={p.providerId}
          aria-label={p.displayName}
          className="rounded border border-slate-300 p-2"
        >
          <h3 className="font-semibold">
            {p.displayName}{' '}
            <span className="font-normal">{p.enabled ? COPY.providerEnabled : COPY.providerDisabled}</span>
          </h3>
          {p.notices.map((n) => (
            <p key={n} role="alert" className="rounded border border-red-700 p-1 font-medium">
              {n}
            </p>
          ))}
          <p>{COPY.plan(COPY.planName[p.plan])}</p>
          {p.excludedFromSchedule ? <p>{COPY.excludedFromSchedule}</p> : null}
          {p.capabilities.discovery !== null ? (
            <Capability title={COPY.capabilityDiscovery} info={p.capabilities.discovery} />
          ) : null}
          {p.capabilities.verification !== null ? (
            <Capability title={COPY.capabilityVerification} info={p.capabilities.verification} />
          ) : null}
          <ul>
            {p.usage.map((u) => (
              <li key={u.scope}>{usageText(u, p.providerId)}</li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
