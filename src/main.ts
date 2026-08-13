import {
	App,
	ItemView,
	Notice,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	WorkspaceLeaf,
	moment,
} from 'obsidian';

type Moment = ReturnType<typeof moment>;
type ViewMode = 'week' | 'month';

const VIEW_TYPE = 'my-agenda-view';
const PIXELS_PER_MINUTE = 2; // 120px per hour
const MIN_BLOCK_HEIGHT = 16;
const REFRESH_DEBOUNCE_MS = 400;

interface AgendaSettings {
	plannerHeading: string;
	startHour: number;
	endHour: number;
	snapMinutes: number;
	defaultDurationMinutes: number;
}

const DEFAULT_SETTINGS: AgendaSettings = {
	plannerHeading: 'Day planner',
	startHour: 6,
	endHour: 24,
	snapMinutes: 10,
	defaultDurationMinutes: 30,
};

interface PlannerTask {
	line: number;
	indent: string;
	checked: boolean;
	start: string;
	end: string;
	text: string;
	raw: string;
}

function timeToMinutes(t: string): number {
	const [h, m] = t.split(':').map(Number);
	return h * 60 + m;
}

function minutesToTime(min: number): string {
	const clamped = Math.max(0, Math.min(24 * 60, Math.round(min)));
	const h = Math.floor(clamped / 60);
	const m = clamped % 60;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function snap(minutes: number, step: number): number {
	return Math.round(minutes / step) * step;
}

// Finds the plugin's own heading line, then collects timed checkbox tasks
// beneath it until the next heading of equal-or-higher level.
function parsePlannerTasks(
	content: string,
	heading: string
): { tasks: PlannerTask[]; headingFound: boolean; headingIdx: number; headingLevel: number } {
	const lines = content.split('\n');
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

	if (headingIdx === -1) return { tasks: [], headingFound: false, headingIdx: -1, headingLevel: 0 };

	const taskRe = /^(\s*)-\s\[([ xX])\]\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s+(.*)$/;
	const tasks: PlannerTask[] = [];

	for (let i = headingIdx + 1; i < lines.length; i++) {
		const line = lines[i];
		const hm = line.match(headingRe);
		if (hm && hm[1].length <= headingLevel) break;

		const tm = line.match(taskRe);
		if (tm) {
			tasks.push({
				line: i,
				indent: tm[1],
				checked: tm[2].toLowerCase() === 'x',
				start: tm[3],
				end: tm[4],
				text: tm[5],
				raw: line,
			});
		}
	}

	return { tasks, headingFound: true, headingIdx, headingLevel };
}

// Resolves a given day's daily note the way this vault actually stores them:
// filename comes from the core Daily Notes format, but the file may live
// in any subfolder (e.g. Calendar/<Month>/) rather than one fixed folder.
function getDailyNoteFormat(app: App): string {
	const dailyNotes = (app as any).internalPlugins?.getPluginById?.('daily-notes');
	return dailyNotes?.instance?.options?.format || 'YYYY-MM-DD';
}

function findNoteFileForDate(app: App, date: Moment): TFile | null {
	const expectedBasename = date.format(getDailyNoteFormat(app));
	const match = app.vault
		.getMarkdownFiles()
		.find((f) => f.basename === expectedBasename);
	return match ?? null;
}

async function createNoteFileForDate(app: App, date: Moment, plannerHeading: string): Promise<TFile> {
	const format = getDailyNoteFormat(app);
	const filename = date.format(format) + '.md';
	const dailyNotes = (app as any).internalPlugins?.getPluginById?.('daily-notes');
	const configuredFolder: string = (dailyNotes?.instance?.options?.folder ?? '').trim();

	// Mirror this vault's existing convention: Calendar/<Month Name>/<file>.
	const calendarFolder = app.vault.getAbstractFileByPath('Calendar');
	let targetFolder = configuredFolder;
	if (calendarFolder) {
		targetFolder = `Calendar/${date.format('MMMM')}`;
	}

	if (targetFolder && !app.vault.getAbstractFileByPath(targetFolder)) {
		await app.vault.createFolder(targetFolder).catch(() => {});
	}

	const path = targetFolder ? `${targetFolder}/${filename}` : filename;
	return app.vault.create(path, `# ${plannerHeading}\n\n`);
}

// Reads and parses a day's tasks in one shot; returns an empty result if there's no note yet.
async function loadDay(
	app: App,
	date: Moment,
	heading: string
): Promise<{ file: TFile | null; tasks: PlannerTask[] }> {
	const file = findNoteFileForDate(app, date);
	if (!file) return { file: null, tasks: [] };
	const content = await app.vault.read(file);
	const { tasks } = parsePlannerTasks(content, heading);
	return { file, tasks };
}

// Ensures a note exists for the date and has the planner heading, creating either as needed.
async function ensureNoteWithHeading(app: App, date: Moment, heading: string): Promise<TFile> {
	let file = findNoteFileForDate(app, date);
	if (!file) {
		return createNoteFileForDate(app, date, heading);
	}
	const data = await app.vault.read(file);
	const { headingFound } = parsePlannerTasks(data, heading);
	if (!headingFound) {
		const prefix = data.length && !data.endsWith('\n') ? '\n' : '';
		await app.vault.modify(file, `${data}${prefix}\n# ${heading}\n`);
	}
	return file;
}

// Finds where a new task line should go: right after the last existing task
// under the heading, or right after the heading itself if there are none yet.
function findInsertionIndex(lines: string[], heading: string): number {
	const { headingFound, headingIdx, headingLevel } = parsePlannerTasks(lines.join('\n'), heading);
	if (!headingFound) return lines.length;

	const headingRe = /^(#{1,6})\s+(.*)$/;
	const taskRe = /^(\s*)-\s\[([ xX])\]\s*(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})\s+(.*)$/;
	let lastIdx = headingIdx;
	for (let i = headingIdx + 1; i < lines.length; i++) {
		const hm = lines[i].match(headingRe);
		if (hm && hm[1].length <= headingLevel) break;
		if (taskRe.test(lines[i])) lastIdx = i;
	}
	return lastIdx + 1;
}

class AgendaView extends ItemView {
	plugin: AgendaPlugin;
	viewMode: ViewMode = 'week';
	targetDate: Moment = moment().startOf('day');
	refreshTimer: number | null = null;
	nowTimer: number | null = null;
	nowLines: { el: HTMLDivElement; date: Moment }[] = [];
	editingInline = false;
	renderToken = 0;

	headerEl!: HTMLDivElement;
	modeSwitchEl!: HTMLDivElement;
	weekModeBtn!: HTMLButtonElement;
	monthModeBtn!: HTMLButtonElement;
	dateLabelEl!: HTMLSpanElement;
	todayBtn!: HTMLButtonElement;
	bodyEl!: HTMLDivElement;

	constructor(leaf: WorkspaceLeaf, plugin: AgendaPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE;
	}

	getDisplayText(): string {
		return 'My Agenda';
	}

	getIcon(): string {
		return 'calendar-clock';
	}

	async onOpen(): Promise<void> {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass('dp-container');

		this.headerEl = container.createDiv({ cls: 'dp-header' });

		this.modeSwitchEl = this.headerEl.createDiv({ cls: 'dp-mode-switch' });
		this.weekModeBtn = this.modeSwitchEl.createEl('button', { cls: 'dp-mode-btn', text: 'Week' });
		this.monthModeBtn = this.modeSwitchEl.createEl('button', { cls: 'dp-mode-btn', text: 'Month' });
		this.weekModeBtn.addEventListener('click', () => this.setMode('week'));
		this.monthModeBtn.addEventListener('click', () => this.setMode('month'));

		const nav = this.headerEl.createDiv({ cls: 'dp-nav' });
		const prevBtn = nav.createEl('button', { cls: 'dp-nav-btn', text: '‹' });
		prevBtn.addEventListener('click', () => {
			this.targetDate = this.targetDate.clone().subtract(1, this.viewMode);
			this.render();
		});
		this.dateLabelEl = nav.createSpan({ cls: 'dp-date-label' });
		const nextBtn = nav.createEl('button', { cls: 'dp-nav-btn', text: '›' });
		nextBtn.addEventListener('click', () => {
			this.targetDate = this.targetDate.clone().add(1, this.viewMode);
			this.render();
		});

		const actions = this.headerEl.createDiv({ cls: 'dp-actions' });
		this.todayBtn = actions.createEl('button', { text: 'Today' });
		this.todayBtn.addEventListener('click', () => {
			this.targetDate = moment().startOf('day');
			this.render();
		});
		const refreshBtn = actions.createEl('button', { text: '⟳' });
		refreshBtn.addEventListener('click', () => this.render());

		this.bodyEl = container.createDiv({ cls: 'dp-body' });

		this.render();

		const scheduleRefresh = () => {
			if (this.editingInline) return; // don't let our own in-progress task-creation write trigger a refresh mid-edit
			if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
			this.refreshTimer = window.setTimeout(() => this.render(), REFRESH_DEBOUNCE_MS);
		};
		this.registerEvent(this.app.vault.on('modify', () => scheduleRefresh()));
		this.registerEvent(this.app.vault.on('rename', () => scheduleRefresh()));
		this.registerEvent(this.app.vault.on('delete', () => scheduleRefresh()));
		this.registerEvent(this.app.vault.on('create', () => scheduleRefresh()));

		this.nowTimer = window.setInterval(() => this.refreshNowLines(), 60_000);
	}

	async onClose(): Promise<void> {
		if (this.refreshTimer) window.clearTimeout(this.refreshTimer);
		if (this.nowTimer) window.clearInterval(this.nowTimer);
	}

	setMode(mode: ViewMode): void {
		this.viewMode = mode;
		this.render();
	}

	goToWeek(date: Moment): void {
		this.targetDate = date.clone().startOf('day');
		this.viewMode = 'week';
		this.render();
	}

	updateHeader(): void {
		this.weekModeBtn.toggleClass('dp-mode-btn-active', this.viewMode === 'week');
		this.monthModeBtn.toggleClass('dp-mode-btn-active', this.viewMode === 'month');

		const now = moment();
		if (this.viewMode === 'week') {
			const start = this.targetDate.clone().startOf('isoWeek');
			const end = start.clone().add(6, 'days');
			this.dateLabelEl.setText(`${start.format('MMM D')} – ${end.format('MMM D')}`);
			this.todayBtn.disabled = now.isBetween(start, end, 'day', '[]');
		} else {
			this.dateLabelEl.setText(this.targetDate.format('MMMM YYYY'));
			this.todayBtn.disabled = now.isSame(this.targetDate, 'month');
		}
	}

	async render(): Promise<void> {
		const token = ++this.renderToken;
		this.bodyEl.empty();
		this.nowLines = [];
		this.updateHeader();

		if (this.viewMode === 'week') return this.renderWeekMode(token);
		return this.renderMonthMode(token);
	}

	// ---------- Week mode ----------

	async renderWeekMode(token: number): Promise<void> {
		const { startHour, endHour, plannerHeading } = this.plugin.settings;
		const totalMinutes = (endHour - startHour) * 60;
		const boundMin = { min: startHour * 60, max: endHour * 60 };
		const weekStart = this.targetDate.clone().startOf('isoWeek');
		const days = Array.from({ length: 7 }, (_, i) => weekStart.clone().add(i, 'days'));

		const loaded = await Promise.all(days.map((d) => loadDay(this.app, d, plannerHeading)));
		if (token !== this.renderToken) return; // a newer render started while these files were loading; discard this stale pass

		// Headers and the timeline are both direct children of bodyEl (not wrapped in
		// their own scroll container) so bodyEl is the one true scroll container for
		// both axes — position:sticky only sticks relative to its nearest scrollable
		// ancestor, so nesting a separate horizontal-scroll wrapper here would stop
		// the header from sticking vertically at all.
		const headers = this.bodyEl.createDiv({ cls: 'dp-week-headers' });
		headers.createDiv({ cls: 'dp-week-gutter' });
		days.forEach((d, i) => {
			const { tasks } = loaded[i];
			const cell = headers.createDiv({ cls: 'dp-week-header-cell' });
			if (d.isSame(moment(), 'day')) cell.addClass('dp-week-header-cell-today');
			cell.createDiv({ cls: 'dp-week-header-day', text: d.format('ddd') });
			cell.createDiv({ cls: 'dp-week-header-date', text: d.format('D') });
			if (tasks.length > 0) {
				const done = tasks.filter((t) => t.checked).length;
				cell.createDiv({ cls: 'dp-week-badge', text: `${done}/${tasks.length}` });
			}
		});

		const row = this.bodyEl.createDiv({ cls: 'dp-week-row' });
		const gutter = row.createDiv({ cls: 'dp-week-gutter dp-week-gutter-body' });
		gutter.style.height = `${totalMinutes * PIXELS_PER_MINUTE}px`;
		this.renderHourGrid(gutter, startHour, endHour, true, true);

		days.forEach((d, i) => {
			const { file, tasks } = loaded[i];
			const col = row.createDiv({ cls: 'dp-week-col dp-week-col-creatable' });
			col.style.height = `${totalMinutes * PIXELS_PER_MINUTE}px`;
			this.renderHourGrid(col, startHour, endHour, false);

			if (d.isSame(moment(), 'day')) {
				this.addNowLine(col, d);
			}

			if (file) {
				for (const task of tasks) {
					this.renderTaskBlock(col, file, task, boundMin, true);
				}
			}

			col.addEventListener('click', (evt: MouseEvent) => {
				if (evt.target !== col) return;
				this.beginCreateTask(col, d, boundMin, evt);
			});
		});
	}

	// ---------- Month mode ----------

	async renderMonthMode(token: number): Promise<void> {
		const { plannerHeading } = this.plugin.settings;
		const monthStart = this.targetDate.clone().startOf('month');
		const gridStart = monthStart.clone().startOf('isoWeek');
		const daysNeeded = monthStart.clone().endOf('month').diff(gridStart, 'days') + 1;
		const weeks = Math.ceil(daysNeeded / 7);
		const days = Array.from({ length: weeks * 7 }, (_, i) => gridStart.clone().add(i, 'days'));

		const loaded = await Promise.all(days.map((d) => loadDay(this.app, d, plannerHeading)));
		if (token !== this.renderToken) return; // a newer render started while these files were loading; discard this stale pass

		const weekdayRow = this.bodyEl.createDiv({ cls: 'dp-month-weekdays' });
		for (let i = 0; i < 7; i++) {
			weekdayRow.createDiv({ cls: 'dp-month-weekday', text: gridStart.clone().add(i, 'days').format('ddd') });
		}

		const grid = this.bodyEl.createDiv({ cls: 'dp-month-grid' });
		days.forEach((d, i) => {
			const { tasks } = loaded[i];
			const cell = grid.createDiv({ cls: 'dp-month-cell' });
			if (d.month() !== monthStart.month()) cell.addClass('dp-month-cell-muted');
			if (d.isSame(moment(), 'day')) cell.addClass('dp-month-cell-today');
			cell.createDiv({ cls: 'dp-month-daynum', text: d.format('D') });
			if (tasks.length > 0) {
				const done = tasks.filter((t) => t.checked).length;
				cell.createDiv({ cls: 'dp-month-badge', text: `${done}/${tasks.length}` });
			}
			cell.addEventListener('click', () => this.goToWeek(d));
		});
	}

	// ---------- Inline task creation (Week mode) ----------

	async beginCreateTask(
		container: HTMLElement,
		date: Moment,
		boundMin: { min: number; max: number },
		evt: MouseEvent
	): Promise<void> {
		const { snapMinutes, defaultDurationMinutes, plannerHeading } = this.plugin.settings;
		const rect = container.getBoundingClientRect();
		const offsetY = evt.clientY - rect.top;

		let startMin = boundMin.min + snap(offsetY / PIXELS_PER_MINUTE, snapMinutes);
		startMin = Math.max(boundMin.min, Math.min(boundMin.max - snapMinutes, startMin));
		const endMin = Math.min(boundMin.max, startMin + defaultDurationMinutes);
		const startStr = minutesToTime(startMin);
		const endStr = minutesToTime(endMin);
		const marker = `- [ ] ${startStr} - ${endStr} `;

		let file: TFile;
		try {
			file = await ensureNoteWithHeading(this.app, date, plannerHeading);
		} catch (e) {
			new Notice(`Could not create note: ${e}`);
			return;
		}

		this.editingInline = true;
		const data = await this.app.vault.read(file);
		const lines = data.split('\n');
		const insertAt = findInsertionIndex(lines, plannerHeading);
		lines.splice(insertAt, 0, marker);
		await this.app.vault.modify(file, lines.join('\n'));

		const block = container.createDiv({ cls: 'dp-task dp-task-compact dp-task-editing' });
		block.style.top = `${(startMin - boundMin.min) * PIXELS_PER_MINUTE}px`;
		block.style.height = `${Math.max(MIN_BLOCK_HEIGHT, (endMin - startMin) * PIXELS_PER_MINUTE)}px`;

		const checkbox = block.createEl('input', { type: 'checkbox' });
		checkbox.disabled = true;

		const input = block.createEl('input', {
			type: 'text',
			cls: 'dp-task-input',
			attr: { placeholder: 'Task…' },
		});

		let settled = false;
		const commit = async (finalText: string) => {
			if (settled) return;
			settled = true;
			block.remove();

			const trimmed = finalText.trim();
			const freshData = await this.app.vault.read(file);
			const freshLines = freshData.split('\n');
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
			await this.app.vault.modify(file, freshLines.join('\n'));
			this.editingInline = false;
			this.render();
		};

		input.addEventListener('keydown', (e: KeyboardEvent) => {
			if (e.key === 'Enter') {
				e.preventDefault();
				input.blur();
			} else if (e.key === 'Escape') {
				e.preventDefault();
				input.value = '';
				input.blur();
			}
		});
		input.addEventListener('blur', () => commit(input.value));
		input.focus();
	}

	// ---------- Shared rendering helpers ----------

	renderHourGrid(container: HTMLElement, startHour: number, endHour: number, showLabels: boolean, compact = false): void {
		for (let h = startHour; h <= endHour; h++) {
			const top = (h - startHour) * 60 * PIXELS_PER_MINUTE;
			const row = container.createDiv({ cls: 'dp-hour-line' });
			row.style.top = `${top}px`;
			if (showLabels) {
				row.createSpan({
					cls: compact ? 'dp-hour-label dp-hour-label-gutter' : 'dp-hour-label',
					text: moment({ hour: h % 24 }).format('H:00'),
				});
			}
			if (h < endHour) {
				const halfTop = top + 30 * PIXELS_PER_MINUTE;
				container.createDiv({ cls: 'dp-half-hour-line' }).style.top = `${halfTop}px`;
			}
		}
	}

	addNowLine(container: HTMLElement, date: Moment): void {
		const el = container.createDiv({ cls: 'dp-now-line' });
		this.nowLines.push({ el, date });
		this.positionNowLine(el, date);
	}

	positionNowLine(el: HTMLDivElement, date: Moment): void {
		if (!date.isSame(moment(), 'day')) {
			el.style.display = 'none';
			return;
		}
		const { startHour, endHour } = this.plugin.settings;
		const nowMin = timeToMinutes(moment().format('HH:mm'));
		const startMin = startHour * 60;
		const endMin = endHour * 60;
		if (nowMin < startMin || nowMin > endMin) {
			el.style.display = 'none';
			return;
		}
		el.style.display = 'block';
		el.style.top = `${(nowMin - startMin) * PIXELS_PER_MINUTE}px`;
	}

	refreshNowLines(): void {
		for (const { el, date } of this.nowLines) this.positionNowLine(el, date);
	}

	renderTaskBlock(
		container: HTMLElement,
		file: TFile,
		task: PlannerTask,
		boundMin: { min: number; max: number },
		compact = false
	): void {
		const { snapMinutes } = this.plugin.settings;

		let startMin = timeToMinutes(task.start);
		let endMin = timeToMinutes(task.end);
		if (endMin <= startMin) endMin = startMin + snapMinutes;

		const block = container.createDiv({ cls: compact ? 'dp-task dp-task-compact' : 'dp-task' });
		if (task.checked) block.addClass('dp-task-checked');
		block.style.top = `${(startMin - boundMin.min) * PIXELS_PER_MINUTE}px`;
		block.style.height = `${Math.max(MIN_BLOCK_HEIGHT, (endMin - startMin) * PIXELS_PER_MINUTE)}px`;

		const checkbox = block.createEl('input', { type: 'checkbox' });
		checkbox.checked = task.checked;
		checkbox.addEventListener('click', (evt) => {
			evt.stopPropagation();
			this.commitTaskEdit(file, task, task.start, task.end, checkbox.checked);
		});

		const label = block.createDiv({ cls: 'dp-task-label' });
		if (!compact) label.createSpan({ cls: 'dp-task-time', text: `${task.start}–${task.end}` });
		label.createSpan({ cls: 'dp-task-text', text: task.text });

		const resizeHandle = block.createDiv({ cls: 'dp-resize-handle' });

		// Drag the block body to move both start and end together.
		block.addEventListener('pointerdown', (downEvt: PointerEvent) => {
			if (downEvt.target === resizeHandle || downEvt.target === checkbox) return;
			downEvt.preventDefault();
			downEvt.stopPropagation();
			const origStart = startMin;
			const origEnd = endMin;
			const duration = origEnd - origStart;
			const startY = downEvt.clientY;

			const onMove = (moveEvt: PointerEvent) => {
				const deltaMin = snap((moveEvt.clientY - startY) / PIXELS_PER_MINUTE, snapMinutes);
				let newStart = origStart + deltaMin;
				newStart = Math.max(boundMin.min, Math.min(boundMin.max - duration, newStart));
				const newEnd = newStart + duration;
				block.style.top = `${(newStart - boundMin.min) * PIXELS_PER_MINUTE}px`;
				const timeEl = label.querySelector('.dp-task-time');
				if (timeEl) timeEl.textContent = `${minutesToTime(newStart)}–${minutesToTime(newEnd)}`;
				(block as any)._pendingStart = newStart;
				(block as any)._pendingEnd = newEnd;
			};
			const onUp = () => {
				window.removeEventListener('pointermove', onMove);
				window.removeEventListener('pointerup', onUp);
				const newStart = (block as any)._pendingStart ?? origStart;
				const newEnd = (block as any)._pendingEnd ?? origEnd;
				this.commitTaskEdit(file, task, minutesToTime(newStart), minutesToTime(newEnd), task.checked);
			};
			window.addEventListener('pointermove', onMove);
			window.addEventListener('pointerup', onUp);
		});

		// Drag the bottom handle to resize (change end time only).
		resizeHandle.addEventListener('pointerdown', (downEvt: PointerEvent) => {
			downEvt.preventDefault();
			downEvt.stopPropagation();
			const origEnd = endMin;
			const startY = downEvt.clientY;

			const onMove = (moveEvt: PointerEvent) => {
				const deltaMin = snap((moveEvt.clientY - startY) / PIXELS_PER_MINUTE, snapMinutes);
				let newEnd = origEnd + deltaMin;
				newEnd = Math.max(startMin + snapMinutes, Math.min(boundMin.max, newEnd));
				block.style.height = `${Math.max(MIN_BLOCK_HEIGHT, (newEnd - startMin) * PIXELS_PER_MINUTE)}px`;
				const timeEl = label.querySelector('.dp-task-time');
				if (timeEl) timeEl.textContent = `${minutesToTime(startMin)}–${minutesToTime(newEnd)}`;
				(block as any)._pendingEnd = newEnd;
			};
			const onUp = () => {
				window.removeEventListener('pointermove', onMove);
				window.removeEventListener('pointerup', onUp);
				const newEnd = (block as any)._pendingEnd ?? origEnd;
				this.commitTaskEdit(file, task, task.start, minutesToTime(newEnd), task.checked);
			};
			window.addEventListener('pointermove', onMove);
			window.addEventListener('pointerup', onUp);
		});
	}

	async commitTaskEdit(file: TFile, task: PlannerTask, newStart: string, newEnd: string, newChecked: boolean): Promise<void> {
		const data = await this.app.vault.read(file);
		const lines = data.split('\n');

		if (lines[task.line] !== task.raw) {
			new Notice('My Agenda: note changed elsewhere, refreshing instead of saving.');
			this.render();
			return;
		}

		const checkedChar = newChecked ? 'x' : ' ';
		lines[task.line] = `${task.indent}- [${checkedChar}] ${newStart} - ${newEnd} ${task.text}`;
		await this.app.vault.modify(file, lines.join('\n'));
	}
}

interface AgendaPluginInterface {
	settings: AgendaSettings;
}

export default class AgendaPlugin extends Plugin implements AgendaPluginInterface {
	settings: AgendaSettings = DEFAULT_SETTINGS;

	async onload(): Promise<void> {
		await this.loadSettings();

		this.registerView(VIEW_TYPE, (leaf) => new AgendaView(leaf, this));

		this.addRibbonIcon('calendar-clock', 'Open My Agenda', () => {
			this.activateView();
		});

		this.addCommand({
			id: 'open-my-agenda',
			name: 'Open My Agenda',
			callback: () => this.activateView(),
		});

		this.addCommand({
			id: 'my-agenda-show-week',
			name: 'My Agenda: Show week view',
			callback: () => this.activateView('week'),
		});
		this.addCommand({
			id: 'my-agenda-show-month',
			name: 'My Agenda: Show month view',
			callback: () => this.activateView('month'),
		});

		this.addSettingTab(new AgendaSettingTab(this.app, this));
	}

	onunload(): void {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE);
	}

	async activateView(mode?: ViewMode): Promise<void> {
		const { workspace } = this.app;
		let leaf = workspace.getLeavesOfType(VIEW_TYPE)[0];
		if (!leaf) {
			leaf = workspace.getRightLeaf(false)!;
			await leaf.setViewState({ type: VIEW_TYPE, active: true });
		}
		workspace.revealLeaf(leaf);
		if (mode && leaf.view instanceof AgendaView) {
			leaf.view.setMode(mode);
		}
	}

	async loadSettings(): Promise<void> {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}

class AgendaSettingTab extends PluginSettingTab {
	plugin: AgendaPlugin;

	constructor(app: App, plugin: AgendaPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Planner heading')
			.setDesc('The Markdown heading under which timed tasks are read, e.g. "# Day planner".')
			.addText((text) =>
				text.setValue(this.plugin.settings.plannerHeading).onChange(async (value) => {
					this.plugin.settings.plannerHeading = value || DEFAULT_SETTINGS.plannerHeading;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Start hour')
			.setDesc('First hour shown on the timeline (0–23).')
			.addSlider((slider) =>
				slider
					.setLimits(0, 23, 1)
					.setValue(this.plugin.settings.startHour)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.startHour = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('End hour')
			.setDesc('Last hour shown on the timeline (1–24).')
			.addSlider((slider) =>
				slider
					.setLimits(1, 24, 1)
					.setValue(this.plugin.settings.endHour)
					.setDynamicTooltip()
					.onChange(async (value) => {
						this.plugin.settings.endHour = value;
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Snap increment (minutes)')
			.setDesc('Dragging, resizing, or clicking to create a task snaps to this many minutes.')
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ '5': '5', '10': '10', '15': '15', '30': '30' })
					.setValue(String(this.plugin.settings.snapMinutes))
					.onChange(async (value) => {
						this.plugin.settings.snapMinutes = Number(value);
						await this.plugin.saveSettings();
					})
			);

		new Setting(containerEl)
			.setName('Default task duration (minutes)')
			.setDesc('How long a new task is when created by clicking an empty spot on the week timeline.')
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({ '15': '15', '30': '30', '45': '45', '60': '60' })
					.setValue(String(this.plugin.settings.defaultDurationMinutes))
					.onChange(async (value) => {
						this.plugin.settings.defaultDurationMinutes = Number(value);
						await this.plugin.saveSettings();
					})
			);
	}
}
