import os
import gc
import json
import math
import random
import sys

APP_DIR = "/system/apps/badge"
sys.path.insert(0, APP_DIR)

import fetch
import wifi
import machine
import missing_details
from badgeware import link as badgelink
import branding as brand

try:
    import secrets
except ImportError:
    secrets = None

badge.mode(HIRES | VSYNC)
screen.antialias = image.X2

phosphor = brand.orange_accent
white = brand.white
faded = brand.muted
spinner = color.rgb(255, 174, 45, 70)

body_font, title_font = brand.fonts()

HANDLE_SIZE = 21
NAME_SIZE = 15
VALUE_SIZE = 23
LABEL_SIZE = 12
NUDGE_SIZE = 14
NUDGE_RECT = (160, 95, 144, 123)

CONTRIB_URL = "https://github.com/{user}.contribs"
USER_AVATAR = "https://wsrv.nl/?url=https://github.com/{user}.png&w=150&output=png"
DETAILS_URL = "https://api.github.com/users/{user}"

CACHE_DIR = "/state"
USER_FILE = f"{CACHE_DIR}/badge_user.json"
CONTRIB_FILE = f"{CACHE_DIR}/badge_contribs.json"
AVATAR_FILE = f"{CACHE_DIR}/badge_avatar.png"

HEADERS = {"User-Agent": "GitHub Universe Badge 2026"}

RETRY_MS = 30000
WIFI_TIMEOUT_MS = 10000

fetch.AsyncFetch.MAX_HEADER_BYTES = 8192

GRAPH_WEEKS = 53
GRAPH_DAYS = 7
TILE_SIZE = 20
TILE_STEP = 23
GRAPH_TOP = brand.HEADER_HEIGHT + 4
PARALLAX_SHIFT = 8
AVATAR_SIZE = 128
AVATAR_X = 18
AVATAR_Y = 90

# /system is the disk exposed over USB, with secrets.py at its root.
SOCIAL_FILE = "/system/arm_badge_socials.json"
SOCIALS_PER_PAGE = 4
SOCIAL_NETWORKS = (
    ("github", "GitHub"),
    ("bluesky", "Bluesky"),
    ("mastodon", "Mastodon"),
    ("linkedin", "LinkedIn"),
    ("instagram", "Instagram"),
    ("discord", "Discord"),
    ("twitter", "X / Twitter"),
    ("youtube", "YouTube"),
    ("website", "Website"),
)

try:
    os.mkdir(CACHE_DIR)
except OSError:
    pass


class Tilt:
    GRAVITY = 16384.0
    SMOOTH_MS = 120
    RECENTRE_MS = 2800

    def __init__(self):
        self.x = 0.0
        self.y = 0.0
        self.rest_z = None
        self.last_ticks = None

    def update(self):
        ax, _, az = badge.imu()[:3]
        now = badge.ticks
        dt = min(now - self.last_ticks, 200) if self.last_ticks is not None else 0
        self.last_ticks = now
        smooth = 1 - math.exp(-dt / self.SMOOTH_MS)
        recentre = 1 - math.exp(-dt / self.RECENTRE_MS)
        if self.rest_z is None:
            self.rest_z = az
        self.rest_z += (az - self.rest_z) * recentre
        target_x = max(-1.0, min(1.0, -ax / self.GRAVITY * 2))
        target_y = max(-1.0, min(1.0, (az - self.rest_z) / self.GRAVITY * 2))
        self.x += (target_x - self.x) * smooth
        self.y += (target_y - self.y) * smooth


tilt = Tilt()


def fake_number():
    return random.randint(10000, 99999)


def placeholder_if_none(text):
    if text:
        return text
    random.seed(badge.ticks // 100)
    chars = "!\"£$%^&*()_+-={}[]:@~;'#<>?,./\\|"
    return "".join(random.choice(chars) for _ in range(20))


class Download:
    def __init__(self, url, file, force_update):
        self.file = file
        self.temp_file = file + ".tmp"
        self.request = None
        if force_update or not file_exists(file):
            self.request = fetch.url(url, headers=HEADERS).to(self.temp_file)

    def ready(self):
        if self.request is None:
            return True
        if self.request:
            os.rename(self.temp_file, self.file)
            self.request = None
            return True
        return False

    @property
    def state(self):
        if self.request is None:
            return None
        return self.request.state

    @property
    def error(self):
        if self.request is None:
            return None
        return self.request.error


class User:
    levels = [
        color.rgb(0, 43, 73, 40),
        color.rgb(0, 145, 189, 55),
        color.rgb(0, 193, 222, 65),
        color.rgb(242, 100, 25, 75),
        color.rgb(255, 174, 45, 100),
    ]

    def __init__(self, handle):
        self.handle = handle
        self.tile = shape.rounded_rectangle(0, 0, TILE_SIZE, TILE_SIZE, 4)
        self.update()

    def update(self, force_update=False):
        self.name = None
        self.followers = None
        self.contribs = None
        self.contribution_data = None
        self.repos = None
        self.avatar = None
        self._download = None
        self._force_update = force_update
        self._error = None
        self._retry_at = 0
        self._wifi_started = None
        self.missing = []

    def load_user_data(self):
        with open(USER_FILE, "r") as f:
            data = json.load(f)
        if data["login"].lower() != self.handle.lower():
            self.update(True)
            return
        self.name = data["name"] or data["login"]
        self.handle = data["login"]
        self.followers = data["followers"]
        self.repos = data["public_repos"]
        del data
        gc.collect()

    def load_contrib_data(self):
        with open(CONTRIB_FILE, "r") as f:
            data = json.load(f)
        self.contribs = data["total_contributions"]
        self.contribution_data = [[0 for _ in range(GRAPH_WEEKS)] for _ in range(GRAPH_DAYS)]
        for week_index, week in enumerate(data["weeks"][:GRAPH_WEEKS]):
            for day, contribution in enumerate(week["contribution_days"][:GRAPH_DAYS]):
                self.contribution_data[day][week_index] = contribution["level"]
        del data
        gc.collect()

    def load_avatar(self):
        self.avatar = image.load(AVATAR_FILE)

    def next_download(self):
        if self.name is None:
            return "fetching user data...", DETAILS_URL, USER_FILE, self.load_user_data
        if self.contribs is None:
            return "fetching contribs...", CONTRIB_URL, CONTRIB_FILE, self.load_contrib_data
        if self.avatar is None:
            return "fetching avatar...", USER_AVATAR, AVATAR_FILE, self.load_avatar
        return None

    def fail(self, error):
        print(f"Badge: {error}")
        self._error = error
        self._retry_at = badge.ticks + RETRY_MS
        self._download = None

    def connect_step(self):
        # fetch.url calls wifi.connect() when pumped. Keep that call behind a
        # connection check: wifi's exhausted retries open a fatal error card.
        # Association progresses on the radio without pumping wifi.connect().
        try:
            if wifi.is_connected():
                self._wifi_started = None
                return True
            if self._wifi_started is None:
                wifi.disconnect()
                wifi.connect(timeout=WIFI_TIMEOUT_MS // 1000, retries=1)
                self._wifi_started = badge.ticks
                return False
            code, _ = wifi.status()
            if code < 0 or badge.ticks - self._wifi_started >= WIFI_TIMEOUT_MS:
                wifi.disconnect()
                self._wifi_started = None
                self.fail("WiFi unavailable")
        except OSError as error:
            print(f"Badge WiFi: {error}")
            try:
                wifi.disconnect()
            except OSError:
                pass
            self._wifi_started = None
            self.fail("WiFi unavailable")
        return False

    def fetch_step(self):
        if self._error:
            if badge.ticks < self._retry_at:
                return "offline - retrying..." if self.offline else "fetch failed, retrying..."
            self._error = None

        pending = self.next_download()
        if pending is None:
            return None

        label, url, file, load = pending

        if self._download is None or self._download.file != file:
            if self._force_update or not file_exists(file):
                self.missing = missing_details.missing("WIFI_SSID")
                if self.missing:
                    return label
            self._download = Download(url.format(user=self.handle), file, self._force_update)

        if self._download.request is not None and not self.connect_step():
            return "offline - retrying..." if self.failed else "connecting to WiFi..."

        if self._download.ready():
            self._download = None
            try:
                load()
            except (OSError, ValueError, KeyError) as e:
                os.remove(file)
                self.fail(e)
            return label

        if self._download.error:
            self.fail(self._download.error)
            return label

        return self._download.state if self._download.state not in ("Idle", "Fetching") else label

    @property
    def loaded(self):
        return self.name is not None

    @property
    def failed(self):
        return self._error is not None

    @property
    def offline(self):
        return self._error == "WiFi unavailable"

    def draw_stat(self, title, value, x, y):
        screen.font = title_font
        screen.pen = white if value else faded
        if value is not None:
            text = str(value)
        elif self.failed:
            text = "-"
        else:
            text = str(fake_number())
        screen.text(text, x, y, VALUE_SIZE)
        screen.font = body_font
        screen.pen = phosphor
        screen.text(title, x, y + VALUE_SIZE + 2, LABEL_SIZE)

    def draw_graph(self):
        graph_width = GRAPH_WEEKS * TILE_STEP
        travel = (graph_width - screen.width) / 2
        offset_x = int(-math.sin(badge.ticks / 5000) * travel + travel + tilt.x * PARALLAX_SHIFT)
        offset_y = GRAPH_TOP - int(tilt.y * PARALLAX_SHIFT)

        for y in range(GRAPH_DAYS):
            for x in range(GRAPH_WEEKS):
                pos_x = x * TILE_STEP - offset_x
                if pos_x + TILE_SIZE < 0 or pos_x > screen.width:
                    continue
                level = self.contribution_data[y][x] if self.contribution_data else 1
                screen.pen = User.levels[level]
                self.tile.transform = mat3().translate(pos_x, y * TILE_STEP + offset_y)
                screen.shape(self.tile)

    def draw_avatar(self):
        if self.avatar:
            screen.blit(self.avatar, rect(AVATAR_X, AVATAR_Y, AVATAR_SIZE, AVATAR_SIZE))
            return
        if self.offline:
            badgelink.draw_identicon(screen, badge_id, AVATAR_X, AVATAR_Y, AVATAR_SIZE)
            return

        squircle = shape.squircle(0, 0, 20, 5)
        screen.pen = spinner
        for i in range(4):
            mul = math.sin(badge.ticks / 1000) * 14000
            squircle.transform = mat3().translate(AVATAR_X + AVATAR_SIZE / 2,
                                                  AVATAR_Y + AVATAR_SIZE / 2).rotate((badge.ticks + i * mul) / 40).scale(1 + i / 1.3)
            screen.shape(squircle)

    def draw(self, status):
        self.draw_graph()

        screen.font = title_font
        screen.pen = white
        center_text(self.handle, 42, HANDLE_SIZE)

        screen.font = body_font
        screen.pen = phosphor
        center_text(placeholder_if_none(self.name), 67, NAME_SIZE)

        self.draw_stat("followers", self.followers, 160, 89)
        self.draw_stat("contribs", self.contribs, 160, 127)
        self.draw_stat("repos", self.repos, 160, 165)

        if status:
            screen.font = body_font
            screen.pen = faded
            text, size = fit_line(status, 144, 12)
            screen.text(text, 160, 207, size)

        self.draw_avatar()


def center_text(text, y, size):
    w, _ = screen.measure_text(text, font_size=size)
    if w > screen.width - 16:
        size = size * (screen.width - 16) / w
        w = screen.width - 16
    screen.text(text, screen.width / 2 - w / 2, y, size)


def setting(key):
    return str(getattr(secrets, key, "") or "").strip()


def linkedin_label(url):
    if not url:
        return ""
    path = url.split("://")[-1]
    if path.startswith("www."):
        path = path[4:]
    return path.rstrip("/")


def fit_line(text, width, size=18):
    while size > 12 and screen.measure_text(text, font_size=size)[0] > width:
        size -= 1
    if screen.measure_text(text, font_size=size)[0] > width:
        while text and screen.measure_text(text + "...", font_size=size)[0] > width:
            text = text[:-1]
        text += "..."
    return text, size


def load_socials():
    # Personal configuration is optional and is never part of the installer
    # payload. Existing GitHub/LinkedIn settings remain useful without it.
    values = {"github": setting("GITHUB_USERNAME"),
              "linkedin": setting("CONTACT_LINKEDIN")}
    error = None
    try:
        with open(SOCIAL_FILE, "r") as stream:
            source = stream.read(4097)
        if len(source) > 4096:
            raise ValueError("Social configuration is too large")
        configured = json.loads(source)
        if not isinstance(configured, dict):
            raise ValueError("Social configuration must be an object")
        for key, _ in SOCIAL_NETWORKS:
            if key not in configured:
                continue
            value = configured[key]
            if not isinstance(value, str) or len(value) > 200:
                error = "Check the social links file."
                continue
            values[key] = value.strip()
    except OSError as reason:
        if reason.args and reason.args[0] != 2:
            error = "Check the social links file."
    except ValueError:
        error = "Check the social links file."

    rows = []
    for key, label in SOCIAL_NETWORKS:
        value = values.get(key, "")
        if not value:
            continue
        if key == "github" and "://" not in value and "/" not in value:
            value = "@" + value.lstrip("@")
        else:
            value = linkedin_label(value)
        rows.append((label, value))
    return rows, error


handle = setting("GITHUB_USERNAME")
contact_name = setting("CONTACT_NAME")
linkedin = linkedin_label(setting("CONTACT_LINKEDIN"))
user = User(handle)
badge_id = bytes(machine.unique_id())[:badgelink.ID_LEN]
socials, social_error = load_socials()
page_count = 1 + max(1, (len(socials) + SOCIALS_PER_PAGE - 1) // SOCIALS_PER_PAGE)
page = 0


def draw_simple(status):
    user.draw_graph()
    screen.font = title_font
    screen.pen = white
    center_text(contact_name or handle or linkedin, 42, HANDLE_SIZE)
    details = []
    if handle and contact_name:
        details.append("@" + handle)
    screen.font = body_font
    screen.pen = phosphor
    for index, line in enumerate(details):
        center_text(line, 67 + index * 18, NAME_SIZE)
    badgelink.draw_identicon(screen, badge_id, AVATAR_X, AVATAR_Y, AVATAR_SIZE)

    if not handle:
        nudge = "Add your GitHub username in Settings or visit Hack Your Badge to show your stats"
    elif user.offline:
        nudge = "Offline. GitHub stats will load when WiFi is available."
    elif user.missing or user.failed:
        nudge = "Visit the Hack Your Badge station to get your GitHub stats"
    else:
        nudge = status or "connecting to GitHub..."
    screen.pen = white
    screen.text(nudge, rect(*NUDGE_RECT), NUDGE_SIZE, align=(LEFT, TOP))


def draw_socials():
    screen.font = title_font
    screen.pen = white
    center_text("Social Links", 44, 22)
    if social_error:
        screen.font = body_font
        screen.pen = phosphor
        center_text(social_error, 69, 12)
    if not socials:
        screen.font = body_font
        screen.pen = faded
        message = "Social links need checking." if social_error else "No social links added yet."
        center_text(message, 126, 16)
        return

    start = (page - 1) * SOCIALS_PER_PAGE
    for index, (label, value) in enumerate(socials[start:start + SOCIALS_PER_PAGE]):
        y = 83 + index * 35
        screen.font = body_font
        screen.pen = phosphor
        screen.text(label, 24, y, 12)
        screen.font = title_font
        screen.pen = white
        text, size = fit_line(value, 272, 18)
        screen.text(text, 24, y + 14, size)


def update():
    global page

    # Returning a result ends Badgeware's run loop. main.py then returns to
    # the launcher, using the same app exit path as the supplied firmware.
    if badge.pressed(BUTTON_BACK):
        return "/system/apps/menu"

    both_held = badge.held(BUTTON_LEFT) and badge.held(BUTTON_RIGHT)
    if handle and both_held and (badge.pressed(BUTTON_LEFT) or badge.pressed(BUTTON_RIGHT)):
        user.update(True)
    elif not both_held:
        if badge.pressed(BUTTON_LEFT):
            page = max(0, page - 1)
        elif badge.pressed(BUTTON_RIGHT):
            page = min(page_count - 1, page + 1)

    tilt.update()

    brand.draw_background()

    if not handle and not contact_name and not linkedin and page == 0:
        missing_details.show(missing_details.missing("GITHUB_USERNAME") + missing_details.missing("WIFI_SSID"), user.draw_graph)
        brand.draw_nav(page, page_count)
        brand.draw_header()
        return

    status = user.fetch_step() if handle else None
    if page:
        draw_socials()
    elif user.loaded:
        user.draw(status)
    else:
        draw_simple(status)

    brand.draw_nav(page, page_count)
    brand.draw_header()


on_exit = run(update).result
