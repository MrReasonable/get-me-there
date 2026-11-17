import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/endpoints.js';
import { alertKeys } from '../../../api/queries.js';
import { useStatus } from '../../../api/statusQuery.js';
import type { DefinitionResponse } from '../../../api/types.js';
import { LoadError } from '../../../components/LoadState.js';
import { COPY } from '../../../copy.js';
import { navigateToQuery } from '../../../state/urlState.js';
import { describeRule } from '../../Alerts/ruleText.js';
import { Fold } from './Fold.js';

const F = COPY.searchPage.folds;

/**
 * Ruling 19, "Alert": off, or N on; each of this search's rules in words (a rule switched off is not on, so it is not
 * listed), what alerts watch, "Change alerts", and, from the status report, that email isn't set up yet. A "Turn on"
 * for read trips waits for stage 4.
 */
export function AlertFold({
  definition,
  requested,
  onHandled,
}: {
  definition: DefinitionResponse;
  requested: boolean;
  onHandled: () => void;
}) {
  const rules = useQuery({
    queryKey: alertKeys.rules(definition.id),
    queryFn: () => api.alertRules(definition.id),
  });
  const status = useStatus();
  const on = (rules.data ?? []).filter((r) => r.enabled);
  const emailNotSetUp = (status.data?.checks ?? []).some(
    (c) => c.area === 'email' && c.offReason === 'not-set-up',
  );
  const alertsQuery = `?view=alerts&def=${encodeURIComponent(definition.id)}`;
  const statusQuery = '?view=status';
  return (
    <Fold
      id="alert"
      title={F.alert}
      state={rules.data === undefined ? null : on.length === 0 ? F.alertOff : F.alertOn(on.length)}
      requested={requested}
      onHandled={onHandled}
    >
      {rules.error ? (
        <LoadError error={rules.error} retry={() => void rules.refetch()} />
      ) : on.length === 0 ? (
        rules.data === undefined ? null : (
          <p>{F.alertNone}</p>
        )
      ) : (
        <ul className="sfold-rules">
          {on.map((r) => (
            // why: decision 55 — a rule's threshold is a price quoted in text, which the rendered sweep allows inside [data-quote]
            <li key={r.id} data-quote>
              {describeRule(r, true)}
            </li>
          ))}
        </ul>
      )}
      {/* why: final review M6: the line speaks of the rules listed, so it shows only when there is one and every one
      watches calendar prices */}
      {on.length > 0 && on.every((r) => r.basis === 'calendar') ? (
        <p className="sfold-note">{F.alertWatches}</p>
      ) : null}
      <p className="sfold-note">
        <a href={alertsQuery} onClick={navigateToQuery(alertsQuery)}>
          {F.changeAlerts}
        </a>
      </p>
      {emailNotSetUp ? (
        <p className="sfold-note">
          <span>{F.emailNotSet}</span>
          {': '}
          <a href={statusQuery} onClick={navigateToQuery(statusQuery)}>
            {F.emailSetUp}
          </a>
          .
        </p>
      ) : null}
    </Fold>
  );
}
