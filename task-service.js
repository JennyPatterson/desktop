import { TaskModel } from "./task-model.js";

export class TaskService {
  getDefaultColorForCategory(appState, category) {
    const normalizedCategory = TaskModel.normalizeCategory(category, null);
    const recentItem = [...appState.items]
      .filter((item) => TaskModel.normalizeCategory(item.category, null) === normalizedCategory)
      .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0))[0];
    return recentItem ? TaskModel.normalizeColor(recentItem.color, TaskModel.getDefaultColor()) : TaskModel.getDefaultColor();
  }

  createItem(appState, fields) {
    const now = fields.now || Date.now();
    const color = fields.color || this.getDefaultColorForCategory(appState, fields.category);
    const newItem = TaskModel.normalizeItem({
      id: crypto.randomUUID(),
      name: fields.name,
      type: "task",
      color,
      urgency: fields.urgency,
      category: fields.category,
      schedule: fields.schedule,
      intervalMinutes: fields.schedule === "recurring" ? fields.intervalMinutes : null,
      intervalValue: fields.schedule === "recurring" ? fields.intervalValue : null,
      intervalUnit: fields.schedule === "recurring" ? fields.intervalUnit : null,
      nextDueAt: now,
      completedAt: null,
      createdAt: now,
    });
    return {
      ...appState,
      items: [...appState.items, newItem],
    };
  }

  updateItem(appState, itemId, fields) {
    const items = [...appState.items];
    const itemIndex = items.findIndex((item) => item.id === itemId);
    if (itemIndex < 0) return appState;
    const currentItem = items[itemIndex];
    const updated = TaskModel.normalizeItem({
      ...currentItem,
      ...fields,
      nextDueAt:
        fields.schedule === "recurring" ? Number(currentItem.nextDueAt) || Date.now() : currentItem.nextDueAt,
    });
    items[itemIndex] = updated;
    const history = TaskModel.normalizeHistoryEntries(
      appState.history.map((entry) =>
        entry.itemId !== itemId
          ? entry
          : { ...entry, name: updated.name, color: updated.color, urgency: updated.urgency, category: updated.category }
      )
    );
    return { ...appState, items, history };
  }

  completeItem(appState, id) {
    const now = Date.now();
    const items = [...appState.items];
    const itemIndex = items.findIndex((item) => item.id === id);
    if (itemIndex < 0) return appState;

    const item = items[itemIndex];
    const completionIntervalMinutes = item.schedule === "recurring" ? TaskModel.normalizeInterval(item).intervalMinutes : null;
    const completionPoints = TaskModel.getCompletionExperiencePoints({
      ...item,
      intervalMinutes: completionIntervalMinutes,
    });
    if (item.schedule === "one-time") items[itemIndex] = { ...item, completedAt: now };
    else items[itemIndex] = { ...item, nextDueAt: now + completionIntervalMinutes * 60 * 1000, completedAt: now };

    const history = TaskModel.normalizeHistoryEntries([
      {
        id: crypto.randomUUID(),
        itemId: item.id,
        name: item.name,
        type: item.type,
        schedule: item.schedule,
        nextDueAt: items[itemIndex].nextDueAt,
        color: item.color,
        completedAt: now,
        urgency: item.urgency,
        category: item.category,
        intervalMinutes: completionIntervalMinutes,
        experiencePointsEarned: completionPoints,
      },
      ...appState.history,
    ]);
    const experiencePoints = Math.max(0, Number(appState.experiencePoints) || 0) + completionPoints;
    return { ...appState, items, history, experiencePoints };
  }

  addToQueueNow(appState, itemId) {
    const items = [...appState.items];
    const itemIndex = items.findIndex((item) => item.id === itemId);
    if (itemIndex < 0) return appState;
    const item = items[itemIndex];
    items[itemIndex] =
      item.schedule === "one-time" ? { ...item, completedAt: null } : { ...item, nextDueAt: Date.now() };
    return { ...appState, items };
  }

  deleteItem(appState, id) {
    return {
      ...appState,
      items: appState.items.filter((item) => item.id !== id),
    };
  }

  syncHistoryForItem(appState, item) {
    const history = TaskModel.normalizeHistoryEntries(
      appState.history.map((entry) => {
        if (entry.itemId !== item.id) return entry;
        return { ...entry, name: item.name, color: item.color, urgency: item.urgency, category: item.category };
      })
    );
    return { ...appState, history };
  }
}
