import { CONFIG } from "./config.js";

export class TaskModel {
  static getDefaultColor() {
    return "#38d9ff";
  }

  static normalizeColor(value, fallback = "#38d9ff") {
    if (typeof value !== "string") return fallback;
    const trimmed = value.trim();
    if (!/^#([0-9a-fA-F]{6})$/.test(trimmed)) return fallback;
    return trimmed.toLowerCase();
  }

  static normalizeUrgency(value, fallback = "C") {
    if (typeof value !== "string") return fallback;
    const normalized = value.trim().toUpperCase();
    return CONFIG.URGENCY_VALUES.includes(normalized) ? normalized : fallback;
  }

  static normalizeCategory(value, fallback = null) {
    if (typeof value !== "string") return fallback;
    const normalized = value.trim();
    return CONFIG.CATEGORY_VALUES.includes(normalized) ? normalized : fallback;
  }

  static normalizeCategoryFilters(value) {
    if (!Array.isArray(value)) return [...CONFIG.DEFAULT_CATEGORY_FILTERS];
    const normalized = value.filter((entry) => CONFIG.DEFAULT_CATEGORY_FILTERS.includes(entry));
    return [...new Set(normalized)];
  }

  static normalizeInterval(item) {
    const unit = CONFIG.UNIT_TO_MINUTES[item.intervalUnit] ? item.intervalUnit : "minutes";
    const value = Math.max(1, Number(item.intervalValue) || 1);
    const intervalMinutesFromValue = value * CONFIG.UNIT_TO_MINUTES[unit];
    const intervalMinutes = Math.max(1, Number(item.intervalMinutes) || intervalMinutesFromValue);
    if (item.intervalUnit || item.intervalValue) return { value, unit, intervalMinutes };
    return { value: intervalMinutes, unit: "minutes", intervalMinutes };
  }

  static normalizeItem(item) {
    const normalizedSchedule = item?.schedule === "recurring" ? "recurring" : "one-time";
    const base = { ...item, type: "task", schedule: normalizedSchedule };
    const color = this.normalizeColor(item?.color, this.getDefaultColor());
    const urgency = this.normalizeUrgency(item?.urgency, "C");
    const category = this.normalizeCategory(item?.category, null);

    if (normalizedSchedule === "recurring") {
      const { value, unit, intervalMinutes } = this.normalizeInterval(base);
      return { ...base, color, urgency, category, intervalValue: value, intervalUnit: unit, intervalMinutes };
    }

    return { ...base, color, urgency, category, intervalValue: null, intervalUnit: null, intervalMinutes: null };
  }

  static normalizeHistoryEntries(history) {
    if (!Array.isArray(history)) return [];
    return history
      .filter((entry) => entry && entry.itemId && entry.name)
      .map((entry) => ({
        ...entry,
        schedule: entry?.schedule === "recurring" ? "recurring" : "one-time",
        nextDueAt: Number(entry?.nextDueAt) || null,
        intervalMinutes: Number(entry?.intervalMinutes) > 0 ? Math.max(1, Number(entry.intervalMinutes)) : null,
        experiencePointsEarned:
          Number.isFinite(Number(entry?.experiencePointsEarned)) && Number(entry.experiencePointsEarned) >= 0
            ? Math.floor(Number(entry.experiencePointsEarned))
            : null,
        color: this.normalizeColor(entry.color, this.getDefaultColor()),
        urgency: this.normalizeUrgency(entry.urgency, "C"),
        category: this.normalizeCategory(entry.category, null),
      }));
  }

  static inferUpdatedAt(items, history) {
    const itemTimes = items.flatMap((item) => [
      Number(item?.createdAt) || 0,
      Number(item?.completedAt) || 0,
      Number(item?.nextDueAt) || 0,
    ]);
    const historyTimes = history.map((entry) => Number(entry?.completedAt) || 0);
    return Math.max(0, ...itemTimes, ...historyTimes);
  }

  static normalizeSnapshot(snapshot) {
    const items = Array.isArray(snapshot?.items)
      ? snapshot.items.filter((item) => item && item.id).map((item) => this.normalizeItem(item))
      : [];
    const history = this.normalizeHistoryEntries(snapshot?.history);
    const sortMode = ["latency", "priority", "frequency", "category"].includes(snapshot?.sortMode)
      ? snapshot.sortMode
      : "latency";
    const categoryFilters = this.normalizeCategoryFilters(snapshot?.categoryFilters);
    const experiencePoints = Math.max(0, Math.floor(Number(snapshot?.experiencePoints) || 0));
    const updatedAt = Math.max(0, Number(snapshot?.updatedAt) || this.inferUpdatedAt(items, history));
    return { items, history, sortMode, categoryFilters, experiencePoints, updatedAt };
  }

  static isVisibleNow(item, now) {
    if (item.schedule === "one-time") return !item.completedAt;
    return (item.nextDueAt || 0) <= now;
  }

  static isVisibleCategory(item, selectedFilters) {
    const category = this.normalizeCategory(item?.category, null);
    if (!category) return selectedFilters.includes(CONFIG.UNCATEGORIZED_FILTER_VALUE);
    return selectedFilters.includes(category);
  }

  static recurrenceText(item) {
    if (item.schedule === "one-time") return "one-time";
    const { value, unit } = this.normalizeInterval(item);
    return `recurs every ${value} ${CONFIG.UNIT_LABELS[unit]}${value === 1 ? "" : "s"}`;
  }

  static formatDuration(ms) {
    const totalMinutes = Math.round(Math.max(0, ms) / 60000);
    if (totalMinutes < 1) return "under a minute";
    const days = Math.floor(totalMinutes / 1440);
    const hours = Math.floor((totalMinutes % 1440) / 60);
    const minutes = totalMinutes % 60;
    const parts = [];
    if (days) parts.push(`${days}d`);
    if (hours) parts.push(`${hours}h`);
    if (minutes || !parts.length) parts.push(`${minutes}m`);
    return parts.slice(0, 2).join(" ");
  }

  static roundToNearestMinute(timestamp) {
    return Math.round(Number(timestamp) / 60000) * 60000;
  }

  static formatDisplayDateTime(timestamp, now = Date.now()) {
    const roundedTimestamp = this.roundToNearestMinute(timestamp);
    if (!Number.isFinite(roundedTimestamp)) return "";
    const date = new Date(roundedTimestamp);
    const nowDate = new Date(now);
    const dateStart = new Date(date);
    dateStart.setHours(0, 0, 0, 0);
    const nowStart = new Date(nowDate);
    nowStart.setHours(0, 0, 0, 0);
    const dayDiff = Math.round((dateStart.getTime() - nowStart.getTime()) / 86400000);
    const dateLabel = dayDiff === 0 ? "Today" : dayDiff === 1 ? "Tomorrow" : date.toLocaleDateString();
    const timeLabel = date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
    return `${dateLabel} ${timeLabel}`;
  }

  static getDueAt(item, now = Date.now()) {
    return Math.max(0, Number(item.nextDueAt) || Number(item.createdAt) || now);
  }

  static dueDurationText(item, now) {
    const dueAt = this.getDueAt(item, now);
    return `due for ${this.formatDuration(now - dueAt)}`;
  }

  static recurringReturnText(entry, linkedItem, now) {
    const schedule =
      entry?.schedule === "recurring" ? "recurring" : linkedItem?.schedule === "recurring" ? "recurring" : "one-time";
    if (schedule !== "recurring") return null;
    const dueAt = Math.max(0, Number(entry?.nextDueAt) || Number(linkedItem?.nextDueAt) || 0);
    if (!dueAt || dueAt <= now) return "back in queue now";
    return `back in ${this.formatDuration(dueAt - now)}`;
  }

  static categoryRank(item) {
    const category = this.normalizeCategory(item?.category, null);
    const index = CONFIG.CATEGORY_VALUES.indexOf(category);
    return index === -1 ? CONFIG.CATEGORY_VALUES.length : index;
  }

  static urgencyRank(item) {
    const urgency = this.normalizeUrgency(item?.urgency, "C");
    const index = CONFIG.URGENCY_VALUES.indexOf(urgency);
    return index === -1 ? CONFIG.URGENCY_VALUES.indexOf("C") : index;
  }

  static sortTasks(items, now, mode = "latency") {
    const byLatency = (a, b) => this.getDueAt(a, now) - this.getDueAt(b, now);
    const byPriority = (a, b) => this.urgencyRank(a) - this.urgencyRank(b) || byLatency(a, b);
    const byFrequency = (a, b) => {
      const aFrequency =
        a.schedule === "recurring" ? Number(a.intervalMinutes) || Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
      const bFrequency =
        b.schedule === "recurring" ? Number(b.intervalMinutes) || Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
      return aFrequency - bFrequency || byPriority(a, b);
    };
    const byCategory = (a, b) => this.categoryRank(a) - this.categoryRank(b) || byPriority(a, b);

    return [...items].sort((a, b) => {
      if (mode === "priority") return byPriority(a, b);
      if (mode === "frequency") return byFrequency(a, b);
      if (mode === "category") return byCategory(a, b);
      return byLatency(a, b);
    });
  }

  static getCompletionExperiencePoints(item) {
    if (!item || item.schedule !== "recurring") return 5;
    const { intervalMinutes } = this.normalizeInterval(item);
    const recurrenceMinutes = Math.max(1, Number(intervalMinutes) || 1);
    if (recurrenceMinutes <= CONFIG.DAILY_INTERVAL_MINUTES) return 1;
    if (recurrenceMinutes <= CONFIG.WEEKLY_INTERVAL_MINUTES) return 3;
    if (recurrenceMinutes <= CONFIG.MONTHLY_INTERVAL_MINUTES) return 5;
    return 5;
  }

  static getHistoryEntryExperiencePoints(entry, linkedItem) {
    if (!entry) return 0;
    const explicitPoints = Number(entry.experiencePointsEarned);
    if (Number.isFinite(explicitPoints) && explicitPoints >= 0) return Math.floor(explicitPoints);
    if (entry.schedule !== "recurring") return 5;
    if (Number(entry.intervalMinutes) > 0) return this.getCompletionExperiencePoints(entry);
    if (linkedItem?.schedule === "recurring") return this.getCompletionExperiencePoints(linkedItem);
    return 1;
  }
}
