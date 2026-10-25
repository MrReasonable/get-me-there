import type { apiContract } from '@gmt/core';
import { useEffect, useRef, useState } from 'react';
import { ApiError } from '../api/client.js';
import { useSendTestEmail } from '../api/statusQuery.js';
import { COPY } from '../copy.js';
import { hrefWith, navigateTo } from '../state/urlState.js';

export type StatusCheck = apiContract.StatusCheck;

/** The words a card is labelled by besides its area: a provider card's own name (the browser worker card is its area's). */
export function cardName(c: StatusCheck): string | null {
  return c.area === 'provider' && c.providerId !== null ? COPY.provider[c.providerId] : null;
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
    if (clipboard === undefined) return setState('selected');
    try {
      await clipboard.writeText(command);
      setState('copied');
    } catch {
      setState('selected');
    }
  };
  return (
    <span className="flex flex-wrap items-center gap-2">
      <code className="rounded bg-slate-100 px-1">{command}</code>
      <button
        type="button"
        aria-label={COPY.statusView.copyCommand(command)}
        className="min-h-11 rounded border border-slate-500 px-3 focus-visible:outline focus-visible:outline-2"
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
          className="min-h-11 rounded border border-slate-500 px-2 font-mono"
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
        className="min-h-11 rounded border border-slate-500 px-3 focus-visible:outline focus-visible:outline-2 disabled:opacity-60"
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
  const border =
    check.state === 'fail'
      ? 'border-red-700'
      : check.state === 'warn'
        ? 'border-amber-600'
        : 'border-slate-300';
  return (
    <section aria-label={label} className={`space-y-1 rounded border p-2 text-sm ${border}`}>
      <p>
        <span className="font-semibold">{COPY.statusView.state[check.state]}</span> {check.summary}
      </p>
      {check.note !== null ? (
        <p className="text-slate-700">
          <span className="font-medium">{COPY.statusView.noteLabel}</span> {check.note}
        </p>
      ) : null}
      {check.state !== 'ok' && check.fix !== null ? (
        <div className="space-y-1">
          <p>
            <span className="font-medium">{COPY.statusView.fixLabel}</span> {check.fix.text}
          </p>
          {check.fix.command === null ? null : <FixCommand command={check.fix.command} />}
        </div>
      ) : null}
      {check.area === 'provider' && check.providerId !== null ? (
        <p>
          <a
            href={hrefWith({ view: 'providers' })}
            onClick={navigateTo({ view: 'providers' })}
            className="inline-flex min-h-11 items-center underline"
          >
            {COPY.statusView.providersLink}
          </a>
        </p>
      ) : null}
      {check.area === 'email' && check.state !== 'off' ? <SendTest /> : null}
    </section>
  );
}
