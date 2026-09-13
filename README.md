# desktop

Simple GitHub Pages-ready task tracker with local persistence.

## Features

- Set each item to **One-time** or **Recurring**
- Configure recurring cadence in **minutes, hours, days, weeks, or years**
- Assign an **Urgency** level per task (`S`, `A`, `B`, `C`, `D`, `E`)
- Pick a custom colour per item
- Check items off when complete
- Recurring items automatically return to the queue after their configured delay
- Completion history feed shows the 20 most recently completed tasks
- Completion history entries include **Add To Queue Now** to instantly make a linked item due
- Edit item name, recurrence, and colour from the queue or completion history
- Permanently delete queued items
- Dark-mode psychedelic visual theme with high-contrast text
- Data persists in the browser via `localStorage` and syncs into the URL hash for cross-device consistency when the same link is opened

## Run / Host

This repository is static-site friendly. Use `index.html` directly or publish with GitHub Pages.

## GitHub Pages setup

1. In GitHub, open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Push to `main` (or run the **Deploy static content to Pages** workflow manually).
4. Open: `https://jennypatterson.github.io/desktop/`