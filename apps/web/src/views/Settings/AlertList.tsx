import type { AlertRule } from '@gmt/core';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../../api/endpoints.js';
import { alertKeys, useDefinitions } from '../../api/queries.js';
import { LoadError, Loading } from '../../components/LoadState.js';
import { COPY } from '../../copy.js';
import { formatInstantLondon } from '../../format.js';
import { hrefWith, navigateTo } from '../../state/urlState.js';
import { navPatch } from '../../state/view.js';
import { describeRule } from '../Alerts/ruleText.js';

const A = COPY.settingsView.alerts;

/**
 * The newest alert events read to find each rule's last send. The api lists them newest first, so a rule's last send is
 * among them unless a thousand later events of other rules came after it; with one operator's handful of rules, that
 * is far beyond what happens.
 */
const EVENTS_READ = 1000;

/** Each rule's newest event that was sent (`notified`), by rule id. */
function lastSends(
  events: readonly { ruleId: string; status: string; firedAt: string }[],
): Map<string, string> {
  const out = new Map<string, string>();
  for (const e of events) if (e.status === 'notified' && !out.has(e.ruleId)) out.set(e.ruleId, e.firedAt);
  return out;
}

/** One rule: its search and its words, when it last sent, Edit (the Alerts view's form) and Delete, asked first. */
function RuleLine({
  rule,
  search,
  lastSent,
  confirming,
  onConfirm,
  onDelete,
}: {
  rule: AlertRule;
  search: string;
  lastSent: string | null | undefined;
  confirming: boolean;
  onConfirm: (open: boolean) => void;
  onDelete: () => void;
}) {
  const id = `alert-rule-${rule.id}`;
  const edit = { ...navPatch('alerts'), def: rule.definitionId };
  return (
    <li className="st-rule">
      <span id={id} className="st-rule-what">
        <b>{search}</b> ·{' '}
        {/* why: decision 55 — a rule's threshold is a price quoted in text, which the rendered sweep allows in data-quote */}
        <span data-quote="">{describeRule(rule, true)}</span>
        {rule.enabled ? null : ` · ${A.off}`}
      </span>
      {lastSent === undefined ? null : (
        <span className="st-hint">
          {A.lastSent(lastSent === null ? A.never : formatInstantLondon(Date.parse(lastSent)))}
        </span>
      )}
      <span className="st-row-buttons">
        <a
          className="st-btn st-btn-sm st-btn-quiet"
          href={hrefWith(edit)}
          onClick={navigateTo(edit)}
          aria-describedby={id}
        >
          {A.edit}
        </a>
        {confirming ? null : (
          <button
            type="button"
            className="st-btn st-btn-sm st-btn-quiet"
            aria-describedby={id}
            onClick={() => onConfirm(true)}
          >
            {A.delete}
          </button>
        )}
      </span>
      {confirming ? (
        <fieldset className="st-confirm">
          <legend>{A.confirmDelete(search)}</legend>
          <div className="st-row-buttons">
            <button type="button" className="st-btn st-btn-sm st-btn-danger" onClick={onDelete}>
              {A.deleteYes}
            </button>
            <button type="button" className="st-btn st-btn-sm" onClick={() => onConfirm(false)}>
              {A.deleteNo}
            </button>
          </div>
        </fieldset>
      ) : null}
    </li>
  );
}

/**
 * The alert rules of every search (settings plan ruling 12), each in the Search page's plain words with its search's
 * name, when it last sent, Edit (the Alerts view's form for that search) and Delete (asked in the page first). With no
 * rules it says where alerts come from; without email it says alerts can't be sent until email is set up.
 */
export function AlertList({ emailSetUp }: { emailSetUp: boolean }) {
  const qc = useQueryClient();
  const rules = useQuery({ queryKey: alertKeys.every, queryFn: () => api.everyAlertRule() });
  const events = useQuery({
    queryKey: alertKeys.everyEvent,
    queryFn: () => api.everyAlertEvent(EVENTS_READ),
  });
  const definitions = useDefinitions();
  const [confirming, setConfirming] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteAlertRule(id),
    // why: every rule list reads again: this one, a search's Alerts view and its page's Alert fold share the prefix
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: alertKeys.every }),
        qc.invalidateQueries({ queryKey: alertKeys.everyEvent }),
      ]),
  });
  // why: the lines wait for the names and the sends, unless one of those reads failed (the rules still show)
  const waiting =
    rules.data === undefined ||
    (definitions.data === undefined && definitions.error === null) ||
    (events.data === undefined && events.error === null);
  const sent = events.data === undefined ? null : lastSends(events.data);
  const nameOf = (definitionId: string) =>
    definitions.data?.find((d) => d.id === definitionId)?.name ?? A.removedSearch;
  return (
    <div className="st-card st-src st-alerts">
      <h3 id="settings-alerts">{A.heading}</h3>
      {emailSetUp ? null : (
        <p className="st-note st-warn">
          <span aria-hidden="true">▲ </span>
          {A.noEmail}
        </p>
      )}
      {rules.error ? (
        <LoadError error={rules.error} retry={() => void rules.refetch()} />
      ) : waiting ? (
        <Loading />
      ) : rules.data.length === 0 ? (
        <p className="st-muted">{A.none}</p>
      ) : (
        <ul aria-labelledby="settings-alerts" className="st-rules">
          {rules.data.map((r) => (
            <RuleLine
              key={r.id}
              rule={r}
              search={nameOf(r.definitionId)}
              lastSent={sent === null ? undefined : (sent.get(r.id) ?? null)}
              confirming={confirming === r.id}
              onConfirm={(open) => setConfirming(open ? r.id : null)}
              onDelete={() => {
                setConfirming(null);
                remove.mutate(r.id);
              }}
            />
          ))}
        </ul>
      )}
      {remove.isError ? (
        <p role="alert" className="st-note st-bad">
          <span aria-hidden="true">✕ </span>
          {A.deleteFailed}
        </p>
      ) : null}
    </div>
  );
}
