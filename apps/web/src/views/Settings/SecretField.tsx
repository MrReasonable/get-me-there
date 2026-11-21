import { type OwnedName, SETTING_LABELS } from '@gmt/core';
import { useEffect, useRef, useState } from 'react';
import { COPY } from '../../copy.js';
import { FieldError, fieldIds } from './fields.js';
import type { SettingsForm } from './useSettingsForm.js';

const S = COPY.settingsView;

/**
 * A key or token, write-only (settings plan ruling 14): once saved the page shows only "saved · ends 3f2a" (or
 * "saved", or that the saved one was set aside at boot), with Replace and Remove. A typed key goes into a password
 * field with `autocomplete="new-password"`. The field is uncontrolled, so React never copies the key into its value
 * attribute; the typed text lives in the field and the page's draft only, and is cleared once saved. Remove asks in
 * the page first; its "Remove it" saves the removal at once (`onRemove`).
 */
export function SecretField({
  name,
  form,
  secret,
  setAside,
  onRemove,
  label = SETTING_LABELS[name],
  hint = S.secretHint,
}: {
  name: OwnedName;
  form: SettingsForm;
  secret: { set: boolean; last4: string | null };
  setAside: boolean;
  /** Remove's save; without one the field offers no Remove (the mail password goes with Remove email). */
  onRemove?: () => void;
  /** The field's name where a form words it its own way (Gmail's "App password"); core's label otherwise. */
  label?: string;
  hint?: string;
}) {
  const ids = fieldIds(name);
  // why: each is open only for the save count it was opened at, so a save that stored something closes it in the same
  // render; a field still holding a typed key stays open whatever else was saved (fix round 1, minor 3)
  const [replacingAt, setReplacingAt] = useState<number | null>(null);
  const [confirmingAt, setConfirmingAt] = useState<number | null>(null);
  const confirming = confirmingAt === form.saves;
  const setReplacing = (open: boolean) => setReplacingAt(open ? form.saves : null);
  const setConfirming = (open: boolean) => setConfirmingAt(open ? form.saves : null);
  const typed = form.edited(name) && form.shown(name) !== null;
  const saved = secret.set && !setAside;
  const error = form.error(name);
  // why: a refused secret (a test email to a changed server needs the password typed) opens the field to type it in
  const typing = !saved || replacingAt === form.saves || typed || error !== null;
  // why: the field is uncontrolled; when a save clears its draft, the text the field still holds is cleared with it
  const field = useRef<HTMLInputElement>(null);
  const draft = typed ? form.shown(name) : null;
  // why: a field mounted again (a section switch and back) while the draft holds a typed key shows it again, set as
  // the property, never the attribute, so the key is never in the markup (fix round 2)
  useEffect(() => {
    const el = field.current;
    if (el === null) return;
    if (draft === null) {
      if (el.value !== '') el.value = '';
    } else if (el.value !== draft) el.value = draft;
  }, [draft]);
  const described = [ids.hint, ...(setAside ? [ids.note] : []), ...(error === null ? [] : [ids.error])].join(
    ' ',
  );
  return (
    <fieldset className="st-field">
      <legend id={ids.label} className="st-lab">
        {label}
      </legend>
      {setAside ? (
        <p id={ids.note} className="st-note st-warn">
          <span aria-hidden="true">▲ </span>
          {S.secretSetAside}
        </p>
      ) : null}
      <div className="st-secret">
        {typing ? (
          <input
            ref={field}
            id={ids.input}
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            aria-labelledby={ids.label}
            aria-describedby={described}
            aria-invalid={error === null ? undefined : true}
            onChange={(e) => form.type(name, e.target.value)}
          />
        ) : (
          <code className="st-saved">
            {secret.last4 === null ? S.secretSaved : S.secretEnds(secret.last4)}
          </code>
        )}
        {saved && !typing ? (
          <button type="button" className="st-btn st-btn-sm" onClick={() => setReplacing(true)}>
            {S.replace}
          </button>
        ) : null}
        {saved && typing ? (
          <button
            type="button"
            className="st-btn st-btn-sm"
            onClick={() => {
              form.revert(name);
              setReplacing(false);
            }}
          >
            {S.cancel}
          </button>
        ) : null}
        {secret.set && !confirming && onRemove !== undefined ? (
          <button type="button" className="st-btn st-btn-sm st-btn-quiet" onClick={() => setConfirming(true)}>
            {S.remove}
          </button>
        ) : null}
      </div>
      {confirming ? (
        <fieldset className="st-confirm">
          <legend>{S.confirmRemove(label)}</legend>
          <div className="st-row-buttons">
            <button
              type="button"
              className="st-btn st-btn-sm st-btn-danger"
              onClick={() => {
                setConfirming(false);
                onRemove?.();
              }}
            >
              {S.confirmRemoveYes}
            </button>
            <button type="button" className="st-btn st-btn-sm" onClick={() => setConfirming(false)}>
              {S.confirmRemoveNo}
            </button>
          </div>
        </fieldset>
      ) : null}
      {!secret.set && !form.edited(name) ? <span className="st-hint">{S.secretNotSet}</span> : null}
      <span id={ids.hint} className="st-hint">
        {hint}
      </span>
      <FieldError name={name} form={form} />
    </fieldset>
  );
}
