/**
 * Shelf — Dashboard: search, status tabs, book cards, add/edit/delete.
 * All filtering happens client-side for instant feedback.
 */
const API = "/api";

let _activeStatus = "";
let _searchQuery = "";
let _activeFormat = "";
let _allItems = [];
let _itemsCache = [];

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
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
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

function renderItems() {
  const searchFiltered = getFilteredItems();
  updateTabCounts(searchFiltered);

  let visible = searchFiltered;
  if (_activeStatus) {
    visible = searchFiltered.filter((item) => item.status === _activeStatus);
  }

  _itemsCache = visible;
  const grid = document.getElementById("library-grid");
  grid.innerHTML =
    visible.length === 0
      ? '<p class="empty-state">No books to show. Add one with the button above.</p>'
      : visible.map(renderItemCard).join("");
}

async function loadAllItems() {
  try {
    _allItems = await api("GET", "/items");
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
  setupModal();
  setupTabs();
  setupSearch();
  setupFormatFilter();
  setupGridActions();
  loadAllItems();
});
