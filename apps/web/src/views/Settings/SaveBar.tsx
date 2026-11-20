import type { ReactNode } from 'react';
import { COPY } from '../../copy.js';
import type { SettingsSection } from '../../state/view.js';
import type { SaveResult, SettingsForm } from './useSettingsForm.js';

const S = COPY.settingsView;

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
      return S.failed;
  }
}

/**
 * The section's one Save and the page's polite live region, which says what the last save did: saving, restarting
 * until the app answers with a new boot id, the runs it waits for, a refusal, or that the app did not come back.
 */
export function SaveBar({
  section,
  form,
  extra,
}: {
  section: SettingsSection;
  form: SettingsForm;
  /** A button that sits before Save (Email's "Send a test email"). */
  extra?: ReactNode;
}) {
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
      {extra}
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
