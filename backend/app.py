"""
Shelf — Your personal library. Flask API server.
"""
import os
import re
import json
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime, timedelta
from flask import Flask, request, jsonify
from flask_cors import CORS
from bson import ObjectId
from config import FORMATS, STATUSES, PROGRESS_TYPES, GOOGLE_BOOKS_API_KEY
from db import items_col
from auth import auth_bp, require_auth

_static = os.path.join(os.path.dirname(__file__), "..", "frontend")
app = Flask(__name__, static_folder=_static, static_url_path="")
CORS(app)

app.register_blueprint(auth_bp)


def to_json_serializable(doc):
    """Convert MongoDB document (with ObjectId) to JSON-serializable dict."""
    if doc is None:
        return None
    d = dict(doc)
    d["id"] = str(doc["_id"])
    del d["_id"]
    return d


def validate_item(data, for_create=True):
    """Basic input validation for library item. Returns (valid, error_message)."""
    if not data or not isinstance(data, dict):
        return False, "Invalid JSON body"

    title = data.get("title")
    if not title or not str(title).strip():
        return False, "title is required"

    fmt = data.get("format")
    if fmt and fmt not in FORMATS:
        return False, f"format must be one of: {', '.join(FORMATS)}"

    status = data.get("status")
    if status and status not in STATUSES:
        return False, f"status must be one of: {', '.join(STATUSES)}"

    progress_type = data.get("progress_type")
    if progress_type and progress_type not in PROGRESS_TYPES:
        return False, f"progress_type must be one of: {', '.join(PROGRESS_TYPES)}"

    if progress_type == "Percent":
        pct = data.get("percent")
        if pct is not None:
            try:
                pct = float(pct)
                if not (0 <= pct <= 100):
                    return False, "percent must be between 0 and 100"
            except (TypeError, ValueError):
                return False, "percent must be a number"
    else:
        current = data.get("progress_current")
        total = data.get("progress_total")
        if current is not None:
            try:
                float(current)
            except (TypeError, ValueError):
                return False, "progress_current must be a number"
        if total is not None:
            try:
                float(total)
            except (TypeError, ValueError):
                return False, "progress_total must be a number"

    started_at = data.get("started_at")
    if started_at is not None and str(started_at).strip() != "":
        try:
            normalize_optional_datetime(started_at)
        except ValueError:
            return False, "started_at must be an ISO datetime or YYYY-MM-DD date"

    isbn = data.get("isbn")
    if isbn is not None and str(isbn).strip() != "":
        normalized_isbn = re.sub(r"[^0-9Xx]", "", str(isbn))
        if len(normalized_isbn) not in (10, 13):
            return False, "isbn must be a valid 10 or 13 character ISBN"

    return True, None


def build_item_doc(data):
    """Build MongoDB document for an item from request data."""
    doc = {
        "title": str(data.get("title", "")).strip(),
        "author": str(data.get("author", "")).strip() or None,
        "isbn": re.sub(r"[^0-9Xx]", "", str(data.get("isbn", "")).strip()) or None,
        "format": data.get("format") or "Physical",
        "status": data.get("status") or "TBR",
        "genre": str(data.get("genre", "")).strip() or None,
        "progress_type": data.get("progress_type") or "Pages",
        "progress_current": None,
        "progress_total": None,
        "percent": None,
        "notes": str(data.get("notes", "")).strip() or None,
        "started_at": normalize_optional_datetime(data.get("started_at")),
        "finished_at": None,
        "dnf_at": None,
        "thoughts": [],
        "review": None,
        "progress_history": [],
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    }

    pt = doc["progress_type"]
    if pt == "Percent":
        pct = data.get("percent")
        doc["percent"] = float(pct) if pct is not None else 0
    else:
        doc["progress_current"] = _num(data.get("progress_current"), 0)
        doc["progress_total"] = _num(data.get("progress_total"), 0)

    return doc


def _num(v, default=None):
    if v is None:
        return default
    try:
        return float(v) if isinstance(v, (int, float)) else float(v)
    except (TypeError, ValueError):
        return default


def progress_snapshot(doc):
    """Return normalized progress info for diffing and history entries."""
    progress_type = doc.get("progress_type") or "Pages"
    if progress_type == "Percent":
        value = _num(doc.get("percent"), 0)
        unit = "%"
    elif progress_type == "Time":
        value = _num(doc.get("progress_current"), 0)
        unit = "minutes"
    elif progress_type == "Chapters":
        value = _num(doc.get("progress_current"), 0)
        unit = "chapters"
    else:
        value = _num(doc.get("progress_current"), 0)
        unit = "pages"
    return {"progress_type": progress_type, "value": value or 0, "unit": unit}


def build_progress_history_entry(previous_doc, next_doc):
    """
    Create a progress history entry when progress changes.
    Returns None when there is no change or when progress type changes.
    """
    prev = progress_snapshot(previous_doc)
    nxt = progress_snapshot(next_doc)
    if prev["progress_type"] != nxt["progress_type"]:
        return None
    delta = nxt["value"] - prev["value"]
    # Only log forward progress; lower values are treated as corrections/reset.
    if delta <= 0:
        return None
    return {
        "progress_type": nxt["progress_type"],
        "unit": nxt["unit"],
        "previous_value": prev["value"],
        "current_value": nxt["value"],
        "delta": delta,
        "timestamp": datetime.utcnow().isoformat(),
    }


def normalize_optional_datetime(value):
    """Accept ISO datetime or YYYY-MM-DD, return ISO datetime string or None."""
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        return datetime.strptime(s, "%Y-%m-%d").isoformat()
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).isoformat()
    except ValueError as exc:
        raise ValueError("invalid datetime format") from exc


def parse_log_datetime(value):
    """Parse ISO-like timestamp from log entries into datetime or None."""
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def get_item_progress_logs(doc):
    """
    Return progress logs list from either progress_history or progress_logs.
    Keeps backward compatibility with older naming.
    """
    logs = doc.get("progress_history")
    if isinstance(logs, list):
        return logs
    logs = doc.get("progress_logs")
    if isinstance(logs, list):
        return logs
    return []


def unit_label(unit):
    u = (unit or "").lower()
    if u == "pages":
        return "pages"
    if u == "chapters":
        return "chapters"
    if u == "minutes":
        return "minutes"
    if u == "%":
        return "percent points"
    return "units"


def preferred_unit(unit_totals):
    """Pick display unit for dashboard rollups."""
    if not unit_totals:
        return "pages"
    for u in ["pages", "chapters", "minutes", "%"]:
        if unit_totals.get(u, 0) > 0:
            return u
    # Fallback to highest total if custom units exist.
    return max(unit_totals.items(), key=lambda pair: pair[1])[0]


def normalize_cover_url(url):
    """Return HTTPS + higher-res Google Books cover URL when possible."""
    if not url:
        return None
    parsed = urllib.parse.urlsplit(url)
    if not parsed.netloc:
        return url
    query = dict(urllib.parse.parse_qsl(parsed.query, keep_blank_values=True))
    # Ask Google Books for a larger image when available.
    query["zoom"] = str(max(int(query.get("zoom", "1") or 1), 3))
    query.pop("edge", None)
    return urllib.parse.urlunsplit((
        "https",
        parsed.netloc,
        parsed.path,
        urllib.parse.urlencode(query),
        parsed.fragment,
    ))


def openlibrary_cover_url(isbn):
    """Fallback cover source when Google Books is unavailable."""
    return f"https://covers.openlibrary.org/b/isbn/{isbn}-L.jpg?default=false"


def url_exists(url, timeout=4):
    """Return True when URL responds successfully; False otherwise."""
    try:
        req = urllib.request.Request(url, method="HEAD")
        with urllib.request.urlopen(req, timeout=timeout):
            return True
    except Exception:
        return False


# ——— Error handler (so API always returns JSON) ———

@app.errorhandler(500)
def handle_500(e):
    return jsonify({"error": str(e) or "Internal server error"}), 500


# ——— Health check ———

@app.route("/health")
def health():
    return jsonify({"status": "ok"}), 200


# ——— Page routes ———

@app.route("/")
def index():
    return app.send_static_file("index.html")


@app.route("/login")
def login_page():
    return app.send_static_file("login.html")


@app.route("/dashboard")
def dashboard_page():
    return app.send_static_file("dashboard.html")


@app.route("/item/<item_id>")
def item_page(item_id):
    return app.send_static_file("item.html")


# ——— API routes ———

@app.route("/api/items", methods=["POST"])
@require_auth
def create_item():
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"error": "Invalid or missing JSON. Send a JSON body with at least 'title'."}), 400
    valid, err = validate_item(data)
    if not valid:
        return jsonify({"error": err}), 400
    doc = build_item_doc(data)
    doc["user_id"] = request.user_id
    now = datetime.utcnow().isoformat()
    if doc.get("status") == "Reading" and not doc.get("started_at"):
        doc["started_at"] = now
    if doc.get("status") == "Finished" and not doc.get("finished_at"):
        doc["finished_at"] = now
    if doc.get("status") == "DNF" and not doc.get("dnf_at"):
        doc["dnf_at"] = now
    try:
        result = items_col.insert_one(doc)
    except Exception as e:
        return jsonify({"error": f"Database error: {str(e)}"}), 500
    doc["_id"] = result.inserted_id
    return jsonify(to_json_serializable(doc)), 201


@app.route("/api/items", methods=["GET"])
@require_auth
def list_items():
    status = request.args.get("status")
    format_filter = request.args.get("format")
    genre = request.args.get("genre")
    q = request.args.get("q", "").strip()

    query = {"user_id": request.user_id}
    if status:
        query["status"] = status
    if format_filter:
        query["format"] = format_filter
    if genre:
        query["genre"] = re.compile(re.escape(genre), re.I)
    if q:
        query["$or"] = [
            {"title": re.compile(re.escape(q), re.I)},
            {"author": re.compile(re.escape(q), re.I)},
        ]

    cursor = items_col.find(query).sort("updated_at", -1)
    items = [to_json_serializable(d) for d in cursor]
    return jsonify(items)


@app.route("/api/items/summary")
@require_auth
def summary():
    """Return counts: total, and by status. Optional for dashboard."""
    user_filter = {"user_id": request.user_id}
    total = items_col.count_documents(user_filter)
    pipeline = [
        {"$match": user_filter},
        {"$group": {"_id": "$status", "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]
    by_status = {r["_id"]: r["count"] for r in items_col.aggregate(pipeline)}
    for s in ["Reading", "TBR", "Finished", "DNF"]:
        if s not in by_status:
            by_status[s] = 0
    return jsonify({"total": total, "by_status": by_status})


@app.route("/api/items/stats/reading", methods=["GET"])
@require_auth
def reading_stats():
    """
    Reading streak + daily stats computed from progress logs.
    """
    items = list(items_col.find({"user_id": request.user_id}))
    day_totals = {}
    day_books = {}
    day_units = {}
    unit_totals = {}

    for item in items:
        item_id = str(item.get("_id"))
        for entry in get_item_progress_logs(item):
            delta = _num(entry.get("delta"), 0)
            if delta <= 0:
                continue
            ts = parse_log_datetime(entry.get("timestamp"))
            if not ts:
                continue
            day_key = ts.date().isoformat()
            unit = (entry.get("unit") or "units").lower()

            if day_key not in day_totals:
                day_totals[day_key] = {}
            day_totals[day_key][unit] = day_totals[day_key].get(unit, 0) + delta

            if day_key not in day_books:
                day_books[day_key] = set()
            day_books[day_key].add(item_id)

            if day_key not in day_units:
                day_units[day_key] = set()
            day_units[day_key].add(unit)

            unit_totals[unit] = unit_totals.get(unit, 0) + delta

    display_unit = preferred_unit(unit_totals)

    today_date = datetime.utcnow().date()
    today_key = today_date.isoformat()
    today_value = day_totals.get(today_key, {}).get(display_unit, 0)
    today_books_count = len(day_books.get(today_key, set()))

    this_week_value = 0
    this_week_days = 0
    for days_ago in range(7):
        d = today_date - timedelta(days=days_ago)
        k = d.isoformat()
        v = day_totals.get(k, {}).get(display_unit, 0)
        if v > 0:
            this_week_days += 1
        this_week_value += v

    streak = 0
    cursor = today_date
    while cursor.isoformat() in day_books:
        streak += 1
        cursor = cursor - timedelta(days=1)

    total_value = unit_totals.get(display_unit, 0)

    return jsonify({
        "current_streak_days": streak,
        "unit": display_unit,
        "unit_label": unit_label(display_unit),
        "today": {
            "value": today_value,
            "books": today_books_count,
        },
        "this_week": {
            "value": this_week_value,
            "active_days": this_week_days,
        },
        "total": {
            "value": total_value,
        },
    })


@app.route("/api/items/<item_id>", methods=["GET"])
@require_auth
def get_item(item_id):
    if not ObjectId.is_valid(item_id):
        return jsonify({"error": "Invalid item id"}), 400
    doc = items_col.find_one({"_id": ObjectId(item_id), "user_id": request.user_id})
    if not doc:
        return jsonify({"error": "Item not found"}), 404
    return jsonify(to_json_serializable(doc))


@app.route("/api/items/<item_id>", methods=["PUT"])
@require_auth
def update_item(item_id):
    """Optional: full update of item."""
    if not ObjectId.is_valid(item_id):
        return jsonify({"error": "Invalid item id"}), 400
    data = request.get_json()
    existing = items_col.find_one({"_id": ObjectId(item_id), "user_id": request.user_id})
    if not existing:
        return jsonify({"error": "Item not found"}), 404
    valid, err = validate_item(data)
    if not valid:
        return jsonify({"error": err}), 400
    doc = build_item_doc(data)
    # Preserve non-editable fields like thoughts/review/created_at on updates.
    editable_fields = [
        "title",
        "author",
        "isbn",
        "format",
        "status",
        "genre",
        "progress_type",
        "progress_current",
        "progress_total",
        "percent",
        "notes",
    ]
    update_doc = {k: doc.get(k) for k in editable_fields}
    update_doc["started_at"] = existing.get("started_at")
    manual_started_at = normalize_optional_datetime(data.get("started_at"))
    if not update_doc["started_at"] and manual_started_at:
        update_doc["started_at"] = manual_started_at
    update_doc["finished_at"] = existing.get("finished_at")
    update_doc["dnf_at"] = existing.get("dnf_at")
    now = datetime.utcnow().isoformat()
    if update_doc.get("status") == "Reading" and not update_doc.get("started_at"):
        update_doc["started_at"] = now
    if update_doc.get("status") == "Finished" and not update_doc.get("finished_at"):
        update_doc["finished_at"] = now
    if update_doc.get("status") == "DNF" and not update_doc.get("dnf_at"):
        update_doc["dnf_at"] = now
    progress_history = list(existing.get("progress_history") or [])
    history_entry = build_progress_history_entry(existing, update_doc)
    if history_entry:
        progress_history.append(history_entry)
    update_doc["progress_history"] = progress_history
    update_doc["updated_at"] = datetime.utcnow().isoformat()
    items_col.update_one(
        {"_id": ObjectId(item_id), "user_id": request.user_id},
        {"$set": update_doc},
    )
    updated = items_col.find_one({"_id": ObjectId(item_id), "user_id": request.user_id})
    return jsonify(to_json_serializable(updated))


@app.route("/api/items/<item_id>/progress/undo", methods=["POST"])
@require_auth
def undo_last_progress_update(item_id):
    """Undo the most recent progress history entry and restore previous value."""
    if not ObjectId.is_valid(item_id):
        return jsonify({"error": "Invalid item id"}), 400
    existing = items_col.find_one({"_id": ObjectId(item_id), "user_id": request.user_id})
    if not existing:
        return jsonify({"error": "Item not found"}), 404
    progress_history = list(existing.get("progress_history") or [])
    if not progress_history:
        return jsonify({"error": "No progress updates to undo"}), 400

    last_entry = progress_history.pop()
    previous_value = _num(last_entry.get("previous_value"), 0)
    progress_type = last_entry.get("progress_type") or existing.get("progress_type") or "Pages"
    update_doc = {
        "progress_history": progress_history,
        "updated_at": datetime.utcnow().isoformat(),
    }
    if progress_type == "Percent":
        update_doc["percent"] = previous_value
    else:
        update_doc["progress_current"] = previous_value

    items_col.update_one(
        {"_id": ObjectId(item_id), "user_id": request.user_id},
        {"$set": update_doc},
    )
    updated = items_col.find_one({"_id": ObjectId(item_id), "user_id": request.user_id})
    return jsonify(to_json_serializable(updated))


@app.route("/api/books/cover", methods=["GET"])
def get_book_cover():
    isbn = re.sub(r"[^0-9Xx]", "", request.args.get("isbn", "").strip())
    if not isbn:
        return jsonify({"error": "isbn query parameter is required"}), 400
    if len(isbn) not in (10, 13):
        return jsonify({"error": "isbn must be a valid 10 or 13 character ISBN"}), 400
    ol_url = openlibrary_cover_url(isbn)
    if url_exists(ol_url):
        return jsonify({"isbn": isbn, "cover_url": ol_url, "source": "openlibrary"})

    query_params = {
        "q": f"isbn:{isbn}",
        "maxResults": 1,
    }
    if GOOGLE_BOOKS_API_KEY:
        query_params["key"] = GOOGLE_BOOKS_API_KEY

    query = urllib.parse.urlencode(query_params)
    url = f"https://www.googleapis.com/books/v1/volumes?{query}"

    try:
        with urllib.request.urlopen(url, timeout=8) as response:
            body = response.read().decode("utf-8")
            payload = json.loads(body) if body else {}
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError):
        # Don't fail the UI if Google Books is unavailable on this host.
        return jsonify({"isbn": isbn, "cover_url": None, "source": None})
    except json.JSONDecodeError:
        return jsonify({"isbn": isbn, "cover_url": None, "source": None})

    items = payload.get("items") or []
    volume = items[0] if items else {}
    volume_info = (volume or {}).get("volumeInfo") or {}
    image_links = volume_info.get("imageLinks") or {}
    cover_url = (
        image_links.get("extraLarge")
        or image_links.get("large")
        or image_links.get("medium")
        or image_links.get("small")
        or image_links.get("thumbnail")
        or image_links.get("smallThumbnail")
    )
    cover_url = normalize_cover_url(cover_url)
    if not cover_url:
        return jsonify({"isbn": isbn, "cover_url": None, "source": None})

    return jsonify({"isbn": isbn, "cover_url": cover_url, "source": "google_books"})


@app.route("/api/items/<item_id>", methods=["DELETE"])
@require_auth
def delete_item(item_id):
    """Optional: delete item."""
    if not ObjectId.is_valid(item_id):
        return jsonify({"error": "Invalid item id"}), 400
    result = items_col.delete_one({"_id": ObjectId(item_id), "user_id": request.user_id})
    if result.deleted_count == 0:
        return jsonify({"error": "Item not found"}), 404
    return jsonify({"deleted": True}), 200


@app.route("/api/items/<item_id>/thoughts", methods=["POST"])
@require_auth
def add_thought(item_id):
    if not ObjectId.is_valid(item_id):
        return jsonify({"error": "Invalid item id"}), 400
    data = request.get_json() or {}
    chapter_or_marker = str(data.get("chapter_or_marker", "")).strip()
    text = str(data.get("text", "")).strip()
    if not text:
        return jsonify({"error": "text is required for a thought"}), 400
    entry = {
        "chapter_or_marker": chapter_or_marker or None,
        "text": text,
        "timestamp": datetime.utcnow().isoformat(),
    }
    result = items_col.update_one(
        {"_id": ObjectId(item_id), "user_id": request.user_id},
        {"$push": {"thoughts": entry}, "$set": {"updated_at": datetime.utcnow().isoformat()}},
    )
    if result.matched_count == 0:
        return jsonify({"error": "Item not found"}), 404
    doc = items_col.find_one({"_id": ObjectId(item_id), "user_id": request.user_id})
    return jsonify(to_json_serializable(doc))


@app.route("/api/items/<item_id>/thoughts/<int:idx>", methods=["DELETE"])
@require_auth
def delete_thought(item_id, idx):
    if not ObjectId.is_valid(item_id):
        return jsonify({"error": "Invalid item id"}), 400
    doc = items_col.find_one({"_id": ObjectId(item_id), "user_id": request.user_id})
    if not doc:
        return jsonify({"error": "Item not found"}), 404
    thoughts = doc.get("thoughts", [])
    if idx < 0 or idx >= len(thoughts):
        return jsonify({"error": "Thought index out of range"}), 400
    thoughts.pop(idx)
    items_col.update_one(
        {"_id": ObjectId(item_id), "user_id": request.user_id},
        {"$set": {"thoughts": thoughts, "updated_at": datetime.utcnow().isoformat()}},
    )
    updated = items_col.find_one({"_id": ObjectId(item_id), "user_id": request.user_id})
    return jsonify(to_json_serializable(updated))


@app.route("/api/items/<item_id>/review", methods=["POST"])
@require_auth
def set_review(item_id):
    if not ObjectId.is_valid(item_id):
        return jsonify({"error": "Invalid item id"}), 400
    data = request.get_json() or {}
    rating = data.get("rating")
    review_text = str(data.get("review_text", "")).strip()
    if rating is not None:
        try:
            rating = int(rating)
            if not (1 <= rating <= 5):
                return jsonify({"error": "rating must be between 1 and 5"}), 400
        except (TypeError, ValueError):
            return jsonify({"error": "rating must be an integer 1-5"}), 400
    review = {
        "rating": rating,
        "review_text": review_text,
        "updated_at": datetime.utcnow().isoformat(),
    }
    result = items_col.update_one(
        {"_id": ObjectId(item_id), "user_id": request.user_id},
        {"$set": {"review": review, "updated_at": datetime.utcnow().isoformat()}},
    )
    if result.matched_count == 0:
        return jsonify({"error": "Item not found"}), 404
    doc = items_col.find_one({"_id": ObjectId(item_id), "user_id": request.user_id})
    return jsonify(to_json_serializable(doc))


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    debug = os.environ.get("FLASK_DEBUG", "").lower() in ("1", "true", "yes")
    app.run(debug=debug, host="0.0.0.0", port=port)
