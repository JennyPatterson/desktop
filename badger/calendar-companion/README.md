# Calendar companion

This companion runs on your computer, reads Google Calendar with OAuth, and
provides a small authenticated feed for the November badge's Calendar app.
It uses Node.js 22 or newer and has no package dependencies.

## Google setup

Use this only if your workplace permits the integration. A Workspace
administrator may need to approve the OAuth client and its read-only
`calendar.events.readonly` scope. Do not make your work calendar public.

1. In an approved Google Cloud project, enable the Google Calendar API.
2. Configure the OAuth consent screen for your organization. If the application
   is in testing, add your account as a test user.
3. Create an OAuth client of type **Desktop app** and download its JSON file.
4. Put the file in a local `.local` directory beside `server.mjs`, or another
   private location outside version control.

The companion keeps Google access and refresh tokens in memory only. Restarting
it requires signing in again. Google credentials never go to the badge.

## Start the companion

From this directory in PowerShell:

```powershell
New-Item -ItemType Directory -Force .local
$env:GOOGLE_OAUTH_CLIENT_FILE = "$PWD\.local\google-client.json"
$env:BADGER_FEED_TOKEN = node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
node .\server.mjs
```

Open the printed `http://127.0.0.1:8766/login` URL **on the computer running the
companion**, then sign in with your work account and approve the read-only scope.
The OAuth callback is available only on that computer.

By default, the feed also listens only on that computer. To let the badge connect,
configure HTTPS with a certificate for your computer's LAN hostname that the
badge's HTTPS client can validate:

```powershell
$env:BADGER_HOST = "0.0.0.0"
$env:BADGER_TLS_CERT = "$PWD\.local\server-cert.pem"
$env:BADGER_TLS_KEY = "$PWD\.local\server-key.pem"
node .\server.mjs
```

Ask IT about an appropriate certificate and network access. Do not disable
certificate verification or use a public tunnel to expose work meetings.
Allow inbound access to port 8765 only from the badge or a trusted private
network. Work Wi-Fi may isolate devices even when they use the same SSID.
The companion refuses unencrypted LAN access; plain HTTP is available only on
loopback for local development.

Optional environment settings:

| Variable | Default | Purpose |
| --- | --- | --- |
| `GOOGLE_CALENDAR_ID` | `primary` | One calendar your account can read |
| `BADGER_TIME_ZONE` | Computer's time zone | IANA zone for displayed times, including DST |
| `BADGER_PORT` | `8765` | Badge feed port |
| `BADGER_OAUTH_PORT` | `8766` | Local OAuth callback port |

## Badge setup

On the physical badge, configure Wi-Fi and these values in `secrets.py` or
Settings:

```python
CALENDAR_FEED_URL = "https://your-computer-hostname:8765/events"
CALENDAR_FEED_TOKEN = "the value of BADGER_FEED_TOKEN"
```

Copy the issuing CA's public certificate in DER format to
`/system/calendar-ca.der` on the badge (the root of its USB disk). Never copy the
server's private key to the badge. Set the badge's RTC to UTC before connecting,
for example with `mpremote rtc --set` over USB. Repeat after a power loss if the
clock resets. The app requires firmware with `ssl.SSLContext`,
`ssl.CERT_REQUIRED`, and hostname validation; it does not fall back to
unverified TLS. MicroPython's stock `requests` can disable certificate
verification, so this app uses an explicit verified TLS connection instead.

Never commit the real token, OAuth JSON, certificates' private keys, or meeting
data. The repository contains blank configuration placeholders only.

Open **Calendar** on the badge and leave it open. It does not interrupt other
apps. When idle it shows a green screen with the next meeting's name and local
start/end times. During the ten minutes before a meeting it switches to yellow
with a `MM:SS` countdown. From the exact start until the end it shows a red screen
with the meeting name and local start/end times. If there are no upcoming
meetings, it stays green and says so. Long names wrap and shrink to two lines;
names still exceeding the display area are shortened.

The companion refreshes every minute, fetching active meetings and the next
upcoming meetings even when they are more than a day away. The green screen
includes the meeting's date. Google expands recurring events and applies
exceptions and time zones. Cancelled, declined, all-day, and free/transparent
events are excluded. For overlapping meetings the earliest starting active
meeting wins; at its end the next active meeting is shown. A sync reports an
error rather than scanning more than 1,000 entries without finding a timed
upcoming meeting.

The badge polls every 30 seconds. On a connection failure, it continues using
its in-memory event copy and clock for up to five minutes after the last Google
sync, with a visible warning. Once expired, it stops showing meeting state and
asks for a fresh sync. Resetting the badge discards its copy. Keep the companion
running and the computer awake.

## Checks

```powershell
node --test .\calendar.test.mjs
python -B .\test_badge.py
```

Live OAuth, workplace firewall rules, HTTPS certificate support, and the actual
badge display must be checked on the target network and hardware.
