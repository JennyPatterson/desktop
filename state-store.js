import { CONFIG } from "./config.js";
import { TaskModel } from "./task-model.js";

export class TaskStateStore {
  constructor() {
    this.appState = TaskModel.normalizeSnapshot(null);
  }

  nukeLocalStateForFreshStart() {
    try {
      if (localStorage.getItem(CONFIG.RESET_FLAG_STORAGE_KEY)) return;
      localStorage.removeItem(CONFIG.STORAGE_KEY);
      localStorage.removeItem(CONFIG.HISTORY_STORAGE_KEY);
      localStorage.removeItem(CONFIG.STATE_STORAGE_KEY);
      localStorage.setItem(CONFIG.RESET_FLAG_STORAGE_KEY, "1");
    } catch {}
  }

  getStateFromLegacyLocalStorage() {
    try {
      const savedItems = localStorage.getItem(CONFIG.STORAGE_KEY);
      const savedHistory = localStorage.getItem(CONFIG.HISTORY_STORAGE_KEY);
      const items = savedItems ? JSON.parse(savedItems) : [];
      const history = savedHistory ? JSON.parse(savedHistory) : [];
      return TaskModel.normalizeSnapshot({ items, history, sortMode: "latency" });
    } catch {
      return TaskModel.normalizeSnapshot(null);
    }
  }

  getStateFromLocalStorage() {
    try {
      const saved = localStorage.getItem(CONFIG.STATE_STORAGE_KEY);
      if (!saved) return this.getStateFromLegacyLocalStorage();
      return TaskModel.normalizeSnapshot(JSON.parse(saved));
    } catch {
      return this.getStateFromLegacyLocalStorage();
    }
  }

  loadState() {
    this.appState = this.getStateFromLocalStorage();
    return this.appState;
  }

  persistState(nextState, options = {}) {
    const normalized = TaskModel.normalizeSnapshot(nextState);
    const snapshot = { ...normalized, updatedAt: options.preserveUpdatedAt ? normalized.updatedAt : Date.now() };
    this.appState = snapshot;
    localStorage.setItem(CONFIG.STATE_STORAGE_KEY, JSON.stringify(snapshot));
    localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(snapshot.items));
    localStorage.setItem(CONFIG.HISTORY_STORAGE_KEY, JSON.stringify(snapshot.history));
    return snapshot;
  }

  loadGithubToken() {
    try {
      return localStorage.getItem(CONFIG.GITHUB_TOKEN_STORAGE_KEY) || "";
    } catch {
      console.warn("Unable to read saved GitHub token from localStorage.");
      return "";
    }
  }

  saveGithubToken(token) {
    try {
      if (!token) {
        localStorage.removeItem(CONFIG.GITHUB_TOKEN_STORAGE_KEY);
        return true;
      }
      localStorage.setItem(CONFIG.GITHUB_TOKEN_STORAGE_KEY, token);
      return true;
    } catch {
      console.warn("Unable to save GitHub token to localStorage.");
      return false;
    }
  }
}
