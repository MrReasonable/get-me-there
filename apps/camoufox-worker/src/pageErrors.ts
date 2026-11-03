import type { Logger } from '@gmt/core';
import type { ContextLike } from './driver.js';

/** A URL, or null when the text is not one (the guard's own reading; kept here so the guard can install this). */
function urlOf(s: string): URL | null {
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

/** The longest console or error text logged; the rest is cut. */
export const PAGE_ERROR_TEXT_MAX = 200;

/** A URL's query and credentials are never logged (spec §14): each `http(s)://` URL in a text keeps its host and path. */
// why: CodeRabbit on PR #39: a URL's user and password are dropped too, and the scheme matches in any case
const URL_IN_TEXT = /(https?:\/\/)(?:[^\s/?#]*@)?([^\s?#]*)(?:[?#]\S*)?/gi;
export const withoutQueries = (text: string): string => text.replace(URL_IN_TEXT, '$1$2');
const cut = (text: string): string => withoutQueries(text).slice(0, PAGE_ERROR_TEXT_MAX);

/**
 * Logs what goes wrong inside the browser's pages, so a page that never finishes (a grid whose prices never arrive,
 * say) can be diagnosed from the worker's log: a request that failed and why, a response of status 400 or more, a
 * console error and an error the page threw. As the guard's refusals: the host at warn, the path without its query at
 * debug, never a URL with its query.
 */
export function logPageErrors(context: ContextLike, log: Logger): void {
  context.on('requestfailed', (r) => {
    const u = urlOf(r.url());
    log.warn(
      { host: u?.hostname ?? 'unparsable', failure: r.failure()?.errorText ?? null },
      'request failed',
    );
    log.debug({ path: u?.pathname ?? 'unparsable' }, 'request failed (path)');
  });
  context.on('response', (r) => {
    const status = r.status();
    if (status < 400) return;
    const u = urlOf(r.url());
    log.warn({ host: u?.hostname ?? 'unparsable', status }, 'response error');
    log.debug({ path: u?.pathname ?? 'unparsable', status }, 'response error (path)');
  });
  context.on('console', (m) => {
    if (m.type() === 'error') log.warn({ text: cut(m.text()) }, 'page console error');
  });
  context.on('weberror', (e) => {
    log.warn({ message: cut(e.error().message) }, 'page error');
  });
}
