import { type OwnedName, SETTING_LABELS } from '@gmt/core';
import { useState } from 'react';
import { COPY } from '../../copy.js';
import { FieldError, fieldIds } from './fields.js';
import type { SettingsForm } from './useSettingsForm.js';

const S = COPY.settingsView;

/**
 * A key or token, write-only (settings plan ruling 14): once saved the page shows only "saved · ends 3f2a" (or
 * "saved", or that the saved one was set aside at boot), with Replace and Remove. A typed key is a password field with
 * `autocomplete="new-password"`, and is cleared once saved. Remove asks in the page first; its "Remove it" saves the
 * removal at once (`onRemove`).
 */
export function SecretField({
  name,
  form,
  secret,
  setAside,
  onRemove,
}: {
  name: OwnedName;
  form: SettingsForm;
  secret: { set: boolean; last4: string | null };
  setAside: boolean;
  onRemove: () => void;
}) {
  const label = SETTING_LABELS[name];
  const ids = fieldIds(name);
  // why: each is open only for the save count it was opened at, so a save that stored something closes the field in
  // the same render that clears its typed key
  const [replacingAt, setReplacingAt] = useState<number | null>(null);
  const [confirmingAt, setConfirmingAt] = useState<number | null>(null);
  const replacing = replacingAt === form.saves;
  const confirming = confirmingAt === form.saves;
  const setReplacing = (open: boolean) => setReplacingAt(open ? form.saves : null);
  const setConfirming = (open: boolean) => setConfirmingAt(open ? form.saves : null);
  const saved = secret.set && !setAside;
  const typing = !saved || replacing;
  const error = form.error(name);
  return (
    <fieldset className="st-field">
      <legend id={ids.label} className="st-lab">
        {label}
      </legend>
      {setAside ? (
        <p className="st-note st-warn">
          <span aria-hidden="true">▲ </span>
          {S.secretSetAside}
        </p>
      ) : null}
      <div className="st-secret">
        {typing ? (
          <input
            id={ids.input}
            type="password"
            autoComplete="new-password"
            spellCheck={false}
            aria-labelledby={ids.label}
            aria-describedby={error === null ? ids.hint : `${ids.hint} ${ids.error}`}
            aria-invalid={error === null ? undefined : true}
            value={form.shown(name) ?? ''}
            onChange={(e) => form.type(name, e.target.value)}
          />
        ) : (
          <code className="st-saved">
            {secret.last4 === null ? S.secretSaved : S.secretEnds(secret.last4)}
          </code>
        )}
        {saved && !replacing ? (
          <button type="button" className="st-btn st-btn-sm" onClick={() => setReplacing(true)}>
            {S.replace}
          </button>
        ) : null}
        {saved && replacing ? (
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
        {secret.set && !confirming ? (
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
                onRemove();
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
        {S.secretHint}
      </span>
      <FieldError name={name} form={form} />
    </fieldset>
  );
}
