import { type apiContract, budgetScopeLabel, type OwnedName, SETTING_LABELS } from '@gmt/core';
import { useBudget } from '../../api/queries.js';
import { COPY } from '../../copy.js';
import { formatMicroGbp } from '../../format.js';
import { FieldError, NumberInput, SetAsideNote, TextInput } from './fields.js';
import type { SettingsForm } from './useSettingsForm.js';

const L = COPY.settingsView.limits;

/**
 * The month's spend so far against the limit in use (`/budget`'s `global-month` window): a meter drawn for the eye only
 * (the words say it), and "£N spent this month". `data-cost` marks it a cost, never a fare.
 */
function Spent() {
  const budget = useBudget();
  const month = budget.data?.scopes.find((u) => u.scope === budgetScopeLabel({ kind: 'global-month' }));
  if (month === undefined) return null;
  const share = month.cap === null || month.cap === 0 ? 0 : Math.min(1, month.costMicroGbp / month.cap);
  return (
    <>
      <meter className="st-meter" aria-hidden="true" min={0} max={1} value={share} />
      <p className="st-hint" data-cost="">
        {L.spent(formatMicroGbp(month.costMicroGbp))}
      </p>
    </>
  );
}

/**
 * Settings › Limits (settings plan rulings 5 and 14): the monthly spend limit typed in pounds and saved in pence (core
 * poundsToPence, in the form), and the SearchApi credits a new search starts with. Each sits inside its sentence, named
 * by core's SETTING_LABELS; a refusal sits beside it. A save's warnings (a limit below the plan's fees) follow Save.
 */
export function Limits({ view, form }: { view: apiContract.SettingsView; form: SettingsForm }) {
  const aside = (name: OwnedName) => view.setAside.includes(name);
  return (
    <div className="st-card st-src">
      <div className="st-src-body st-flush">
        <div className="st-field">
          {/* why: the "£" belongs to the money typed after it, a cost, never a fare (the rendered sweep's data-cost) */}
          <p className="st-inline" data-cost="">
            {L.spendBefore}
            <TextInput
              name="MONTHLY_SPEND_CAP_PENCE"
              form={form}
              setAside={aside('MONTHLY_SPEND_CAP_PENCE')}
              label={SETTING_LABELS.MONTHLY_SPEND_CAP_PENCE}
              inputMode="decimal"
              className="st-money"
            />{' '}
            {L.spendAfter}
          </p>
          <SetAsideNote name="MONTHLY_SPEND_CAP_PENCE" setAside={aside('MONTHLY_SPEND_CAP_PENCE')} />
          <FieldError name="MONTHLY_SPEND_CAP_PENCE" form={form} />
          <Spent />
        </div>
        <div className="st-field">
          <p className="st-inline">
            {L.creditsBefore}{' '}
            <NumberInput
              name="EXECUTION_MAX_CALLS"
              form={form}
              min={0}
              setAside={aside('EXECUTION_MAX_CALLS')}
            />{' '}
            {L.creditsAfter}
          </p>
          <SetAsideNote name="EXECUTION_MAX_CALLS" setAside={aside('EXECUTION_MAX_CALLS')} />
          <FieldError name="EXECUTION_MAX_CALLS" form={form} />
          <p className="st-hint">{L.creditsHint}</p>
        </div>
      </div>
    </div>
  );
}
