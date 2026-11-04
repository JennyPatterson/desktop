import http from 'node:http';
import https from 'node:https';
import { readFile } from 'node:fs/promises';
import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { meetingFeed } from './calendar.mjs';

const SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly';
const MAX_AGE = 300;

export function authorized(header, token) {
  const actual = Buffer.from(header || '');
  const expected = Buffer.from(`Bearer ${token}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function feedHandler(state, token, now = () => Math.floor(Date.now() / 1000)) {
  return (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json');
    if (!authorized(req.headers.authorization, token)) {
      res.writeHead(401);
      res.end(JSON.stringify({ error: 'Badge access token required' }));
      return;
    }
    if (req.method !== 'GET' || req.url !== '/events') {
      res.writeHead(404);
      res.end(JSON.stringify({ error: 'Not found' }));
      return;
    }
    const timestamp = now();
    if (state.syncedAt === null || timestamp - state.syncedAt >= MAX_AGE) {
      res.writeHead(503);
      res.end(JSON.stringify({ error: 'Calendar sync unavailable; check the companion' }));
      return;
    }
    res.end(JSON.stringify({
      now: timestamp,
      synced_at: state.syncedAt,
      valid_until: state.syncedAt + MAX_AGE,
      sync_error: Boolean(state.error),
      events: state.events,
    }));
  };
}

async function googleJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    throw new Error(`Google request failed (HTTP ${response.status}); check OAuth approval and calendar access`);
  }
  return response.json();
}

async function listen(server, port, host) {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
}

export async function startCompanion(env = process.env) {
  const host = env.BADGER_HOST || '127.0.0.1';
  const port = Number(env.BADGER_PORT || 8765);
  const callbackPort = Number(env.BADGER_OAUTH_PORT || 8766);
  const tlsEnabled = Boolean(env.BADGER_TLS_CERT && env.BADGER_TLS_KEY);
  if (!['127.0.0.1', '::1'].includes(host) && !tlsEnabled) {
    throw new Error('LAN access requires BADGER_TLS_CERT and BADGER_TLS_KEY');
  }
  if (!env.BADGER_FEED_TOKEN || env.BADGER_FEED_TOKEN.length < 32) {
    throw new Error('Set BADGER_FEED_TOKEN to a random access token of at least 32 characters');
  }
  if (!env.GOOGLE_OAUTH_CLIENT_FILE) {
    throw new Error('Set GOOGLE_OAUTH_CLIENT_FILE to your Google Desktop OAuth client JSON');
  }
  if (![port, callbackPort].every(value => Number.isInteger(value) && value > 0 && value <= 65535)
      || port === callbackPort) {
    throw new Error('Feed and OAuth ports must be different valid TCP ports');
  }

  const credentials = JSON.parse(await readFile(env.GOOGLE_OAUTH_CLIENT_FILE, 'utf8')).installed;
  if (!credentials?.client_id || !credentials.client_secret) {
    throw new Error('Use an OAuth client of type Desktop app');
  }
  const redirectUri = `http://127.0.0.1:${callbackPort}/callback`;
  const calendarId = env.GOOGLE_CALENDAR_ID || 'primary';
  const timeZone = env.BADGER_TIME_ZONE || Intl.DateTimeFormat().resolvedOptions().timeZone;
  new Intl.DateTimeFormat('en-GB', { timeZone }).format();
  const state = { events: [], syncedAt: null, error: null };
  let tokens = null;
  let pending = null;
  let syncing = false;

  async function exchange(parameters) {
    return googleJson('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: credentials.client_id,
        client_secret: credentials.client_secret,
        ...parameters,
      }),
    });
  }

  async function sync() {
    if (!tokens || syncing) return;
    syncing = true;
    try {
      if (Date.now() >= tokens.expiresAt - 60000) {
        if (!tokens.refresh_token) throw new Error('Google sign-in expired; sign in again');
        const refreshed = await exchange({
          grant_type: 'refresh_token',
          refresh_token: tokens.refresh_token,
        });
        if (!refreshed.access_token || !refreshed.expires_in) {
          throw new Error('Google returned an incomplete token response');
        }
        tokens = { ...tokens, ...refreshed, expiresAt: Date.now() + refreshed.expires_in * 1000 };
      }
      const now = Math.floor(Date.now() / 1000);
      const items = [];
      let pageToken = '';
      let pages = 0;
      do {
        const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
        url.search = new URLSearchParams({
          timeMin: new Date(now * 1000).toISOString(),
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '50',
          fields: 'items(summary,start,end,status,transparency,attendees(self,responseStatus)),nextPageToken',
          ...(pageToken ? { pageToken } : {}),
        });
        const data = await googleJson(url, {
          headers: { Authorization: `Bearer ${tokens.access_token}` },
        });
        if (data.items !== undefined && !Array.isArray(data.items)) {
          throw new Error('Google returned an invalid events response');
        }
        items.push(...(data.items || []));
        pageToken = data.nextPageToken || '';
        if (meetingFeed(items, now, timeZone).some(event => event.start > now)) break;
        pages++;
        if (pageToken && pages >= 20) throw new Error('Too many calendar entries before the next meeting');
      } while (pageToken);
      state.events = meetingFeed(items, now, timeZone);
      state.syncedAt = now;
      state.error = null;
    } catch (error) {
      state.error = error.message;
      console.error(`Calendar sync failed: ${error.message}`);
    } finally {
      syncing = false;
    }
  }

  const oauth = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const url = new URL(req.url, redirectUri);
    if (req.headers.host !== `127.0.0.1:${callbackPort}` || req.method !== 'GET') {
      res.writeHead(400);
      res.end('Invalid request');
      return;
    }
    if (url.pathname === '/login') {
      const verifier = randomBytes(32).toString('base64url');
      pending = {
        verifier,
        state: randomBytes(32).toString('hex'),
        expiresAt: Date.now() + 10 * 60000,
      };
      const authorization = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authorization.search = new URLSearchParams({
        client_id: credentials.client_id,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: SCOPE,
        access_type: 'offline',
        prompt: 'consent',
        state: pending.state,
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      });
      res.writeHead(302, { Location: authorization.href });
      res.end();
      return;
    }
    if (url.pathname !== '/callback' || !pending || Date.now() > pending.expiresAt
        || url.searchParams.get('state') !== pending.state) {
      res.writeHead(400);
      res.end('Invalid or expired sign-in. Start again at /login.');
      return;
    }
    const attempt = pending;
    pending = null;
    if (url.searchParams.has('error') || !url.searchParams.get('code')) {
      res.writeHead(403);
      res.end('Google sign-in was not approved. Your Workspace administrator may need to allow this client.');
      return;
    }
    try {
      const result = await exchange({
        grant_type: 'authorization_code',
        redirect_uri: redirectUri,
        code: url.searchParams.get('code'),
        code_verifier: attempt.verifier,
      });
      if (!result.access_token || !result.expires_in
          || !result.scope?.split(' ').includes(SCOPE)) {
        throw new Error('Google did not grant the required read-only event access');
      }
      tokens = { ...result, expiresAt: Date.now() + result.expires_in * 1000 };
      await sync();
      if (state.error) throw new Error(state.error);
      res.end('Calendar connected. You can close this tab. Keep the companion running.');
    } catch (error) {
      console.error(`Calendar sign-in failed: ${error.message}`);
      res.writeHead(502);
      res.end('Calendar connection failed. Check the companion console, then try /login again.');
    }
  });

  const handler = feedHandler(state, env.BADGER_FEED_TOKEN);
  const feed = tlsEnabled
    ? https.createServer({
      cert: await readFile(env.BADGER_TLS_CERT),
      key: await readFile(env.BADGER_TLS_KEY),
    }, handler)
    : http.createServer(handler);
  await listen(oauth, callbackPort, '127.0.0.1');
  try {
    await listen(feed, port, host);
  } catch (error) {
    oauth.close();
    throw error;
  }
  const timer = setInterval(sync, 60000);
  console.log(`Sign in on this computer: http://127.0.0.1:${callbackPort}/login`);
  console.log(`Badge feed: ${tlsEnabled ? 'https' : 'http'}://${host}:${port}/events`);
  console.log(`Meeting times use ${timeZone}. OAuth tokens stay in memory; sign in again after restarting.`);
  return {
    close() {
      clearInterval(timer);
      feed.close();
      oauth.close();
      tokens = null;
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startCompanion().then(companion => {
    process.once('SIGINT', () => companion.close());
    process.once('SIGTERM', () => companion.close());
  }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
