/* my-agenda — built from src/main.ts, do not edit main.js by hand */
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => AgendaPlugin
});
module.exports = __toCommonJS(main_exports);
var import_obsidian = require("obsidian");
var VIEW_TYPE = "my-agenda-view";
var PIXELS_PER_MINUTE = 2;
var MIN_BLOCK_HEIGHT = 16;
var REFRESH_DEBOUNCE_MS = 400;
var DEFAULT_SETTINGS = {
  plannerHeading: "Day planner",
  startHour: 6,
  endHour: 24,
  snapMinutes: 10,
  defaultDurationMinutes: 30
};
function timeToMinutes(t) {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + m;
}
function minutesToTime(min) {
  const clamped = Math.max(0, Math.min(24 * 60, Math.round(min)));
  const h = Math.floor(clamped / 60);
  const m = clamped % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}
function snap(minutes, step) {
  return Math.round(minutes / step) * step;
}
function parsePlannerTasks(content, heading) {
  const lines = content.split("\n");
  const headingRe = /^(#{1,6})\s+(.*)$/;
  let headingIdx = -1;
  let headingLevel = 0;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(headingRe);
    if (m && m[2].trim().toLowerCase() === heading.trim().toLowerCase()) {
      headingIdx = i;
      headingLevel = m[1].length;
      break;
    }
  }
  if (headingIdx === -1)
    return { tasks: [], headingFound: false, headingIdx: -1, headingLevel: 0 };
  const taskRe = /^(\s*)-\s\[([ xX])\]\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s+(.*)$/;
  const tasks = [];
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const line = lines[i];
    const hm = line.match(headingRe);
    if (hm && hm[1].length <= headingLevel)
      break;
    const tm = line.match(taskRe);
    if (tm) {
      tasks.push({
        line: i,
        indent: tm[1],
        checked: tm[2].toLowerCase() === "x",
        start: tm[3],
        end: tm[4],
        text: tm[5],
        raw: line
      });
    }
  }
  return { tasks, headingFound: true, headingIdx, headingLevel };
}
function getDailyNoteFormat(app) {
  var _a, _b, _c, _d;
  const dailyNotes = (_b = (_a = app.internalPlugins) == null ? void 0 : _a.getPluginById) == null ? void 0 : _b.call(_a, "daily-notes");
  return ((_d = (_c = dailyNotes == null ? void 0 : dailyNotes.instance) == null ? void 0 : _c.options) == null ? void 0 : _d.format) || "YYYY-MM-DD";
}
function findNoteFileForDate(app, date) {
  const expectedBasename = date.format(getDailyNoteFormat(app));
  const match = app.vault.getMarkdownFiles().find((f) => f.basename === expectedBasename);
  return match != null ? match : null;
}
async function createNoteFileForDate(app, date, plannerHeading) {
  var _a, _b, _c, _d, _e;
  const format = getDailyNoteFormat(app);
  const filename = date.format(format) + ".md";
  const dailyNotes = (_b = (_a = app.internalPlugins) == null ? void 0 : _a.getPluginById) == null ? void 0 : _b.call(_a, "daily-notes");
  const configuredFolder = ((_e = (_d = (_c = dailyNotes == null ? void 0 : dailyNotes.instance) == null ? void 0 : _c.options) == null ? void 0 : _d.folder) != null ? _e : "").trim();
  const calendarFolder = app.vault.getAbstractFileByPath("Calendar");
  let targetFolder = configuredFolder;
  if (calendarFolder) {
    targetFolder = `Calendar/${date.format("MMMM")}`;
  }
  if (targetFolder && !app.vault.getAbstractFileByPath(targetFolder)) {
    await app.vault.createFolder(targetFolder).catch(() => {
    });
  }
  const path = targetFolder ? `${targetFolder}/${filename}` : filename;
  return app.vault.create(path, `# ${plannerHeading}

`);
}
async function loadDay(app, date, heading) {
  const file = findNoteFileForDate(app, date);
  if (!file)
    return { file: null, tasks: [] };
  const content = await app.vault.read(file);
  const { tasks } = parsePlannerTasks(content, heading);
  return { file, tasks };
}
async function ensureNoteWithHeading(app, date, heading) {
  let file = findNoteFileForDate(app, date);
  if (!file) {
    return createNoteFileForDate(app, date, heading);
  }
  const data = await app.vault.read(file);
  const { headingFound } = parsePlannerTasks(data, heading);
  if (!headingFound) {
    const prefix = data.length && !data.endsWith("\n") ? "\n" : "";
    await app.vault.modify(file, `${data}${prefix}
# ${heading}
`);
  }
  return file;
}
function findInsertionIndex(lines, heading) {
  const { headingFound, headingIdx, headingLevel } = parsePlannerTasks(lines.join("\n"), heading);
  if (!headingFound)
    return lines.length;
  const headingRe = /^(#{1,6})\s+(.*)$/;
  const taskRe = /^(\s*)-\s\[([ xX])\]\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s+(.*)$/;
  let lastIdx = headingIdx;
  for (let i = headingIdx + 1; i < lines.length; i++) {
    const hm = lines[i].match(headingRe);
    if (hm && hm[1].length <= headingLevel)
      break;
    if (taskRe.test(lines[i]))
      lastIdx = i;
  }
  return lastIdx + 1;
}
var AgendaView = class extends import_obsidian.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.viewMode = "week";
    this.targetDate = (0, import_obsidian.moment)().startOf("day");
    this.refreshTimer = null;
    this.nowTimer = null;
    this.nowLines = [];
    this.editingInline = false;
    this.renderToken = 0;
    this.plugin = plugin;
  }
  getViewType() {
    return VIEW_TYPE;
  }
  getDisplayText() {
    return "My Agenda";
  }
  getIcon() {
    return "calendar-clock";
  }
  async onOpen() {
    const container = this.containerEl.children[1];
    container.empty();
    container.addClass("dp-container");
    this.headerEl = container.createDiv({ cls: "dp-header" });
    this.modeSwitchEl = this.headerEl.createDiv({ cls: "dp-mode-switch" });
    this.weekModeBtn = this.modeSwitchEl.createEl("button", { cls: "dp-mode-btn", text: "Week" });
    this.monthModeBtn = this.modeSwitchEl.createEl("button", { cls: "dp-mode-btn", text: "Month" });
    this.weekModeBtn.addEventListener("click", () => this.setMode("week"));
    this.monthModeBtn.addEventListener("click", () => this.setMode("month"));
    const nav = this.headerEl.createDiv({ cls: "dp-nav" });
    const prevBtn = nav.createEl("button", { cls: "dp-nav-btn", text: "\u2039" });
    prevBtn.addEventListener("click", () => {
      this.targetDate = this.targetDate.clone().subtract(1, this.viewMode);
      this.render();
    });
    this.dateLabelEl = nav.createSpan({ cls: "dp-date-label" });
    const nextBtn = nav.createEl("button", { cls: "dp-nav-btn", text: "\u203A" });
    nextBtn.addEventListener("click", () => {
      this.targetDate = this.targetDate.clone().add(1, this.viewMode);
      this.render();
    });
    const actions = this.headerEl.createDiv({ cls: "dp-actions" });
    this.todayBtn = actions.createEl("button", { text: "Today" });
    this.todayBtn.addEventListener("click", () => {
      this.targetDate = (0, import_obsidian.moment)().startOf("day");
      this.render();
    });
    const refreshBtn = actions.createEl("button", { text: "\u27F3" });
    refreshBtn.addEventListener("click", () => this.render());
    this.bodyEl = container.createDiv({ cls: "dp-body" });
    this.render();
    const scheduleRefresh = () => {
      if (this.editingInline)
        return;
      if (this.refreshTimer)
        window.clearTimeout(this.refreshTimer);
      this.refreshTimer = window.setTimeout(() => this.render(), REFRESH_DEBOUNCE_MS);
    };
    this.registerEvent(this.app.vault.on("modify", () => scheduleRefresh()));
    this.registerEvent(this.app.vault.on("rename", () => scheduleRefresh()));
    this.registerEvent(this.app.vault.on("delete", () => scheduleRefresh()));
    this.registerEvent(this.app.vault.on("create", () => scheduleRefresh()));
    this.nowTimer = window.setInterval(() => this.refreshNowLines(), 6e4);
  }
  async onClose() {
    if (this.refreshTimer)
      window.clearTimeout(this.refreshTimer);
    if (this.nowTimer)
      window.clearInterval(this.nowTimer);
  }
  setMode(mode) {
    this.viewMode = mode;
    this.render();
  }
  goToWeek(date) {
    this.targetDate = date.clone().startOf("day");
    this.viewMode = "week";
    this.render();
  }
  updateHeader() {
    this.weekModeBtn.toggleClass("dp-mode-btn-active", this.viewMode === "week");
    this.monthModeBtn.toggleClass("dp-mode-btn-active", this.viewMode === "month");
    const now = (0, import_obsidian.moment)();
    if (this.viewMode === "week") {
      const start = this.targetDate.clone().startOf("isoWeek");
      const end = start.clone().add(6, "days");
      this.dateLabelEl.setText(`${start.format("MMM D")} \u2013 ${end.format("MMM D")}`);
      this.todayBtn.disabled = now.isBetween(start, end, "day", "[]");
    } else {
      this.dateLabelEl.setText(this.targetDate.format("MMMM YYYY"));
      this.todayBtn.disabled = now.isSame(this.targetDate, "month");
    }
  }
  async render() {
    const token = ++this.renderToken;
    this.bodyEl.empty();
    this.nowLines = [];
    this.updateHeader();
    if (this.viewMode === "week")
      return this.renderWeekMode(token);
    return this.renderMonthMode(token);
  }
  // ---------- Week mode ----------
  async renderWeekMode(token) {
    const { startHour, endHour, plannerHeading } = this.plugin.settings;
    const totalMinutes = (endHour - startHour) * 60;
    const boundMin = { min: startHour * 60, max: endHour * 60 };
    const weekStart = this.targetDate.clone().startOf("isoWeek");
    const days = Array.from({ length: 7 }, (_, i) => weekStart.clone().add(i, "days"));
    const loaded = await Promise.all(days.map((d) => loadDay(this.app, d, plannerHeading)));
    if (token !== this.renderToken)
      return;
    const headers = this.bodyEl.createDiv({ cls: "dp-week-headers" });
    headers.createDiv({ cls: "dp-week-gutter" });
    days.forEach((d, i) => {
      const { tasks } = loaded[i];
      const cell = headers.createDiv({ cls: "dp-week-header-cell" });
      if (d.isSame((0, import_obsidian.moment)(), "day"))
        cell.addClass("dp-week-header-cell-today");
      cell.createDiv({ cls: "dp-week-header-day", text: d.format("ddd") });
      cell.createDiv({ cls: "dp-week-header-date", text: d.format("D") });
      if (tasks.length > 0) {
        const done = tasks.filter((t) => t.checked).length;
        cell.createDiv({ cls: "dp-week-badge", text: `${done}/${tasks.length}` });
      }
    });
    const row = this.bodyEl.createDiv({ cls: "dp-week-row" });
    const gutter = row.createDiv({ cls: "dp-week-gutter dp-week-gutter-body" });
    gutter.style.height = `${totalMinutes * PIXELS_PER_MINUTE}px`;
    this.renderHourGrid(gutter, startHour, endHour, true, true);
    days.forEach((d, i) => {
      const { file, tasks } = loaded[i];
      const col = row.createDiv({ cls: "dp-week-col dp-week-col-creatable" });
      col.style.height = `${totalMinutes * PIXELS_PER_MINUTE}px`;
      this.renderHourGrid(col, startHour, endHour, false);
      if (d.isSame((0, import_obsidian.moment)(), "day")) {
        this.addNowLine(col, d);
      }
      if (file) {
        for (const task of tasks) {
          this.renderTaskBlock(col, file, task, boundMin, true);
        }
      }
      col.addEventListener("click", (evt) => {
        if (evt.target !== col)
          return;
        this.beginCreateTask(col, d, boundMin, evt);
      });
    });
  }
  // ---------- Month mode ----------
  async renderMonthMode(token) {
    const { plannerHeading } = this.plugin.settings;
    const monthStart = this.targetDate.clone().startOf("month");
    const gridStart = monthStart.clone().startOf("isoWeek");
    const daysNeeded = monthStart.clone().endOf("month").diff(gridStart, "days") + 1;
    const weeks = Math.ceil(daysNeeded / 7);
    const days = Array.from({ length: weeks * 7 }, (_, i) => gridStart.clone().add(i, "days"));
    const loaded = await Promise.all(days.map((d) => loadDay(this.app, d, plannerHeading)));
    if (token !== this.renderToken)
      return;
    const weekdayRow = this.bodyEl.createDiv({ cls: "dp-month-weekdays" });
    for (let i = 0; i < 7; i++) {
      weekdayRow.createDiv({ cls: "dp-month-weekday", text: gridStart.clone().add(i, "days").format("ddd") });
    }
    const grid = this.bodyEl.createDiv({ cls: "dp-month-grid" });
    days.forEach((d, i) => {
      const { tasks } = loaded[i];
      const cell = grid.createDiv({ cls: "dp-month-cell" });
      if (d.month() !== monthStart.month())
        cell.addClass("dp-month-cell-muted");
      if (d.isSame((0, import_obsidian.moment)(), "day"))
        cell.addClass("dp-month-cell-today");
      cell.createDiv({ cls: "dp-month-daynum", text: d.format("D") });
      if (tasks.length > 0) {
        const done = tasks.filter((t) => t.checked).length;
        cell.createDiv({ cls: "dp-month-badge", text: `${done}/${tasks.length}` });
      }
      cell.addEventListener("click", () => this.goToWeek(d));
    });
  }
  // ---------- Inline task creation (Week mode) ----------
  async beginCreateTask(container, date, boundMin, evt) {
    const { snapMinutes, defaultDurationMinutes, plannerHeading } = this.plugin.settings;
    const rect = container.getBoundingClientRect();
    const offsetY = evt.clientY - rect.top;
    let startMin = boundMin.min + snap(offsetY / PIXELS_PER_MINUTE, snapMinutes);
    startMin = Math.max(boundMin.min, Math.min(boundMin.max - snapMinutes, startMin));
    const endMin = Math.min(boundMin.max, startMin + defaultDurationMinutes);
    const startStr = minutesToTime(startMin);
    const endStr = minutesToTime(endMin);
    const marker = `- [ ] ${startStr} - ${endStr} `;
    let file;
    try {
      file = await ensureNoteWithHeading(this.app, date, plannerHeading);
    } catch (e) {
      new import_obsidian.Notice(`Could not create note: ${e}`);
      return;
    }
    this.editingInline = true;
    const data = await this.app.vault.read(file);
    const lines = data.split("\n");
    const insertAt = findInsertionIndex(lines, plannerHeading);
    lines.splice(insertAt, 0, marker);
    await this.app.vault.modify(file, lines.join("\n"));
    const block = container.createDiv({ cls: "dp-task dp-task-compact dp-task-editing" });
    block.style.top = `${(startMin - boundMin.min) * PIXELS_PER_MINUTE}px`;
    block.style.height = `${Math.max(MIN_BLOCK_HEIGHT, (endMin - startMin) * PIXELS_PER_MINUTE)}px`;
    const checkbox = block.createEl("input", { type: "checkbox" });
    checkbox.disabled = true;
    const input = block.createEl("input", {
      type: "text",
      cls: "dp-task-input",
      attr: { placeholder: "Task\u2026" }
    });
    let settled = false;
    const commit = async (finalText) => {
      if (settled)
        return;
      settled = true;
      block.remove();
      const trimmed = finalText.trim();
      const freshData = await this.app.vault.read(file);
      const freshLines = freshData.split("\n");
      const idx = freshLines.indexOf(marker);
      if (idx === -1) {
        this.editingInline = false;
        this.render();
        return;
      }
      if (!trimmed) {
        freshLines.splice(idx, 1);
      } else {
        freshLines[idx] = `- [ ] ${startStr} - ${endStr} ${trimmed}`;
      }
      await this.app.vault.modify(file, freshLines.join("\n"));
      this.editingInline = false;
      this.render();
    };
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        input.blur();
      } else if (e.key === "Escape") {
        e.preventDefault();
        input.value = "";
        input.blur();
      }
    });
    input.addEventListener("blur", () => commit(input.value));
    input.focus();
  }
  // ---------- Shared rendering helpers ----------
  renderHourGrid(container, startHour, endHour, showLabels, compact = false) {
    for (let h = startHour; h <= endHour; h++) {
      const top = (h - startHour) * 60 * PIXELS_PER_MINUTE;
      const row = container.createDiv({ cls: "dp-hour-line" });
      row.style.top = `${top}px`;
      if (showLabels) {
        row.createSpan({
          cls: compact ? "dp-hour-label dp-hour-label-gutter" : "dp-hour-label",
          text: (0, import_obsidian.moment)({ hour: h % 24 }).format("H:00")
        });
      }
      if (h < endHour) {
        const halfTop = top + 30 * PIXELS_PER_MINUTE;
        container.createDiv({ cls: "dp-half-hour-line" }).style.top = `${halfTop}px`;
      }
    }
  }
  addNowLine(container, date) {
    const el = container.createDiv({ cls: "dp-now-line" });
    this.nowLines.push({ el, date });
    this.positionNowLine(el, date);
  }
  positionNowLine(el, date) {
    if (!date.isSame((0, import_obsidian.moment)(), "day")) {
      el.style.display = "none";
      return;
    }
    const { startHour, endHour } = this.plugin.settings;
    const nowMin = timeToMinutes((0, import_obsidian.moment)().format("HH:mm"));
    const startMin = startHour * 60;
    const endMin = endHour * 60;
    if (nowMin < startMin || nowMin > endMin) {
      el.style.display = "none";
      return;
    }
    el.style.display = "block";
    el.style.top = `${(nowMin - startMin) * PIXELS_PER_MINUTE}px`;
  }
  refreshNowLines() {
    for (const { el, date } of this.nowLines)
      this.positionNowLine(el, date);
  }
  renderTaskBlock(container, file, task, boundMin, compact = false) {
    const { snapMinutes } = this.plugin.settings;
    let startMin = timeToMinutes(task.start);
    let endMin = timeToMinutes(task.end);
    if (endMin <= startMin)
      endMin = startMin + snapMinutes;
    const block = container.createDiv({ cls: compact ? "dp-task dp-task-compact" : "dp-task" });
    if (task.checked)
      block.addClass("dp-task-checked");
    block.style.top = `${(startMin - boundMin.min) * PIXELS_PER_MINUTE}px`;
    block.style.height = `${Math.max(MIN_BLOCK_HEIGHT, (endMin - startMin) * PIXELS_PER_MINUTE)}px`;
    const checkbox = block.createEl("input", { type: "checkbox" });
    checkbox.checked = task.checked;
    checkbox.addEventListener("click", (evt) => {
      evt.stopPropagation();
      this.commitTaskEdit(file, task, task.start, task.end, checkbox.checked);
    });
    const label = block.createDiv({ cls: "dp-task-label" });
    if (!compact)
      label.createSpan({ cls: "dp-task-time", text: `${task.start}\u2013${task.end}` });
    label.createSpan({ cls: "dp-task-text", text: task.text });
    const resizeHandle = block.createDiv({ cls: "dp-resize-handle" });
    block.addEventListener("pointerdown", (downEvt) => {
      if (downEvt.target === resizeHandle || downEvt.target === checkbox)
        return;
      downEvt.preventDefault();
      downEvt.stopPropagation();
      const origStart = startMin;
      const origEnd = endMin;
      const duration = origEnd - origStart;
      const startY = downEvt.clientY;
      const onMove = (moveEvt) => {
        const deltaMin = snap((moveEvt.clientY - startY) / PIXELS_PER_MINUTE, snapMinutes);
        let newStart = origStart + deltaMin;
        newStart = Math.max(boundMin.min, Math.min(boundMin.max - duration, newStart));
        const newEnd = newStart + duration;
        block.style.top = `${(newStart - boundMin.min) * PIXELS_PER_MINUTE}px`;
        const timeEl = label.querySelector(".dp-task-time");
        if (timeEl)
          timeEl.textContent = `${minutesToTime(newStart)}\u2013${minutesToTime(newEnd)}`;
        block._pendingStart = newStart;
        block._pendingEnd = newEnd;
      };
      const onUp = () => {
        var _a, _b;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        const newStart = (_a = block._pendingStart) != null ? _a : origStart;
        const newEnd = (_b = block._pendingEnd) != null ? _b : origEnd;
        this.commitTaskEdit(file, task, minutesToTime(newStart), minutesToTime(newEnd), task.checked);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
    resizeHandle.addEventListener("pointerdown", (downEvt) => {
      downEvt.preventDefault();
      downEvt.stopPropagation();
      const origEnd = endMin;
      const startY = downEvt.clientY;
      const onMove = (moveEvt) => {
        const deltaMin = snap((moveEvt.clientY - startY) / PIXELS_PER_MINUTE, snapMinutes);
        let newEnd = origEnd + deltaMin;
        newEnd = Math.max(startMin + snapMinutes, Math.min(boundMin.max, newEnd));
        block.style.height = `${Math.max(MIN_BLOCK_HEIGHT, (newEnd - startMin) * PIXELS_PER_MINUTE)}px`;
        const timeEl = label.querySelector(".dp-task-time");
        if (timeEl)
          timeEl.textContent = `${minutesToTime(startMin)}\u2013${minutesToTime(newEnd)}`;
        block._pendingEnd = newEnd;
      };
      const onUp = () => {
        var _a;
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
        const newEnd = (_a = block._pendingEnd) != null ? _a : origEnd;
        this.commitTaskEdit(file, task, task.start, minutesToTime(newEnd), task.checked);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    });
  }
  async commitTaskEdit(file, task, newStart, newEnd, newChecked) {
    const data = await this.app.vault.read(file);
    const lines = data.split("\n");
    if (lines[task.line] !== task.raw) {
      new import_obsidian.Notice("My Agenda: note changed elsewhere, refreshing instead of saving.");
      this.render();
      return;
    }
    const checkedChar = newChecked ? "x" : " ";
    lines[task.line] = `${task.indent}- [${checkedChar}] ${newStart} - ${newEnd} ${task.text}`;
    await this.app.vault.modify(file, lines.join("\n"));
  }
};
var AgendaPlugin = class extends import_obsidian.Plugin {
  constructor() {
    super(...arguments);
    this.settings = DEFAULT_SETTINGS;
  }
  async onload() {
    await this.loadSettings();
    this.registerView(VIEW_TYPE, (leaf) => new AgendaView(leaf, this));
    this.addRibbonIcon("calendar-clock", "Open My Agenda", () => {
      this.activateView();
    });
    this.addCommand({
      id: "open-my-agenda",
      name: "Open My Agenda",
      callback: () => this.activateView()
    });
    this.addCommand({
      id: "my-agenda-show-week",
      name: "My Agenda: Show week view",
      callback: () => this.activateView("week")
    });
    this.addCommand({
      id: "my-agenda-show-month",
      name: "My Agenda: Show month view",
      callback: () => this.activateView("month")
    });
    this.addSettingTab(new AgendaSettingTab(this.app, this));
  }
  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }
  async activateView(mode) {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
    }
    workspace.revealLeaf(leaf);
    if (mode && leaf.view instanceof AgendaView) {
      leaf.view.setMode(mode);
    }
  }
  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }
  async saveSettings() {
    await this.saveData(this.settings);
  }
};
var AgendaSettingTab = class extends import_obsidian.PluginSettingTab {
  constructor(app, plugin) {
    super(app, plugin);
    this.plugin = plugin;
  }
  display() {
    const { containerEl } = this;
    containerEl.empty();
    new import_obsidian.Setting(containerEl).setName("Planner heading").setDesc('The Markdown heading under which timed tasks are read, e.g. "# Day planner".').addText(
      (text) => text.setValue(this.plugin.settings.plannerHeading).onChange(async (value) => {
        this.plugin.settings.plannerHeading = value || DEFAULT_SETTINGS.plannerHeading;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Start hour").setDesc("First hour shown on the timeline (0\u201323).").addSlider(
      (slider) => slider.setLimits(0, 23, 1).setValue(this.plugin.settings.startHour).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.startHour = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("End hour").setDesc("Last hour shown on the timeline (1\u201324).").addSlider(
      (slider) => slider.setLimits(1, 24, 1).setValue(this.plugin.settings.endHour).setDynamicTooltip().onChange(async (value) => {
        this.plugin.settings.endHour = value;
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Snap increment (minutes)").setDesc("Dragging, resizing, or clicking to create a task snaps to this many minutes.").addDropdown(
      (dropdown) => dropdown.addOptions({ "5": "5", "10": "10", "15": "15", "30": "30" }).setValue(String(this.plugin.settings.snapMinutes)).onChange(async (value) => {
        this.plugin.settings.snapMinutes = Number(value);
        await this.plugin.saveSettings();
      })
    );
    new import_obsidian.Setting(containerEl).setName("Default task duration (minutes)").setDesc("How long a new task is when created by clicking an empty spot on the week timeline.").addDropdown(
      (dropdown) => dropdown.addOptions({ "15": "15", "30": "30", "45": "45", "60": "60" }).setValue(String(this.plugin.settings.defaultDurationMinutes)).onChange(async (value) => {
        this.plugin.settings.defaultDurationMinutes = Number(value);
        await this.plugin.saveSettings();
      })
    );
  }
};
