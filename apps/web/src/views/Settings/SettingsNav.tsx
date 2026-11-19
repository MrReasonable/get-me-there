import { COPY } from '../../copy.js';
import { hrefWith, navigateTo } from '../../state/urlState.js';
import { SETTINGS_SECTIONS, type SettingsSection, settingsPatch } from '../../state/view.js';

const S = COPY.settingsView;

/**
 * The Settings page's sections (settings plan ruling 14): a side list on a desktop, one row of links above the section
 * on a phone. Each is a real link (`?view=settings&section=…`), the open one `aria-current="page"`; a section holding
 * edits not saved yet says "unsaved" beside its name.
 */
export function SettingsNav({
  current,
  unsaved,
}: {
  current: SettingsSection;
  unsaved: (section: SettingsSection) => boolean;
}) {
  return (
    <nav aria-label={S.sectionsLabel} className="st-side">
      <ul>
        {SETTINGS_SECTIONS.map((section) => {
          const patch = settingsPatch(section);
          return (
            <li key={section}>
              <a
                href={hrefWith(patch)}
                onClick={navigateTo(patch)}
                aria-current={section === current ? 'page' : undefined}
              >
                {S.section[section]}
                {unsaved(section) ? (
                  <>
                    {' '}
                    <span className="st-unsaved">· {S.unsaved}</span>
                  </>
                ) : null}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
