import { Crumbs } from '../../components/Crumbs.js';
import { COPY } from '../../copy.js';
import { hrefWith, navigateTo } from '../../state/urlState.js';
import { navPatch, type ViewId } from '../../state/view.js';

const S = COPY.settingsView;

/** The Settings page's sections, in order: each opens one of the older views, which keep their own URLs. */
const SECTIONS: readonly { view: ViewId; title: string; line: string }[] = [
  { view: 'providers', title: COPY.crumbs.priceSources, line: S.priceSources },
  { view: 'alerts', title: COPY.crumbs.alerts, line: S.alerts },
  { view: 'status', title: COPY.crumbs.system, line: S.system },
];

/**
 * The trail on a Settings section: "Settings › Price sources | Alerts | System" (Ruling 12), the first step the
 * Settings page. `title` is the section's own name, the page.
 */
export function SettingsCrumbs({ title }: { title: string }) {
  return (
    <Crumbs
      items={[{ label: COPY.crumbs.settings, href: hrefWith(navPatch('settings')) }, { label: title }]}
    />
  );
}

/**
 * The interim Settings page (Ruling 9): three linked sections, each with one line of what is there. Stage 3 replaces
 * it; until then the older views keep rendering at their URLs, headed "Price sources", "Alerts" and "System".
 */
export function SettingsView() {
  return (
    <div className="settings">
      <h1 className="settings-title">{S.heading}</h1>
      <p className="settings-lede">{S.lede}</p>
      <ul aria-label={S.sectionsLabel} className="settings-sections">
        {SECTIONS.map((s) => {
          const patch = navPatch(s.view);
          return (
            <li key={s.view}>
              <section aria-labelledby={`settings-${s.view}`} className="settings-card">
                <h2 id={`settings-${s.view}`} className="settings-card-title">
                  <a
                    href={hrefWith(patch)}
                    onClick={navigateTo(patch)}
                    className="inline-flex min-h-11 items-center"
                  >
                    {s.title}
                  </a>
                </h2>
                <p>{s.line}</p>
              </section>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
