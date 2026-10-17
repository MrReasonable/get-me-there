/** Alerts view (spec §11): the rule form and the rules list. Task 11.11 adds the events list. */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/endpoints.js';
import { COPY } from '../../copy.js';
import { RuleForm } from './RuleForm.js';
import { describeRule } from './ruleText.js';

const C = COPY.alertsView;

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
  const refresh = () => qc.invalidateQueries({ queryKey: alertKeys.rules(props.definitionId) });
  const create = useMutation({ mutationFn: api.createAlertRule, onSuccess: refresh });
  const remove = useMutation({ mutationFn: api.deleteAlertRule, onSuccess: refresh });
  const list = rules.data ?? [];

  return (
    <section aria-labelledby="alerts-heading" className="grid gap-6">
      <h2 id="alerts-heading">{C.heading}</h2>
      <p>{C.intro}</p>
      <RuleForm
        definitionId={props.definitionId}
        onSubmit={(b) => create.mutate(b)}
        busy={create.isPending}
      />
      {create.isError ? <p role="alert">{C.notSaved(create.error.message)}</p> : null}
      <div>
        <h3>{C.rulesHeading}</h3>
        <p className="text-sm">{C.deleteKeepsHistory}</p>
        {rules.isLoading ? (
          <p>{COPY.loading}</p>
        ) : list.length === 0 ? (
          <p>{C.noRules}</p>
        ) : (
          <ul>
            {list.map((r) => (
              <li key={r.id} className="flex gap-2">
                {/* why: decision 55 — a rule's threshold is a price quoted in text, which WP9's sweep allows inside [data-quote] */}
                <span data-quote>{describeRule(r)}</span>
                <button type="button" onClick={() => remove.mutate(r.id)}>
                  {C.deleteRule}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
