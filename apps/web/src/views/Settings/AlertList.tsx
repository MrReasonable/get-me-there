import type { apiContract } from '@gmt/core';
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
 * One rule: its search and its words, when it last sent (the route's own `lastSentAt`, settings plan R13), Edit (the
 * Alerts view's form) and Delete, asked first.
 */
function RuleLine({
  rule,
  search,
  confirming,
  onConfirm,
  onDelete,
}: {
  rule: apiContract.AlertRuleListed;
  search: string;
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
      <span className="st-hint">
        {A.lastSent(rule.lastSentAt === null ? A.never : formatInstantLondon(Date.parse(rule.lastSentAt)))}
      </span>
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
  const definitions = useDefinitions();
  const [confirming, setConfirming] = useState<string | null>(null);
  const remove = useMutation({
    mutationFn: (id: string) => api.deleteAlertRule(id),
    // why: every rule list reads again: this one, a search's Alerts view and its page's Alert fold share the prefix
    onSuccess: () => qc.invalidateQueries({ queryKey: alertKeys.every }),
  });
  // why: the lines wait for the searches' names, unless that read failed (the rules still show, their search unnamed)
  const waiting = rules.data === undefined || (definitions.data === undefined && definitions.error === null);
  // why: a search missing from a good read was removed; with no read at all the line can't say which search it is
  // (fix round 1, minor 2)
  const nameOf = (definitionId: string) =>
    definitions.data === undefined
      ? A.unnamedSearch
      : (definitions.data.find((d) => d.id === definitionId)?.name ?? A.removedSearch);
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
