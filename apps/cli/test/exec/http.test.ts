// The CLI's requests to the app: each request's own bound (`timeoutMs`) is the one that ends it. fetch's dispatcher
// has header and body timeouts of its own (undici's, 300 s each by default), below the smoke's wait (600 s and more),
// which once cut a long grid page short. These tests stand in a dispatcher with a small timeout for that default, and a server that
// holds its answer until a second request, made after the first, has run out of that small timeout.
import { once } from 'node:events';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { Agent, type Dispatcher, getGlobalDispatcher, setGlobalDispatcher } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CLIENT_TIMEOUTS_OFF, systemHttp } from '../../src/exec/http.js';

// why: undici's own timers run at about one second's resolution, so the stand-in is not set any smaller
const STAND_IN_MS = 1000;

let server: Server;
let base = '';
let previous: Dispatcher;
let standIn: Agent;

beforeEach(async () => {
  expect.hasAssertions();
  previous = getGlobalDispatcher();
  standIn = new Agent({ headersTimeout: STAND_IN_MS, bodyTimeout: STAND_IN_MS });
  setGlobalDispatcher(standIn);
  server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const a = server.address();
  if (a === null || typeof a === 'string') throw new Error('not listening on TCP');
  base = `http://127.0.0.1:${a.port}`;
});

afterEach(async () => {
  setGlobalDispatcher(previous);
  server.closeAllConnections();
  server.close();
  await standIn.destroy();
});

/** The next request the server holds, with its response not yet written. */
function nextHeld(): Promise<{ req: IncomingMessage; res: ServerResponse }> {
  return new Promise((resolve) => server.once('request', (req, res) => resolve({ req, res })));
}

const post = (timeoutMs: number) =>
  systemHttp({
    method: 'POST',
    url: `${base}/api/tools/smoke`,
    headers: { 'Content-Type': 'application/json' },
    body: '{"route":"LHR-JFK"}',
    timeoutMs,
  });

describe('systemHttp: the request’s own bound is the one that applies', { timeout: 30_000 }, () => {
  it('turns the client’s own timeouts off, not merely up: a 300 s default could not be told apart here', () => {
    expect(CLIENT_TIMEOUTS_OFF).toEqual({ headersTimeout: 0, bodyTimeout: 0 });
  });

  it('answers when the app holds its headers past fetch’s own header timeout', async () => {
    const arrived = nextHeld();
    const page = post(60_000);
    const { req, res } = await arrived;
    expect(req.method).toBe('POST');
    expect(req.headers['content-type']).toBe('application/json');
    req.setEncoding('utf8');
    let sent = '';
    for await (const chunk of req) sent += chunk;
    expect(sent).toBe('{"route":"LHR-JFK"}');
    // why: a second request, made after the first, runs out of the stand-in's header timeout; the first has waited longer
    const canaryArrived = nextHeld();
    const canary = fetch(`${base}/canary`);
    await canaryArrived;
    await expect(canary).rejects.toMatchObject({ cause: { code: 'UND_ERR_HEADERS_TIMEOUT' } });
    res.writeHead(200, { 'Content-Type': 'application/json' }).end('{"exitCode":0}');
    expect(await page).toEqual({ status: 200, body: '{"exitCode":0}' });
  });

  it('answers when the app holds its body past fetch’s own body timeout', async () => {
    const arrived = nextHeld();
    const page = post(60_000);
    const { res } = await arrived;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.write('{"exitCode":');
    const canaryArrived = nextHeld();
    const canary = fetch(`${base}/canary`);
    const held = await canaryArrived;
    held.res.writeHead(200);
    held.res.write('{');
    const answer = await canary;
    await expect(answer.text()).rejects.toMatchObject({ cause: { code: 'UND_ERR_BODY_TIMEOUT' } });
    res.end('0}');
    expect(await page).toEqual({ status: 200, body: '{"exitCode":0}' });
  });

  it('sends no body when the request has none', async () => {
    const arrived = nextHeld();
    const read = systemHttp({
      method: 'GET',
      url: `${base}/api/tools/smoke/plan`,
      headers: {},
      timeoutMs: 60_000,
    });
    const { req, res } = await arrived;
    expect(req.method).toBe('GET');
    expect(req.headers['content-length']).toBeUndefined();
    expect(req.headers['transfer-encoding']).toBeUndefined();
    res.writeHead(200).end('{}');
    expect(await read).toEqual({ status: 200, body: '{}' });
  });

  it('still ends at its own bound: no answer within timeoutMs is a TimeoutError', async () => {
    const arrived = nextHeld();
    const page = post(200);
    await arrived;
    expect(await page).toEqual({ error: 'TimeoutError' });
  });
});
