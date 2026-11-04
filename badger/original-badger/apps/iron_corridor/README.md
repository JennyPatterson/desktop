# Iron Corridor

Iron Corridor is a retro first-person maze shooter with hostile drones, supply pickups, and a reactor exit.

## Usage

Open **Iron Corridor** from the badge menu and press SELECT to enter the facility.
Disable all five hostile drones, then walk into the green exit in the southeast
corner. Drones take two hits and fire when they can see you; walls block both
your blaster and their attacks. Collect green medical packs to restore health.
The blaster recharges automatically, so you cannot run out of ammunition.

| Control | Action |
| --- | --- |
| UP / DOWN | Walk forward / backward |
| LEFT / RIGHT | Turn left / right |
| Hold SELECT | Fire the blaster |
| MENU | Toggle the tactical map (red drones, green exit, white player) |
| BACK | Pause |
| SELECT or BACK while paused | Resume |
| MENU while paused | Return to title |
| SELECT after winning or losing | Start a fresh run |
| HOME | Return to the badge menu |

Controls follow the screen orientation. The title and pause screens freeze the
game. Runs are not saved; restarting the app starts a new game.

## Requirements

Universe 2026 firmware with the runtime-provided graphics and logical button
APIs. No network, credentials, extra hardware, or `secrets.py` settings are used.
The 160x120 renderer uses two-pixel ray-cast columns with depth-clipped pixel
sprites. This is an original game, not a DOOM port; all maps and artwork are
original and no DOOM code, names, sounds, or assets are included in the game.

## Validation

From the repository root:

```powershell
python -B -m unittest discover -s tests -p test_iron_corridor.py
python -B .github\skills\hyb26-skill\scripts\validate_app.py badge\apps\iron_corridor
python -B .github\scripts\validate_app_readmes.py badge\apps\iron_corridor
```

In the Badge Simulator, check movement, turning, firing, wall occlusion, the map,
pause/resume, losing/restarting, and clearing the facility. Before considering
hardware behavior verified, deploy through USB disk mode and exercise these
controls upright and inverted, check the menu icon, and check HOME/reopening.
