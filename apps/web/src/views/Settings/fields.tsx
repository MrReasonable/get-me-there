import { type OwnedName, SETTING_LABELS } from '@gmt/core';
import { COPY } from '../../copy.js';
import type { SettingsForm } from './useSettingsForm.js';

const S = COPY.settingsView;

/** The ids a field's parts take, so a refusal is tied to its input through aria-describedby (Global Constraints). */
export function fieldIds(name: OwnedName) {
  const base = `setting-${name.toLowerCase().replaceAll('_', '-')}`;
  return {
    input: base,
    label: `${base}-label`,
    hint: `${base}-hint`,
    error: `${base}-error`,
    note: `${base}-note`,
  };
}

/** The ids an input is described by: its refusal when there is one, and its set-aside note when there is one. */
export function describedBy(name: OwnedName, form: SettingsForm, setAside: boolean): string | undefined {
  const ids = fieldIds(name);
  const parts = [...(setAside ? [ids.note] : []), ...(form.error(name) === null ? [] : [ids.error])];
  return parts.length === 0 ? undefined : parts.join(' ');
}

/** A 422's words beside the field it refused (ruling 5), with a glyph so it is never told by colour alone. */
export function FieldError({ name, form }: { name: OwnedName; form: SettingsForm }) {
  const error = form.error(name);
  if (error === null) return null;
  return (
    <p id={fieldIds(name).error} className="st-note st-bad">
      <span aria-hidden="true">✕ </span>
      {error}
    </p>
  );
}

/** A stored value set aside at boot (it no longer passes), so the default is in use until it is set again. */
export function SetAsideNote({ name, setAside }: { name: OwnedName; setAside: boolean }) {
  if (!setAside) return null;
  return (
    <p id={fieldIds(name).note} className="st-note st-warn">
      <span aria-hidden="true">▲ </span>
      {S.valueSetAside}
    </p>
  );
}

/** A whole number inside a sentence ("until [12] reads in a row…"), labelled by core's SETTING_LABELS. */
export function NumberInput({
  name,
  form,
  min,
  max,
  setAside,
}: {
  name: OwnedName;
  form: SettingsForm;
  min: number;
  max: number;
  setAside: boolean;
}) {
  const error = form.error(name);
  return (
    <input
      id={fieldIds(name).input}
      type="number"
      inputMode="numeric"
      min={min}
      max={max}
      step={1}
      className="st-num"
      aria-label={SETTING_LABELS[name]}
      aria-describedby={describedBy(name, form, setAside)}
      aria-invalid={error === null ? undefined : true}
      value={form.shown(name) ?? ''}
      onChange={(e) => form.set(name, e.target.value)}
    />
  );
}

/** A choice among fixed values, each worded by the caller. */
export function SelectInput<V extends string>({
  name,
  form,
  options,
  setAside,
  labelled = false,
}: {
  name: OwnedName;
  form: SettingsForm;
  options: Readonly<Record<V, string>>;
  setAside: boolean;
  /** A visible label names it (`<label htmlFor>`); otherwise core's label is its accessible name. */
  labelled?: boolean;
}) {
  const error = form.error(name);
  const entries: Array<[string, string]> = Object.entries(options);
  return (
    <select
      id={fieldIds(name).input}
      className="st-select"
      {...(labelled ? {} : { 'aria-label': SETTING_LABELS[name] })}
      aria-describedby={describedBy(name, form, setAside)}
      aria-invalid={error === null ? undefined : true}
      value={form.shown(name) ?? ''}
      onChange={(e) => form.set(name, e.target.value)}
    >
      {entries.map(([value, words]) => (
        <option key={value} value={value}>
          {words}
        </option>
      ))}
    </select>
  );
}
