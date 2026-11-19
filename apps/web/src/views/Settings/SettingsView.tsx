import { useSettings } from '../../api/queries.js';
import { Crumbs } from '../../components/Crumbs.js';
import { LoadError, Loading } from '../../components/LoadState.js';
import { COPY } from '../../copy.js';
import { hrefWith, navigateTo, useSearchParams } from '../../state/urlState.js';
import { navPatch, parseSettingsSection, SECTION_PARAM, type SettingsSection } from '../../state/view.js';
import { PriceSources } from './PriceSources.js';
import { SettingsNav } from './SettingsNav.js';
import { type SaveResult, type SettingsForm, useSettingsForm } from './useSettingsForm.js';
import './settings.css';

const S = COPY.settingsView;

/**
 * The trail on an older Settings page (Providers, Alerts, Status keep their URLs, ruling 14): "Settings › <title>",
 * the first step the Settings page.
 */
export function SettingsCrumbs({ title }: { title: string }) {
  return (
    <Crumbs
      items={[{ label: COPY.crumbs.settings, href: hrefWith(navPatch('settings')) }, { label: title }]}
    />
  );
}

/** The last save's words (ruling 14), with the warnings a save gave (ruling 5). */
function resultWords(r: SaveResult): string {
  switch (r.kind) {
    case 'saving':
      return S.saving;
    case 'restarting':
      return S.restarting;
    case 'restarted':
      return S.restarted;
    case 'not-back':
      return S.notBack;
    case 'after-runs':
      return S.appliesAfter(r.running);
    case 'unchanged':
      return S.unchanged;
    case 'refused':
      return S.refused;
    case 'no-answer':
      return S.noAnswer;
    case 'failed':
      return S.notSaved(r.message);
  }
}

/**
 * The section's one Save and the page's polite live region, which says what the last save did: saving, restarting
 * until the app answers with a new boot id, the runs it waits for, a refusal, or that the app did not come back.
 */
function SaveBar({ section, form }: { section: SettingsSection; form: SettingsForm }) {
  const r = form.result;
  const warnings = r !== null && 'warnings' in r ? r.warnings : [];
  return (
    <div className="st-savebar">
      <div role="status" aria-live="polite" className="st-result">
        {r === null ? null : (
          <p
            className={
              r.kind === 'refused' || r.kind === 'failed' || r.kind === 'not-back' || r.kind === 'no-answer'
                ? 'st-bad'
                : undefined
            }
          >
            {resultWords(r)}
          </p>
        )}
        {warnings.map((w) => (
          <p key={w} className="st-warn">
            <span aria-hidden="true">▲ </span>
            {w}
          </p>
        ))}
      </div>
      <button
        type="button"
        className="st-btn st-btn-primary"
        disabled={r?.kind === 'saving'}
        onClick={() => void form.save(section)}
      >
        {S.save(S.section[section])}
      </button>
    </div>
  );
}

/** A section not on this page yet: its own page keeps it until then. */
function NotHereYet({ section }: { section: Exclude<SettingsSection, 'sources'> }) {
  const link =
    section === 'email'
      ? { patch: navPatch('alerts'), words: S.openAlerts }
      : section === 'system'
        ? { patch: navPatch('status'), words: S.openStatus }
        : null;
  return (
    <div className="st-card st-src">
      <p>
        {S.notHereYet}
        {link === null ? null : (
          <>
            {' '}
            <a href={hrefWith(link.patch)} onClick={navigateTo(link.patch)}>
              {link.words}
            </a>
          </>
        )}
      </p>
    </div>
  );
}

/**
 * The Settings page (UX redesign stage 3, settings plan ruling 14): the sections as links (`section=`), Price sources
 * first; the edits are held here, above the sections, so they survive a switch between them and the side list can mark
 * a section with edits not saved. While a save waits for running searches, every load says so.
 */
export function SettingsView() {
  const params = useSearchParams();
  const section = parseSettingsSection(params.get(SECTION_PARAM));
  const settings = useSettings();
  const form = useSettingsForm(settings.data);
  const pending = settings.data?.pending ?? null;
  // why: the save's own line says it already; the read's is for a load of the page while the restart waits
  const showPending = pending !== null && form.result?.kind !== 'after-runs';
  return (
    <div className="settings">
      <h1 className="st-title">{S.heading}</h1>
      {showPending ? (
        <p role="status" className="st-pending">
          {S.appliesAfter(pending.running)}
        </p>
      ) : null}
      <div className="st-layout">
        <SettingsNav current={section} unsaved={form.unsaved} />
        <section aria-labelledby="settings-section" className="st-section">
          <h2 id="settings-section">{S.section[section]}</h2>
          <p className="st-lede">{S.lede[section]}</p>
          {section === 'sources' ? (
            settings.data === undefined ? (
              settings.error === null ? (
                <Loading />
              ) : (
                <LoadError error={settings.error} retry={() => void settings.refetch()} />
              )
            ) : (
              <>
                <PriceSources view={settings.data} form={form} />
                <SaveBar section={section} form={form} />
              </>
            )
          ) : (
            <NotHereYet section={section} />
          )}
        </section>
      </div>
    </div>
  );
}
