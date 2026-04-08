/**
 * Shelf — Dashboard: search, status tabs, book cards, add/edit/delete.
 * All filtering happens client-side for instant feedback.
 */
const API = "/api";
const TOKEN_KEY = "shelf_token";

let _activeStatus = "";
let _searchQuery = "";
let _activeFormat = "";
let _allItems = [];
let _itemsCache = [];
let _latestReadingStats = null;
let _goalOverrides = {};
const WEEKLY_GOALS_STORAGE_KEY = "shelf_weekly_goal_overrides_v1";
const WEEKLY_GOAL_TYPE_STORAGE_KEY = "shelf_weekly_goal_type_v1";
let _weeklyGoalModal = null;
let _selectedGoalType = "pages";
const WEEKLY_GOAL_UNITS = new Set(["pages", "minutes", "chapters"]);
let _allTimeRange = "all";

function showMessage(text, type) {
  const el = document.getElementById("message");
  el.textContent = text;
  el.hidden = false;
  el.className = "message " + (type === "error" ? "error" : "success");
  setTimeout(() => {
    el.hidden = true;
  }, 4000);
}

async function api(method, path, body) {
  const token = localStorage.getItem(TOKEN_KEY);
  const headers = { "Content-Type": "application/json" };
  if (token) headers["Authorization"] = "Bearer " + token;
  const opts = { method, headers };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  if (res.status === 401) {
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = "/login";
    return;
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const msg = data.error || data.message || res.statusText;
    throw new Error(msg);
  }
  return data != null ? data : {};
}

const FORMAT_PROGRESS = {
  Physical: { type: "Pages", currentLabel: "Current Page", totalLabel: "Total Pages", unit: "pages" },
  Audiobook: { type: "Time", currentLabel: "Current Time", totalLabel: "Total Time", unit: "hrs" },
  "Series (Chapter Based)": { type: "Chapters", currentLabel: "Current Chapter", totalLabel: "Total Chapters", unit: "chapters" },
};

const FORMAT_FILTER_OPTIONS = [
  { value: "", label: "All Formats" },
  { value: "Physical", label: "Physical Books" },
  { value: "Audiobook", label: "Audiobooks" },
  { value: "Series (Chapter Based)", label: "Series (Chapter Based)" },
];

const STATUS_DONUT = [
  { status: "Reading", color: "#2563eb" },
  { status: "TBR", color: "#6b7280" },
  { status: "Finished", color: "#059669" },
  { status: "DNF", color: "#dc2626" },
];

const SUGGESTED_GENRES = [
  "Fantasy",
  "Science Fiction",
  "Mystery",
  "Thriller",
  "Romance",
  "Historical Fiction",
  "Horror",
  "Nonfiction",
  "Biography",
  "Self-Help",
  "Business",
  "Young Adult",
];

function formatMinutes(mins) {
  const m = Math.round(Number(mins) || 0);
  if (m <= 0) return "0m";
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}m`;
  return r > 0 ? `${h}h ${r}m` : `${h}h`;
}

function progressLabel(item) {
  const pt = item.progress_type || "Pages";
  if (pt === "Percent") {
    const pct = item.percent != null ? item.percent : 0;
    return `${Math.round(pct)}%`;
  }
  const cur = item.progress_current != null ? item.progress_current : 0;
  const tot = item.progress_total != null ? item.progress_total : 0;
  if (pt === "Time") {
    return `${formatMinutes(cur)} / ${formatMinutes(tot)}`;
  }
  const unitMap = { Pages: "pages", Chapters: "chapters" };
  const unit = unitMap[pt] || pt.toLowerCase();
  return `${cur} / ${tot} ${unit}`;
}

function progressPercent(item) {
  const pt = item.progress_type || "Pages";
  if (pt === "Percent")
    return Math.min(100, Math.max(0, Number(item.percent) || 0));
  const cur = Number(item.progress_current) || 0;
  const tot = Number(item.progress_total) || 0;
  if (tot <= 0) return 0;
  return Math.min(100, Math.round((cur / tot) * 100));
}

function escapeHtml(s) {
  if (s == null) return "";
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

function normalizeIsbn(isbn) {
  return (isbn || "").replace(/[^0-9Xx]/g, "").trim();
}

function toDateInputValue(value) {
  if (!value) return "";
  try {
    return new Date(value).toISOString().slice(0, 10);
  } catch {
    return "";
  }
}

function formatCardDate(value) {
  if (!value) return "";
  try {
    return new Date(value).toLocaleDateString(undefined, {
      month: "numeric",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return "";
  }
}

function formatStatNumber(value) {
  const n = Number(value) || 0;
  if (Number.isInteger(n)) return String(n);
  return String(Math.round(n * 10) / 10);
}

function pluralize(word, count) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function loadGoalOverrides() {
  try {
    const raw = localStorage.getItem(WEEKLY_GOALS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function saveGoalOverrides() {
  try {
    localStorage.setItem(WEEKLY_GOALS_STORAGE_KEY, JSON.stringify(_goalOverrides));
  } catch {
    // Ignore storage failures in private browsing or restricted environments.
  }
}

function loadSelectedGoalType() {
  try {
    const raw = localStorage.getItem(WEEKLY_GOAL_TYPE_STORAGE_KEY);
    if (WEEKLY_GOAL_UNITS.has(raw)) return raw;
    return "pages";
  } catch {
    return "pages";
  }
}

function saveSelectedGoalType(unit) {
  if (!WEEKLY_GOAL_UNITS.has(unit)) return;
  try {
    localStorage.setItem(WEEKLY_GOAL_TYPE_STORAGE_KEY, unit);
  } catch {
    // Ignore storage failures in restricted environments.
  }
}

function formatGoalLabel(unit, target) {
  const targetValue = formatStatNumber(target);
  if (unit === "minutes") {
    if (target % 60 === 0) {
      return `${formatStatNumber(target / 60)} hours/week`;
    }
    return `${targetValue} minutes/week`;
  }
  if (unit === "chapters") return `${targetValue} chapters/week`;
  return `${targetValue} pages/week`;
}

function goalTypeLabel(unit) {
  if (unit === "minutes") return "hours";
  if (unit === "chapters") return "chapters";
  return "pages";
}

function updateWeeklyGoalFormHint(unit) {
  const hint = document.getElementById("weekly-goal-hint");
  if (!hint) return;
  if (unit === "minutes") {
    hint.textContent = "Enter total minutes to read/listen this week (e.g. 300 = 5 hours)";
    return;
  }
  if (unit === "chapters") {
    hint.textContent = "Number of chapters to read this week";
    return;
  }
  hint.textContent = "Number of pages to read this week";
}

function getWeeklyGoal(unit) {
  const defaults = {
    pages: { target: 300, unitLabel: "pages" },
    chapters: { target: 20, unitLabel: "chapters" },
    minutes: { target: 300, unitLabel: "minutes" },
  };
  const key = unit in defaults ? unit : "pages";
  const fallback = defaults[key];
  const override = Number(_goalOverrides[key]);
  const target = Number.isFinite(override) && override > 0 ? override : fallback.target;
  return { target, unitLabel: fallback.unitLabel, label: formatGoalLabel(key, target), key };
}

function parseLogDate(value) {
  if (!value) return null;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getItemProgressLogs(item) {
  if (Array.isArray(item.progress_history)) return item.progress_history;
  if (Array.isArray(item.progress_logs)) return item.progress_logs;
  return [];
}

function getRangeStart(range) {
  if (range === "all") return null;
  const now = new Date();
  const start = startOfDay(now);
  if (range === "week") {
    start.setDate(start.getDate() - 6);
    return start;
  }
  if (range === "month") {
    start.setMonth(start.getMonth() - 1);
    return start;
  }
  if (range === "year") {
    start.setFullYear(start.getFullYear() - 1);
    return start;
  }
  return null;
}

function getWeeklyProgressForGoalType(goalType) {
  const unitByType = {
    pages: "pages",
    chapters: "chapters",
    minutes: "minutes",
  };
  const expectedUnit = unitByType[goalType] || "pages";
  const now = new Date();
  const start = startOfDay(now);
  start.setDate(start.getDate() - 6);

  let value = 0;
  const dayKeys = new Set();
  for (const item of _allItems) {
    const logs = Array.isArray(item.progress_history)
      ? item.progress_history
      : (Array.isArray(item.progress_logs) ? item.progress_logs : []);
    for (const entry of logs) {
      const unit = (entry && entry.unit ? String(entry.unit) : "").toLowerCase();
      if (unit !== expectedUnit) continue;
      const delta = Number(entry && entry.delta);
      if (!Number.isFinite(delta) || delta <= 0) continue;
      const ts = parseLogDate(entry && entry.timestamp);
      if (!ts) continue;
      if (ts < start || ts > now) continue;
      value += delta;
      dayKeys.add(startOfDay(ts).toISOString().slice(0, 10));
    }
  }
  return { value, activeDays: dayKeys.size };
}

function computeAllTimeStats(items, unit, range) {
  const expectedUnit = (unit || "pages").toLowerCase();
  const dailyTotals = {};
  const rangeStart = getRangeStart(range);

  for (const item of items) {
    const logs = getItemProgressLogs(item);
    for (const entry of logs) {
      const entryUnit = (entry && entry.unit ? String(entry.unit) : "").toLowerCase();
      if (entryUnit !== expectedUnit) continue;
      const delta = Number(entry && entry.delta);
      if (!Number.isFinite(delta) || delta <= 0) continue;
      const ts = parseLogDate(entry && entry.timestamp);
      if (!ts) continue;
      if (rangeStart && ts < rangeStart) continue;
      const dayKey = startOfDay(ts).toISOString().slice(0, 10);
      dailyTotals[dayKey] = (dailyTotals[dayKey] || 0) + delta;
    }
  }

  const dayKeys = Object.keys(dailyTotals).sort();
  const activeDaysCount = dayKeys.length;
  if (activeDaysCount === 0) {
    return {
      bestDayValue: 0,
      bestDayDate: null,
      averagePerActiveDay: 0,
      activeDaysCount: 0,
      longestStreak: 0,
    };
  }

  let bestDayValue = 0;
  let bestDayDate = dayKeys[0];
  let total = 0;
  for (const day of dayKeys) {
    const value = dailyTotals[day] || 0;
    total += value;
    if (value > bestDayValue) {
      bestDayValue = value;
      bestDayDate = day;
    }
  }

  let longestStreak = 1;
  let currentStreak = 1;
  for (let i = 1; i < dayKeys.length; i++) {
    const prev = new Date(dayKeys[i - 1]);
    const next = new Date(dayKeys[i]);
    const diffDays = Math.round((next - prev) / (1000 * 60 * 60 * 24));
    if (diffDays === 1) {
      currentStreak += 1;
      if (currentStreak > longestStreak) longestStreak = currentStreak;
    } else {
      currentStreak = 1;
    }
  }

  return {
    bestDayValue,
    bestDayDate,
    averagePerActiveDay: total / activeDaysCount,
    activeDaysCount,
    longestStreak,
  };
}

function formatDayLabel(dayKey) {
  if (!dayKey) return "No activity yet";
  try {
    return new Date(dayKey).toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return dayKey;
  }
}

function renderAllTimeStats(unitLabel, stats) {
  document.getElementById("alltime-best-day-value").textContent = formatStatNumber(stats.bestDayValue);
  document.getElementById("alltime-best-day-meta").textContent =
    stats.activeDaysCount > 0
      ? `${formatDayLabel(stats.bestDayDate)} • ${unitLabel}`
      : "No activity yet";
  document.getElementById("alltime-avg-day-value").textContent = formatStatNumber(stats.averagePerActiveDay);
  document.getElementById("alltime-avg-day-meta").textContent =
    `${unitLabel} across ${pluralize("active day", stats.activeDaysCount)}`;
  document.getElementById("alltime-longest-streak-value").textContent = formatStatNumber(stats.longestStreak);
  document.getElementById("alltime-longest-streak-meta").textContent = "days in a row";
}

function setupAllTimeRangeFilter() {
  const select = document.getElementById("alltime-range-filter");
  if (!select) return;
  select.value = _allTimeRange;
  select.addEventListener("change", () => {
    _allTimeRange = select.value;
    if (_latestReadingStats) {
      renderReadingStats(_latestReadingStats);
    }
  });
}

function renderReadingStats(stats) {
  _latestReadingStats = stats || null;
  const streak = Number(stats && stats.current_streak_days) || 0;
  const today = (stats && stats.today) || {};
  const week = (stats && stats.this_week) || {};
  const total = (stats && stats.total) || {};
  const unit = (stats && stats.unit) || "pages";
  const unitLabel = (stats && stats.unit_label) || "units";

  const todayValue = formatStatNumber(today.value);
  const rawWeekValue = Number(week.value) || 0;
  const weekValue = formatStatNumber(rawWeekValue);
  const totalValue = formatStatNumber(total.value);
  const todayBooks = Number(today.books) || 0;
  const activeDays = Number(week.active_days) || 0;
  if (!WEEKLY_GOAL_UNITS.has(_selectedGoalType)) {
    _selectedGoalType = WEEKLY_GOAL_UNITS.has(unit) ? unit : "pages";
  }
  const goal = getWeeklyGoal(_selectedGoalType);
  const goalWeek = getWeeklyProgressForGoalType(goal.key);
  const goalWeekValue = goalWeek.value;
  const goalWeekValueLabel = formatStatNumber(goalWeekValue);
  const weekGoalPct = goal.target > 0 ? Math.min(999, Math.round((goalWeekValue / goal.target) * 100)) : 0;
  const goalPctClamped = Math.min(100, weekGoalPct);
  const goalStatus =
    weekGoalPct >= 100
      ? "Goal reached!"
      : `${formatStatNumber(goal.target - goalWeekValue)} ${goal.unitLabel} to go`;

  document.getElementById("stat-streak-value").textContent = streak;
  document.getElementById("stat-streak-meta").textContent = `${pluralize("day", streak)} in a row`;
  document.getElementById("stat-today-value").textContent = todayValue;
  document.getElementById("stat-today-meta").textContent = `${todayValue} ${unitLabel} from ${pluralize("book", todayBooks)}`;
  document.getElementById("stat-week-value").textContent = weekValue;
  document.getElementById("stat-week-meta").textContent = `${weekValue} ${unitLabel} read`;
  document.getElementById("stat-week-days-meta").textContent = `${pluralize("day", activeDays)} active`;
  document.getElementById("stat-goal-value").textContent = `${weekGoalPct}%`;
  document.getElementById("stat-goal-meta").textContent =
    `${goalWeekValueLabel} / ${formatStatNumber(goal.target)} ${goal.unitLabel}`;
  document.getElementById("stat-goal-progress-fill").style.width = `${goalPctClamped}%`;
  document.getElementById("stat-goal-status").textContent = `${goalStatus} • ${goal.label}`;
  document.getElementById("stat-total-value").textContent = totalValue;
  document.getElementById("stat-total-meta").textContent = `${totalValue} ${unitLabel} read all time`;
  renderAllTimeStats(unitLabel, computeAllTimeStats(_allItems, unit, _allTimeRange));
}

function setupGoalEditor() {
  const editBtn = document.getElementById("btn-edit-weekly-goal");
  if (!editBtn) return;
  editBtn.addEventListener("click", () => {
    const defaultUnit = WEEKLY_GOAL_UNITS.has(_selectedGoalType)
      ? _selectedGoalType
      : ((_latestReadingStats && _latestReadingStats.unit) || "pages");
    const select = document.getElementById("weekly-goal-type");
    const targetInput = document.getElementById("weekly-goal-target");
    const error = document.getElementById("weekly-goal-error");
    if (!select || !targetInput || !error) return;

    const unit = WEEKLY_GOAL_UNITS.has(defaultUnit) ? defaultUnit : "pages";
    select.value = unit;
    const goal = getWeeklyGoal(unit);
    targetInput.value = String(goal.target);
    error.textContent = "";
    updateWeeklyGoalFormHint(unit);
    openWeeklyGoalModal();
  });
}

function openWeeklyGoalModal() {
  if (!_weeklyGoalModal) return;
  _weeklyGoalModal.hidden = false;
  _weeklyGoalModal.style.display = "";
}

function closeWeeklyGoalModal() {
  if (!_weeklyGoalModal) return;
  _weeklyGoalModal.hidden = true;
  _weeklyGoalModal.style.display = "none";
}

function setupWeeklyGoalModal() {
  _weeklyGoalModal = document.getElementById("modal-weekly-goal");
  const closeBtn = document.getElementById("btn-close-weekly-goal");
  const cancelBtn = document.getElementById("btn-cancel-weekly-goal");
  const form = document.getElementById("weekly-goal-form");
  const select = document.getElementById("weekly-goal-type");
  const input = document.getElementById("weekly-goal-target");
  const error = document.getElementById("weekly-goal-error");
  if (!_weeklyGoalModal || !closeBtn || !cancelBtn || !form || !select || !input || !error) return;

  _weeklyGoalModal.hidden = true;
  _weeklyGoalModal.style.display = "none";
  closeBtn.addEventListener("click", closeWeeklyGoalModal);
  cancelBtn.addEventListener("click", closeWeeklyGoalModal);
  _weeklyGoalModal.addEventListener("click", (e) => {
    if (e.target === _weeklyGoalModal) closeWeeklyGoalModal();
  });
  form.addEventListener("click", (e) => e.stopPropagation());

  select.addEventListener("change", () => {
    const goal = getWeeklyGoal(select.value);
    input.value = String(goal.target);
    error.textContent = "";
    updateWeeklyGoalFormHint(select.value);
  });

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const unit = select.value;
    const value = Number(input.value);
    error.textContent = "";
    if (!Number.isFinite(value) || value <= 0) {
      error.textContent = "Please enter a valid positive target.";
      return;
    }
    _selectedGoalType = unit;
    saveSelectedGoalType(unit);
    _goalOverrides[unit] = value;
    saveGoalOverrides();
    closeWeeklyGoalModal();
    if (_latestReadingStats) renderReadingStats(_latestReadingStats);
    showMessage(`Weekly ${goalTypeLabel(unit)} goal updated.`, "success");
  });
}

function setupGenreInput({ inputId, datalistId, tagsId }) {
  const input = document.getElementById(inputId);
  const datalist = document.getElementById(datalistId);
  const tags = document.getElementById(tagsId);
  if (!input || !datalist || !tags) return;

  datalist.innerHTML = SUGGESTED_GENRES.map((g) => `<option value="${escapeHtml(g)}"></option>`).join("");
  tags.innerHTML = SUGGESTED_GENRES
    .map((g) => `<button type="button" class="genre-tag" data-genre="${escapeHtml(g)}">${escapeHtml(g)}</button>`)
    .join("");

  tags.addEventListener("click", (e) => {
    const btn = e.target.closest(".genre-tag");
    if (!btn) return;
    input.value = btn.dataset.genre || "";
    input.focus();
  });
}

function renderItemCard(item) {
  const pct = progressPercent(item);
  const label = progressLabel(item);
  const genre = (item.genre || "").trim();
  const genreLine = genre
    ? `<p class="card-author">Genre: ${escapeHtml(genre)}</p>`
    : "";
  const startedLine = item.started_at
    ? `<p class="card-author">Started: ${escapeHtml(formatCardDate(item.started_at))}</p>`
    : "";
  const finishedLine = item.finished_at
    ? `<p class="card-author">Finished: ${escapeHtml(formatCardDate(item.finished_at))}</p>`
    : "";
  const thoughts = item.thoughts || [];
  const thoughtCount = thoughts.length;
  const thoughtLabel =
    thoughtCount > 0
      ? `${thoughtCount} chapter thought${thoughtCount !== 1 ? "s" : ""}`
      : "No chapter thoughts yet";

  const rating = item.review && item.review.rating;
  const ratingLine = rating
    ? `<div class="card-rating">${Array.from({ length: 5 }, (_, i) =>
        `<span class="star-display ${i < rating ? "filled" : ""}">\u2605</span>`
      ).join("")}</div>`
    : "";

  return `
    <div class="item-card" data-id="${item.id}">
      <div class="card-main">
        <div class="card-format-badge">${escapeHtml(item.format || "Physical")}</div>
        <h3 class="card-title"><a href="/item/${item.id}">${escapeHtml(item.title)}</a></h3>
        <p class="card-author">${escapeHtml(item.author || "")}</p>
        ${genreLine}
        ${startedLine}
        ${finishedLine}
        <div class="card-progress">
          <div class="card-progress-header">
            <span>Progress</span>
            <span>${escapeHtml(label)}</span>
          </div>
          <div class="progress-bar-wrap"><div class="progress-bar-fill" style="width:${pct}%"></div></div>
        </div>
        ${ratingLine}
        <div class="card-actions">
          <button type="button" class="btn-icon btn-edit" data-id="${item.id}" title="Edit">&#9998;</button>
          <button type="button" class="btn-icon btn-delete" data-id="${item.id}" title="Delete">&times;</button>
        </div>
      </div>
      <a class="card-thoughts-footer" href="/item/${item.id}" aria-label="View thoughts for ${escapeHtml(item.title)}">
        <span class="card-thoughts-text">${escapeHtml(thoughtLabel)}</span>
        <span class="card-thoughts-cta">View</span>
      </a>
    </div>`;
}

// --- Filtering (all client-side) ---

function matchesSearch(item, q) {
  if (!q) return true;
  const lower = q.toLowerCase();
  const title = (item.title || "").toLowerCase();
  const author = (item.author || "").toLowerCase();
  const genre = (item.genre || "").toLowerCase();
  return title.includes(lower) || author.includes(lower) || genre.includes(lower);
}

function getFilteredItems() {
  let items = _allItems;
  if (_searchQuery) {
    items = items.filter((item) => matchesSearch(item, _searchQuery));
  }
  if (_activeFormat) {
    items = items.filter((item) => item.format === _activeFormat);
  }
  return items;
}

function updateTabCounts(searchFiltered) {
  const counts = { Reading: 0, TBR: 0, Finished: 0, DNF: 0 };
  for (const item of searchFiltered) {
    if (counts.hasOwnProperty(item.status)) {
      counts[item.status]++;
    }
  }
  document.getElementById("summary-all").textContent = searchFiltered.length;
  document.getElementById("summary-reading").textContent = counts.Reading;
  document.getElementById("summary-tbr").textContent = counts.TBR;
  document.getElementById("summary-finished").textContent = counts.Finished;
  document.getElementById("summary-dnf").textContent = counts.DNF;
}

function renderStatusDonut(items) {
  const donut = document.getElementById("status-donut-chart");
  const legend = document.getElementById("status-donut-legend");
  const totalEl = document.getElementById("status-donut-total");
  const subEl = document.getElementById("status-donut-sub");
  if (!donut || !legend || !totalEl || !subEl) return;

  const counts = { Reading: 0, TBR: 0, Finished: 0, DNF: 0 };
  for (const item of items) {
    if (Object.prototype.hasOwnProperty.call(counts, item.status)) {
      counts[item.status] += 1;
    }
  }
  const total = items.length;
  totalEl.textContent = total;
  subEl.textContent = total === 1 ? "item" : "items";

  if (total === 0) {
    donut.style.background = "conic-gradient(#e5e7eb 0% 100%)";
  } else {
    let cursor = 0;
    const slices = [];
    for (const entry of STATUS_DONUT) {
      const value = counts[entry.status];
      if (!value) continue;
      const pct = (value / total) * 100;
      const end = cursor + pct;
      slices.push(`${entry.color} ${cursor}% ${end}%`);
      cursor = end;
    }
    donut.style.background = `conic-gradient(${slices.join(", ")})`;
  }

  legend.innerHTML = STATUS_DONUT.map((entry) => {
    const count = counts[entry.status];
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    return `
      <div class="status-donut-legend-row">
        <span class="status-donut-legend-key">
          <span class="status-donut-legend-swatch" style="background:${entry.color}"></span>
          <span>${entry.status}</span>
        </span>
        <span class="status-donut-legend-value">${count} (${pct}%)</span>
      </div>
    `;
  }).join("");
}

function renderItems() {
  const searchFiltered = getFilteredItems();
  updateTabCounts(searchFiltered);

  let visible = searchFiltered;
  if (_activeStatus) {
    visible = searchFiltered.filter((item) => item.status === _activeStatus);
  }

  renderStatusDonut(visible);
  _itemsCache = visible;
  const grid = document.getElementById("library-grid");
  grid.innerHTML =
    visible.length === 0
      ? '<p class="empty-state">No books to show. Add one with the button above.</p>'
      : visible.map(renderItemCard).join("");
}

async function loadAllItems() {
  try {
    const [itemsResult, statsResult] = await Promise.allSettled([
      api("GET", "/items"),
      api("GET", "/items/stats/reading"),
    ]);
    if (itemsResult.status !== "fulfilled") {
      throw itemsResult.reason;
    }
    _allItems = itemsResult.value;
    if (statsResult.status === "fulfilled") {
      renderReadingStats(statsResult.value);
    }
    renderItems();
  } catch (e) {
    showMessage(e.message || "Failed to load library", "error");
  }
}

// --- Status tabs ---

function setActiveTab(status) {
  _activeStatus = status;
  document.querySelectorAll(".status-tab").forEach((tab) => {
    tab.classList.toggle("active", tab.dataset.status === status);
  });
  renderItems();
}

function setupTabs() {
  document.getElementById("status-tabs").addEventListener("click", (e) => {
    const tab = e.target.closest(".status-tab");
    if (!tab) return;
    setActiveTab(tab.dataset.status);
  });
}

// --- Search ---

function debounce(fn, ms) {
  let t;
  return function () {
    clearTimeout(t);
    t = setTimeout(() => fn.apply(this, arguments), ms);
  };
}

function setupSearch() {
  const input = document.getElementById("search-input");
  input.addEventListener(
    "input",
    debounce(() => {
      _searchQuery = input.value.trim();
      renderItems();
    }, 200)
  );
}

// --- Format filter ---

function renderFormatFilterMenu() {
  const menu = document.getElementById("format-filter-menu");
  const label = document.getElementById("format-filter-label");
  if (!menu || !label) return;

  const selected = FORMAT_FILTER_OPTIONS.find((opt) => opt.value === _activeFormat) || FORMAT_FILTER_OPTIONS[0];
  label.textContent = selected.label;

  menu.innerHTML = FORMAT_FILTER_OPTIONS.map((opt) => {
    const isSelected = opt.value === _activeFormat;
    return `
      <button type="button" class="format-option ${isSelected ? "selected" : ""}" data-value="${escapeHtml(opt.value)}" role="option" aria-selected="${isSelected}">
        <span>${escapeHtml(opt.label)}</span>
        <span class="format-option-check">${isSelected ? "\u2713" : ""}</span>
      </button>
    `;
  }).join("");
}

function closeFormatMenu() {
  const root = document.getElementById("format-filter");
  const toggle = document.getElementById("format-filter-toggle");
  const menu = document.getElementById("format-filter-menu");
  if (!root || !toggle || !menu) return;
  root.classList.remove("open");
  toggle.setAttribute("aria-expanded", "false");
  menu.hidden = true;
}

function openFormatMenu() {
  const root = document.getElementById("format-filter");
  const toggle = document.getElementById("format-filter-toggle");
  const menu = document.getElementById("format-filter-menu");
  if (!root || !toggle || !menu) return;
  root.classList.add("open");
  toggle.setAttribute("aria-expanded", "true");
  menu.hidden = false;
}

function setupFormatFilter() {
  const root = document.getElementById("format-filter");
  const toggle = document.getElementById("format-filter-toggle");
  const menu = document.getElementById("format-filter-menu");
  if (!root || !toggle || !menu) return;

  renderFormatFilterMenu();

  toggle.addEventListener("click", () => {
    if (menu.hidden) openFormatMenu();
    else closeFormatMenu();
  });

  menu.addEventListener("click", (e) => {
    const option = e.target.closest(".format-option");
    if (!option) return;
    _activeFormat = option.dataset.value || "";
    renderFormatFilterMenu();
    closeFormatMenu();
    renderItems();
  });

  document.addEventListener("click", (e) => {
    if (!root.contains(e.target)) {
      closeFormatMenu();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeFormatMenu();
    }
  });
}

// --- Modal (add / edit) ---

let modal, form;

function syncProgressWithFormat() {
  const fmt = document.getElementById("item-format").value;
  const info = FORMAT_PROGRESS[fmt] || FORMAT_PROGRESS.Physical;
  document.getElementById("item-progress-type").value = info.type;
  document.getElementById("label-progress-current").textContent = info.currentLabel;
  document.getElementById("label-progress-total").textContent = info.totalLabel;
  const isTime = info.type === "Time";
  document.getElementById("time-hint").hidden = !isTime;
  document.getElementById("item-progress-current").placeholder = isTime ? "e.g. 90" : "";
  document.getElementById("item-progress-total").placeholder = isTime ? "e.g. 480" : "";
}

function openAddModal() {
  if (!modal || !form) return;
  document.getElementById("modal-title").textContent = "Add library item";
  document.getElementById("item-id").value = "";
  form.reset();
  document.getElementById("item-status").value = "TBR";
  document.getElementById("item-format").value = "Physical";
  document.getElementById("item-progress-type").value = "Pages";
  syncProgressWithFormat();
  document.getElementById("error-title").textContent = "";
  modal.hidden = false;
  modal.style.display = "";
}

function closeModal() {
  if (modal) {
    modal.hidden = true;
    modal.style.display = "none";
  }
}

function getFormPayload() {
  const fmt = document.getElementById("item-format").value;
  const info = FORMAT_PROGRESS[fmt] || FORMAT_PROGRESS.Physical;
  const cur = document.getElementById("item-progress-current").value;
  const tot = document.getElementById("item-progress-total").value;
  const started_at = document.getElementById("item-start-date").value;
  return {
    title: document.getElementById("item-title").value.trim(),
    author: document.getElementById("item-author").value.trim() || undefined,
    isbn: normalizeIsbn(document.getElementById("item-isbn").value) || undefined,
    format: fmt,
    status: document.getElementById("item-status").value,
    genre: document.getElementById("item-genre").value.trim() || undefined,
    started_at: started_at || undefined,
    progress_type: info.type,
    progress_current: cur === "" ? undefined : parseFloat(cur),
    progress_total: tot === "" ? undefined : parseFloat(tot),
    notes: document.getElementById("item-notes").value.trim() || undefined,
  };
}

function setupModal() {
  modal = document.getElementById("modal-form");
  form = document.getElementById("item-form");
  if (!modal || !form) return;

  modal.hidden = true;
  modal.style.display = "none";

  const modalContent = modal.querySelector(".modal-content");
  if (modalContent)
    modalContent.addEventListener("click", (e) => e.stopPropagation());

  setupGenreInput({
    inputId: "item-genre",
    datalistId: "item-genre-suggestions",
    tagsId: "item-genre-tags",
  });

  document.getElementById("item-format").addEventListener("change", syncProgressWithFormat);
  form.addEventListener("submit", handleFormSubmit);
  document
    .getElementById("btn-cancel-form")
    .addEventListener("click", closeModal);
  document
    .getElementById("btn-add-item")
    .addEventListener("click", openAddModal);
  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });
}

async function handleFormSubmit(e) {
  e.preventDefault();
  const id = document.getElementById("item-id").value;
  const payload = getFormPayload();
  if (!payload.title) {
    document.getElementById("error-title").textContent = "Title is required.";
    return;
  }
  document.getElementById("error-title").textContent = "";
  try {
    if (id) {
      await api("PUT", "/items/" + id, payload);
      showMessage("Item updated.", "success");
    } else {
      await api("POST", "/items", payload);
      showMessage("Item added.", "success");
    }
    closeModal();
    await loadAllItems();
  } catch (err) {
    const msg = err.message || "Failed to save";
    showMessage(msg, "error");
    document.getElementById("error-title").textContent = msg;
  }
}

// --- Edit / Delete ---

function openEditModal(itemId) {
  const item = _itemsCache.find((i) => i.id === itemId);
  if (!item || !modal || !form) return;
  document.getElementById("modal-title").textContent = "Edit library item";
  document.getElementById("item-id").value = item.id;
  document.getElementById("item-title").value = item.title || "";
  document.getElementById("item-author").value = item.author || "";
  document.getElementById("item-isbn").value = item.isbn || "";
  document.getElementById("item-format").value = item.format || "Physical";
  document.getElementById("item-status").value = item.status || "TBR";
  document.getElementById("item-genre").value = item.genre || "";
  document.getElementById("item-start-date").value = toDateInputValue(item.started_at);
  syncProgressWithFormat();
  document.getElementById("item-progress-current").value =
    item.progress_current != null ? item.progress_current : "";
  document.getElementById("item-progress-total").value =
    item.progress_total != null ? item.progress_total : "";
  document.getElementById("item-notes").value = item.notes || "";
  document.getElementById("error-title").textContent = "";
  modal.hidden = false;
  modal.style.display = "";
}

async function deleteItem(itemId) {
  if (!confirm("Are you sure you want to delete this item?")) return;
  try {
    await api("DELETE", "/items/" + itemId);
    showMessage("Item deleted.", "success");
    await loadAllItems();
  } catch (err) {
    showMessage(err.message || "Failed to delete item", "error");
  }
}

function setupGridActions() {
  document
    .getElementById("library-grid")
    .addEventListener("click", function (e) {
      const editBtn = e.target.closest(".btn-edit");
      if (editBtn) {
        e.preventDefault();
        openEditModal(editBtn.dataset.id);
        return;
      }
      const deleteBtn = e.target.closest(".btn-delete");
      if (deleteBtn) {
        e.preventDefault();
        deleteItem(deleteBtn.dataset.id);
      }
    });
}

// --- Init ---

document.addEventListener("DOMContentLoaded", function () {
  if (!localStorage.getItem(TOKEN_KEY)) {
    window.location.href = "/login";
    return;
  }
  _goalOverrides = loadGoalOverrides();
  _selectedGoalType = loadSelectedGoalType();
  setupModal();
  setupTabs();
  setupSearch();
  setupFormatFilter();
  setupGridActions();
  setupWeeklyGoalModal();
  setupGoalEditor();
  setupAllTimeRangeFilter();
  loadAllItems();
  document.getElementById("btn-logout").addEventListener("click", function () {
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = "/login";
  });
});
