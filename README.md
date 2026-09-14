# desktop

Simple GitHub Pages-ready task tracker with local persistence.

## Features

- Set each item to **One-time** or **Recurring**
- Configure recurring cadence in **minutes, hours, days, weeks, or years**
- Assign an **Urgency** level per task (`S`, `A`, `B`, `C`, `D`, `E`)
- Optionally assign a **Category** per task (`Health`, `Financial`, `Chore`, `Hobby`, `Work`, `Community`)
- Pick a custom colour per item
- Category-specific minimalist icons shown beside each current task title
- Check items off when complete
- Sparkle animation plays when a task is checked off
- Recurring items automatically return to the queue after their configured delay
- Sort current tasks by **Latency**, **Priority**, **Frequency**, or **Category**
- Filter current tasks to show only selected categories (including uncategorized items)
- Earn experience points when completing tasks based on recurrence cadence
- Completion history feed shows the 20 most recently completed tasks
- Completion history entries include **Add To Queue Now** to instantly make a linked item due
- Edit item name, recurrence, and colour from the queue or completion history
- Permanently delete queued items
- Dark-mode psychedelic visual theme with high-contrast text
- Data persists locally in the browser via `localStorage`
- **Sync Across Devices** uses GitHub Gists as the canonical shared state so mobile/desktop refreshes stay in sync
- Shared links are anonymous (`?sync=<gist-id>`) and readable without sign-in; writing requires a GitHub token with gist scope on that device
- Beta reset: legacy hash-based state migration is intentionally disabled and local state starts fresh once

## Run / Host

This repository is static-site friendly. Use `index.html` directly or publish with GitHub Pages.

## GitHub Pages setup

1. In GitHub, open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Push to `main` (or run the **Deploy static content to Pages** workflow manually).
4. Open: `https://jennypatterson.github.io/desktop/`