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

function maxAgeText(info: CapabilityInfo): string {
  const h = info.maxAgeHours;
  if (h === 'unknown') return COPY.maxAgeUnknown;
  if (h === 0) return COPY.maxAgeAtFetch;
  // why: ruling 17 (pie-007): an assumed bound is worded as an assumption, never as the vendor's.
  return info.maxAgeAssumed === true ? COPY.maxAgeAssumed(formatDuration(h)) : COPY.maxAge(formatDuration(h));
}

function Capability({ title, info }: { title: string; info: CapabilityInfo }) {
  return (
    <div>
      <p>{COPY.capability(title, sourceLabel(info), maxAgeText(info))}</p>
      <p className="text-slate-700">{info.provenanceNote}</p>
    </div>
  );
}

/** Only a `provider-lifetime:` scope is a lifetime allowance; any other row without bounds states no window (review prov-020). The API sends only the window the plan uses, so a null cap here means no cap is configured (ruling 2). */
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
        // why: UI-003: the card is headed by the provider's name, the word the status bar, filters and marks use; the
        // source labels (the API's displayName among them) stay on the capability lines.
        <section
          key={p.providerId}
          aria-label={COPY.provider[p.providerId]}
          className="rounded border border-slate-300 p-2"
        >
          <h3 className="font-semibold">
            {COPY.provider[p.providerId]}{' '}
            <span className="font-normal">{p.enabled ? COPY.providerEnabled : COPY.providerDisabled}</span>
          </h3>
          {p.notices.map((n) => (
            <p key={n} role="alert" className="rounded border border-red-700 p-1 font-medium">
              {n}
            </p>
          ))}
          <p>{COPY.plan(COPY.planName[p.plan])}</p>
          {/* why: ruling 5: which call cap stops a £0-per-call plan; information, not a warning, so no alert role */}
          {p.capNote !== null ? <p data-cost="">{p.capNote}</p> : null}
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
