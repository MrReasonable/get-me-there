/** Alert rule form (spec §6.8, §11): type, threshold or percentage, basis, requireAllVerified on the itinerary-search basis only, cooldown. */
import { apiContract } from '@gmt/core';
import { type FormEvent, useState } from 'react';
import type { AlertRuleBody } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { parsePoundsToPence } from '../../format.js';

const C = COPY.alertsView;
const RULE_TYPES = ['absolute', 'dropPct', 'dropAbs'] as const;
const BASES = ['verified', 'calendar'] as const;
type RuleType = (typeof RULE_TYPES)[number];
type Basis = (typeof BASES)[number];

/** A select's value narrowed by lookup (decision 48: no casts); the options are the only values it can hold. */
function ruleTypeOf(v: string): RuleType {
  return RULE_TYPES.find((t) => t === v) ?? 'absolute';
}
function basisOf(v: string): Basis {
  return BASES.find((b) => b === v) ?? 'verified';
}

/** The field label a zod issue belongs to, by the first segment of its path. */
const FIELD_LABEL: Readonly<Record<string, string>> = {
  thresholdPence: C.threshold,
  pct: C.dropPct,
  cooldownHours: C.cooldown,
  basis: C.basis,
  requireAllVerified: C.requireAll,
  type: C.ruleType,
};

/** A number field: empty or unparsable input becomes NaN, which the schema rejects with a field message. */
function numberOrNaN(s: string): number {
  return s.trim() === '' ? Number.NaN : Number(s);
}

export function RuleForm(props: {
  definitionId: string;
  onSubmit: (body: AlertRuleBody) => void;
  busy: boolean;
}) {
  const [type, setType] = useState<RuleType>('absolute');
  const [amount, setAmount] = useState('');
  const [pct, setPct] = useState('');
  const [basis, setBasis] = useState<Basis>('verified');
  const [requireAll, setRequireAll] = useState(false);
  const [cooldown, setCooldown] = useState('336');
  const [errors, setErrors] = useState<string[]>([]);

  function submit(e: FormEvent) {
    e.preventDefault();
    const parsed = apiContract.alertRuleInputSchema.safeParse({
      definitionId: props.definitionId,
      type,
      thresholdPence: type === 'dropPct' ? null : (parsePoundsToPence(amount) ?? Number.NaN),
      pct: type === 'dropPct' ? numberOrNaN(pct) : null,
      basis,
      // why: spec §6.8 — requireAllVerified exists only on the itinerary-search basis; the schema rejects it on calendar.
      requireAllVerified: basis === 'verified' ? requireAll : null,
      cooldownHours: numberOrNaN(cooldown),
      enabled: true,
    });
    if (!parsed.success) {
      setErrors(
        parsed.error.issues.map((i) =>
          COPY.fieldError(FIELD_LABEL[String(i.path[0])] ?? C.formLabel, i.message),
        ),
      );
      return;
    }
    setErrors([]);
    props.onSubmit(parsed.data);
  }

  return (
    <form onSubmit={submit} className="grid max-w-xl gap-3" aria-label={C.formLabel}>
      <label className="grid gap-1">
        <span>{C.ruleType}</span>
        <select aria-label={C.ruleType} value={type} onChange={(e) => setType(ruleTypeOf(e.target.value))}>
          <option value="absolute">{C.typeAbsolute}</option>
          <option value="dropPct">{C.typeDropPct}</option>
          <option value="dropAbs">{C.typeDropAbs}</option>
        </select>
      </label>
      {type === 'dropPct' ? (
        <label className="grid gap-1">
          <span>{C.dropPct}</span>
          <input
            aria-label={C.dropPct}
            inputMode="numeric"
            value={pct}
            onChange={(e) => setPct(e.target.value)}
          />
        </label>
      ) : (
        <label className="grid gap-1">
          <span>{C.threshold}</span>
          <input
            aria-label={C.threshold}
            inputMode="decimal"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
      )}
      <label className="grid gap-1">
        <span>{C.basis}</span>
        <select aria-label={C.basis} value={basis} onChange={(e) => setBasis(basisOf(e.target.value))}>
          <option value="verified">{C.basisVerified}</option>
          <option value="calendar">{C.basisCalendar}</option>
        </select>
      </label>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          aria-label={C.requireAll}
          disabled={basis === 'calendar'}
          checked={basis === 'verified' && requireAll}
          onChange={(e) => setRequireAll(e.target.checked)}
        />
        <span>{C.requireAll}</span>
      </label>
      {basis === 'calendar' ? <p className="text-sm">{C.requireAllCalendarNote}</p> : null}
      <label className="grid gap-1">
        <span>{C.cooldown}</span>
        <input
          aria-label={C.cooldown}
          type="number"
          min={1}
          value={cooldown}
          onChange={(e) => setCooldown(e.target.value)}
        />
        <span className="text-sm">{C.cooldownHint}</span>
      </label>
      {errors.length > 0 ? (
        <div role="alert" className="text-sm text-red-800">
          {errors.map((m) => (
            <p key={m}>{m}</p>
          ))}
        </div>
      ) : null}
      <button type="submit" className="min-h-11 rounded border border-slate-500 px-3" disabled={props.busy}>
        {C.addRule}
      </button>
    </form>
  );
}
