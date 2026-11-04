import copy
import io
import json
import pathlib
import runpy
import sys
import time
import types
import unittest
from unittest.mock import mock_open, patch


APP = pathlib.Path(__file__).parents[1] / "november-badger" / "apps" / "calendar" / "__init__.py"


class BadgeTests(unittest.TestCase):
    def setUp(self):
        self.tick = 1000
        self.drawn = []
        self.backgrounds = []
        self.screen = types.SimpleNamespace(
            pen=None,
            font=None,
            antialias=None,
            measure_text=lambda text, font_size=1: (len(text) * font_size / 2, font_size),
            text=lambda text, *args, **kwargs: self.drawn.append(text),
            clear=lambda: self.backgrounds.append(self.screen.pen),
            rectangle=lambda *args: None,
        )
        self.wifi = types.SimpleNamespace(
            connect=lambda **kwargs: True,
            is_connected=lambda: True,
            status=lambda: (1, "Connected"),
        )
        self.secrets = types.SimpleNamespace(
            CALENDAR_FEED_URL="https://badge.example.test/events",
            CALENDAR_FEED_TOKEN="test-only-token",
        )
        self.payload = {
            "now": 1000, "synced_at": 1000, "valid_until": 1300,
            "sync_error": False,
            "events": [{
                "name": "Planning meeting", "start": 1100, "end": 1200,
                "start_label": "10:00", "end_label": "10:02",
            }],
        }
        self.closed = False
        self.status = 200
        self.http_calls = []
        self.tls_error = None
        self.tls_context = types.SimpleNamespace(
            verify_mode=None,
            load_verify_locations=lambda **kwargs: self.assertEqual(kwargs["cadata"], b"test-ca"),
            wrap_socket=self.wrap_socket,
        )
        self.socket = types.SimpleNamespace(
            SOCK_STREAM=1,
            socket=self.make_connection,
            getaddrinfo=lambda *args: [(2, 1, 0, "", ("127.0.0.1", 8765))],
        )
        self.ssl = types.SimpleNamespace(
            PROTOCOL_TLS_CLIENT=1, CERT_REQUIRED=2,
            SSLContext=lambda _: self.tls_context,
        )
        modules = {
            "socket": self.socket, "ssl": self.ssl,
            "wifi": self.wifi, "secrets": self.secrets,
        }
        self.addCleanup(patch.stopall)
        patch.dict(sys.modules, modules).start()
        patch.object(time, "ticks_ms", lambda: self.tick, create=True).start()
        patch.object(time, "gmtime", lambda: (2026, 11, 4, 0, 0, 0, 0, 0, 0)).start()
        patch.object(time, "ticks_diff", lambda a, b: ((a - b + (1 << 29)) % (1 << 30)) - (1 << 29), create=True).start()
        namespace = runpy.run_path(str(APP), init_globals={
            "badge": types.SimpleNamespace(mode=lambda _: None, pressed=lambda _: False),
            "screen": self.screen,
            "HIRES": 1, "VSYNC": 2, "BUTTON_BACK": 1,
            "image": types.SimpleNamespace(X2=2, CENTER=1),
            "color": types.SimpleNamespace(rgb=lambda *values: values),
            "font": types.SimpleNamespace(ignore=1, sins=2, bacteria=3),
            "rect": lambda *values: values,
            "reset": lambda: None,
            "run": lambda _: None,
        })
        self.app = namespace["load_calendar"].__globals__
        self.app["open"] = mock_open(read_data=b"test-ca")

    def make_connection(self):
        body = json.dumps(copy.deepcopy(self.payload)).encode()
        self.response = io.BytesIO(
            ("HTTP/1.1 %d OK\r\nContent-Length: %d\r\n\r\n" % (self.status, len(body))).encode() + body
        )
        self.http_calls.append(bytearray())
        self.connection = types.SimpleNamespace(
            settimeout=lambda _: None,
            connect=lambda _: None,
            write=self.write_request,
            readline=lambda *args: self.response.readline(*args),
            read=lambda count: self.response.read(min(count, 7)),
            close=lambda: setattr(self, "closed", True),
        )
        return self.connection

    def write_request(self, data):
        length = min(len(data), 13)
        self.http_calls[-1].extend(data[:length])
        return length

    def wrap_socket(self, connection, server_hostname):
        self.assertEqual(self.tls_context.verify_mode, self.ssl.CERT_REQUIRED)
        self.assertEqual(server_hostname, "badge.example.test")
        if self.tls_error:
            raise self.tls_error
        return connection

    def load(self):
        self.app["load_calendar"]()

    def test_countdown_boundary(self):
        self.payload["events"][0].update(start=1600, end=1700)
        self.load()
        self.assertEqual(self.app["meeting_state"](999)[0], "upcoming")
        self.assertEqual(self.app["meeting_state"](1000)[0], "countdown")
        self.app["draw_event"](self.app["events"][0], 1000)
        self.assertIn("10:00", self.drawn)
        self.assertIn("Planning meeting", self.drawn)

    def test_exact_start_and_end_and_red_display(self):
        self.load()
        self.assertEqual(self.app["meeting_state"](1099)[0], "countdown")
        self.assertEqual(self.app["meeting_state"](1100)[0], "active")
        self.assertEqual(self.app["meeting_state"](1199)[0], "active")
        self.assertEqual(self.app["meeting_state"](1200)[0], "empty")
        self.tick += 100000
        self.app["draw"]()
        self.assertEqual(self.backgrounds[-1], (205, 24, 35))
        for expected in ("IN PROGRESS", "Planning meeting", "10:00", "10:02"):
            self.assertIn(expected, self.drawn)

    def test_overlapping_meetings_prefer_earliest_active(self):
        self.payload["events"].insert(0, {
            "name": "Later overlap", "start": 1150, "end": 1250,
            "start_label": "10:01", "end_label": "10:03",
        })
        self.load()
        self.assertEqual(self.app["meeting_state"](1150)[1]["name"], "Planning meeting")
        self.assertEqual(self.app["meeting_state"](1200)[1]["name"], "Later overlap")

    def test_clock_handles_tick_wrap(self):
        self.tick = (1 << 30) - 36
        self.load()
        self.tick = 964
        self.assertEqual(self.app["current_time"](), 1001)

    def test_failed_refresh_retains_copy_but_expiration_stops_meeting_display(self):
        self.load()
        self.status = 503
        with self.assertRaises(OSError):
            self.load()
        self.assertTrue(self.closed)
        self.assertEqual(self.app["meeting_state"](1150)[0], "active")
        self.assertEqual(self.app["meeting_state"](1300), ("expired", None))

    def test_authentication_and_https_required(self):
        self.load()
        self.assertIn(b"Authorization: Bearer test-only-token\r\n", self.http_calls[-1])
        self.secrets.CALENDAR_FEED_URL = "http://badge.example.test/events"
        with self.assertRaisesRegex(ValueError, "requires HTTPS"):
            self.load()
        self.secrets.CALENDAR_FEED_URL = "https://badge.example.test/events"
        self.secrets.CALENDAR_FEED_TOKEN = ""
        with self.assertRaisesRegex(ValueError, "Token"):
            self.load()

    def test_invalid_feed_is_rejected_without_overwriting_copy(self):
        self.load()
        for invalid in (
            {**self.payload, "now": "1000"},
            {**self.payload, "valid_until": 1400},
            {**self.payload, "valid_until": 1000},
            {**self.payload, "events": None},
            {**self.payload, "events": [{"name": "bad"}]},
        ):
            self.payload = invalid
            with self.assertRaises((ValueError, KeyError)):
                self.load()
            self.assertEqual(self.app["events"][0]["name"], "Planning meeting")

    def test_refresh_warning_is_visible_during_meeting(self):
        self.payload["sync_error"] = True
        self.load()
        self.tick += 100000
        self.app["draw"]()
        self.assertEqual(self.backgrounds[-1], (205, 24, 35))
        self.assertIn("Google sync failed; using cached events", self.drawn)

    def test_long_name_wraps(self):
        self.app["draw_name"]("Weekly planning and delivery")
        self.assertGreater(len(self.drawn), 1)
        self.assertEqual(" ".join(self.drawn), "Weekly planning and delivery")

    def test_poll_updates_after_failure_and_handles_back(self):
        self.status = 503
        self.app["update"]()
        self.assertIn("Calendar request failed", self.app["fault"])
        self.assertIsNotNone(self.app["last_fetch"])
        self.tick += 30000
        self.status = 200
        self.app["update"]()
        self.assertIsNone(self.app["fault"])
        self.app["badge"].pressed = lambda _: True
        self.app["reset"] = lambda: self.drawn.append("reset")
        self.app["update"]()
        self.assertEqual(self.drawn[-1], "reset")

    def test_upcoming_is_green_with_name_and_times(self):
        self.payload["events"][0].update(start=1601, end=1700)
        self.load()
        self.app["draw"]()
        self.assertEqual(self.backgrounds[-1], (40, 190, 95))
        self.assertIn("Planning meeting", self.drawn)
        self.assertIn("10:00 - 10:02", self.drawn)

    def test_countdown_is_yellow_at_exactly_ten_minutes(self):
        self.payload["events"][0].update(start=1600, end=1700)
        self.load()
        self.app["draw"]()
        self.assertEqual(self.backgrounds[-1], (255, 211, 51))
        self.assertIn("10:00", self.drawn)

    def test_empty_calendar_stays_green(self):
        self.payload["events"] = []
        self.load()
        self.app["draw"]()
        self.assertEqual(self.backgrounds[-1], (40, 190, 95))
        self.assertIn("No upcoming meetings", self.drawn)

    def test_tls_failure_closes_socket_without_sending_token(self):
        self.tls_error = OSError("Certificate validation failed")
        with self.assertRaisesRegex(OSError, "Certificate"):
            self.load()
        self.assertTrue(self.closed)
        self.assertEqual(self.http_calls[-1], b"")

    def test_header_injection_and_uninitialized_rtc_are_rejected(self):
        self.secrets.CALENDAR_FEED_TOKEN = "bad\r\ntoken"
        with self.assertRaisesRegex(ValueError, "Invalid calendar feed token"):
            self.load()
        self.secrets.CALENDAR_FEED_TOKEN = "test-only-token"
        with patch.object(time, "gmtime", lambda: (2000, 1, 1, 0, 0, 0, 0, 0, 0)):
            with self.assertRaisesRegex(ValueError, "RTC"):
                self.load()


if __name__ == "__main__":
    unittest.main()
