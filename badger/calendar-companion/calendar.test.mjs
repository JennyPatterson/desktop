import assert from 'node:assert/strict';
import { once } from 'node:events';
import http from 'node:http';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { meetingFeed } from './calendar.mjs';
import { authorized, feedHandler, startCompanion } from './server.mjs';

const TOKEN = 'test-only-badge-token-not-a-real-credential';
const SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
const meeting = {
  summary: 'Weekly\nplanning',
  start: { dateTime: '2026-11-04T10:00:00-06:00' },
  end: { dateTime: '2026-11-04T10:30:00-06:00' },
};

test('meeting feed converts instants and formats local times', () => {
  const [event] = meetingFeed([meeting], 0, 'America/Chicago');
  assert.deepEqual(event, {
    name: 'Weekly planning',
    start: Date.parse('2026-11-04T16:00:00Z') / 1000,
    end: Date.parse('2026-11-04T16:30:00Z') / 1000,
    start_label: '10:00',
    end_label: '10:30',
    start_day: 'Wed, 04 Nov 2026',
  });
});

test('local labels follow daylight saving time', () => {
  const [event] = meetingFeed([{
    ...meeting,
    start: { dateTime: '2026-07-04T16:00:00Z' },
    end: { dateTime: '2026-07-04T16:30:00Z' },
  }], 0, 'America/Chicago');
  assert.equal(event.start_label, '11:00');
});

test('excludes cancelled, all-day, free, declined, and ended events', () => {
  const result = meetingFeed([
    meeting,
    { ...meeting, status: 'cancelled' },
    { ...meeting, transparency: 'transparent' },
    { ...meeting, attendees: [{ self: true, responseStatus: 'declined' }] },
    { ...meeting, start: { date: '2026-11-04' }, end: { date: '2026-11-05' } },
  ], Date.parse(meeting.end.dateTime) / 1000, 'UTC');
  assert.deepEqual(result, []);
});

test('sorts unsorted events and rejects malformed meeting times', () => {
  const earlier = {
    ...meeting,
    start: { dateTime: '2026-11-04T09:00:00-06:00' },
    end: { dateTime: '2026-11-04T09:30:00-06:00' },
  };
  const result = meetingFeed([meeting, earlier], 0, 'UTC');
  assert.ok(result[0].start < result[1].start);
  assert.throws(() => meetingFeed([{
    ...meeting, end: { dateTime: 'not-a-date' },
  }], 0, 'UTC'), /invalid meeting times/);
});

test('feed authentication requires the exact bearer token', () => {
  assert.equal(authorized(`Bearer ${TOKEN}`, TOKEN), true);
  assert.equal(authorized(`Bearer ${TOKEN}x`, TOKEN), false);
  assert.equal(authorized(undefined, TOKEN), false);
});

test('HTTP feed denies unauthenticated callers and flags stale copies', async t => {
  let now = 1000;
  const state = { events: [], syncedAt: null, error: null };
  const server = http.createServer(feedHandler(state, TOKEN, () => now));
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(() => server.close());
  const url = `http://127.0.0.1:${server.address().port}/events`;
  assert.equal((await fetch(url)).status, 401);
  const options = { headers: { Authorization: `Bearer ${TOKEN}` } };
  assert.equal((await fetch(url, options)).status, 503);
  state.syncedAt = 1000;
  state.error = 'Google unavailable';
  const response = await fetch(url, options);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.ok(Number(response.headers.get('content-length')) > 0);
  assert.deepEqual(await response.json(), {
    now: 1000, synced_at: 1000, valid_until: 1300, sync_error: true, events: [],
  });
  now = 1300;
  assert.equal((await fetch(url, options)).status, 503);
  assert.equal((await fetch(url.replace('/events', '/wrong'), options)).status, 404);
});

test('companion refuses unencrypted LAN access before loading credentials', async () => {
  await assert.rejects(startCompanion({
    BADGER_HOST: '0.0.0.0',
    BADGER_FEED_TOKEN: TOKEN,
  }), /LAN access requires/);
});

async function availablePort() {
  const server = http.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('OAuth uses PKCE and state; sync refreshes tokens and paginates expanded events', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'badger-oauth-test-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const credentials = join(directory, 'client.json');
  await writeFile(credentials, JSON.stringify({
    installed: { client_id: 'test-client', client_secret: 'test-only-placeholder' },
  }));
  const port = await availablePort();
  let oauthPort = await availablePort();
  while (port === oauthPort) oauthPort = await availablePort();
  const originalFetch = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, options) => {
    const url = new URL(input);
    if (url.hostname === '127.0.0.1') return originalFetch(input, options);
    calls.push({ url, options });
    if (url.hostname === 'oauth2.googleapis.com') {
      if (options.body.get('grant_type') === 'authorization_code') {
        assert.ok(options.body.get('code_verifier'));
        return Response.json({
          access_token: 'test-access', refresh_token: 'test-refresh',
          expires_in: 1, scope: SCOPE,
        });
      }
      assert.equal(options.body.get('refresh_token'), 'test-refresh');
      return Response.json({ access_token: 'test-refreshed-access', expires_in: 3600 });
    }
    assert.equal(url.hostname, 'www.googleapis.com');
    assert.equal(url.searchParams.get('singleEvents'), 'true');
    assert.equal(url.searchParams.get('orderBy'), 'startTime');
    assert.equal(url.searchParams.has('timeMax'), false);
    assert.equal(options.headers.Authorization, 'Bearer test-refreshed-access');
    const start = new Date(Date.now() + 3 * 86400000).toISOString();
    const end = new Date(Date.now() + 3 * 86400000 + 900000).toISOString();
    if (!url.searchParams.has('pageToken')) {
      return Response.json({
        items: [{
          summary: 'All-day entry', start: { date: '2026-11-04' }, end: { date: '2026-11-05' },
        }],
        nextPageToken: 'page-two',
      });
    }
    assert.equal(url.searchParams.get('pageToken'), 'page-two');
    return Response.json({
      items: [{ summary: 'Test meeting', start: { dateTime: start }, end: { dateTime: end } }],
      nextPageToken: 'unneeded-page',
    });
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const companion = await startCompanion({
    GOOGLE_OAUTH_CLIENT_FILE: credentials,
    BADGER_FEED_TOKEN: TOKEN,
    BADGER_PORT: String(port),
    BADGER_OAUTH_PORT: String(oauthPort),
    BADGER_TIME_ZONE: 'America/Chicago',
  });
  t.after(() => companion.close());
  const login = await fetch(`http://127.0.0.1:${oauthPort}/login`, { redirect: 'manual' });
  const authorization = new URL(login.headers.get('location'));
  assert.equal(authorization.searchParams.get('scope'), SCOPE);
  assert.equal(authorization.searchParams.get('code_challenge_method'), 'S256');
  assert.ok(authorization.searchParams.get('code_challenge'));
  const callback = new URL(`http://127.0.0.1:${oauthPort}/callback`);
  callback.search = new URLSearchParams({ state: 'wrong', code: 'test-code' });
  assert.equal((await fetch(callback)).status, 400);
  callback.searchParams.set('state', authorization.searchParams.get('state'));
  assert.equal((await fetch(callback)).status, 200);
  assert.equal(calls.length, 4);
  assert.equal((await fetch(callback)).status, 400);
  const feed = await fetch(`http://127.0.0.1:${port}/events`, {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });
  const payload = await feed.json();
  assert.equal(payload.events[0].name, 'Test meeting');
  assert.equal(payload.sync_error, false);
  assert.equal(payload.valid_until - payload.synced_at, 300);
});
