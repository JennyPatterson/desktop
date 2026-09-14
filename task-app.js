import { CONFIG } from "./config.js";
import { TaskModel } from "./task-model.js";
import { TaskStateStore } from "./state-store.js";
import { TaskSyncService } from "./sync-service.js";
import { TaskService } from "./task-service.js";
import { TaskRenderer } from "./task-renderer.js";

export class TaskboardApp {
  constructor() {
    this.store = new TaskStateStore();
    this.syncService = new TaskSyncService(() => this.dom?.githubTokenInput?.value?.trim() || "");
    this.taskService = new TaskService();
    this.renderer = new TaskRenderer();
    this.dom = this.getDom();

    this.editingItemId = null;
    this.syncId = null;
    this.remoteRevision = 0;
    this.remoteEtag = null;
    this.remoteSyncTimer = null;
    this.pendingRemoteWrite = false;
    this.remoteSyncInFlight = false;
    this.tasksPage = 1;
    this.historyPage = 1;
    this.appState = TaskModel.normalizeSnapshot(null);
  }

  getDom() {
    return {
      form: document.getElementById("item-form"),
      scheduleSelect: document.getElementById("schedule"),
      intervalLabel: document.getElementById("interval-label"),
      intervalValueInput: document.getElementById("interval-value"),
      intervalUnitInput: document.getElementById("interval-unit"),
      urgencyInput: document.getElementById("urgency"),
      categoryInput: document.getElementById("category"),
      experiencePointsDisplay: document.getElementById("experience-points"),
      editPanel: document.getElementById("edit-panel"),
      editForm: document.getElementById("edit-form"),
      editNameInput: document.getElementById("edit-name"),
      editScheduleInput: document.getElementById("edit-schedule"),
      editIntervalLabel: document.getElementById("edit-interval-label"),
      editIntervalValueInput: document.getElementById("edit-interval-value"),
      editIntervalUnitInput: document.getElementById("edit-interval-unit"),
      editColorInput: document.getElementById("edit-color"),
      editUrgencyInput: document.getElementById("edit-urgency"),
      editCategoryInput: document.getElementById("edit-category"),
      cancelEditButton: document.getElementById("cancel-edit"),
      contextMenuToggle: document.getElementById("context-menu-toggle"),
      contextMenuPanel: document.getElementById("context-menu-panel"),
      sortModeInput: document.getElementById("sort-mode"),
      categoryFilterInputs: Array.from(document.querySelectorAll('input[name="category-filter"]')),
      tasksList: document.getElementById("tasks-list"),
      historyList: document.getElementById("history-list"),
      tasksPagination: document.getElementById("tasks-pagination"),
      historyPagination: document.getElementById("history-pagination"),
      statsGraph: document.getElementById("stats-graph"),
      statsSummary: document.getElementById("stats-summary"),
      collapseToggleButtons: Array.from(document.querySelectorAll(".collapse-toggle")),
      githubTokenInput: document.getElementById("github-token"),
      saveGithubTokenButton: document.getElementById("save-github-token"),
      createSharedSyncButton: document.getElementById("create-shared-sync"),
      syncNowButton: document.getElementById("sync-now"),
      syncLinkInput: document.getElementById("sync-link"),
      copySyncLinkButton: document.getElementById("copy-sync-link"),
      syncCopyStatus: document.getElementById("sync-copy-status"),
    };
  }

  init() {
    this.store.nukeLocalStateForFreshStart();
    this.clearLegacyHashStateParam();
    this.appState = this.store.loadState();
    this.syncId = new URLSearchParams(window.location.search).get(CONFIG.SYNC_ID_PARAM) || null;
    this.initializeUiState();
    this.bindEvents();
    this.render();
    this.reconcileFromRemote();
    setInterval(() => this.render(), 30 * 1000);
  }

  initializeUiState() {
    const {
      sortModeInput,
      urgencyInput,
      editUrgencyInput,
      categoryInput,
      editCategoryInput,
      githubTokenInput,
    } = this.dom;
    sortModeInput.value = this.appState.sortMode;
    this.setSelectedCategoryFilters(this.appState.categoryFilters);
    urgencyInput.value = "C";
    editUrgencyInput.value = "C";
    categoryInput.value = "";
    editCategoryInput.value = "";
    githubTokenInput.value = this.store.loadGithubToken();
    this.updateSyncLinkDisplay();
    this.initCollapsibleSections();
    this.toggleIntervalVisibility();
    this.toggleEditIntervalVisibility();
  }

  bindEvents() {
    const {
      form,
      scheduleSelect,
      editScheduleInput,
      cancelEditButton,
      contextMenuToggle,
      contextMenuPanel,
      copySyncLinkButton,
      saveGithubTokenButton,
      createSharedSyncButton,
      syncNowButton,
      sortModeInput,
      categoryFilterInputs,
      editForm,
    } = this.dom;

    form.addEventListener("submit", (event) => this.onCreateSubmit(event));
    editForm.addEventListener("submit", (event) => this.onEditSubmit(event));
    contextMenuToggle?.addEventListener("click", (event) => {
      event.stopPropagation();
      this.setContextMenuOpen(!this.isContextMenuOpen());
    });
    contextMenuPanel?.addEventListener("click", (event) => {
      event.stopPropagation();
    });
    document.addEventListener("click", () => {
      if (this.isContextMenuOpen()) this.setContextMenuOpen(false);
    });
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && this.isContextMenuOpen()) this.setContextMenuOpen(false);
    });
    scheduleSelect.addEventListener("change", () => this.toggleIntervalVisibility());
    editScheduleInput.addEventListener("change", () => this.toggleEditIntervalVisibility());
    cancelEditButton.addEventListener("click", () => this.closeEditPanel());
    copySyncLinkButton?.addEventListener("click", () => this.copySyncLink());
    saveGithubTokenButton?.addEventListener("click", () => this.onSaveToken());
    createSharedSyncButton?.addEventListener("click", () => this.onCreateSharedSync());
    syncNowButton?.addEventListener("click", () => this.onSyncNow());
    window.addEventListener("online", () => this.onOnline());
    window.addEventListener("hashchange", () => this.onHashChange());
    sortModeInput.addEventListener("change", () => {
      this.persistState({ ...this.appState, sortMode: sortModeInput.value });
      this.render();
    });
    for (const input of categoryFilterInputs) {
      input.addEventListener("change", () => {
        const categoryFilters = TaskModel.normalizeCategoryFilters(this.getSelectedCategoryFilters());
        this.persistState({ ...this.appState, categoryFilters });
        this.render();
      });
    }
  }

  loadItems() {
    return this.appState.items.map((item) => ({ ...item }));
  }

  loadHistory() {
    return this.appState.history.map((entry) => ({ ...entry }));
  }

  persistState(nextState, options = {}) {
    this.appState = this.store.persistState(nextState, options);
    this.updateSyncLinkDisplay();
    if (options.skipRemote !== true) this.queueRemoteSync();
  }

  getSelectedCategoryFilters() {
    if (!this.dom.categoryFilterInputs.length) return [...CONFIG.DEFAULT_CATEGORY_FILTERS];
    return this.dom.categoryFilterInputs.filter((input) => input.checked).map((input) => input.value);
  }

  setSelectedCategoryFilters(values) {
    const selected = new Set(TaskModel.normalizeCategoryFilters(values));
    for (const input of this.dom.categoryFilterInputs) input.checked = selected.has(input.value);
  }

  clearLegacyHashStateParam() {
    try {
      const hash = window.location.hash.startsWith("#") ? window.location.hash.slice(1) : "";
      if (!hash) return;
      const params = new URLSearchParams(hash);
      if (!params.has(CONFIG.HASH_STATE_PARAM)) return;
      params.delete(CONFIG.HASH_STATE_PARAM);
      const nextHash = params.toString();
      const nextPath = window.location.pathname + window.location.search + (nextHash ? "#" + nextHash : "");
      window.history.replaceState(
        null,
        "",
        nextPath
      );
    } catch {}
  }

  updateSyncIdInUrl(id) {
    const params = new URLSearchParams(window.location.search);
    if (id) params.set(CONFIG.SYNC_ID_PARAM, id);
    else params.delete(CONFIG.SYNC_ID_PARAM);
    const nextSearch = params.toString();
    const nextPath = window.location.pathname + (nextSearch ? "?" + nextSearch : "") + window.location.hash;
    window.history.replaceState(
      null,
      "",
      nextPath
    );
  }

  getSyncUrl() {
    const params = new URLSearchParams(window.location.search);
    if (this.syncId) {
      params.set(CONFIG.SYNC_ID_PARAM, this.syncId);
      return `${window.location.origin}${window.location.pathname}?${params.toString()}`;
    }
    return `${window.location.origin}${window.location.pathname}${window.location.search}${window.location.hash}`;
  }

  updateSyncLinkDisplay(status = "") {
    if (this.dom.syncLinkInput) this.dom.syncLinkInput.value = this.getSyncUrl();
    if (this.dom.syncCopyStatus) this.dom.syncCopyStatus.textContent = status;
  }

  setSectionCollapsed(toggleButton, collapsed) {
    if (!toggleButton) return;
    const targetId = toggleButton.dataset.target;
    if (!targetId) return;
    const content = document.getElementById(targetId);
    if (!content) return;
    content.hidden = collapsed;
    toggleButton.setAttribute("aria-expanded", String(!collapsed));
    toggleButton.textContent = collapsed ? "v" : "^";
  }

  initCollapsibleSections() {
    for (const button of this.dom.collapseToggleButtons) {
      const expanded = button.getAttribute("aria-expanded") !== "false";
      this.setSectionCollapsed(button, !expanded);
      button.addEventListener("click", () => {
        const isExpanded = button.getAttribute("aria-expanded") === "true";
        this.setSectionCollapsed(button, isExpanded);
      });
    }
  }

  toggleIntervalVisibility() {
    this.dom.intervalLabel.style.display = this.dom.scheduleSelect.value === "recurring" ? "grid" : "none";
    this.resizeScheduleSelect(this.dom.scheduleSelect);
  }

  toggleEditIntervalVisibility() {
    this.dom.editIntervalLabel.style.display = this.dom.editScheduleInput.value === "recurring" ? "grid" : "none";
    this.resizeScheduleSelect(this.dom.editScheduleInput);
  }

  resizeScheduleSelect(selectInput) {
    const selectedOption = selectInput?.options?.[selectInput.selectedIndex];
    const text = (selectedOption?.textContent || "").trim();
    const widthCh = Math.ceil(Math.max(8, text.length + 2) * 1.3);
    selectInput.style.width = `${widthCh}ch`;
  }

  setContextMenuOpen(isOpen) {
    if (!this.dom.contextMenuToggle || !this.dom.contextMenuPanel) return;
    this.dom.contextMenuPanel.hidden = !isOpen;
    this.dom.contextMenuToggle.setAttribute("aria-expanded", String(isOpen));
  }

  isContextMenuOpen() {
    return Boolean(this.dom.contextMenuPanel && !this.dom.contextMenuPanel.hidden);
  }

  queueRemoteSync() {
    if (!this.syncId) return;
    const token = this.dom.githubTokenInput?.value?.trim() || "";
    if (!token) return;
    this.pendingRemoteWrite = true;
    if (this.remoteSyncTimer) clearTimeout(this.remoteSyncTimer);
    this.remoteSyncTimer = setTimeout(() => {
      this.flushRemoteSync();
    }, CONFIG.REMOTE_SYNC_DEBOUNCE_MS);
  }

  async flushRemoteSync(retryOnConflict = true) {
    if (!this.syncId || this.remoteSyncInFlight || !this.pendingRemoteWrite) return;
    const token = this.dom.githubTokenInput?.value?.trim() || "";
    if (!token) {
      this.pendingRemoteWrite = true;
      this.updateSyncLinkDisplay("Add token to sync changes to GitHub.");
      return;
    }
    this.pendingRemoteWrite = false;
    this.remoteSyncInFlight = true;
    try {
      const latest = await this.syncService.writeRemoteState(this.syncId, this.appState, this.remoteRevision, token);
      this.remoteRevision = latest.revision;
      this.remoteEtag = latest.etag;
      this.updateSyncLinkDisplay("Synced to GitHub.");
    } catch (error) {
      if (error?.code === "conflict" && retryOnConflict) {
        const latest = error?.latest || (await this.syncService.readRemoteState(this.syncId, token));
        this.remoteRevision = latest.revision;
        this.remoteEtag = latest.etag;
        if (latest.snapshot.updatedAt >= this.appState.updatedAt) {
          this.persistState(latest.snapshot, { preserveUpdatedAt: true, skipRemote: true });
          this.dom.sortModeInput.value = this.appState.sortMode;
          this.setSelectedCategoryFilters(this.appState.categoryFilters);
          this.render();
          this.updateSyncLinkDisplay("Conflict resolved using latest remote state.");
        } else {
          this.pendingRemoteWrite = true;
          await this.flushRemoteSync(false);
        }
      } else {
        this.pendingRemoteWrite = true;
        this.updateSyncLinkDisplay(`Sync pending: ${error.message}`);
      }
    } finally {
      this.remoteSyncInFlight = false;
    }
  }

  async reconcileFromRemote() {
    if (!this.syncId) return;
    const token = this.dom.githubTokenInput?.value?.trim() || "";
    try {
      const remote = await this.syncService.readRemoteState(this.syncId, token);
      this.remoteRevision = remote.revision;
      this.remoteEtag = remote.etag;
      if (remote.snapshot.updatedAt >= this.appState.updatedAt) {
        this.persistState(remote.snapshot, { preserveUpdatedAt: true, skipRemote: true });
        this.dom.sortModeInput.value = this.appState.sortMode;
        this.setSelectedCategoryFilters(this.appState.categoryFilters);
        this.render();
        this.updateSyncLinkDisplay("Synced from GitHub.");
        return;
      }
      if (token) this.queueRemoteSync();
      else this.updateSyncLinkDisplay("Loaded remote state. Add token to push edits from this device.");
    } catch (error) {
      this.updateSyncLinkDisplay(`Remote sync unavailable: ${error.message}`);
    }
  }

  render() {
    const now = Date.now();
    this.renderer.renderTasks(this, now);
    this.renderer.renderHistory(this, now);
  }

  completeItem(id, listItemEl, checkboxEl) {
    if (listItemEl?.classList.contains("completing")) return;
    if (checkboxEl) {
      checkboxEl.disabled = true;
      checkboxEl.checked = true;
    }
    if (listItemEl) listItemEl.classList.add("completing");

    const applyCompletion = () => {
      this.persistState(this.taskService.completeItem(this.appState, id));
      this.render();
    };

    if (listItemEl) setTimeout(applyCompletion, 420);
    else applyCompletion();
  }

  addToQueueNow(itemId) {
    this.persistState(this.taskService.addToQueueNow(this.appState, itemId));
    this.render();
  }

  deleteItemPermanently(id) {
    const items = this.loadItems();
    const itemToDelete = items.find((item) => item.id === id);
    if (!itemToDelete) return;
    const confirmed = window.confirm(`Delete "${itemToDelete.name}" permanently from the queue?`);
    if (!confirmed) return;
    this.persistState(this.taskService.deleteItem(this.appState, id));
    if (this.editingItemId === id) this.closeEditPanel();
    this.render();
  }

  startEditingItem(id) {
    const items = this.loadItems();
    const item = items.find((candidate) => candidate.id === id);
    if (!item) return;
    this.editingItemId = id;
    this.dom.editNameInput.value = item.name;
    this.dom.editScheduleInput.value = item.schedule;
    const { value, unit } = TaskModel.normalizeInterval(item);
    this.dom.editIntervalValueInput.value = value;
    this.dom.editIntervalUnitInput.value = unit;
    this.dom.editColorInput.value = item.color;
    this.dom.editUrgencyInput.value = item.urgency;
    this.dom.editCategoryInput.value = TaskModel.normalizeCategory(item.category, "") || "";
    this.toggleEditIntervalVisibility();
    this.dom.editPanel.hidden = false;
    this.dom.editNameInput.focus();
  }

  closeEditPanel() {
    this.editingItemId = null;
    this.dom.editPanel.hidden = true;
    this.dom.editForm.reset();
    this.dom.editScheduleInput.value = "one-time";
    this.dom.editIntervalUnitInput.value = "days";
    this.dom.editUrgencyInput.value = "C";
    this.dom.editCategoryInput.value = "";
    this.toggleEditIntervalVisibility();
  }

  async copySyncLink() {
    const link = this.dom.syncLinkInput?.value || this.getSyncUrl();
    try {
      if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(link);
      else {
        if (!this.dom.syncLinkInput) {
          this.updateSyncLinkDisplay("Copy failed. Please copy the sync link manually.");
          return;
        }
        this.dom.syncLinkInput.focus();
        this.dom.syncLinkInput.select();
        const copied = document.execCommand("copy");
        if (!copied) {
          this.updateSyncLinkDisplay("Copy failed. Please copy the sync link manually.");
          return;
        }
      }
      this.updateSyncLinkDisplay("Sync link copied. Open it on mobile to use the same saved history.");
    } catch {
      this.updateSyncLinkDisplay("Copy failed. Please copy the sync link manually.");
    }
  }

  onSaveToken() {
    const token = this.dom.githubTokenInput?.value?.trim() || "";
    const didSave = this.store.saveGithubToken(token);
    if (!token) {
      this.updateSyncLinkDisplay("Token cleared on this device.");
      return;
    }
    if (!didSave) {
      this.updateSyncLinkDisplay("Unable to save token on this device. Keep this tab open and sync without refreshing.");
      return;
    }
    this.updateSyncLinkDisplay("Token saved on this device.");
  }

  async onCreateSharedSync() {
    try {
      const result = await this.syncService.createRemoteState(
        this.appState,
        this.dom.githubTokenInput?.value?.trim() || ""
      );
      this.syncId = result.id;
      this.remoteRevision = result.revision;
      this.remoteEtag = result.etag;
      this.updateSyncIdInUrl(this.syncId);
      this.updateSyncLinkDisplay("Shared sync link created.");
      await this.reconcileFromRemote();
      this.render();
    } catch (error) {
      this.updateSyncLinkDisplay(error?.message || "Unable to create shared sync link.");
    }
  }

  async onSyncNow() {
    try {
      await this.reconcileFromRemote();
      if ((this.dom.githubTokenInput?.value?.trim() || "") && this.syncId) {
        this.pendingRemoteWrite = true;
        await this.flushRemoteSync();
      }
    } catch (error) {
      this.updateSyncLinkDisplay(error?.message || "Sync failed.");
    }
  }

  onOnline() {
    if (this.syncId && (this.dom.githubTokenInput?.value?.trim() || "")) {
      this.pendingRemoteWrite = true;
      this.flushRemoteSync();
    }
  }

  onHashChange() {
    this.appState = this.store.loadState();
    this.dom.sortModeInput.value = this.appState.sortMode;
    this.setSelectedCategoryFilters(this.appState.categoryFilters);
    this.render();
    this.updateSyncLinkDisplay();
  }

  onCreateSubmit(event) {
    event.preventDefault();
    const nameInput = document.getElementById("name");
    const schedule = this.dom.scheduleSelect.value;
    const name = nameInput.value.trim();
    if (!name) return;
    const intervalValue = TaskModel.normalizeRecurrenceValue(this.dom.intervalValueInput.value);
    const intervalUnit = CONFIG.UNIT_TO_MINUTES[this.dom.intervalUnitInput.value] ? this.dom.intervalUnitInput.value : "days";
    const intervalMinutes = intervalValue * CONFIG.UNIT_TO_MINUTES[intervalUnit];
    const urgency = TaskModel.normalizeUrgency(this.dom.urgencyInput.value, "C");
    const category = TaskModel.normalizeCategory(this.dom.categoryInput.value, null);

    this.persistState(
      this.taskService.createItem(this.appState, {
        name,
        schedule,
        intervalValue,
        intervalUnit,
        intervalMinutes,
        urgency,
        category,
        now: Date.now(),
      })
    );
    this.dom.form.reset();
    this.dom.scheduleSelect.value = "one-time";
    this.dom.intervalUnitInput.value = "days";
    this.dom.urgencyInput.value = "C";
    this.dom.categoryInput.value = "";
    this.toggleIntervalVisibility();
    this.render();
  }

  onEditSubmit(event) {
    event.preventDefault();
    if (!this.editingItemId) return;
    const name = this.dom.editNameInput.value.trim();
    if (!name) return;
    const schedule = this.dom.editScheduleInput.value;
    const color = TaskModel.normalizeColor(this.dom.editColorInput.value, TaskModel.getDefaultColor());
    const urgency = TaskModel.normalizeUrgency(this.dom.editUrgencyInput.value, "C");
    const category = TaskModel.normalizeCategory(this.dom.editCategoryInput.value, null);
    const intervalValue = TaskModel.normalizeRecurrenceValue(this.dom.editIntervalValueInput.value);
    const intervalUnit = CONFIG.UNIT_TO_MINUTES[this.dom.editIntervalUnitInput.value] ? this.dom.editIntervalUnitInput.value : "days";
    const intervalMinutes = intervalValue * CONFIG.UNIT_TO_MINUTES[intervalUnit];
    this.persistState(
      this.taskService.updateItem(this.appState, this.editingItemId, {
        name,
        color,
        urgency,
        category,
        schedule,
        intervalMinutes: schedule === "recurring" ? intervalMinutes : null,
        intervalValue: schedule === "recurring" ? intervalValue : null,
        intervalUnit: schedule === "recurring" ? intervalUnit : null,
      })
    );
    this.closeEditPanel();
    this.render();
  }
}
