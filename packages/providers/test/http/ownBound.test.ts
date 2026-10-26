// http-kit's requests end at their own bound (`requestTimeoutSeconds`, spec §5.3) and at no shorter one. Global fetch's
// dispatcher has header and body timeouts of its own (undici's, 300 s each by default), below a grid page's bound
// with many scrolls. These tests stand in a dispatcher with a small timeout for that default, and a worker that holds
// its answer until a second request, made after the first through that stand-in, has run out of its small timeout.
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { passthrough } from 'msw';
import { http } from 'msw/http';
import {
  Agent,
  type Dispatcher,
  getGlobalDispatcher,
  setGlobalDispatcher,
  fetch as undiciFetch,
} from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLIENT_TIMEOUTS_OFF } from '../../src/http/dispatcher.js';
import { makeKit, req, SENTINELS, testLimits } from '../fakes.js';
import { allowLoopbackLookup } from '../support/loopback.js';
import { server as msw } from '../support/msw.js';

// why: undici's own timers run at about one second's resolution, so the stand-in is not set any smaller
const STAND_IN_MS = 1000;

let worker: Server;
let port = 0;
let previous: Dispatcher;
let standIn: Agent;
let restoreLookup: () => void;

beforeEach(async () => {
  expect.hasAssertions();
  previous = getGlobalDispatcher();
  standIn = new Agent({ headersTimeout: STAND_IN_MS, bodyTimeout: STAND_IN_MS });
  setGlobalDispatcher(standIn);
  restoreLookup = allowLoopbackLookup();
  worker = createServer();
  const listening = new Promise<void>((resolve) => worker.once('listening', resolve));
  worker.listen(0, '127.0.0.1');
  await listening;
  const a = worker.address();
  if (a === null || typeof a === 'string') throw new Error('not listening on TCP');
  port = a.port;
  msw.use(http.all(`http://127.0.0.1:${port}/*`, () => passthrough()));
});

afterEach(async () => {
  setGlobalDispatcher(previous);
  restoreLookup();
  worker.closeAllConnections();
  worker.close();
  await standIn.destroy();
});

/** The next request the worker holds, with its response not yet written. */
function nextHeld(): Promise<{ req: IncomingMessage; res: ServerResponse }> {
  return new Promise((resolve) => worker.once('request', (req, res) => resolve({ req, res })));
}

/** One grid page asked of the worker through http-kit, with a bound far above the stand-in's timeout. */
function page() {
  const { kit } = makeKit({
    limits: testLimits({ camoufox: { workerPort: port, requestTimeoutSeconds: 600 } }),
  });
  return kit.request(
    req({
      providerId: 'camoufox',
      url: `http://127.0.0.1:${port}/v1/page`,
      method: 'POST',
      headers: { authorization: `Bearer ${SENTINELS.camoufox.reveal()}`, 'content-type': 'application/json' },
      body: '{}',
    }),
  );
}

/** A request through the stand-in, made now: it fails once the stand-in's timeout has run out. */
const canary = () => undiciFetch(`http://127.0.0.1:${port}/canary`, { dispatcher: standIn });

describe('http-kit: the request’s own bound is the one that applies (spec §5.3)', { timeout: 30_000 }, () => {
  it('turns the client’s own timeouts off, not merely up: a 300 s default could not be told apart here', () => {
    expect(CLIENT_TIMEOUTS_OFF).toEqual({ headersTimeout: 0, bodyTimeout: 0 });
  });

  it('a worker answer whose headers come after fetch’s own header timeout still arrives', async () => {
    const arrived = nextHeld();
    const answer = page();
    const { res } = await arrived;
    const canaryArrived = nextHeld();
    const late = canary();
    await canaryArrived;
    await expect(late).rejects.toMatchObject({ cause: { code: 'UND_ERR_HEADERS_TIMEOUT' } });
    res.writeHead(200, { 'content-type': 'application/json' }).end('{"kind":"cells"}');
    await expect(answer).resolves.toMatchObject({ status: 200, body: { kind: 'cells' } });
  });

  it('a worker answer whose body pauses past fetch’s own body timeout still arrives', async () => {
    const arrived = nextHeld();
    const answer = page();
    const { res } = await arrived;
    res.writeHead(200, { 'content-type': 'application/json' });
    res.write('{"kind":');
    const canaryArrived = nextHeld();
    const late = canary();
    const held = await canaryArrived;
    held.res.writeHead(200);
    held.res.write('{');
    const lateAnswer = await late;
    await expect(lateAnswer.text()).rejects.toMatchObject({ cause: { code: 'UND_ERR_BODY_TIMEOUT' } });
    res.end('"cells"}');
    await expect(answer).resolves.toMatchObject({ status: 200, body: { kind: 'cells' } });
  });
});
