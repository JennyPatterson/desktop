export const CONFIG = {
  STORAGE_KEY: "priorityTaskApp.items.v1",
  HISTORY_STORAGE_KEY: "priorityTaskApp.history.v1",
  STATE_STORAGE_KEY: "priorityTaskApp.state.v2",
  GITHUB_TOKEN_STORAGE_KEY: "priorityTaskApp.githubToken.v1",
  RESET_FLAG_STORAGE_KEY: "priorityTaskApp.resetForRemoteSync.v1",
  HASH_STATE_PARAM: "state",
  SYNC_ID_PARAM: "sync",
  GIST_FILENAME: "priority-task-state.json",
  GITHUB_API_BASE: "https://api.github.com",
  REMOTE_SYNC_DEBOUNCE_MS: 700,
  MAX_REMOTE_PAYLOAD_BYTES: 200000,
  ENTRIES_PER_PAGE: 10,
  UNIT_TO_MINUTES: { minutes: 1, hours: 60, days: 1440, weeks: 10080, years: 525600 },
  UNIT_LABELS: { minutes: "minute", hours: "hour", days: "day", weeks: "week", years: "year" },
  DAILY_INTERVAL_MINUTES: 1440,
  WEEKLY_INTERVAL_MINUTES: 10080,
  MONTHLY_INTERVAL_MINUTES: 43200,
  URGENCY_VALUES: ["S", "A", "B", "C", "D", "E"],
  CATEGORY_VALUES: ["Health", "Financial", "Chore", "Hobby", "Work", "Community"],
  UNCATEGORIZED_FILTER_VALUE: "__uncategorized__",
  CATEGORY_ICON_SVGS: {
    Health:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-6.8-4.7-8.8-8.1C1.5 8.8 3.1 5.5 6.4 5.5c2 0 3.2 1 4.1 2.4.9-1.4 2.1-2.4 4.1-2.4 3.3 0 4.9 3.3 3.2 6.4C18.8 15.3 12 20 12 20z"></path></svg>',
    Financial:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="6.5" width="17" height="11" rx="2"></rect><circle cx="12" cy="12" r="2.2"></circle><path d="M6.5 9.5h1M16.5 14.5h1"></path></svg>',
    Chore:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14.5 3.5l6 6"></path><path d="M4 14l4.8-4.8 4 4-4.8 4.8H4z"></path><path d="M5.8 14.8v3.7M7.6 13l.1 5.5M9.4 11.2v5.6"></path></svg>',
    Hobby:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5l2.5 5.2 5.7.8-4.1 4 1 5.7L12 16.3 6.9 19.2l1-5.7-4.1-4 5.7-.8L12 3.5z"></path></svg>',
    Work:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="7.5" width="17" height="11" rx="2"></rect><path d="M9 7.5v-1.2A1.8 1.8 0 0 1 10.8 4.5h2.4A1.8 1.8 0 0 1 15 6.3V7.5M3.5 11.2h17"></path></svg>',
    Community:
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8" cy="10" r="2.2"></circle><circle cx="16" cy="10" r="2.2"></circle><path d="M4.5 17c.6-2.2 2.1-3.3 3.5-3.3S10.9 14.8 11.5 17M12.5 17c.6-2.2 2.1-3.3 3.5-3.3s2.9 1.1 3.5 3.3"></path></svg>',
  },
};

CONFIG.DEFAULT_CATEGORY_FILTERS = [...CONFIG.CATEGORY_VALUES, CONFIG.UNCATEGORIZED_FILTER_VALUE];
