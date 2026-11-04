"""Iron Corridor: an original tiny ray-cast drone shooter."""

import math
import os
import sys

APP_DIR = "/system/apps/iron_corridor"
os.chdir(APP_DIR)
sys.path.insert(0, APP_DIR)

from world import Game, MAP, EXIT, cast

badge.mode(LORES | VSYNC)
screen.font = font.nope
screen.antialias = image.OFF
screen.fill_rule = image.EVEN_ODD

INK = color.rgb(13, 18, 27)
FLOOR = color.rgb(30, 34, 39)
STEEL = color.rgb(101, 121, 127)
LIGHT = color.rgb(222, 225, 203)
AMBER = color.rgb(247, 174, 66)
RED = color.rgb(236, 83, 65)
GREEN = color.rgb(107, 218, 172)
WALLS = [
    [color.rgb(int(r * shade), int(g * shade), int(b * shade))
     for shade in (0.25, 0.36, 0.48, 0.62, 0.78, 1.0)]
    for r, g, b in ((101, 121, 127), (151, 105, 69))
]
PALETTE = (None, STEEL, INK, AMBER, RED, LIGHT, GREEN)
DRONE = (
    "000330033000", "000110011000", "001111111100",
    "011111111110", "112444444211", "112455554211",
    "011222222110", "001111111100", "000113311000",
    "000033330000", "000003300000", "000000000000",
)
MEDKIT = (
    "000000000000", "000111111000", "001555555100",
    "001556655100", "001556655100", "001666666100",
    "001666666100", "001556655100", "001556655100",
    "001555555100", "000111111000", "000000000000",
)
PORTAL = (
    "011111111110", "016666666610", "016222222610",
    "016222222610", "016226222610", "016266622610",
    "016666662610", "016266622610", "016226222610",
    "016222222610", "016666666610", "011111111110",
)

game = Game()
mode = "title"
show_map = False
STRIPE = 2
depths = [0.0] * ((screen.width + STRIPE - 1) // STRIPE)
camera_rays = [((x + STRIPE / 2) / screen.width * 2 - 1) * 0.66
               for x in range(0, screen.width, STRIPE)]


def centered(text, y, pen=LIGHT):
    screen.pen = pen
    width, _ = screen.measure_text(text)
    screen.text(text, (screen.width - width) / 2, y)


def sprite(x, y, texture, size, cosine, sine, focal, view_h):
    dx, dy = x - game.x, y - game.y
    distance = dx * cosine + dy * sine
    if distance < 0.15:
        return
    height = min(view_h * 4, focal * size / distance)
    center = screen.width / 2 + (dy * cosine - dx * sine) * focal / distance
    left = center - height / 2
    top = view_h / 2 + focal * 0.5 / distance - height
    start = max(0, int(left) // STRIPE * STRIPE)
    stop = min(screen.width, int(left + height) + STRIPE)
    for sx in range(start, stop, STRIPE):
        if distance >= depths[sx // STRIPE]:
            continue
        u = int((sx + STRIPE / 2 - left) * 12 / height)
        if not 0 <= u < 12:
            continue
        row = 0
        while row < 12:
            pixel = texture[row][u]
            end = row + 1
            while end < 12 and texture[end][u] == pixel:
                end += 1
            if pixel != "0":
                y0 = max(0, int(top + row * height / 12))
                y1 = min(view_h, int(top + end * height / 12))
                if y1 > y0:
                    screen.pen = PALETTE[int(pixel)]
                    screen.rectangle(sx, y0, STRIPE, y1 - y0)
            row = end


def world():
    w, h = screen.width, screen.height - 28
    focal = w / 1.32
    cosine, sine = math.cos(game.angle), math.sin(game.angle)
    screen.pen = INK
    screen.rectangle(screen.clip)
    screen.pen = FLOOR
    screen.rectangle(0, h // 2, w, h - h // 2)
    for index, camera in enumerate(camera_rays):
        distance, side, tile, offset = cast(
            game.x, game.y, cosine - sine * camera, sine + cosine * camera)
        depths[index] = distance
        height = focal / distance
        top, bottom = max(0, int((h - height) / 2)), min(h, int((h + height) / 2))
        shade = max(0, min(5, int(6 - distance * 0.65) - side))
        if offset < 0.035 or offset > 0.965:
            shade = max(0, shade - 2)
        screen.pen = WALLS[min(1, tile - 1)][shade]
        sx = index * STRIPE
        screen.rectangle(sx, top, STRIPE, bottom - top)
        screen.pen = WALLS[min(1, tile - 1)][max(0, shade - 2)]
        for seam in (0.28, 0.72):
            sy = int((h - height) / 2 + height * seam)
            if 0 <= sy < h:
                screen.rectangle(sx, sy, STRIPE, 1)
    objects = [(EXIT[0], EXIT[1], PORTAL, 1.0)]
    objects.extend((s[0], s[1], MEDKIT, 0.45) for s in game.supplies if s[2])
    objects.extend((e[0], e[1], DRONE, 0.75) for e in game.enemies if e[2] > 0)
    objects.sort(key=lambda obj: (obj[0] - game.x) ** 2 + (obj[1] - game.y) ** 2,
                 reverse=True)
    for x, y, texture, size in objects:
        sprite(x, y, texture, size, cosine, sine, focal, h)

    cx = w // 2
    screen.pen = LIGHT
    screen.line(cx - 3, h // 2, cx + 3, h // 2)
    screen.line(cx, h // 2 - 3, cx, h // 2 + 3)
    bob = int(math.sin(game.elapsed * 9) * 1.5)
    screen.pen = INK
    screen.rectangle(cx - 16, h - 17 + bob, 32, 18)
    screen.pen = STEEL
    screen.rectangle(cx - 11, h - 16 + bob, 22, 16)
    screen.pen = INK
    screen.rectangle(cx - 5, h - 24 + bob, 10, 17)
    screen.pen = AMBER
    screen.rectangle(cx - 2, h - 23 + bob, 4, 12)
    if game.flash > 0:
        screen.pen = AMBER
        screen.rectangle(cx - 8, h - 33, 16, 8)
        screen.pen = LIGHT
        screen.rectangle(cx - 3, h - 37, 6, 14)
    if game.hurt > 0:
        screen.pen = RED
        screen.rectangle(0, 0, w, 2)
        screen.rectangle(0, 0, 2, h)
        screen.rectangle(w - 2, 0, 2, h)
    if show_map:
        minimap()
    screen.pen = INK
    screen.rectangle(0, h, w, 28)
    screen.pen = RED if game.health <= 30 else GREEN
    screen.text("HP %d" % game.health, 3, h + 1)
    screen.pen = AMBER
    screen.text("DRONES %d/%d" % (game.kills, len(game.enemies)), w - 76, h + 1)
    centered("EXIT OPEN" if game.kills == len(game.enemies) else "CLEAR THE FACILITY",
             h + 14, GREEN if game.kills == len(game.enemies) else STEEL)


def minimap():
    screen.pen = INK
    screen.rectangle(2, 2, 50, 41)
    for y, row in enumerate(MAP):
        for x, tile in enumerate(row):
            if tile != "0":
                screen.pen = STEEL
                screen.rectangle(3 + x * 3, 3 + y * 3, 3, 3)
    screen.pen = GREEN
    screen.rectangle(3 + int(EXIT[0] * 3), 3 + int(EXIT[1] * 3), 2, 2)
    screen.pen = RED
    for e in game.enemies:
        if e[2] > 0:
            screen.rectangle(3 + int(e[0] * 3), 3 + int(e[1] * 3), 2, 2)
    px, py = 3 + game.x * 3, 3 + game.y * 3
    screen.pen = LIGHT
    screen.rectangle(int(px) - 1, int(py) - 1, 2, 2)
    screen.line(px, py, px + math.cos(game.angle) * 4, py + math.sin(game.angle) * 4)


def overlay(title, lines):
    screen.pen = INK
    screen.rectangle(3, 15, screen.width - 6, 78)
    screen.pen = AMBER
    screen.rectangle(3, 15, screen.width - 6, 2)
    centered(title, 22, AMBER)
    for index, text in enumerate(lines):
        centered(text, 38 + index * 11)


def update():
    global mode, show_map
    if mode == "title":
        if badge.pressed(BUTTON_SELECT):
            game.reset()
            mode = "playing"
    elif mode == "playing":
        if badge.pressed(BUTTON_BACK):
            mode = "paused"
        else:
            if badge.pressed(BUTTON_MENU):
                show_map = not show_map
            forward = int(badge.held(BUTTON_UP)) - int(badge.held(BUTTON_DOWN))
            turn = int(badge.held(BUTTON_RIGHT)) - int(badge.held(BUTTON_LEFT))
            game.advance(badge.ticks_delta / 1000, forward, turn,
                         badge.held(BUTTON_SELECT))
            if game.state in ("won", "lost"):
                mode = game.state
    elif mode == "paused":
        if badge.pressed(BUTTON_SELECT) or badge.pressed(BUTTON_BACK):
            mode = "playing"
        elif badge.pressed(BUTTON_MENU):
            mode = "title"
    elif badge.pressed(BUTTON_SELECT):
        game.reset()
        mode = "playing"
    elif badge.pressed(BUTTON_BACK):
        mode = "title"
    world()
    if mode == "title":
        overlay("IRON CORRIDOR", ("UP/DOWN move",
                "LEFT/RIGHT turn", "Hold SELECT to fire", "SELECT - enter"))
    elif mode == "paused":
        overlay("PAUSED", ("SELECT/BACK resume",
                "MENU - title", "MENU in game: map", "HOME - badge menu"))
    elif mode == "won":
        overlay("FACILITY CLEARED", ("%d seconds" % game.elapsed,
                "All drones disabled", "SELECT - play again", "BACK - title"))
    elif mode == "lost":
        overlay("SIGNAL LOST", ("%d drones disabled" % game.kills,
                "Keep moving & firing", "SELECT - retry", "BACK - title"))


run(update)
