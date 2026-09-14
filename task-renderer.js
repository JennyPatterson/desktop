import { CONFIG } from "./config.js";
import { TaskModel } from "./task-model.js";

export class TaskRenderer {
  getTotalPages(totalCount) {
    return Math.max(1, Math.ceil(Math.max(0, Number(totalCount) || 0) / CONFIG.ENTRIES_PER_PAGE));
  }

  clampPage(page, totalCount) {
    return Math.min(this.getTotalPages(totalCount), Math.max(1, Number(page) || 1));
  }

  getPageEntries(entries, page) {
    const start = (this.clampPage(page, entries.length) - 1) * CONFIG.ENTRIES_PER_PAGE;
    return entries.slice(start, start + CONFIG.ENTRIES_PER_PAGE);
  }

  renderPagination(container, totalCount, currentPage, onPageChange) {
    container.innerHTML = "";
    if (totalCount <= CONFIG.ENTRIES_PER_PAGE) {
      container.hidden = true;
      return;
    }
    const totalPages = this.getTotalPages(totalCount);
    container.hidden = false;

    const previousButton = document.createElement("button");
    previousButton.type = "button";
    previousButton.className = "secondary";
    previousButton.textContent = "Previous";
    previousButton.disabled = currentPage <= 1;
    previousButton.addEventListener("click", () => onPageChange(currentPage - 1));

    const pageLabel = document.createElement("span");
    pageLabel.className = "muted";
    pageLabel.textContent = `Page ${currentPage} of ${totalPages}`;

    const nextButton = document.createElement("button");
    nextButton.type = "button";
    nextButton.className = "secondary";
    nextButton.textContent = "Next";
    nextButton.disabled = currentPage >= totalPages;
    nextButton.addEventListener("click", () => onPageChange(currentPage + 1));

    container.appendChild(previousButton);
    container.appendChild(pageLabel);
    container.appendChild(nextButton);
  }

  createUrgencyGrade(urgency) {
    const grade = document.createElement("span");
    grade.className = "urgency-grade";
    grade.textContent = TaskModel.normalizeUrgency(urgency, "C");
    grade.title = `Urgency ${grade.textContent}`;
    grade.ariaLabel = `Urgency ${grade.textContent}`;
    return grade;
  }

  createCategoryIcon(category) {
    const normalized = TaskModel.normalizeCategory(category, null);
    if (!normalized) return null;
    const icon = document.createElement("span");
    icon.className = "category-icon";
    icon.title = `${normalized} category`;
    icon.ariaLabel = `${normalized} category`;
    icon.innerHTML = CONFIG.CATEGORY_ICON_SVGS[normalized];
    return icon;
  }

  renderList(listEl, items, now = Date.now(), onComplete, onEdit, onDelete) {
    listEl.innerHTML = "";
    if (!items.length) {
      const empty = document.createElement("li");
      empty.className = "muted";
      empty.textContent = "No items right now.";
      listEl.appendChild(empty);
      return;
    }
    for (const item of items) {
      const li = document.createElement("li");
      if (listEl.id === "tasks-list") li.classList.add(item.schedule === "recurring" ? "schedule-recurring" : "schedule-one-time");
      li.style.borderColor = item.color;
      const left = document.createElement("div");
      left.className = "item-content";
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.ariaLabel = `Complete ${item.name}`;
      checkbox.addEventListener("change", () => {
        if (!checkbox.checked) return;
        onComplete(item.id, li, checkbox);
      });
      const color = document.createElement("span");
      color.className = "item-color";
      color.style.backgroundColor = item.color;
      const categoryIcon = this.createCategoryIcon(item.category);
      const textWrap = document.createElement("div");
      const name = document.createElement("div");
      name.textContent = item.name;
      const meta = document.createElement("div");
      meta.className = "muted";
      meta.textContent = `urgency ${item.urgency} • ${TaskModel.recurrenceText(item)} • ${TaskModel.dueDurationText(item, now)}`;
      const actions = document.createElement("div");
      actions.className = "actions";
      const urgencyGrade = this.createUrgencyGrade(item.urgency);
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "secondary";
      editButton.textContent = "Edit";
      editButton.addEventListener("click", () => onEdit(item.id));
      const deleteButton = document.createElement("button");
      deleteButton.type = "button";
      deleteButton.className = "danger";
      deleteButton.textContent = "Delete";
      deleteButton.addEventListener("click", () => onDelete(item.id));
      textWrap.appendChild(name);
      textWrap.appendChild(meta);
      left.appendChild(checkbox);
      left.appendChild(color);
      if (categoryIcon) left.appendChild(categoryIcon);
      left.appendChild(textWrap);
      actions.appendChild(urgencyGrade);
      actions.appendChild(editButton);
      actions.appendChild(deleteButton);
      li.appendChild(left);
      li.appendChild(actions);
      listEl.appendChild(li);
    }
  }

  renderStats(statsGraph, statsSummary, completedEntries, itemsById) {
    if (!statsGraph || !statsSummary) return;
    const DAY_MS = 24 * 60 * 60 * 1000;
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    const todayStart = now.getTime();
    const firstDayStart = todayStart - DAY_MS * 6;
    const xpPerDay = Array.from({ length: 7 }, () => 0);

    for (const entry of completedEntries) {
      const completedAt = Number(entry?.completedAt);
      if (!Number.isFinite(completedAt) || completedAt < firstDayStart || completedAt >= todayStart + DAY_MS) continue;
      const entryDayStart = new Date(completedAt);
      entryDayStart.setHours(0, 0, 0, 0);
      const dayIndex = Math.floor((entryDayStart.getTime() - firstDayStart) / DAY_MS);
      if (dayIndex < 0 || dayIndex > 6) continue;
      const linkedItem = itemsById.get(entry.itemId);
      xpPerDay[dayIndex] += TaskModel.getHistoryEntryExperiencePoints(entry, linkedItem);
    }

    const width = 700;
    const height = 240;
    const padding = { top: 14, right: 16, bottom: 34, left: 44 };
    const innerWidth = width - padding.left - padding.right;
    const innerHeight = height - padding.top - padding.bottom;
    const maxY = Math.max(1, ...xpPerDay);
    const createSvgEl = (tag) => document.createElementNS("http://www.w3.org/2000/svg", tag);
    statsGraph.innerHTML = "";
    statsGraph.setAttribute("viewBox", `0 0 ${width} ${height}`);

    for (let step = 0; step <= 4; step += 1) {
      const yValue = Math.round((maxY * step) / 4);
      const y = padding.top + innerHeight - (innerHeight * yValue) / maxY;
      const grid = createSvgEl("line");
      grid.setAttribute("x1", String(padding.left));
      grid.setAttribute("x2", String(width - padding.right));
      grid.setAttribute("y1", String(y));
      grid.setAttribute("y2", String(y));
      grid.setAttribute("class", "stats-grid");
      statsGraph.appendChild(grid);

      const label = createSvgEl("text");
      label.setAttribute("x", String(padding.left - 8));
      label.setAttribute("y", String(y + 4));
      label.setAttribute("text-anchor", "end");
      label.setAttribute("class", "stats-label");
      label.textContent = String(yValue);
      statsGraph.appendChild(label);
    }

    const xAxis = createSvgEl("line");
    xAxis.setAttribute("x1", String(padding.left));
    xAxis.setAttribute("x2", String(width - padding.right));
    xAxis.setAttribute("y1", String(height - padding.bottom));
    xAxis.setAttribute("y2", String(height - padding.bottom));
    xAxis.setAttribute("class", "stats-axis");
    statsGraph.appendChild(xAxis);

    const yAxis = createSvgEl("line");
    yAxis.setAttribute("x1", String(padding.left));
    yAxis.setAttribute("x2", String(padding.left));
    yAxis.setAttribute("y1", String(padding.top));
    yAxis.setAttribute("y2", String(height - padding.bottom));
    yAxis.setAttribute("class", "stats-axis");
    statsGraph.appendChild(yAxis);

    const points = xpPerDay.map((value, index) => {
      const x = padding.left + (innerWidth * index) / 6;
      const y = padding.top + innerHeight - (innerHeight * value) / maxY;
      return { x, y, index };
    });

    const polyline = createSvgEl("polyline");
    polyline.setAttribute("points", points.map((point) => `${point.x.toFixed(2)},${point.y.toFixed(2)}`).join(" "));
    polyline.setAttribute("class", "stats-line");
    statsGraph.appendChild(polyline);

    const dayLabelFormatter = new Intl.DateTimeFormat(undefined, { weekday: "short" });
    for (const point of points) {
      const dot = createSvgEl("circle");
      dot.setAttribute("cx", String(point.x));
      dot.setAttribute("cy", String(point.y));
      dot.setAttribute("r", "3");
      dot.setAttribute("class", "stats-point");
      statsGraph.appendChild(dot);

      const day = new Date(firstDayStart + point.index * DAY_MS);
      const xLabel = createSvgEl("text");
      xLabel.setAttribute("x", String(point.x));
      xLabel.setAttribute("y", String(height - 12));
      xLabel.setAttribute("text-anchor", "middle");
      xLabel.setAttribute("class", "stats-label");
      xLabel.textContent = dayLabelFormatter.format(day);
      statsGraph.appendChild(xLabel);
    }

    const totalWeekXp = xpPerDay.reduce((sum, value) => sum + value, 0);
    const todayXp = xpPerDay[6] || 0;
    statsSummary.textContent = `Last 7 days: ${totalWeekXp} XP total • Today: ${todayXp} XP`;
  }

  renderHistory(app, now = Date.now()) {
    const { historyList, historyPagination, statsGraph, statsSummary } = app.dom;
    historyList.innerHTML = "";
    const itemsById = new Map(app.loadItems().map((item) => [item.id, item]));
    const completedEntries = app
      .loadHistory()
      .filter((entry) => entry && entry.name && entry.completedAt)
      .sort((a, b) => b.completedAt - a.completedAt);
    this.renderStats(statsGraph, statsSummary, completedEntries, itemsById);
    app.historyPage = this.clampPage(app.historyPage, completedEntries.length);
    const visibleEntries = this.getPageEntries(completedEntries, app.historyPage);
    this.renderPagination(historyPagination, completedEntries.length, app.historyPage, (nextPage) => {
      app.historyPage = nextPage;
      this.renderHistory(app, now);
    });

    if (!visibleEntries.length) {
      const empty = document.createElement("li");
      empty.className = "muted";
      empty.textContent = "No completed items yet.";
      historyList.appendChild(empty);
      return;
    }

    for (const entry of visibleEntries) {
      const li = document.createElement("li");
      const left = document.createElement("div");
      left.className = "item-content";
      const color = document.createElement("span");
      color.className = "item-color";
      const linkedItem = itemsById.get(entry.itemId);
      const colorValue = TaskModel.normalizeColor(entry.color, linkedItem?.color || TaskModel.getDefaultColor());
      color.style.backgroundColor = colorValue;
      li.style.borderColor = colorValue;
      const name = document.createElement("div");
      name.textContent = entry.name;
      const meta = document.createElement("div");
      meta.className = "muted";
      const completedAt = TaskModel.formatDisplayDateTime(entry.completedAt, now);
      const urgency = TaskModel.normalizeUrgency(entry.urgency, linkedItem?.urgency || "C");
      const returnText = TaskModel.recurringReturnText(entry, linkedItem, now);
      const metaParts = ["Urgency " + urgency, "Completed " + completedAt];
      if (returnText) metaParts.push("• " + returnText);
      meta.textContent = metaParts.join(" ");
      const textWrap = document.createElement("div");
      textWrap.appendChild(name);
      textWrap.appendChild(meta);
      const actions = document.createElement("div");
      actions.className = "actions";
      const addToQueueButton = document.createElement("button");
      addToQueueButton.type = "button";
      addToQueueButton.className = "secondary";
      addToQueueButton.textContent = "Add To Queue Now";
      if (linkedItem) addToQueueButton.addEventListener("click", () => app.addToQueueNow(linkedItem.id));
      else {
        addToQueueButton.disabled = true;
        addToQueueButton.title = "Item no longer exists in the queue";
      }
      const editButton = document.createElement("button");
      editButton.type = "button";
      editButton.className = "secondary";
      editButton.textContent = "Edit";
      if (linkedItem) editButton.addEventListener("click", () => app.startEditingItem(linkedItem.id));
      else {
        editButton.disabled = true;
        editButton.title = "Item no longer exists in the queue";
      }
      actions.appendChild(addToQueueButton);
      actions.appendChild(editButton);
      left.appendChild(color);
      left.appendChild(textWrap);
      li.appendChild(left);
      li.appendChild(actions);
      historyList.appendChild(li);
    }
  }

  renderTasks(app, now = Date.now()) {
    const { tasksList, tasksPagination, experiencePointsDisplay, sortModeInput } = app.dom;
    const items = app.loadItems();
    const selectedCategoryFilters = app.getSelectedCategoryFilters();
    const visibleTasks = items.filter((item) => TaskModel.isVisibleNow(item, now) && TaskModel.isVisibleCategory(item, selectedCategoryFilters));
    const sortedTasks = TaskModel.sortTasks(visibleTasks, now, sortModeInput?.value || "latency");
    app.tasksPage = this.clampPage(app.tasksPage, sortedTasks.length);
    if (experiencePointsDisplay) {
      experiencePointsDisplay.textContent = `${Math.max(0, Number(app.appState.experiencePoints) || 0)} XP`;
    }
    this.renderList(
      tasksList,
      this.getPageEntries(sortedTasks, app.tasksPage),
      now,
      (id, listItemEl, checkboxEl) => app.completeItem(id, listItemEl, checkboxEl),
      (id) => app.startEditingItem(id),
      (id) => app.deleteItemPermanently(id)
    );
    this.renderPagination(tasksPagination, sortedTasks.length, app.tasksPage, (nextPage) => {
      app.tasksPage = nextPage;
      app.render();
    });
  }
}
