import json
import socket
import ssl
import time

import wifi

try:
    import secrets
except ImportError:
    secrets = None

badge.mode(HIRES | VSYNC)
screen.antialias = image.X2

WIDTH, HEIGHT = 320, 240
REFRESH_MS = 30000
REQUEST_TIMEOUT = 10
COUNTDOWN_WINDOW = 600

red = color.rgb(205, 24, 35)
yellow = color.rgb(255, 211, 51)
green = color.rgb(40, 190, 95)
white = color.rgb(255, 246, 244)
muted = color.rgb(242, 170, 170)
black = color.rgb(18, 8, 9)

title_font = font.ignore
label_font = font.sins
value_font = font.bacteria

events = []
server_time = None
server_tick = None
valid_until = None
last_fetch = None
fault = None


def setting(name, default=""):
    return str(getattr(secrets, name, default) or default) if secrets else default


def parse_feed(payload):
    if not isinstance(payload, dict):
        raise ValueError("Invalid calendar feed")
    now = payload["now"]
    synced_at = payload["synced_at"]
    expires = payload["valid_until"]
    if not all(type(value) is int for value in (now, synced_at, expires)):
        raise ValueError("Invalid calendar clock")
    if not synced_at <= now < expires <= synced_at + 300:
        raise ValueError("Calendar copy has expired")
    if not isinstance(payload["events"], list):
        raise ValueError("Invalid calendar events")
    parsed = []
    for event in payload["events"]:
        if not isinstance(event, dict):
            raise ValueError("Invalid calendar event")
        if not all(isinstance(event[key], str) for key in ("name", "start_label", "end_label")):
            raise ValueError("Invalid meeting text")
        if type(event["start"]) is not int or type(event["end"]) is not int:
            raise ValueError("Invalid meeting time")
        if event["end"] <= event["start"]:
            raise ValueError("Invalid meeting duration")
        parsed.append(event)
    return now, expires, sorted(parsed, key=lambda event: event["start"])


def get_feed(url, token):
    if not url.startswith("https://"):
        raise ValueError("Calendar feed requires HTTPS")
    address, separator, path = url[8:].partition("/")
    if separator != "/" or path != "events":
        raise ValueError("Calendar URL must end in /events")
    parts = address.split(":")
    host = parts[0]
    port = int(parts[1]) if len(parts) == 2 else 443
    if len(parts) > 2 or not host or not all(
        character.isalnum() or character in ".-" for character in host
    ) or not 1 <= port <= 65535:
        raise ValueError("Invalid calendar host or port")
    if not all(33 <= ord(character) <= 126 for character in token):
        raise ValueError("Invalid calendar feed token")
    if time.gmtime()[0] < 2025:
        raise ValueError("Set badge RTC before connecting")
    context = ssl.SSLContext(ssl.PROTOCOL_TLS_CLIENT)
    context.verify_mode = ssl.CERT_REQUIRED
    with open("/system/calendar-ca.der", "rb") as certificate:
        context.load_verify_locations(cadata=certificate.read())
    connection = socket.socket()
    try:
        connection.settimeout(REQUEST_TIMEOUT)
        connection.connect(socket.getaddrinfo(host, port, 0, socket.SOCK_STREAM)[0][-1])
        connection = context.wrap_socket(connection, server_hostname=host)
        request = (
            "GET /events HTTP/1.1\r\nHost: %s\r\nAuthorization: Bearer %s\r\n"
            "Connection: close\r\n\r\n" % (address, token)
        ).encode()
        sent = 0
        while sent < len(request):
            written = connection.write(request[sent:])
            if not written:
                raise OSError("Calendar connection closed")
            sent += written
        status = connection.readline(1024).split()
        if len(status) < 2 or status[1] != b"200":
            raise OSError("Calendar request failed; check companion and token")
        length = None
        total = 0
        while True:
            line = connection.readline(1024)
            total += len(line)
            if not line or total > 8192:
                raise ValueError("Invalid calendar response headers")
            if line == b"\r\n":
                break
            key, value = line.split(b":", 1)
            if key.lower() == b"content-length":
                length = int(value.strip())
            if key.lower() == b"transfer-encoding":
                raise ValueError("Unsupported calendar transfer encoding")
        if length is None or not 0 < length <= 65536:
            raise ValueError("Invalid calendar response size")
        body = bytearray()
        while len(body) < length:
            chunk = connection.read(min(4096, length - len(body)))
            if not chunk:
                raise OSError("Incomplete calendar response")
            body.extend(chunk)
        return json.loads(body.decode())
    finally:
        connection.close()


def load_calendar():
    global events, server_time, server_tick, valid_until, fault
    url = setting("CALENDAR_FEED_URL").strip()
    token = setting("CALENDAR_FEED_TOKEN").strip()
    if not url:
        raise ValueError("Set Calendar Feed URL in Settings")
    if not token:
        raise ValueError("Set Calendar Feed Token in Settings")
    payload = get_feed(url, token)
    now, expires, parsed = parse_feed(payload)
    events = parsed
    server_time = now
    server_tick = time.ticks_ms()
    valid_until = expires
    fault = "Google sync failed; using cached events" if payload.get("sync_error") else None


def current_time():
    if server_time is None:
        return None
    return server_time + time.ticks_diff(time.ticks_ms(), server_tick) // 1000


def meeting_state(now):
    if now is None:
        return "waiting", None
    if now >= valid_until:
        return "expired", None
    for event in events:
        if event["start"] <= now < event["end"]:
            return "active", event
    for event in events:
        if event["start"] > now:
            state = "countdown" if event["start"] - now <= COUNTDOWN_WINDOW else "upcoming"
            return state, event
    return "empty", None


def fit(text, width, size):
    while text and screen.measure_text(text, font_size=size)[0] > width:
        text = text[:-1]
    return text


def centered(text, y, size, pen=white):
    screen.font = value_font
    screen.pen = pen
    text = fit(text, WIDTH - 24, size)
    width, _ = screen.measure_text(text, font_size=size)
    screen.text(text, (WIDTH - width) / 2, y, size)


def draw_status(pen=muted):
    screen.font = title_font
    screen.pen = pen
    screen.text("CALENDAR", 10, 7)


def draw_name(name, pen=white):
    screen.font = value_font
    for size in (22, 18, 14, 10):
        lines = []
        line = ""
        for word in name.split():
            candidate = (line + " " + word).strip()
            if screen.measure_text(candidate, font_size=size)[0] <= WIDTH - 24:
                line = candidate
            else:
                if line:
                    lines.append(line)
                line = word
        if line:
            lines.append(line)
        if len(lines) <= 2 and all(
            screen.measure_text(line, font_size=size)[0] <= WIDTH - 24 for line in lines
        ):
            break
    for index, line in enumerate(lines[:2]):
        centered(line, 68 + index * 25, size, pen)


def draw_event(event, now):
    active = event["start"] <= now < event["end"]
    if active:
        screen.pen = red
        screen.clear()
        draw_status()
        screen.font = label_font
        screen.pen = white
        screen.text("IN PROGRESS", rect(12, 38, WIDTH - 24, 22), align=image.CENTER)
        draw_name(event["name"])
        screen.font = label_font
        screen.pen = white
        screen.text("START", rect(22, 139, 120, 20), align=image.CENTER)
        screen.text("END", rect(178, 139, 120, 20), align=image.CENTER)
        screen.font = value_font
        screen.text(event["start_label"], rect(22, 160, 120, 42), 22, align=image.CENTER)
        screen.text(event["end_label"], rect(178, 160, 120, 42), 22, align=image.CENTER)
        return

    seconds = max(0, event["start"] - now)
    screen.pen = yellow if seconds <= COUNTDOWN_WINDOW else green
    screen.clear()
    draw_status(black)
    screen.font = label_font
    screen.pen = black
    screen.text("NEXT MEETING", rect(12, 38, WIDTH - 24, 22), align=image.CENTER)
    draw_name(event["name"], black)
    if seconds <= COUNTDOWN_WINDOW:
        centered("%02d:%02d" % (seconds // 60, seconds % 60), 127, 42, black)
        screen.font = label_font
        screen.pen = black
        screen.text("STARTS AT " + event["start_label"],
                    rect(12, 181, WIDTH - 24, 20), align=image.CENTER)
    else:
        centered(event["start_label"] + " - " + event["end_label"], 126, 25, black)
        screen.font = label_font
        screen.pen = black
        screen.text(event.get("start_day", ""),
                    rect(12, 181, WIDTH - 24, 20), align=image.CENTER)


def draw():
    now = current_time()
    state, event = meeting_state(now)
    if event:
        draw_event(event, now)
    else:
        screen.pen = green if state == "empty" else black
        screen.clear()
        draw_status(black if state == "empty" else muted)
        message = {
            "waiting": "Waiting for calendar",
            "expired": "Calendar copy expired",
            "empty": "No upcoming meetings",
        }[state]
        centered(message, 101, 20, black if state == "empty" else muted)
    if fault:
        screen.pen = black
        screen.rectangle(0, 203, WIDTH, 37)
        screen.font = label_font
        screen.pen = white
        screen.text(fault, rect(12, 205, WIDTH - 24, 33), align=image.CENTER)


def update():
    global last_fetch, fault
    if badge.pressed(BUTTON_BACK):
        reset()
        return
    tick = time.ticks_ms()
    if not wifi.is_connected():
        code, message = wifi.status()
        fault = "Wi-Fi: " + message if code < 0 else "Connecting to Wi-Fi"
        wifi.connect()
    elif last_fetch is None or time.ticks_diff(tick, last_fetch) >= REFRESH_MS:
        try:
            load_calendar()
        except (OSError, ValueError, KeyError, TypeError, AttributeError) as error:
            fault = "%s: %s" % (type(error).__name__, error)
            print("Calendar refresh failed:", fault)
        last_fetch = time.ticks_ms()
    draw()


wifi.connect(timeout=10, retries=100000)
run(update)
