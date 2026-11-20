import { useStatus } from '../../api/statusQuery.js';
import { Loading } from '../../components/LoadState.js';
import { StatusLine } from '../../components/StatusCard.js';
import { CheckedLine, failureWords } from '../../components/StatusNotices.js';
import { COPY } from '../../copy.js';
import { useCheckedWords } from '../../hooks/useCheckedWords.js';

/**
 * Settings › System (settings plan ruling 13): the status report's checks one per line (what, words, fix), worst first
 * as the report orders them, refetched as Status is (every 60 s and on focus). It stands on the status query alone, so
 * a failed settings read never hides it. A failed refresh keeps the last report; with none, it says the app is silent.
 */
export function System() {
  const q = useStatus();
  const checked = useCheckedWords(q.data?.generatedAt ?? null);
  if (q.data === undefined) {
    if (!q.error) return <Loading />;
    return (
      <div role="alert" className="st-card st-sys-error">
        <p>{failureWords(q.error)}</p>
        <button type="button" className="st-btn" onClick={() => void q.refetch()}>
          {COPY.retryLoad}
        </button>
      </div>
    );
  }
  return (
    <>
      <div className="st-sys-age">
        <CheckedLine checked={checked} refetchError={q.isRefetchError} />
      </div>
      <div className="st-card">
        <ul aria-label={COPY.settingsView.systemLabel} className="st-sys">
          {q.data.checks.map((c) => (
            <StatusLine key={c.id} check={c} />
          ))}
        </ul>
      </div>
    </>
  );
}
