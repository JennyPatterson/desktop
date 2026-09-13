# desktop

Simple GitHub Pages-ready priority and task tracker with local persistence.

## Features

- Save items as either **Priority** or **Task**
- Set each item to **One-time** or **Recurring**
- Configure recurring cadence in **minutes, days, weeks, or years**
- Pick a custom colour per item
- Check items off when complete
- Recurring items automatically return to the queue after their configured delay
- Completion history feed shows the 20 most recently completed priorities/tasks
- Edit item name, recurrence, and colour from the queue or completion history
- Permanently delete queued items
- Dark-mode psychedelic visual theme with high-contrast text
- Data persists in the browser via `localStorage`

## Run / Host

This repository is static-site friendly. Use `index.html` directly or publish with GitHub Pages.

## GitHub Pages setup

1. In GitHub, open **Settings → Pages**.
2. Under **Build and deployment**, set **Source** to **GitHub Actions**.
3. Push to `main` (or run the **Deploy static content to Pages** workflow manually).
4. Open: `https://jennypatterson.github.io/desktop/`