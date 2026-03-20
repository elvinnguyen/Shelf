/**
 * Shelf — Item detail: progress, thoughts, review.
 */
const API = "/api";

function getItemId() {
  const path = window.location.pathname;
  const match = path.match(/\/item\/([^/]+)/);
  return match ? match[1] : null;
}

async function api(method, path, body) {
  const opts = { method, headers: { "Content-Type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);
  const res = await fetch(API + path, opts);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

function escapeHtml(s) {
  if (s == null) return "";
  const div = document.createElement("div");
  div.textContent = s;
  return div.innerHTML;
}

const FORMAT_PROGRESS = {
  Physical: { type: "Pages", currentLabel: "Current Page", totalLabel: "Total Pages", unit: "pages" },
  Audiobook: { type: "Time", currentLabel: "Current Time", totalLabel: "Total Time", unit: "hrs" },
  "Series (Chapter Based)": { type: "Chapters", currentLabel: "Current Chapter", totalLabel: "Total Chapters", unit: "chapters" },
};

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
  if (pt === "Percent") return Math.min(100, Math.max(0, Number(item.percent) || 0));
  const cur = Number(item.progress_current) || 0;
  const tot = Number(item.progress_total) || 0;
  if (tot <= 0) return 0;
  return Math.min(100, Math.round((cur / tot) * 100));
}

function statusClass(s) {
  const map = { Reading: "status-reading", TBR: "status-tbr", Finished: "status-finished", DNF: "status-dnf" };
  return map[s] || "";
}

function formatDate(iso) {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "numeric", day: "numeric", year: "numeric" });
  } catch {
    return iso;
  }
}

function renderItem(item) {
  document.getElementById("item-title").textContent = item.title;
  document.getElementById("item-author").textContent = item.author || "";
  document.getElementById("item-format").textContent = item.format || "Physical";
  const statusEl = document.getElementById("item-status");
  statusEl.textContent = item.status || "TBR";
  statusEl.className = "status-badge " + statusClass(item.status);
  document.getElementById("item-genre").textContent = item.genre || "";
  document.getElementById("item-genre-sep").style.display = item.genre ? "inline" : "none";
  document.getElementById("item-notes").textContent = item.notes || "";
  document.getElementById("item-notes").style.display = item.notes ? "block" : "none";

  const pct = progressPercent(item);
  document.getElementById("progress-label").textContent = progressLabel(item);
  document.getElementById("progress-bar-wrap").style.display = "block";
  document.getElementById("progress-bar-fill").style.width = pct + "%";

  // Thoughts
  const list = document.getElementById("thoughts-list");
  const thoughts = item.thoughts || [];
  if (thoughts.length === 0) {
    list.innerHTML = '<p class="thoughts-empty">No chapter thoughts yet. Add your first one!</p>';
  } else {
    list.innerHTML = thoughts
      .map(
        (t, i) => `
      <div class="thought-card" data-idx="${i}">
        <div class="thought-card-header">
          <span class="thought-marker">${escapeHtml(t.chapter_or_marker || "")}</span>
          <button type="button" class="thought-delete" data-idx="${i}" title="Delete thought">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
          </button>
        </div>
        <div class="thought-text">${escapeHtml(t.text)}</div>
        <div class="thought-time">${formatDate(t.timestamp)}</div>
      </div>`
      )
      .join("");
  }

  // Review — only visible when status is Finished
  const reviewSection = document.getElementById("review-section");
  reviewSection.hidden = item.status !== "Finished";

  const review = item.review;
  const reviewDisplay = document.getElementById("review-display");
  const reviewForm = document.getElementById("review-form");
  const reviewSubmitBtn = reviewForm.querySelector("button[type='submit']");
  if (review && (review.rating != null || review.review_text)) {
    reviewDisplay.hidden = false;
    reviewForm.hidden = true;
    const r = review.rating;
    const starsHtml = r != null
      ? Array.from({ length: 5 }, (_, i) =>
          `<span class="star-display ${i < r ? "filled" : ""}">\u2605</span>`
        ).join("") + ` <span class="rating-label">(${r}/5)</span>`
      : "";
    reviewDisplay.innerHTML = `
      <div class="review-display-header">
        <div class="rating">${starsHtml}</div>
        <div class="review-actions">
          <button type="button" class="btn btn-primary btn-sm" id="btn-edit-review">Edit Review</button>
          <button type="button" class="btn btn-link-danger btn-sm" id="btn-delete-review">Delete review</button>
        </div>
      </div>
      <div>${escapeHtml(review.review_text || "")}</div>
    `;
  } else {
    reviewDisplay.hidden = true;
    reviewForm.hidden = false;
    setStarRating(0);
    document.getElementById("review-text").value = "";
    reviewSubmitBtn.textContent = "Save review";
  }
}

function showError(msg) {
  const el = document.getElementById("item-error");
  el.textContent = msg;
  el.hidden = false;
}

let _currentItem = null;
let _isDeletingReview = false;

function setStarRating(val) {
  document.getElementById("review-rating").value = val || "";
  document.querySelectorAll("#star-rating .star").forEach((s) => {
    s.classList.toggle("active", parseInt(s.dataset.value, 10) <= val);
  });
}

function openDeleteReviewModal() {
  const modal = document.getElementById("modal-delete-review");
  modal.hidden = false;
  modal.style.display = "";
}

function closeDeleteReviewModal() {
  const modal = document.getElementById("modal-delete-review");
  modal.hidden = true;
  modal.style.display = "none";
}

function openReviewEditor(review) {
  const reviewForm = document.getElementById("review-form");
  const reviewDisplay = document.getElementById("review-display");
  const reviewSubmitBtn = reviewForm.querySelector("button[type='submit']");
  setStarRating(review && review.rating != null ? review.rating : 0);
  document.getElementById("review-text").value = review && review.review_text ? review.review_text : "";
  reviewSubmitBtn.textContent = review ? "Save changes" : "Save review";
  reviewDisplay.hidden = true;
  reviewForm.hidden = false;
}

function syncEditProgressWithFormat() {
  const fmt = document.getElementById("edit-format").value;
  const info = FORMAT_PROGRESS[fmt] || FORMAT_PROGRESS.Physical;
  document.getElementById("edit-progress-type").value = info.type;
  document.getElementById("edit-label-progress-current").textContent = info.currentLabel;
  document.getElementById("edit-label-progress-total").textContent = info.totalLabel;
  const isTime = info.type === "Time";
  document.getElementById("edit-time-hint").hidden = !isTime;
  document.getElementById("edit-progress-current").placeholder = isTime ? "e.g. 90" : "";
  document.getElementById("edit-progress-total").placeholder = isTime ? "e.g. 480" : "";
}

function openEditModal(item) {
  const modal = document.getElementById("modal-edit");
  document.getElementById("edit-title").value = item.title || "";
  document.getElementById("edit-author").value = item.author || "";
  document.getElementById("edit-format").value = item.format || "Physical";
  document.getElementById("edit-status").value = item.status || "TBR";
  document.getElementById("edit-genre").value = item.genre || "";
  syncEditProgressWithFormat();
  document.getElementById("edit-progress-current").value =
    item.progress_current != null ? item.progress_current : "";
  document.getElementById("edit-progress-total").value =
    item.progress_total != null ? item.progress_total : "";
  document.getElementById("edit-notes").value = item.notes || "";
  document.getElementById("edit-error-title").textContent = "";
  modal.hidden = false;
  modal.style.display = "";
}

function closeEditModal() {
  const modal = document.getElementById("modal-edit");
  modal.hidden = true;
  modal.style.display = "none";
}

function getEditPayload() {
  const fmt = document.getElementById("edit-format").value;
  const info = FORMAT_PROGRESS[fmt] || FORMAT_PROGRESS.Physical;
  const cur = document.getElementById("edit-progress-current").value;
  const tot = document.getElementById("edit-progress-total").value;
  return {
    title: document.getElementById("edit-title").value.trim(),
    author: document.getElementById("edit-author").value.trim() || undefined,
    format: fmt,
    status: document.getElementById("edit-status").value,
    genre: document.getElementById("edit-genre").value.trim() || undefined,
    progress_type: info.type,
    progress_current: cur === "" ? undefined : parseFloat(cur),
    progress_total: tot === "" ? undefined : parseFloat(tot),
    notes: document.getElementById("edit-notes").value.trim() || undefined,
  };
}

document.addEventListener("DOMContentLoaded", async function () {
  const id = getItemId();
  if (!id) {
    showError("Invalid item.");
    return;
  }
  try {
    const item = await api("GET", "/items/" + id);
    _currentItem = item;
    document.getElementById("item-loading").hidden = true;
    document.getElementById("item-content").hidden = false;
    document.title = item.title + " — Shelf";
    renderItem(item);

    // Edit button
    document.getElementById("btn-edit-item").addEventListener("click", () => {
      openEditModal(_currentItem);
    });

    // Delete button
    document.getElementById("btn-delete-item").addEventListener("click", async () => {
      if (!confirm("Are you sure you want to delete this item?")) return;
      try {
        await api("DELETE", "/items/" + id);
        window.location.href = "/dashboard";
      } catch (err) {
        showError(err.message || "Failed to delete item.");
      }
    });

    // Edit modal setup
    const editModal = document.getElementById("modal-edit");
    const editModalContent = editModal.querySelector(".modal-content");
    editModalContent.addEventListener("click", (e) => e.stopPropagation());
    editModal.addEventListener("click", (e) => {
      if (e.target === editModal) closeEditModal();
    });
    document.getElementById("btn-cancel-edit").addEventListener("click", closeEditModal);
    document.getElementById("edit-format").addEventListener("change", syncEditProgressWithFormat);

    // Delete review modal setup
    const deleteReviewModal = document.getElementById("modal-delete-review");
    const deleteReviewContent = deleteReviewModal.querySelector(".modal-content");
    deleteReviewContent.addEventListener("click", (e) => e.stopPropagation());
    deleteReviewModal.addEventListener("click", (e) => {
      if (e.target === deleteReviewModal) closeDeleteReviewModal();
    });
    document.getElementById("btn-cancel-delete-review").addEventListener("click", closeDeleteReviewModal);
    document.getElementById("btn-confirm-delete-review").addEventListener("click", async () => {
      if (_isDeletingReview) return;
      _isDeletingReview = true;
      try {
        const updated = await api("POST", "/items/" + id + "/review", {
          rating: null,
          review_text: "",
        });
        _currentItem = updated;
        renderItem(updated);
        closeDeleteReviewModal();
      } catch (err) {
        showError(err.message || "Failed to delete review.");
      } finally {
        _isDeletingReview = false;
      }
    });

    document.getElementById("edit-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const payload = getEditPayload();
      if (!payload.title) {
        document.getElementById("edit-error-title").textContent = "Title is required.";
        return;
      }
      document.getElementById("edit-error-title").textContent = "";
      try {
        const updated = await api("PUT", "/items/" + id, payload);
        _currentItem = updated;
        document.title = updated.title + " — Shelf";
        renderItem(updated);
        closeEditModal();
      } catch (err) {
        document.getElementById("edit-error-title").textContent =
          err.message || "Failed to save.";
      }
    });

    // Thought form toggle
    const thoughtWrap = document.getElementById("thought-form-wrap");
    document.getElementById("btn-add-thought").addEventListener("click", () => {
      thoughtWrap.hidden = false;
      document.getElementById("thought-chapter").focus();
    });
    document.getElementById("btn-cancel-thought").addEventListener("click", () => {
      thoughtWrap.hidden = true;
      document.getElementById("thought-error").textContent = "";
    });

    // Thought form submit
    document.getElementById("thought-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const text = document.getElementById("thought-text").value.trim();
      const chapter_or_marker = document.getElementById("thought-chapter").value.trim();
      document.getElementById("thought-error").textContent = "";
      if (!text) {
        document.getElementById("thought-error").textContent = "Please enter your thought.";
        return;
      }
      try {
        const updated = await api("POST", "/items/" + id + "/thoughts", { chapter_or_marker: chapter_or_marker || undefined, text });
        _currentItem = updated;
        renderItem(updated);
        document.getElementById("thought-text").value = "";
        document.getElementById("thought-chapter").value = "";
        thoughtWrap.hidden = true;
      } catch (err) {
        document.getElementById("thought-error").textContent = err.message || "Failed to add thought.";
      }
    });

    // Delete thought (event delegation)
    document.getElementById("thoughts-list").addEventListener("click", async (e) => {
      const btn = e.target.closest(".thought-delete");
      if (!btn) return;
      const idx = parseInt(btn.dataset.idx, 10);
      if (!confirm("Delete this thought?")) return;
      try {
        const updated = await api("DELETE", "/items/" + id + "/thoughts/" + idx);
        _currentItem = updated;
        renderItem(updated);
      } catch (err) {
        showError(err.message || "Failed to delete thought.");
      }
    });

    // Star rating interaction
    const starContainer = document.getElementById("star-rating");
    starContainer.addEventListener("click", (e) => {
      const star = e.target.closest(".star");
      if (!star) return;
      const val = parseInt(star.dataset.value, 10);
      const current = parseInt(document.getElementById("review-rating").value, 10);
      setStarRating(val === current ? 0 : val);
    });
    starContainer.addEventListener("mouseover", (e) => {
      const star = e.target.closest(".star");
      if (!star) return;
      const val = parseInt(star.dataset.value, 10);
      starContainer.querySelectorAll(".star").forEach((s) => {
        s.classList.toggle("hover", parseInt(s.dataset.value, 10) <= val);
      });
    });
    starContainer.addEventListener("mouseleave", () => {
      starContainer.querySelectorAll(".star").forEach((s) => s.classList.remove("hover"));
    });

    // Review form
    document.getElementById("review-form").addEventListener("submit", async (e) => {
      e.preventDefault();
      const rating = document.getElementById("review-rating").value;
      const review_text = document.getElementById("review-text").value.trim();
      try {
        const updated = await api("POST", "/items/" + id + "/review", {
          rating: rating === "" ? undefined : parseInt(rating, 10),
          review_text,
        });
        _currentItem = updated;
        renderItem(updated);
      } catch (err) {
        document.getElementById("review-display").innerHTML = "<span class='error'>" + escapeHtml(err.message) + "</span>";
        document.getElementById("review-display").hidden = false;
      }
    });

    // Review actions (event delegation)
    document.getElementById("review-display").addEventListener("click", (e) => {
      const editBtn = e.target.closest("#btn-edit-review");
      if (editBtn) {
        openReviewEditor(_currentItem && _currentItem.review ? _currentItem.review : null);
        return;
      }
      const deleteBtn = e.target.closest("#btn-delete-review");
      if (deleteBtn) {
        openDeleteReviewModal();
      }
    });
  } catch (e) {
    document.getElementById("item-loading").hidden = true;
    showError(e.message || "Item not found.");
  }
});
