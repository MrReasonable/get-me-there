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

/** The ids of a field that writes several names (the Gmail address is the user and the sender): each one's notes. */
export function describedByAll(
  names: readonly OwnedName[],
  form: SettingsForm,
  setAside: (name: OwnedName) => boolean,
): string | undefined {
  const parts = names.flatMap((n) => describedBy(n, form, setAside(n)) ?? []);
  return parts.length === 0 ? undefined : parts.join(' ');
}

/**
 * A 422's words beside the field it refused (ruling 5), with a glyph so it is never told by colour alone. `id` names it
 * where one refusal is shown in more than one place (a source list, beside each control that writes it).
 */
export function FieldError({ name, form, id }: { name: OwnedName; form: SettingsForm; id?: string }) {
  const error = form.error(name);
  if (error === null) return null;
  return (
    <p id={id ?? fieldIds(name).error} className="st-note st-bad">
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

/**
 * A whole number inside a sentence ("until [12] reads in a row…"), labelled by core's SETTING_LABELS; `labelled` when a
 * visible `<label htmlFor>` names it instead.
 */
export function NumberInput({
  name,
  form,
  min,
  max,
  setAside,
  labelled = false,
  wide = false,
}: {
  name: OwnedName;
  form: SettingsForm;
  min: number;
  max?: number;
  setAside: boolean;
  labelled?: boolean;
  /** Room for five digits (a port). */
  wide?: boolean;
}) {
  const error = form.error(name);
  return (
    <input
      id={fieldIds(name).input}
      type="number"
      inputMode="numeric"
      min={min}
      {...(max === undefined ? {} : { max })}
      step={1}
      className={wide ? 'st-num st-num-wide' : 'st-num'}
      {...(labelled ? {} : { 'aria-label': SETTING_LABELS[name] })}
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

/**
 * A line of text (a server's name, a user name, an address), named by a visible `<label htmlFor>` with core's label, or
 * by `label` where a sentence holds it (the spend limit in pounds).
 */
export function TextInput({
  name,
  form,
  setAside,
  type = 'text',
  label,
  inputMode,
  autoComplete = 'off',
  className,
}: {
  name: OwnedName;
  form: SettingsForm;
  setAside: boolean;
  type?: 'text' | 'email';
  /** The accessible name when no visible label names the field. */
  label?: string;
  inputMode?: 'decimal' | 'email' | 'text';
  autoComplete?: string;
  className?: string;
}) {
  const error = form.error(name);
  return (
    <input
      id={fieldIds(name).input}
      type={type}
      {...(inputMode === undefined ? {} : { inputMode })}
      {...(label === undefined ? {} : { 'aria-label': label })}
      {...(className === undefined ? {} : { className })}
      autoComplete={autoComplete}
      spellCheck={false}
      aria-describedby={describedBy(name, form, setAside)}
      aria-invalid={error === null ? undefined : true}
      value={form.shown(name) ?? ''}
      onChange={(e) => form.set(name, e.target.value)}
    />
  );
}
