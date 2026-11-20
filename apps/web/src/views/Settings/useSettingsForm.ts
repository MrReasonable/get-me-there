import {
  apiContract,
  DEFAULT_CAMOUFOX_BROWSER_WINDOW,
  DEFAULT_DISCOVERY_REFRESH_DAYS,
  DEFAULT_FLIGHT_READ_PATIENCE,
  DEFAULT_SEARCHAPI_BILLING_DAY,
  DEFAULT_SEARCHAPI_PLAN,
  DEFAULT_SMTP_TLS,
  EMAIL_NAMES,
  isOwnedName,
  type OwnedName,
  type ProviderId,
  poundsToPence,
  providerIdSchema,
  settingRefusal,
} from '@gmt/core';
import { useQueryClient } from '@tanstack/react-query';
import { useContext, useEffect, useRef, useState } from 'react';
import { ApiError } from '../../api/client.js';
import { api } from '../../api/endpoints.js';
import { SETTINGS_KEY } from '../../api/queries.js';
import { penceToPoundsInput } from '../../format.js';
import type { SettingsSection } from '../../state/view.js';
import { type RestartClock, RestartClockContext } from './restartClock.js';

type View = apiContract.SettingsView;
type Changes = apiContract.SettingChanges;
/** The operator's edits not saved yet: a name's new value, `null` to unset it; a name absent is unchanged. */
type Draft = Partial<Record<OwnedName, string | null>>;

/** The owned names each section saves (settings plan ruling 14: one Save per section, sending only its changes). */
export const SECTION_NAMES: Readonly<Record<SettingsSection, readonly OwnedName[]>> = {
  sources: [
    'TRAVELPAYOUTS_TOKEN',
    'SEARCHAPI_KEY',
    'SEARCHAPI_PLAN',
    'SEARCHAPI_BILLING_DAY',
    'CAMOUFOX_BROWSER_WINDOW',
    'FLIGHT_READ_PATIENCE',
    'DISCOVERY_REFRESH_DAYS',
    'NEW_SEARCH_DISCOVERY',
    'NEW_SEARCH_VERIFICATION',
  ],
  limits: ['MONTHLY_SPEND_CAP_PENCE', 'EXECUTION_MAX_CALLS'],
  email: EMAIL_NAMES,
  system: [],
};

/**
 * What an unset plain name means, as core's schema defaults it, so a select or a number shows the value in use and
 * choosing it again is no change.
 */
export const SETTING_DEFAULTS: Readonly<Partial<Record<OwnedName, string>>> = {
  SEARCHAPI_PLAN: DEFAULT_SEARCHAPI_PLAN,
  SEARCHAPI_BILLING_DAY: String(DEFAULT_SEARCHAPI_BILLING_DAY),
  CAMOUFOX_BROWSER_WINDOW: DEFAULT_CAMOUFOX_BROWSER_WINDOW,
  FLIGHT_READ_PATIENCE: String(DEFAULT_FLIGHT_READ_PATIENCE),
  DISCOVERY_REFRESH_DAYS: String(DEFAULT_DISCOVERY_REFRESH_DAYS),
  SMTP_TLS: DEFAULT_SMTP_TLS,
};

/**
 * A name typed in one form and stored in another (Global Constraints): the spend limit is typed in pounds and stored in
 * pence, read from the typed string by core's poundsToPence, never through a float. `value` is null for text it refuses.
 */
interface Typed {
  text(stored: string): string;
  value(text: string): string | null;
}
const TYPED: Readonly<Partial<Record<OwnedName, Typed>>> = {
  MONTHLY_SPEND_CAP_PENCE: {
    text: (pence) => (/^\d+$/.test(pence) ? penceToPoundsInput(Number(pence)) : pence),
    value: (text) => {
      const pence = poundsToPence(text.trim());
      return pence === null ? null : String(pence);
    },
  },
};

const SECRETS: ReadonlySet<string> = new Set(apiContract.SECRET_SETTING_NAMES);
export const isSecretName = (name: OwnedName): boolean => SECRETS.has(name);

/** The two source lists a new search starts with (ruling 8), by role. */
export type SourceRole = 'discovery' | 'verification';
export const LIST_NAME: Readonly<Record<SourceRole, OwnedName>> = {
  discovery: 'NEW_SEARCH_DISCOVERY',
  verification: 'NEW_SEARCH_VERIFICATION',
};

/** A source list as the app stores it: the ids in core's order, comma-separated, or `none` for an empty list. */
export function sourceListValue(ids: readonly ProviderId[]): string {
  const ordered = providerIdSchema.options.filter((id) => ids.includes(id));
  return ordered.length === 0 ? 'none' : ordered.join(',');
}

/** A stored source list back to its ids (an unknown entry is dropped: the api refuses it on save anyway). */
export function parseSourceList(value: string | null): ProviderId[] {
  if (value === null || value === 'none') return [];
  return value.split(',').flatMap((part) => {
    const id = providerIdSchema.safeParse(part.trim());
    return id.success ? [id.data] : [];
  });
}

/**
 * What a name holds before any edit: a source list as the effective one `GET /settings` gives (an unset list is the
 * draft it means, ruling 8), a plain name as stored (null when unset), a secret nothing (it is never sent back).
 */
export function originalOf(view: View, name: OwnedName): string | null {
  if (name === 'NEW_SEARCH_DISCOVERY') return sourceListValue(view.newSearchSources.discovery);
  if (name === 'NEW_SEARCH_VERIFICATION') return sourceListValue(view.newSearchSources.verification);
  const plain = apiContract.PLAIN_SETTING_NAMES.find((n) => n === name);
  return plain === undefined ? null : view.values[plain];
}

/** The boot id of a health answer; the page always gets the detailed one, which carries it (ruling 6). */
export function bootIdOf(health: Awaited<ReturnType<typeof api.health>>): string | null {
  return 'bootId' in health ? health.bootId : null;
}

/** The restart's watch (ruling 14): `/api/health` asked this often until a new boot id answers, for this long at most. */
export const RESTART_POLL_MS = 1_000;
export const RESTART_LIMIT_MS = 60_000;

/**
 * Asks `read` for the boot id every RESTART_POLL_MS on `clock` (a failed read is the app restarting, and is asked
 * again; the next ask waits for the last to settle) until it answers one other than `before` ("back"), or
 * RESTART_LIMIT_MS have passed ("not-back"). Returns the cancel.
 */
export function watchRestart(
  before: string,
  read: () => Promise<string | null>,
  done: (outcome: 'back' | 'not-back') => void,
  clock: RestartClock,
): () => void {
  let over = false;
  let cancelPoll: () => void = () => undefined;
  const stop = () => {
    over = true;
    cancelPoll();
    cancelLimit();
  };
  const finish = (outcome: 'back' | 'not-back') => {
    if (over) return;
    stop();
    done(outcome);
  };
  const cancelLimit = clock.after(RESTART_LIMIT_MS, () => finish('not-back'));
  const tick = () => {
    read()
      .then(
        (id) => {
          if (id !== null && id !== before) finish('back');
        },
        // why: while the app restarts it does not answer; that is the wait, not a failure
        () => undefined,
      )
      .finally(() => {
        if (!over) cancelPoll = clock.after(RESTART_POLL_MS, tick);
      });
  };
  cancelPoll = clock.after(RESTART_POLL_MS, tick);
  return stop;
}

/** What the last save said, worded by the page (ruling 14). */
export type SaveResult =
  | { kind: 'saving' }
  | { kind: 'restarting'; warnings: string[] }
  | { kind: 'restarted'; warnings: string[] }
  | { kind: 'not-back'; warnings: string[] }
  | { kind: 'after-runs'; running: string[]; warnings: string[] }
  | { kind: 'unchanged'; warnings: string[] }
  | { kind: 'refused' }
  | { kind: 'no-answer' }
  | { kind: 'failed' };

export interface SettingsForm {
  /** The value a field shows: the edit, else what is stored, else the default; a secret shows only what is typed. */
  shown(name: OwnedName): string | null;
  /** Whether `name` has an edit not saved yet (a secret's typed value or its removal). */
  edited(name: OwnedName): boolean;
  /** Sets a plain field; a value equal to what is in use (the stored one, or the default when unset) is no edit. */
  set(name: OwnedName, value: string | null): void;
  /** A secret typed into its field (an empty field is no edit). */
  type(name: OwnedName, value: string): void;
  /** Drops the edit of `name`. */
  revert(name: OwnedName): void;
  /** A source list's ids as they stand with the edits. */
  list(role: SourceRole): ProviderId[];
  setList(role: SourceRole, ids: readonly ProviderId[]): void;
  /** The changes a section's Save sends: only its names that differ from what is in use. */
  changes(section: SettingsSection): Changes;
  unsaved(section: SettingsSection): boolean;
  /** A 422's words for a field, by owned name. */
  error(name: OwnedName): string | null;
  /** Puts refusals beside their fields, with any already there (a test email's 422 says them as a save's does). */
  refuse(errors: Partial<Record<OwnedName, string>>): void;
  /** Saves `changes` (the section's own by default); the result is in `result`. */
  save(section: SettingsSection, changes?: Changes): Promise<void>;
  result: SaveResult | null;
  /** Counts the saves that stored something, so a key field can close itself after one. */
  saves: number;
}

/**
 * The page's edits, lifted above the sections so they survive a switch between them (ruling 14), and its one save: the
 * boot id read first, `PUT /settings` with only the changed names, then the restart watched until a new boot id
 * answers, or the runs it waits for named. A 422 puts each refusal's words beside its field.
 */
export function useSettingsForm(
  view: View | undefined,
  /** What an unset name means where the running app decides it (the plan's spend limit, its credits a run). */
  inUseDefaults: Readonly<Partial<Record<OwnedName, string>>> = {},
): SettingsForm {
  const qc = useQueryClient();
  const [draft, setDraft] = useState<Draft>({});
  const [errors, setErrors] = useState<Partial<Record<OwnedName, string>>>({});
  const [result, setResult] = useState<SaveResult | null>(null);
  const [saves, setSaves] = useState(0);
  const clock = useContext(RestartClockContext);
  const cancelWatch = useRef<(() => void) | null>(null);
  // why: a save answered after the page has gone must not start a watch or set state (fix round 1, minor 8)
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      cancelWatch.current?.();
    };
  }, []);
  // why: after a save that waited for running searches, the restart shows as `pending` going back to null; the page
  // says so then and reads everything again, as a save that restarted at once does (fix round 1, minor 4)
  const sawPending = useRef(false);
  const pending = view?.pending ?? null;
  useEffect(() => {
    if (result?.kind !== 'after-runs') {
      sawPending.current = false;
      return;
    }
    if (pending !== null) sawPending.current = true;
    else if (sawPending.current) {
      sawPending.current = false;
      setResult({ kind: 'restarted', warnings: result.warnings });
      void qc.invalidateQueries();
    }
  }, [pending, result, qc]);

  const defaultOf = (name: OwnedName): string | null => inUseDefaults[name] ?? SETTING_DEFAULTS[name] ?? null;
  const inUse = (name: OwnedName): string | null =>
    view === undefined ? null : (originalOf(view, name) ?? defaultOf(name));

  const edit = (name: OwnedName, value: string | null | undefined) => {
    setErrors((e) => {
      if (e[name] === undefined) return e;
      const { [name]: _dropped, ...rest } = e;
      return rest;
    });
    setDraft((d) => {
      const { [name]: _old, ...rest } = d;
      return value === undefined ? rest : { ...rest, [name]: value };
    });
  };

  const shown = (name: OwnedName): string | null => {
    if (name in draft) return draft[name] ?? null;
    if (isSecretName(name)) return null;
    const value = inUse(name);
    const typed = TYPED[name];
    return value === null || typed === undefined ? value : typed.text(value);
  };

  const storedOf = (name: OwnedName) => (view === undefined ? null : originalOf(view, name));

  /** Whether `value` is what the name holds now: the stored value, or the default when nothing is stored. */
  const inUseAlready = (name: OwnedName, value: string | null) => {
    const stored = storedOf(name);
    return value === stored || (stored === null && value === defaultOf(name));
  };

  const set = (name: OwnedName, raw: string | null) => {
    // why: a typed name keeps the text as typed ("35.5" is not rewritten to "35.50" under the cursor); whether it
    // differs from what is in use is judged by the value it stores, when the changes are taken
    if (TYPED[name] !== undefined) {
      edit(name, raw);
      return;
    }
    // why: an emptied field is kept as typed (''), so the operator can type a new number into it; it saves as unset
    edit(name, inUseAlready(name, raw) ? undefined : raw);
  };

  const list = (role: SourceRole) => parseSourceList(shown(LIST_NAME[role]));

  /** A section's edits as they would be sent, and the typed names whose text cannot be (money it refuses). */
  const prepared = (section: SettingsSection): { changes: Changes; refused: OwnedName[] } => {
    const out: Changes = {};
    const refused: OwnedName[] = [];
    for (const name of SECTION_NAMES[section]) {
      if (!(name in draft)) continue;
      const raw = draft[name] === '' ? null : (draft[name] ?? null);
      const typed = TYPED[name];
      const value = raw === null || typed === undefined ? raw : typed.value(raw);
      if (raw !== null && value === null) {
        refused.push(name);
        continue;
      }
      // why: typed text that stores the value in use ("35.00" for 3500) is no change
      if (typed !== undefined && value !== null && inUseAlready(name, value)) continue;
      // why: emptying a field that holds nothing stored is no change (it reads the default either way)
      if (value === null && !isSecretName(name) && storedOf(name) === null) continue;
      out[name] = value;
    }
    return { changes: out, refused };
  };
  const changes = (section: SettingsSection): Changes => prepared(section).changes;

  const save = async (section: SettingsSection, given?: Changes) => {
    if (given === undefined) {
      const { refused } = prepared(section);
      // why: text the page cannot read as a value (money poundsToPence refuses) is refused here, in the api's own
      // words (core settingRefusal), and nothing is sent
      if (refused.length > 0) {
        setErrors(
          Object.fromEntries(
            refused.map((name) => [name, settingRefusal(name, { field: name, message: '' })]),
          ),
        );
        setResult({ kind: 'refused' });
        return;
      }
    }
    const body = given ?? changes(section);
    const names = Object.keys(body).filter(isOwnedName);
    if (names.length === 0) {
      setResult({ kind: 'unchanged', warnings: [] });
      return;
    }
    cancelWatch.current?.();
    setResult({ kind: 'saving' });
    let before: string | null;
    try {
      before = bootIdOf(await api.health());
    } catch {
      before = null;
    }
    if (!mounted.current) return;
    // why: without the boot id the page could not tell the restart from the app before it, so it saves nothing
    if (before === null) {
      setResult({ kind: 'no-answer' });
      return;
    }
    let answer: apiContract.SettingsUpdateResponse;
    try {
      answer = await api.saveSettings(body);
    } catch (e) {
      if (!mounted.current) return;
      const refused = e instanceof ApiError && e.status === 422 ? e.fieldErrors() : [];
      if (refused.length > 0) {
        const next: Partial<Record<OwnedName, string>> = {};
        for (const f of refused) if (isOwnedName(f.field)) next[f.field] = f.message;
        setErrors(next);
        setResult({ kind: 'refused' });
      } else if (e instanceof ApiError && e.code === 'network') setResult({ kind: 'no-answer' });
      // why: the api's own message is for its log; the page says it in its own words (fix round 1, minor 9)
      else setResult({ kind: 'failed' });
      return;
    }
    if (!mounted.current) return;
    // why: the saved names are in use now (or will be after the runs); a typed key is cleared from the page at once
    setDraft((d) => {
      const rest: Draft = { ...d };
      for (const name of names) delete rest[name];
      return rest;
    });
    setErrors({});
    const { warnings } = answer;
    if (answer.applies === 'unchanged') {
      setResult({ kind: 'unchanged', warnings });
      return;
    }
    setSaves((n) => n + 1);
    if (answer.applies === 'after-runs') {
      setResult({ kind: 'after-runs', running: answer.running, warnings });
      void qc.invalidateQueries({ queryKey: SETTINGS_KEY });
      return;
    }
    setResult({ kind: 'restarting', warnings });
    cancelWatch.current = watchRestart(
      before,
      async () => bootIdOf(await api.health()),
      (outcome) => {
        cancelWatch.current = null;
        setResult({ kind: outcome === 'back' ? 'restarted' : 'not-back', warnings });
        // why: everything the page reads may differ under the new settings (sources, balance, status)
        if (outcome === 'back') void qc.invalidateQueries();
      },
      clock,
    );
  };

  return {
    shown,
    edited: (name) => name in draft,
    set,
    type: (name, value) => edit(name, value === '' ? undefined : value),
    revert: (name) => edit(name, undefined),
    list,
    setList: (role, ids) => set(LIST_NAME[role], sourceListValue(ids)),
    changes,
    unsaved: (section) => {
      const p = prepared(section);
      return Object.keys(p.changes).length > 0 || p.refused.length > 0;
    },
    error: (name) => errors[name] ?? null,
    // why: a test email's refusals join those a save left, never wiping them (fix round 1, minor 4)
    refuse: (next) => setErrors((e) => ({ ...e, ...next })),
    save,
    result,
    saves,
  };
}
