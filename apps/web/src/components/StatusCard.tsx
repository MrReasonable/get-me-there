import { type apiContract, DETAIL_LINK_PARAMS } from '@gmt/core';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useSendTestEmail } from '../api/statusQuery.js';
import { COPY } from '../copy.js';
import { DATES_COVERAGE } from '../state/resultsState.js';
import { hrefWith, navigateTo } from '../state/urlState.js';

export type StatusCheck = apiContract.StatusCheck;

/** Each state's tag ink: white ok, amber to check, red failing, dim off; the state's word is always written in it. */
const STATE_TAG: Readonly<Record<StatusCheck['state'], string>> = {
  ok: '',
  warn: 'tag-warn',
  fail: 'tag-bad',
  off: 'tag-dim',
};

/** The words a card is labelled by besides its area: a provider's own name, or a search's name (V11); else none. */
export function cardName(c: StatusCheck): string | null {
  if (c.area === 'provider' && c.providerId !== null) return COPY.provider[c.providerId];
  return c.label;
}

/**
 * A data card's search opened on the Dates view with its coverage section open (spec §11 Status; WP19 Task 19.7), by
 * the definition id its check id carries (`data-<id>`); null for any other card.
 */
function coveragePatch(c: StatusCheck): Record<string, string | null> | null {
  return c.area === 'data' && c.id.startsWith('data-')
    ? { [DETAIL_LINK_PARAMS.view]: 'dates', [DETAIL_LINK_PARAMS.def]: c.id.slice(5), ...DATES_COVERAGE }
    : null;
}

/**
 * A fix command with a button that copies exactly the command and confirms "Copied". Where the clipboard is unavailable
 * (a page served over plain HTTP is not a secure context) or refuses, the command is shown selected instead, ready for
 * the person's own copy.
 */
function FixCommand({ command }: { command: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'selected'>('idle');
  const field = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (state === 'selected') {
      field.current?.focus();
      field.current?.select();
    }
  }, [state]);
  const copy = async () => {
    const clipboard = typeof navigator === 'undefined' ? undefined : navigator.clipboard;
    if (clipboard === undefined) return reselect();
    try {
      await clipboard.writeText(command);
      setState('copied');
    } catch {
      reselect();
    }
  };
  // why: pressing Copy again in the selected state selects the field again, even though the state does not change
  const reselect = () => {
    setState('selected');
    field.current?.focus();
    field.current?.select();
  };
  return (
    <span className="flex flex-wrap items-center gap-2">
      <code className="cmd">{command}</code>
      <button
        type="button"
        aria-label={COPY.statusView.copyCommand(command)}
        className="btn btn-sm min-h-11"
        onClick={() => void copy()}
      >
        {COPY.statusView.copy}
      </button>
      {state === 'copied' ? <span role="status">{COPY.statusView.copied}</span> : null}
      {state === 'selected' ? (
        <input
          ref={field}
          readOnly
          value={command}
          size={Math.max(20, command.length)}
          aria-label={COPY.statusView.selectedInstead(command)}
          className="input min-h-11 max-w-full font-mono"
        />
      ) : null}
    </span>
  );
}

/** The email card's "Send test": disabled while sending, with a distinct message for each outcome (spec §11 Status). */
function SendTest() {
  const send = useSendTestEmail();
  let message: string | null = null;
  if (send.isSuccess)
    message = send.data.result === 'sent' ? COPY.statusView.testSent : COPY.statusView.testFailed;
  else if (send.error instanceof ApiError)
    message =
      send.error.status === 409
        ? COPY.statusView.testNotConfigured
        : send.error.status === 429
          ? COPY.statusView.testLimit
          : COPY.statusView.testFailedCall(send.error.message);
  else if (send.error) message = COPY.statusView.testFailedCall(send.error.message);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        className="btn btn-sm min-h-11"
        disabled={send.isPending}
        aria-busy={send.isPending ? true : undefined}
        onClick={() => send.mutate()}
      >
        {send.isPending ? COPY.statusView.sending : COPY.statusView.sendTest}
      </button>
      {message === null ? null : <span role="status">{message}</span>}
    </div>
  );
}

/**
 * One check of the report as a labelled region (spec §11 Status). The state is written as text before the summary, never
 * colour alone. A card that is not ok shows its fix; a note shows on any card; a provider card links to the Providers
 * view, whose usage wording its summary reuses; the email card carries "Send test".
 */
export function StatusCard({ check }: { check: StatusCheck }) {
  const label = COPY.statusView.cardLabel(COPY.statusView.areaName[check.area], cardName(check));
  const coverage = coveragePatch(check);
  return (
    <section aria-label={label} data-state={check.state} className="plate status-card space-y-2 text-[15px]">
      {/* why: a search's card is named by its search; the name is shown, not only in the region's label (critique) */}
      {check.area === 'data' && check.label !== null ? <h4 className="h-sub">{check.label}</h4> : null}
      <p>
        <span className={`tag mr-2 ${STATE_TAG[check.state]}`}>{COPY.statusView.state[check.state]}</span>{' '}
        {check.summary}
      </p>
      {check.note !== null ? (
        <p className="text-fg-2">
          <span className="font-medium">{COPY.statusView.noteLabel}</span> {check.note}
        </p>
      ) : null}
      {check.state !== 'ok' && check.fix !== null ? (
        <div className="space-y-1">
          <p>
            <span className="font-bold">{COPY.statusView.fixLabel}</span> {check.fix.text}
          </p>
          {/* why: V11 (ui-b1-005): keyed by the command, so "Copied" never outlives the command it was for */}
          {check.fix.command === null ? null : (
            <FixCommand key={check.fix.command} command={check.fix.command} />
          )}
        </div>
      ) : null}
      {coverage !== null ? (
        <p>
          <a href={hrefWith(coverage)} onClick={navigateTo(coverage)} className="link">
            {COPY.statusView.coverageLink}
          </a>
        </p>
      ) : null}
      {check.area === 'provider' && check.providerId !== null ? (
        <p>
          <a
            href={hrefWith({ view: 'providers' })}
            onClick={navigateTo({ view: 'providers' })}
            className="link"
          >
            {COPY.statusView.providersLink}
          </a>
        </p>
      ) : null}
      {check.area === 'email' && check.state !== 'off' ? <SendTest /> : null}
    </section>
  );
}
