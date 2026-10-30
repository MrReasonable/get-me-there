/** Alerts view (spec §11): the rule form, the rules list and the events list. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/endpoints.js';
import { LoadError } from '../../components/LoadState.js';
import { COPY } from '../../copy.js';
import { EventsTable } from './EventsTable.js';
import { RuleForm } from './RuleForm.js';
import { describeRule } from './ruleText.js';
import './alerts.css';

const C = COPY.alertsView;
/** The newest events shown (alertEventsQuerySchema allows up to 1000). */
const EVENTS_LIMIT = 200;

export const alertKeys = {
  rules: (id: string) => ['alerts', id] as const,
  events: (id: string) => ['alert-events', id] as const,
};

export function AlertsView(props: { definitionId: string }) {
  const qc = useQueryClient();
  const rules = useQuery({
    queryKey: alertKeys.rules(props.definitionId),
    queryFn: () => api.alertRules(props.definitionId),
  });
  const events = useQuery({
    queryKey: alertKeys.events(props.definitionId),
    queryFn: () => api.alertEvents(props.definitionId, EVENTS_LIMIT),
  });
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: alertKeys.rules(props.definitionId) }),
      qc.invalidateQueries({ queryKey: alertKeys.events(props.definitionId) }),
    ]);
  const create = useMutation({ mutationFn: api.createAlertRule, onSuccess: refresh });
  const remove = useMutation({ mutationFn: api.deleteAlertRule, onSuccess: refresh });
  const list = rules.data ?? [];
  const ruleText = new Map(list.map((r) => [r.id, describeRule(r)] as const));

  return (
    <section aria-labelledby="alerts-heading" className="alerts grid grid-cols-[minmax(0,1fr)] gap-5 pt-5">
      <div className="alerts-wide space-y-2">
        <h2 id="alerts-heading" className="h-view">
          {C.heading}
        </h2>
        <p className="lede">{C.intro}</p>
      </div>
      <RuleForm
        definitionId={props.definitionId}
        onSubmit={(b) => create.mutate(b)}
        busy={create.isPending}
      />
      {create.isError ? (
        <p role="alert" className="plate notice alerts-wide bad-text">
          {C.notSaved(create.error.message)}
        </p>
      ) : null}
      {remove.isError ? (
        <p role="alert" className="plate notice alerts-wide bad-text">
          {COPY.actionFailed(remove.error.message)}
        </p>
      ) : null}
      <div className="plate plate-pad alerts-rules space-y-3">
        <h3 className="h-section">{C.rulesHeading}</h3>
        <p className="hint">{C.deleteKeepsHistory}</p>
        {rules.error ? (
          <LoadError error={rules.error} retry={() => void rules.refetch()} />
        ) : rules.isLoading ? (
          <p className="loading-line">{COPY.loading}</p>
        ) : list.length === 0 ? (
          <p>{C.noRules}</p>
        ) : (
          <ul className="alerts-rule-list">
            {list.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2">
                {/* why: decision 55 — a rule's threshold is a price quoted in text, which WP9's sweep allows inside [data-quote] */}
                <span data-quote>{ruleText.get(r.id)}</span>
                <button type="button" className="btn btn-sm min-h-11" onClick={() => remove.mutate(r.id)}>
                  {C.deleteRule}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="plate plate-pad alerts-wide space-y-3">
        <h3 className="h-section">{C.eventsHeading}</h3>
        {/* why: the Rule column shows each rule in words, so the table waits for both queries */}
        {events.error ? (
          <LoadError error={events.error} retry={() => void events.refetch()} />
        ) : rules.isLoading || events.isLoading ? (
          <p className="loading-line">{COPY.loading}</p>
        ) : (
          <EventsTable events={events.data ?? []} ruleText={ruleText} />
        )}
      </div>
    </section>
  );
}
