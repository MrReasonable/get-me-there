import type { OwnedName } from '@gmt/core';
import { useState } from 'react';
import { useBudget, useProviders, useSettings } from '../../api/queries.js';
import { Crumbs } from '../../components/Crumbs.js';
import { LoadError, Loading } from '../../components/LoadState.js';
import { COPY } from '../../copy.js';
import { hrefWith, navigateTo, useSearchParams } from '../../state/urlState.js';
import { navPatch, parseSettingsSection, SECTION_PARAM } from '../../state/view.js';
import { EmailAlerts, type EmailChoice } from './EmailAlerts.js';
import { Limits } from './Limits.js';
import { PriceSources } from './PriceSources.js';
import { SaveBar } from './SaveBar.js';
import { SettingsNav } from './SettingsNav.js';
import { useSettingsForm } from './useSettingsForm.js';
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

/** System is not on this page yet: the status report keeps it until then. */
function NotHereYet() {
  const patch = navPatch('status');
  return (
    <div className="st-card st-src">
      <p>
        {S.notHereYet}{' '}
        <a href={hrefWith(patch)} onClick={navigateTo(patch)}>
          {S.openStatus}
        </a>
      </p>
    </div>
  );
}

/**
 * What an unset limit means is decided by the running app (the SearchApi plan's spend limit and credits a run, else 0),
 * so the page shows the values in use there: the cap from /budget, the credits from the new-search presets.
 */
function useLimitsInUse(): Partial<Record<OwnedName, string>> {
  const budget = useBudget();
  const providers = useProviders();
  return {
    ...(budget.data === undefined ? {} : { MONTHLY_SPEND_CAP_PENCE: String(budget.data.monthlyCapPence) }),
    ...(providers.data === undefined
      ? {}
      : { EXECUTION_MAX_CALLS: String(providers.data.presets.budget.maxCalls) }),
  };
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
  const form = useSettingsForm(settings.data, useLimitsInUse());
  // why: the email form's mode (Gmail or another server) is held here with the edits, so it survives a section switch
  const [emailChoice, setEmailChoice] = useState<EmailChoice | null>(null);
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
          {section === 'system' ? (
            <NotHereYet />
          ) : settings.data === undefined ? (
            settings.error === null ? (
              <Loading />
            ) : (
              <LoadError error={settings.error} retry={() => void settings.refetch()} />
            )
          ) : section === 'sources' ? (
            <>
              <PriceSources view={settings.data} form={form} />
              <SaveBar section={section} form={form} />
            </>
          ) : section === 'limits' ? (
            <>
              <Limits view={settings.data} form={form} />
              <SaveBar section={section} form={form} />
            </>
          ) : (
            <EmailAlerts view={settings.data} form={form} choice={emailChoice} setChoice={setEmailChoice} />
          )}
        </section>
      </div>
    </div>
  );
}
