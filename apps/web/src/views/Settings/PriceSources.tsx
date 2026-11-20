import {
  type apiContract,
  budgetScopeLabel,
  CONFIRM_TARGET,
  type OwnedName,
  type ProviderId,
  SETTING_LABELS,
} from '@gmt/core';
import type { ReactNode } from 'react';
import { useBudget, useProviders, useSearchApiAccount } from '../../api/queries.js';
import { useStatus } from '../../api/statusQuery.js';
import type { ProvidersResponse } from '../../api/types.js';
import { COPY } from '../../copy.js';
import { formatIsoDate } from '../../format.js';
import { searchApiCreditsLine } from '../../lib/searchApiCreditsLine.js';
import { hrefWith, navigateTo } from '../../state/urlState.js';
import { navPatch, settingsPatch } from '../../state/view.js';
import { FieldError, fieldIds, NumberInput, SelectInput, SetAsideNote } from './fields.js';
import { SecretField } from './SecretField.js';
import { LIST_NAME, type SettingsForm, type SourceRole } from './useSettingsForm.js';

const S = COPY.settingsView;
const NAME = COPY.newSearch.source;

type View = apiContract.SettingsView;
type StatusCheck = apiContract.StatusCheck;
type Toggle = (role: SourceRole, id: ProviderId, on: boolean) => void;
/** What every source card is given: the stored view, the page's form, and the switch that writes the source lists. */
interface CardProps {
  view: View;
  form: SettingsForm;
  toggle: Toggle;
}

/** The id of a source list's refusal as shown in one source's card. */
const listErrorId = (role: SourceRole, source: ProviderId) => `${fieldIds(LIST_NAME[role]).error}-${source}`;
/** The id of a set-aside source list's note as shown in one source's card. */
const listNoteId = (role: SourceRole, source: ProviderId) => `${fieldIds(LIST_NAME[role]).note}-${source}`;
/** The id of a card's "save a key first" line. */
const needsKeyId = (source: ProviderId) => `needs-key-${source}`;
/** Whether the app set a source list aside at boot (review residual (c)). */
const listAside = (view: View, role: SourceRole) => view.setAside.includes(LIST_NAME[role]);

/**
 * What a control that writes the source lists `roles` is described by (fix round 1, important 1): each list's refusal
 * as its card shows it, when there is one, each list's set-aside note, and the card's "save a key first" line when it
 * is shown.
 */
function describedBy(
  view: View,
  form: SettingsForm,
  source: ProviderId,
  roles: readonly SourceRole[],
  needsKey: boolean,
) {
  const ids = [
    ...roles.filter((r) => form.error(LIST_NAME[r]) !== null).map((r) => listErrorId(r, source)),
    ...roles.filter((r) => listAside(view, r)).map((r) => listNoteId(r, source)),
    ...(needsKey ? [needsKeyId(source)] : []),
  ];
  return ids.length === 0 ? undefined : ids.join(' ');
}

/**
 * A source list's refusals and, when the app set it aside (review residual (c)), its note, inside the card of a source
 * whose controls write that list. Every source's block offers the default or none for it, which need no switch.
 */
function ListLines({
  view,
  form,
  id,
  roles,
}: {
  view: View;
  form: SettingsForm;
  id: ProviderId;
  roles: readonly SourceRole[];
}) {
  return (
    <>
      {roles.map((r) =>
        listAside(view, r) ? (
          <p key={`aside-${r}`} id={listNoteId(r, id)} className="st-note st-warn">
            <span aria-hidden="true">▲ </span>
            {S.listSetAside(SETTING_LABELS[LIST_NAME[r]])}
          </p>
        ) : null,
      )}
      {roles.map((r) => (
        <FieldError key={r} name={LIST_NAME[r]} form={form} id={listErrorId(r, id)} />
      ))}
    </>
  );
}

/** A state in words and a glyph, so a line never says it by colour alone. */
const GLYPH: Readonly<Record<StatusCheck['state'], string>> = { ok: '●', warn: '▲', fail: '✕', off: '○' };

/**
 * A source's switch (settings plan ruling 8): it sets whether new searches start with the source, and says so in words,
 * "New searches use it" or "Off for new searches"; its name stays the source's.
 */
function SourceSwitch({
  source,
  on,
  disabled,
  onChange,
  describedBy,
}: {
  source: string;
  on: boolean;
  disabled: boolean;
  onChange: (on: boolean) => void;
  describedBy?: string | undefined;
}) {
  return (
    <label className="st-switch">
      <input
        type="checkbox"
        role="switch"
        checked={on}
        aria-checked={on}
        disabled={disabled}
        aria-label={S.switchLabel(source)}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>{on ? S.switchOn : S.switchOff}</span>
    </label>
  );
}

/** One source's card: its name, what it is, its switch, then its own fields. */
function SourceCard({
  id,
  title,
  meta,
  control,
  children,
}: {
  id: ProviderId;
  title: string;
  meta: string;
  control: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="st-card st-src" aria-labelledby={`source-${id}`}>
      <div className="st-src-head">
        <div>
          <h3 id={`source-${id}`}>{title}</h3>
          <p className="st-meta">{meta}</p>
        </div>
        {control}
      </div>
      <div className="st-src-body">{children}</div>
    </section>
  );
}

/** A set-up command, shown as code. */
const Command = ({ text }: { text: string }) => <code className="st-cmd">{text}</code>;

/**
 * The consent record in the page's own words (fix round 1, minor 1): its expiry date when the report gives one, else a
 * short line pointing to System; never the report's summary.
 */
function consentWords(c: StatusCheck): string {
  const date = c.expiresOn === undefined ? null : formatIsoDate(c.expiresOn);
  if (c.state === 'off') return S.consentUnchecked;
  if (date === null) return c.state === 'ok' ? S.consentHeld : S.consentProblem;
  if (c.state === 'ok') return S.consentSaved(date);
  return c.state === 'warn' ? S.consentEnding(date) : S.consentEnded(date);
}

/** The browser's state from `/status` (ruling 9): the worker's line, then the consent record's, each in words. */
function BrowserStatus() {
  const status = useStatus();
  if (status.data === undefined)
    return status.error === null ? null : <p className="st-kv">{S.browserUnknown}</p>;
  const worker = status.data.checks.find((c) => c.id === 'worker');
  const consent = status.data.checks.find((c) => c.id === 'consent');
  const line = (c: StatusCheck, words: string) => (
    <p className="st-kv" key={c.id}>
      <span aria-hidden="true" className={`st-glyph st-${c.state}`}>
        {GLYPH[c.state]}
      </span>
      {words}
    </p>
  );
  return (
    <>
      {worker === undefined
        ? null
        : line(
            worker,
            worker.state === 'ok'
              ? S.browserReady
              : S.browserState(COPY.statusView.state[worker.state], worker.summary),
          )}
      {consent === undefined ? null : line(consent, consentWords(consent))}
      <p className="st-kv">
        {status.data.pagesAtOnce === undefined
          ? S.pagesAtOnceUnknown
          : S.pagesAtOnce(status.data.pagesAtOnce)}
        <span className="st-muted">
          {' · '}
          {S.changeWith} <Command text={S.browserCommand} />
        </span>
      </p>
    </>
  );
}

/** The stopping rule for flight reads, a number inside its sentence. */
function PatienceField({ view, form }: Omit<CardProps, 'toggle'>) {
  const aside = view.setAside.includes('FLIGHT_READ_PATIENCE');
  return (
    <div className="st-field">
      <p className="st-inline">
        {S.patienceBefore}{' '}
        <NumberInput name="FLIGHT_READ_PATIENCE" form={form} min={3} max={50} setAside={aside} />{' '}
        {S.patienceAfter(CONFIRM_TARGET)}
      </p>
      <SetAsideNote name="FLIGHT_READ_PATIENCE" setAside={aside} />
      <FieldError name="FLIGHT_READ_PATIENCE" form={form} />
    </div>
  );
}

/** When the browser may run. */
function WindowField({ view, form }: Omit<CardProps, 'toggle'>) {
  const aside = view.setAside.includes('CAMOUFOX_BROWSER_WINDOW');
  return (
    <div className="st-field">
      <p className="st-inline">
        {S.mayRun}{' '}
        <SelectInput name="CAMOUFOX_BROWSER_WINDOW" form={form} options={S.browserWindow} setAside={aside} />
      </p>
      <SetAsideNote name="CAMOUFOX_BROWSER_WINDOW" setAside={aside} />
      <FieldError name="CAMOUFOX_BROWSER_WINDOW" form={form} />
    </div>
  );
}

/**
 * The browser's block (ruling 9): set-up words when it is off, else its state and its settings. Off, a
 * setting of its own that the app set aside still gets its field (review I3, ruling R21), so the System line about it
 * can be fixed here.
 */
function Browser({ view, form, toggle }: CardProps) {
  const aside = (name: OwnedName) => view.setAside.includes(name);
  if (!view.envOnly.camoufoxEnabled)
    return (
      <SourceCard id="camoufox" title={NAME.camoufox} meta={S.browserMeta} control={null}>
        <p>
          {S.browserNotSetUp} <Command text={S.browserCommand} /> {S.browserSetUpDoc}
        </p>
        {aside('FLIGHT_READ_PATIENCE') ? <PatienceField view={view} form={form} /> : null}
        {aside('CAMOUFOX_BROWSER_WINDOW') ? <WindowField view={view} form={form} /> : null}
      </SourceCard>
    );
  const on = form.list('discovery').includes('camoufox');
  return (
    <SourceCard
      id="camoufox"
      title={NAME.camoufox}
      meta={S.browserMeta}
      control={
        <SourceSwitch
          source={NAME.camoufox}
          on={on}
          disabled={false}
          describedBy={describedBy(view, form, 'camoufox', ['discovery'], false)}
          onChange={(v) => toggle('discovery', 'camoufox', v)}
        />
      }
    >
      <ListLines view={view} form={form} id="camoufox" roles={['discovery']} />
      <BrowserStatus />
      <PatienceField view={view} form={form} />
      <WindowField view={view} form={form} />
    </SourceCard>
  );
}

const LIST_ROLES: readonly SourceRole[] = ['discovery', 'verification'];

/**
 * A source list the app set aside (review residual (c)): the default or none, each saved at once, so it can be fixed
 * even when no switch can be used (no key saved, the browser not set up).
 */
function ListChoice({ form, role }: { form: SettingsForm; role: SourceRole }) {
  const name = LIST_NAME[role];
  const choose = (value: string | null) => {
    const changes: apiContract.SettingChanges = {};
    changes[name] = value;
    void form.save('sources', changes);
  };
  return (
    <div className="st-field">
      <p className="st-note st-warn">
        <span aria-hidden="true">▲ </span>
        {S.listChoose(SETTING_LABELS[name])}
      </p>
      <div className="st-row-buttons">
        <button type="button" className="st-btn" onClick={() => choose(null)}>
          {S.listUseDefault}
        </button>
        <button type="button" className="st-btn" onClick={() => choose('none')}>
          {S.listUseNone}
        </button>
      </div>
    </div>
  );
}

/**
 * What applies to every source (review I1 and I3, rulings R19 and R21): the link to Calls and caps (the Providers
 * view: each source's calls, caps and windows, which this section does not show), and under Advanced how often a
 * date's calendar price is read again, a setting of every calendar source, not the browser's alone.
 */
function EverySource({ view, form }: Omit<CardProps, 'toggle'>) {
  const aside = view.setAside.includes('DISCOVERY_REFRESH_DAYS');
  const providers = navPatch('providers');
  return (
    <section className="st-card st-src" aria-labelledby="sources-every">
      <h3 id="sources-every">{S.everySource}</h3>
      <div className="st-src-body">
        {LIST_ROLES.filter((r) => listAside(view, r)).map((r) => (
          <ListChoice key={r} form={form} role={r} />
        ))}
        <p className="st-hint">
          {S.callsAndCapsBefore}{' '}
          <a href={hrefWith(providers)} onClick={navigateTo(providers)}>
            {S.callsAndCapsLink}
          </a>
          .
        </p>
        <details
          className="st-more"
          open={form.error('DISCOVERY_REFRESH_DAYS') !== null || aside ? true : undefined}
        >
          <summary>{S.advanced}</summary>
          <div className="st-field">
            <p className="st-inline">
              {S.refreshBefore}{' '}
              <NumberInput name="DISCOVERY_REFRESH_DAYS" form={form} min={1} max={30} setAside={aside} />{' '}
              {S.refreshAfter}
            </p>
            <SetAsideNote name="DISCOVERY_REFRESH_DAYS" setAside={aside} />
            <FieldError name="DISCOVERY_REFRESH_DAYS" form={form} />
          </div>
        </details>
      </div>
    </section>
  );
}

/**
 * SearchApi's balance (ruling 10), told apart from every other state: its own figure ("0 credits left" included), this
 * app's count when SearchApi could not be asked, or that it could not be read at all. Nothing while it is asked.
 */
function Balance({ providers }: { providers: ProvidersResponse | undefined }) {
  const budget = useBudget();
  const account = useSearchApiAccount();
  if (providers === undefined || budget.data === undefined || account.isPending) return null;
  const line = searchApiCreditsLine(account.data?.account ?? null, budget.data, providers);
  if (line === null) return <p className="st-kv st-muted">{S.balanceUnread}</p>;
  return (
    <p className="st-kv">
      <b>{S.credits(line.left, line.cap)}</b>
      {line.tail === '' ? null : (
        <>
          {' '}
          <span className="st-muted">{line.tail}</span>
        </>
      )}
    </p>
  );
}

function SearchApi({ view, form, toggle }: CardProps) {
  const providers = useProviders();
  const aside = (name: OwnedName) => view.setAside.includes(name);
  const key = view.secrets.SEARCHAPI_KEY;
  const keySaved = key.set && !aside('SEARCHAPI_KEY');
  const typed = form.shown('SEARCHAPI_KEY');
  // why: a source with no key cannot be used, so it is switched on only with a key saved or typed (and not removed)
  const canUse = form.edited('SEARCHAPI_KEY') ? typed !== null : keySaved;
  const verification = form.list('verification').includes('searchapi');
  const discovery = form.list('discovery').includes('searchapi');
  const on = verification || discovery;
  const plan = form.shown('SEARCHAPI_PLAN');
  return (
    <SourceCard
      id="searchapi"
      title={NAME.searchapi}
      meta={S.searchapiMeta}
      control={
        <SourceSwitch
          source={NAME.searchapi}
          on={on}
          disabled={!canUse && !on}
          describedBy={describedBy(view, form, 'searchapi', ['verification', 'discovery'], !canUse)}
          onChange={(v) => {
            // why: ruling 8 — On ticks the first box; Off unticks both (an emptied list is stored as none)
            if (v) toggle('verification', 'searchapi', true);
            else {
              toggle('verification', 'searchapi', false);
              toggle('discovery', 'searchapi', false);
            }
          }}
        />
      }
    >
      <ListLines view={view} form={form} id="searchapi" roles={['verification', 'discovery']} />
      {keySaved && !form.edited('SEARCHAPI_KEY') ? <Balance providers={providers.data} /> : null}
      {!key.set ? <p className="st-kv st-muted">{S.searchapiNoKey}</p> : null}
      <SecretField
        name="SEARCHAPI_KEY"
        form={form}
        secret={key}
        setAside={aside('SEARCHAPI_KEY')}
        onRemove={() => void form.save('sources', { SEARCHAPI_KEY: null })}
      />
      <div className="st-row">
        <div className="st-field">
          <label className="st-lab" htmlFor={fieldIds('SEARCHAPI_PLAN').input}>
            {SETTING_LABELS.SEARCHAPI_PLAN}
          </label>
          <SelectInput
            name="SEARCHAPI_PLAN"
            form={form}
            options={S.plan}
            setAside={aside('SEARCHAPI_PLAN')}
            labelled
          />
          <SetAsideNote name="SEARCHAPI_PLAN" setAside={aside('SEARCHAPI_PLAN')} />
          <FieldError name="SEARCHAPI_PLAN" form={form} />
        </div>
        {/* why: review I3 (ruling R21): a billing day the app set aside keeps its field on any plan */}
        {plan === '40usd' || aside('SEARCHAPI_BILLING_DAY') ? (
          <div className="st-field">
            <label className="st-lab" htmlFor={fieldIds('SEARCHAPI_BILLING_DAY').input}>
              {SETTING_LABELS.SEARCHAPI_BILLING_DAY}
            </label>
            <NumberInput
              name="SEARCHAPI_BILLING_DAY"
              form={form}
              min={1}
              max={28}
              setAside={aside('SEARCHAPI_BILLING_DAY')}
            />
            <SetAsideNote name="SEARCHAPI_BILLING_DAY" setAside={aside('SEARCHAPI_BILLING_DAY')} />
            <FieldError name="SEARCHAPI_BILLING_DAY" form={form} />
          </div>
        ) : null}
      </div>
      <label className="st-check">
        <input
          type="checkbox"
          checked={verification}
          disabled={!canUse && !verification}
          aria-describedby={describedBy(view, form, 'searchapi', ['verification'], !canUse)}
          onChange={(e) => toggle('verification', 'searchapi', e.target.checked)}
        />
        <span>{S.verificationBox}</span>
      </label>
      <label className="st-check">
        <input
          type="checkbox"
          checked={discovery}
          disabled={!canUse && !discovery}
          aria-describedby={describedBy(view, form, 'searchapi', ['discovery'], !canUse)}
          onChange={(e) => toggle('discovery', 'searchapi', e.target.checked)}
        />
        <span>
          {S.discoveryBox} <span className="st-muted">{S.discoveryBoxNote}</span>
        </span>
      </label>
      {canUse ? null : (
        <p id={needsKeyId('searchapi')} className="st-hint">
          {S.needsKey}
        </p>
      )}
      <p className="st-hint">
        {S.creditsPerSearch}{' '}
        <a href={hrefWith(settingsPatch('limits'))} onClick={navigateTo(settingsPatch('limits'))}>
          {S.section.limits}
        </a>
        .
      </p>
    </SourceCard>
  );
}

function Travelpayouts({ view, form, toggle }: CardProps) {
  const providers = useProviders();
  const token = view.secrets.TRAVELPAYOUTS_TOKEN;
  const aside = view.setAside.includes('TRAVELPAYOUTS_TOKEN');
  const saved = token.set && !aside;
  const canUse = form.edited('TRAVELPAYOUTS_TOKEN') ? form.shown('TRAVELPAYOUTS_TOKEN') !== null : saved;
  const on = form.list('discovery').includes('travelpayouts');
  const month = providers.data?.providers
    .find((p) => p.providerId === 'travelpayouts')
    ?.usage.find(
      (u) => u.scope === budgetScopeLabel({ kind: 'provider-month', providerId: 'travelpayouts' }),
    );
  return (
    <SourceCard
      id="travelpayouts"
      title={NAME.travelpayouts}
      meta={S.travelpayoutsMeta}
      control={
        <SourceSwitch
          source={NAME.travelpayouts}
          on={on}
          disabled={!canUse && !on}
          describedBy={describedBy(view, form, 'travelpayouts', ['discovery'], !canUse)}
          onChange={(v) => toggle('discovery', 'travelpayouts', v)}
        />
      }
    >
      <ListLines view={view} form={form} id="travelpayouts" roles={['discovery']} />
      {!token.set ? <p className="st-kv st-muted">{S.travelpayoutsNoKey}</p> : null}
      <SecretField
        name="TRAVELPAYOUTS_TOKEN"
        form={form}
        secret={token}
        setAside={aside}
        onRemove={() => void form.save('sources', { TRAVELPAYOUTS_TOKEN: null })}
      />
      {saved && month !== undefined ? (
        <p className="st-kv st-muted">{S.callsThisMonth(month.calls, month.cap)}</p>
      ) : null}
      {canUse ? null : (
        <p id={needsKeyId('travelpayouts')} className="st-hint">
          {S.needsKey}
        </p>
      )}
    </SourceCard>
  );
}

/**
 * Settings › Price sources (settings plan rulings 8, 9 and 10): the browser, SearchApi and the Aviasales cache, each
 * with its switch for new searches and its own settings, then what applies to every source. A refused source list is
 * said inside each card whose switch or box writes that list, and each of those controls is described by it.
 */
export function PriceSources({ view, form }: Omit<CardProps, 'toggle'>) {
  const toggle: Toggle = (role, id, on) => {
    const now = form.list(role);
    form.setList(role, on ? [...now.filter((x) => x !== id), id] : now.filter((x) => x !== id));
  };
  return (
    <div className="st-sources">
      <Browser view={view} form={form} toggle={toggle} />
      <SearchApi view={view} form={form} toggle={toggle} />
      <Travelpayouts view={view} form={form} toggle={toggle} />
      <EverySource view={view} form={form} />
    </div>
  );
}
