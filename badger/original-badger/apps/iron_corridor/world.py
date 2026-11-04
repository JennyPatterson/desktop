"""Hardware-independent movement, ray casting, and combat."""

import math


MAP = (
    "1111111111111111",
    "1000001000000001",
    "1000001000000001",
    "1000000000200001",
    "1110111000200001",
    "1000001000220221",
    "1000000000000001",
    "1000001000000001",
    "1001111110111011",
    "1000000000000001",
    "1000001000000001",
    "1000001000000001",
    "1111111111111111",
)
EXIT = (14.5, 11.5)
SPAWNS = ((4.5, 2.5), (8.5, 3.5), (12.5, 2.5),
          (4.5, 10.5), (12.5, 10.5))
SUPPLIES = ((2.5, 6.5), (13.5, 6.5), (8.5, 11.5))


def wall(x, y):
    if x < 0 or y < 0 or x >= len(MAP[0]) or y >= len(MAP):
        return 1
    return int(MAP[int(y)][int(x)])


def cast(x, y, dx, dy):
    """Return ray parameter, side, tile, and wall texture coordinate."""
    mx, my = int(x), int(y)
    ddx = abs(1 / dx) if dx else 1e20
    ddy = abs(1 / dy) if dy else 1e20
    sx, sy = (1 if dx >= 0 else -1), (1 if dy >= 0 else -1)
    tx = (mx + 1 - x if dx >= 0 else x - mx) * ddx
    ty = (my + 1 - y if dy >= 0 else y - my) * ddy
    for _ in range(64):
        if tx < ty:
            distance = tx
            tx += ddx
            mx += sx
            side = 0
        else:
            distance = ty
            ty += ddy
            my += sy
            side = 1
        tile = wall(mx, my)
        if tile:
            hit = y + distance * dy if side == 0 else x + distance * dx
            return max(0.001, distance), side, tile, hit % 1
    return 64.0, 0, 1, 0.0


def clear_path(x, y, tx, ty):
    dx, dy = tx - x, ty - y
    distance = math.sqrt(dx * dx + dy * dy)
    if distance < 0.001:
        return True
    return cast(x, y, dx / distance, dy / distance)[0] >= distance


def fits(x, y, radius=0.18):
    return not any(wall(x + ox, y + oy)
                   for ox in (-radius, radius) for oy in (-radius, radius))


def move(x, y, dx, dy):
    if fits(x + dx, y):
        x += dx
    if fits(x, y + dy):
        y += dy
    return x, y


class Game:
    def __init__(self):
        self.reset()

    def reset(self):
        self.x, self.y, self.angle = 2.5, 2.5, 0.0
        self.health = 100
        self.kills = 0
        self.elapsed = 0.0
        self.cooldown = self.flash = self.hurt = 0.0
        self.state = "playing"
        # x, y, hit points, time until next attack
        self.enemies = [[x, y, 2, 1.8] for x, y in SPAWNS]
        self.supplies = [[x, y, True] for x, y in SUPPLIES]

    def shoot(self):
        if self.state != "playing" or self.cooldown > 0:
            return False
        self.cooldown = 0.32
        self.flash = 0.09
        dx, dy = math.cos(self.angle), math.sin(self.angle)
        nearest = min(10.0, cast(self.x, self.y, dx, dy)[0])
        target = None
        for enemy in self.enemies:
            if enemy[2] <= 0:
                continue
            ex, ey = enemy[0] - self.x, enemy[1] - self.y
            along = ex * dx + ey * dy
            across = abs(ex * dy - ey * dx)
            if across < 0.3:
                entry = along - math.sqrt(0.3 ** 2 - across ** 2)
                if along > 0 and entry < nearest:
                    nearest, target = max(0, entry), enemy
        if target is not None:
            target[2] -= 1
            if target[2] == 0:
                self.kills += 1
        return True

    def advance(self, dt, forward=0, turn=0, firing=False):
        if self.state != "playing":
            return
        remaining = max(0, min(dt, 0.1))
        while remaining > 1e-8 and self.state == "playing":
            step = min(remaining, 0.025)
            remaining -= step
            self._step(step, forward, turn, firing)

    def _step(self, dt, forward, turn, firing):
        self.elapsed += dt
        self.cooldown = max(0, self.cooldown - dt)
        self.flash = max(0, self.flash - dt)
        self.hurt = max(0, self.hurt - dt)
        self.angle = (self.angle + turn * dt * 2.1) % (2 * math.pi)
        speed = forward * dt * 1.8
        self.x, self.y = move(self.x, self.y,
                              math.cos(self.angle) * speed,
                              math.sin(self.angle) * speed)
        if firing:
            self.shoot()
        for enemy in self.enemies:
            if enemy[2] <= 0:
                continue
            enemy[3] = max(0, enemy[3] - dt)
            dx, dy = self.x - enemy[0], self.y - enemy[1]
            distance = math.sqrt(dx * dx + dy * dy)
            if distance < 5.5 and clear_path(enemy[0], enemy[1], self.x, self.y):
                if distance > 1.1:
                    speed = min(dt * 0.48, distance - 1.1) / distance
                    enemy[0], enemy[1] = move(enemy[0], enemy[1], dx * speed, dy * speed)
                if distance < 4.5 and enemy[3] <= 0:
                    self.health = max(0, self.health - 10)
                    self.hurt = 0.18
                    enemy[3] = 1.4
        if self.health <= 0:
            self.state = "lost"
            return
        for supply in self.supplies:
            if supply[2] and self.health < 100:
                if (self.x - supply[0]) ** 2 + (self.y - supply[1]) ** 2 < 0.4 ** 2:
                    self.health = min(100, self.health + 35)
                    supply[2] = False
        if self.kills == len(self.enemies):
            if (self.x - EXIT[0]) ** 2 + (self.y - EXIT[1]) ** 2 < 0.5 ** 2:
                self.state = "won"
