import { describe, expect, it } from 'vitest';
import { installGuard } from '../src/guard.js';
import { logPageErrors, PAGE_ERROR_TEXT_MAX, withoutQueries } from '../src/pageErrors.js';
import { FakeContext } from './support/fakeContext.js';
import { FakePage } from './support/fakePage.js';
import { memoryLog } from './support/log.js';

const GRID_DATA =
  'https://www.google.com/_/FlightsFrontendUi/data/travel.frontend.flights.FlightsFrontendService/GetCalendarGrid?f.sid=123&bl=x';

const setup = () => {
  const ctx = new FakeContext();
  const log = memoryLog();
  logPageErrors(ctx, log);
  return { ctx, lines: () => log.lines.map((l) => [l.level, l.o, l.msg]) };
};

describe('what fails inside a page is logged (the grid of 2026-11-03, whose prices never arrived)', () => {
  it('a failed request: its host and why at warn, its path without the query at debug', () => {
    const { ctx, lines } = setup();
    ctx.emitRequestFailed({ url: () => GRID_DATA, failure: () => ({ errorText: 'NS_ERROR_NET_RESET' }) });
    ctx.emitRequestFailed({ url: () => 'not a url', failure: () => null });
    expect(lines()).toEqual([
      ['warn', { host: 'www.google.com', failure: 'NS_ERROR_NET_RESET' }, 'request failed'],
      [
        'debug',
        { path: '/_/FlightsFrontendUi/data/travel.frontend.flights.FlightsFrontendService/GetCalendarGrid' },
        'request failed (path)',
      ],
      ['warn', { host: 'unparsable', failure: null }, 'request failed'],
      ['debug', { path: 'unparsable' }, 'request failed (path)'],
    ]);
  });

  it('a response of status 400 or more is logged with its status; 399 and below are not', () => {
    const { ctx, lines } = setup();
    for (const status of [200, 304, 399]) ctx.emitResponse({ url: () => GRID_DATA, status: () => status });
    expect(lines()).toEqual([]);
    ctx.emitResponse({ url: () => GRID_DATA, status: () => 400 });
    ctx.emitResponse({ url: () => 'not a url', status: () => 429 });
    expect(lines()).toEqual([
      ['warn', { host: 'www.google.com', status: 400 }, 'response error'],
      [
        'debug',
        {
          path: '/_/FlightsFrontendUi/data/travel.frontend.flights.FlightsFrontendService/GetCalendarGrid',
          status: 400,
        },
        'response error (path)',
      ],
      ['warn', { host: 'unparsable', status: 429 }, 'response error'],
      ['debug', { path: 'unparsable', status: 429 }, 'response error (path)'],
    ]);
  });

  it('a console error is logged, without any URL query and cut to 200 characters; other console kinds are not', () => {
    const { ctx, lines } = setup();
    ctx.emitConsole({ type: () => 'warning', text: () => 'a warning' });
    ctx.emitConsole({ type: () => 'log', text: () => 'a log line' });
    expect(lines()).toEqual([]);
    ctx.emitConsole({ type: () => 'error', text: () => `Failed to load ${GRID_DATA} (429)` });
    ctx.emitConsole({ type: () => 'error', text: () => 'x'.repeat(300) });
    expect(lines()).toEqual([
      [
        'warn',
        {
          text: 'Failed to load https://www.google.com/_/FlightsFrontendUi/data/travel.frontend.flights.FlightsFrontendService/GetCalendarGrid (429)',
        },
        'page console error',
      ],
      ['warn', { text: 'x'.repeat(PAGE_ERROR_TEXT_MAX) }, 'page console error'],
    ]);
    expect(PAGE_ERROR_TEXT_MAX).toBe(200);
  });

  it('an error the page threw is logged by its message, without any URL query and cut to 200 characters', () => {
    const { ctx, lines } = setup();
    ctx.emitWebError({
      error: () => new TypeError(`cannot read grid from https://www.google.com/x?tfs=abc#h`),
    });
    ctx.emitWebError({ error: () => new Error('y'.repeat(250)) });
    expect(lines()).toEqual([
      ['warn', { message: 'cannot read grid from https://www.google.com/x' }, 'page error'],
      ['warn', { message: 'y'.repeat(200) }, 'page error'],
    ]);
  });

  it('a query or fragment is cut from every http(s) URL in a text, and nothing else changes', () => {
    expect(withoutQueries('a http://a.example/p?q=1 and https://b.example/r#f end')).toBe(
      'a http://a.example/p and https://b.example/r end',
    );
    expect(withoutQueries('no url? here # none')).toBe('no url? here # none');
    expect(withoutQueries('https://c.example/s')).toBe('https://c.example/s');
    // why: CodeRabbit on PR #39: a URL's user and password never reach the log either, whatever the scheme's case
    expect(withoutQueries('see https://user:secret@d.example/p?q=1 there')).toBe(
      'see https://d.example/p there',
    );
    expect(withoutQueries('HTTPS://E.example/p?token=1#f and Http://u@f.example/')).toBe(
      'HTTPS://E.example/p and Http://f.example/',
    );
  });

  it('the guard installs it once per browser context, so every page and the recorder log what failed', async () => {
    const ctx = new FakeContext();
    const log = memoryLog();
    await installGuard(ctx, new FakePage(ctx), log);
    await installGuard(ctx, new FakePage(ctx), log);
    expect(ctx.failedListeners).toHaveLength(1);
    expect(ctx.responseListeners).toHaveLength(1);
    expect(ctx.consoleListeners).toHaveLength(1);
    expect(ctx.webErrorListeners).toHaveLength(1);
    ctx.emitResponse({ url: () => GRID_DATA, status: () => 503 });
    expect(log.lines.map((l) => [l.level, l.msg])).toEqual([
      ['warn', 'response error'],
      ['debug', 'response error (path)'],
    ]);
  });
});
