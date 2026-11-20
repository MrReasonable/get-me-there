import {
  apiContract,
  DEFAULT_SMTP_TLS,
  EMAIL_NAMES,
  type OwnedName,
  SETTING_LABELS,
  SMTP_REQUIRED_NAMES,
} from '@gmt/core';
import { type ReactNode, useState } from 'react';
import { ApiError } from '../../api/client.js';
import { api } from '../../api/endpoints.js';
import { COPY } from '../../copy.js';
import type { SettingsSection } from '../../state/view.js';
import { AlertList } from './AlertList.js';
import {
  describedByAll,
  FieldError,
  fieldIds,
  NumberInput,
  SelectInput,
  SetAsideNote,
  TextInput,
} from './fields.js';
import { SaveBar } from './SaveBar.js';
import { SecretField } from './SecretField.js';
import { originalOf, type SettingsForm } from './useSettingsForm.js';

const S = COPY.settingsView;
const E = COPY.settingsView.email;
const SECTION = 'email' satisfies SettingsSection;

type View = apiContract.SettingsView;
/** How the page sends email (settings plan ruling 11): Gmail, or another mail server named in full. */
export type EmailMode = 'gmail' | 'other';

/** The names another server's form writes that a switch to Gmail overwrites (Gmail's server, its address twice). */
const OTHER_NAMES = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_TLS', 'SMTP_USER', 'ALERT_EMAIL_FROM'] as const;
/** Those names' edits as they stood in the Other form, so a switch back to it puts them back (fix round 1). */
type OtherDraft = Partial<Record<(typeof OTHER_NAMES)[number], string | null>>;
/**
 * The email form's mode, held by the page so it survives a section switch, with the Other form's edits from before a
 * switch to Gmail (null when none was made from Other).
 */
export interface EmailChoice {
  mode: EmailMode;
  other: OtherDraft | null;
}

/** Gmail's server, as ruling 11 stores it: the address is both the user name and the sender. */
const GMAIL = { host: 'smtp.gmail.com', port: '465', tls: 'implicit' } as const;

/** The server names the Gmail form fills itself and shows no field for. */
const SERVER_NAMES = ['SMTP_HOST', 'SMTP_PORT', 'SMTP_TLS'] as const;

/**
 * A stored smtp.gmail.com opens as Gmail, another server as Other; with nothing stored, Gmail is offered first. A server
 * name the app set aside opens as Other, where it has its field (review I3, ruling R21).
 */
export function storedEmailMode(view: View): EmailMode {
  if (SERVER_NAMES.some((n) => view.setAside.includes(n))) return 'other';
  const host = view.values.SMTP_HOST;
  return host === null || host === GMAIL.host ? 'gmail' : 'other';
}

/** Whether any email setting is stored, so Remove email has something to remove. */
function emailStored(view: View): boolean {
  return view.secrets.SMTP_PASS.set || EMAIL_NAMES.some((n) => originalOf(view, n) !== null);
}

/** Whether email can send: every name it needs stored, none of them set aside at boot. */
function emailSetUp(view: View): boolean {
  return (
    SMTP_REQUIRED_NAMES.every((n) =>
      n === 'SMTP_PASS' ? view.secrets.SMTP_PASS.set : originalOf(view, n) !== null,
    ) && !view.setAside.some((n) => EMAIL_NAMES.includes(n))
  );
}

/** Gmail's server names written into the form (no edit where they are stored already). */
function fillGmail(form: SettingsForm): void {
  form.set('SMTP_HOST', GMAIL.host);
  form.set('SMTP_PORT', GMAIL.port);
  form.set('SMTP_TLS', GMAIL.tls);
}

/** What the last test email did, worded by the page (ruling 11). */
type TestResult =
  | { kind: 'sending' }
  | { kind: 'sent'; to: string }
  | { kind: 'failed'; reason: apiContract.EmailTestFailure }
  | { kind: 'limited' | 'refused' | 'incomplete' | 'no-answer' | 'error' };

function testWords(r: TestResult, mode: EmailMode): string {
  switch (r.kind) {
    case 'sending':
      return E.testSending;
    case 'sent':
      return E.testSent(r.to);
    case 'failed':
      return E.testFailed[r.reason];
    case 'limited':
      return E.testLimited;
    case 'refused':
      return E.testRefused;
    case 'incomplete':
      return E.testIncomplete[mode];
    case 'no-answer':
      return E.testNoAnswer;
    case 'error':
      return E.testError;
  }
}

/** The test email's answer: sent, one of the four fixed failures (never the server's own words), or why it wasn't. */
function testOutcome(e: unknown, form: SettingsForm): TestResult {
  if (!(e instanceof ApiError)) return { kind: 'error' };
  const refused = e.status === 422 ? e.fieldErrors() : [];
  if (refused.length > 0) {
    const next: Partial<Record<OwnedName, string>> = {};
    for (const f of refused) {
      const name = EMAIL_NAMES.find((n) => n === f.field);
      if (name !== undefined) next[name] = f.message;
    }
    form.refuse(next);
    return { kind: 'refused' };
  }
  if (e.status === 429) return { kind: 'limited' };
  if (e.status === 502) {
    const reason = apiContract.emailTestFailureSchema.safeParse(e.details?.reason);
    return reason.success ? { kind: 'failed', reason: reason.data } : { kind: 'error' };
  }
  return e.code === 'network' ? { kind: 'no-answer' } : { kind: 'error' };
}

/** A field with a visible label (core's, or the form's own words where Gmail names it its way). */
function Labelled({ name, label, children }: { name: OwnedName; label?: string; children: ReactNode }) {
  return (
    <div className="st-field">
      <label className="st-lab" htmlFor={fieldIds(name).input}>
        {label ?? SETTING_LABELS[name]}
      </label>
      {children}
    </div>
  );
}

/**
 * Settings › Email and alerts (settings plan rulings 11 and 12): email by Gmail (address, app password, send-to) or by
 * another mail server (each name in full), the test email, Remove email (asked first, then the seven names unset at
 * once), and the alert rules. The mode is held by the page (`choice`), so it survives a switch to another section; a
 * switch to Gmail writes the names it fixes (Gmail's server, and its address as user and sender), and a switch back
 * puts the Other form's edits back as they were.
 */
export function EmailAlerts({
  view,
  form,
  choice,
  setChoice,
}: {
  view: View;
  form: SettingsForm;
  choice: EmailChoice | null;
  setChoice: (choice: EmailChoice | null) => void;
}) {
  const mode = choice?.mode ?? storedEmailMode(view);
  const [test, setTest] = useState<TestResult | null>(null);
  const [confirming, setConfirming] = useState(false);
  const aside = (name: OwnedName) => view.setAside.includes(name);
  const toGmail = () => {
    // why: Gmail overwrites the Other form's server, user and sender; its edits are kept to put back on the way back
    const other: OtherDraft = {};
    for (const n of OTHER_NAMES) if (form.edited(n)) other[n] = form.shown(n);
    setChoice({ mode: 'gmail', other });
    fillGmail(form);
    form.set('ALERT_EMAIL_FROM', form.shown('SMTP_USER') ?? '');
  };
  const toOther = () => {
    const before = choice?.other ?? null;
    setChoice({ mode: 'other', other: null });
    // why: back from Gmail, the Other form is as it was: its own edits, else what is stored (fix round 1)
    if (before !== null) {
      for (const n of OTHER_NAMES) {
        const value = before[n];
        if (value === undefined) form.revert(n);
        else form.set(n, value);
      }
      return;
    }
    for (const n of SERVER_NAMES) form.revert(n);
    // why: Gmail's server name is no other server's; the field is emptied for the operator to type theirs
    if (view.values.SMTP_HOST === GMAIL.host) form.set('SMTP_HOST', '');
  };
  const sendTest = async () => {
    const pass = form.edited('SMTP_PASS') ? form.shown('SMTP_PASS') : null;
    const body = apiContract.settingsEmailTestRequestSchema.safeParse({
      host: form.shown('SMTP_HOST') ?? '',
      port: Number(form.shown('SMTP_PORT') ?? ''),
      tls: form.shown('SMTP_TLS') ?? DEFAULT_SMTP_TLS,
      user: form.shown('SMTP_USER') ?? '',
      from: form.shown('ALERT_EMAIL_FROM') ?? '',
      to: form.shown('ALERT_EMAIL_TO') ?? '',
      // why: a password goes only when typed; otherwise the api uses the stored one for the stored server only
      ...(pass === null ? {} : { pass }),
    });
    if (!body.success) {
      setTest({ kind: 'incomplete' });
      return;
    }
    setTest({ kind: 'sending' });
    try {
      await api.settingsEmailTest(body.data);
      setTest({ kind: 'sent', to: body.data.to });
    } catch (e) {
      setTest(testOutcome(e, form));
    }
  };
  const removeAll = () => {
    const changes: apiContract.SettingChanges = {};
    for (const n of EMAIL_NAMES) changes[n] = null;
    setChoice(null);
    void form.save(SECTION, changes);
  };
  const toField = (
    <Labelled name="ALERT_EMAIL_TO">
      <TextInput name="ALERT_EMAIL_TO" form={form} setAside={aside('ALERT_EMAIL_TO')} type="email" />
      <SetAsideNote name="ALERT_EMAIL_TO" setAside={aside('ALERT_EMAIL_TO')} />
      <FieldError name="ALERT_EMAIL_TO" form={form} />
    </Labelled>
  );
  return (
    <>
      <div className="st-card st-src">
        <fieldset className="st-modes">
          <legend className="st-lab">{E.sendWith}</legend>
          <label className="st-check">
            <input type="radio" name="email-mode" checked={mode === 'gmail'} onChange={toGmail} />
            <span>{E.modeGmail}</span>
          </label>
          <label className="st-check">
            <input type="radio" name="email-mode" checked={mode === 'other'} onChange={toOther} />
            <span>{E.modeOther}</span>
          </label>
        </fieldset>
        <div className="st-src-body">
          {mode === 'gmail' ? (
            <>
              {/* why: Gmail's own server names are not fields here; a refusal of one is still said */}
              <FieldError name="SMTP_HOST" form={form} />
              <FieldError name="SMTP_PORT" form={form} />
              <FieldError name="SMTP_TLS" form={form} />
              <div className="st-row st-row-wide">
                <Labelled name="SMTP_USER" label={E.gmailAddress}>
                  <input
                    id={fieldIds('SMTP_USER').input}
                    type="email"
                    autoComplete="off"
                    spellCheck={false}
                    aria-describedby={describedByAll(['SMTP_USER', 'ALERT_EMAIL_FROM'], form, aside)}
                    aria-invalid={
                      form.error('SMTP_USER') === null && form.error('ALERT_EMAIL_FROM') === null
                        ? undefined
                        : true
                    }
                    value={form.shown('SMTP_USER') ?? ''}
                    onChange={(e) => {
                      fillGmail(form);
                      form.set('SMTP_USER', e.target.value);
                      form.set('ALERT_EMAIL_FROM', e.target.value);
                    }}
                  />
                  <SetAsideNote name="SMTP_USER" setAside={aside('SMTP_USER')} />
                  <SetAsideNote name="ALERT_EMAIL_FROM" setAside={aside('ALERT_EMAIL_FROM')} />
                  <FieldError name="SMTP_USER" form={form} />
                  <FieldError name="ALERT_EMAIL_FROM" form={form} />
                </Labelled>
                {toField}
              </div>
              <SecretField
                name="SMTP_PASS"
                form={form}
                secret={view.secrets.SMTP_PASS}
                setAside={aside('SMTP_PASS')}
                label={E.appPassword}
                hint={E.appPasswordHint}
              />
            </>
          ) : (
            <>
              <div className="st-row st-row-wide">
                <Labelled name="SMTP_HOST">
                  <TextInput name="SMTP_HOST" form={form} setAside={aside('SMTP_HOST')} />
                  <SetAsideNote name="SMTP_HOST" setAside={aside('SMTP_HOST')} />
                  <FieldError name="SMTP_HOST" form={form} />
                </Labelled>
                <Labelled name="SMTP_PORT">
                  <NumberInput
                    name="SMTP_PORT"
                    form={form}
                    min={1}
                    max={65535}
                    setAside={aside('SMTP_PORT')}
                    labelled
                    wide
                  />
                  <SetAsideNote name="SMTP_PORT" setAside={aside('SMTP_PORT')} />
                  <FieldError name="SMTP_PORT" form={form} />
                </Labelled>
                <Labelled name="SMTP_TLS">
                  <SelectInput
                    name="SMTP_TLS"
                    form={form}
                    options={E.tls}
                    setAside={aside('SMTP_TLS')}
                    labelled
                  />
                  <SetAsideNote name="SMTP_TLS" setAside={aside('SMTP_TLS')} />
                  <FieldError name="SMTP_TLS" form={form} />
                </Labelled>
              </div>
              <div className="st-row st-row-wide">
                <Labelled name="SMTP_USER">
                  <TextInput name="SMTP_USER" form={form} setAside={aside('SMTP_USER')} />
                  <SetAsideNote name="SMTP_USER" setAside={aside('SMTP_USER')} />
                  <FieldError name="SMTP_USER" form={form} />
                </Labelled>
                <Labelled name="ALERT_EMAIL_FROM">
                  <TextInput
                    name="ALERT_EMAIL_FROM"
                    form={form}
                    setAside={aside('ALERT_EMAIL_FROM')}
                    type="email"
                  />
                  <SetAsideNote name="ALERT_EMAIL_FROM" setAside={aside('ALERT_EMAIL_FROM')} />
                  <FieldError name="ALERT_EMAIL_FROM" form={form} />
                </Labelled>
                {toField}
              </div>
              <SecretField
                name="SMTP_PASS"
                form={form}
                secret={view.secrets.SMTP_PASS}
                setAside={aside('SMTP_PASS')}
                hint={E.passwordHint}
              />
            </>
          )}
          {emailStored(view) ? (
            confirming ? (
              <fieldset className="st-confirm">
                <legend>{E.confirmRemove}</legend>
                <div className="st-row-buttons">
                  <button
                    type="button"
                    className="st-btn st-btn-sm st-btn-danger"
                    onClick={() => {
                      setConfirming(false);
                      removeAll();
                    }}
                  >
                    {S.confirmRemoveYes}
                  </button>
                  <button type="button" className="st-btn st-btn-sm" onClick={() => setConfirming(false)}>
                    {S.confirmRemoveNo}
                  </button>
                </div>
              </fieldset>
            ) : (
              <button
                type="button"
                className="st-btn st-btn-sm st-btn-quiet st-btn-start"
                onClick={() => setConfirming(true)}
              >
                {E.remove}
              </button>
            )
          ) : null}
        </div>
      </div>
      <SaveBar
        section={SECTION}
        form={form}
        extra={
          <>
            {/* why: the test email's answer sits beside its button, in a polite live region of its own */}
            <p role="status" aria-live="polite" className="st-result">
              {test === null ? null : (
                <span
                  className={test.kind === 'sent' ? 'st-ok' : test.kind === 'sending' ? undefined : 'st-bad'}
                >
                  {test.kind === 'sent' ? <span aria-hidden="true">● </span> : null}
                  {test.kind === 'sending' || test.kind === 'sent' ? null : (
                    <span aria-hidden="true">✕ </span>
                  )}
                  {testWords(test, mode)}
                </span>
              )}
            </p>
            <button
              type="button"
              className="st-btn"
              disabled={test?.kind === 'sending'}
              onClick={() => void sendTest()}
            >
              {E.sendTest}
            </button>
          </>
        }
      />
      <AlertList emailSetUp={emailSetUp(view)} />
    </>
  );
}
