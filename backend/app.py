"""
Shelf — Your personal library. Flask API server.
"""
import os
import re
import json
import urllib.parse
import urllib.request
import urllib.error
from datetime import datetime
from flask import Flask, request, jsonify
from flask_cors import CORS
from pymongo import MongoClient
from bson import ObjectId
from config import MONGODB_URI, DATABASE_NAME, ITEMS_COLLECTION, MONGODB_TLS_INSECURE
from config import FORMATS, STATUSES, PROGRESS_TYPES, GOOGLE_BOOKS_API_KEY

_static = os.path.join(os.path.dirname(__file__), "..", "frontend")
app = Flask(__name__, static_folder=_static, static_url_path="")
CORS(app)

# MongoDB connection (tlsAllowInvalidCertificates for macOS SSL cert issues in dev)
client = MongoClient(
    MONGODB_URI,
    tlsAllowInvalidCertificates=MONGODB_TLS_INSECURE,
)
db = client[DATABASE_NAME]
items_col = db[ITEMS_COLLECTION]


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


# ——— Error handler (so API always returns JSON) ———

@app.errorhandler(500)
def handle_500(e):
    return jsonify({"error": str(e) or "Internal server error"}), 500


# ——— API routes ———

@app.route("/")
def index():
    return app.send_static_file("index.html")


@app.route("/dashboard")
def dashboard_page():
    return app.send_static_file("dashboard.html")


@app.route("/item/<item_id>")
def item_page(item_id):
    return app.send_static_file("item.html")


@app.route("/api/items", methods=["POST"])
def create_item():
    data = request.get_json(silent=True)
    if data is None:
        return jsonify({"error": "Invalid or missing JSON. Send a JSON body with at least 'title'."}), 400
    valid, err = validate_item(data)
    if not valid:
        return jsonify({"error": err}), 400
    doc = build_item_doc(data)
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
def list_items():
    status = request.args.get("status")
    format_filter = request.args.get("format")
    genre = request.args.get("genre")
    q = request.args.get("q", "").strip()

    query = {}
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
def summary():
    """Return counts: total, and by status. Optional for dashboard."""
    total = items_col.count_documents({})
    pipeline = [
        {"$group": {"_id": "$status", "count": {"$sum": 1}}},
        {"$sort": {"_id": 1}},
    ]
    by_status = {r["_id"]: r["count"] for r in items_col.aggregate(pipeline)}
    for s in ["Reading", "TBR", "Finished", "DNF"]:
        if s not in by_status:
            by_status[s] = 0
    return jsonify({"total": total, "by_status": by_status})


@app.route("/api/items/<item_id>", methods=["GET"])
def get_item(item_id):
    if not ObjectId.is_valid(item_id):
        return jsonify({"error": "Invalid item id"}), 400
    doc = items_col.find_one({"_id": ObjectId(item_id)})
    if not doc:
        return jsonify({"error": "Item not found"}), 404
    return jsonify(to_json_serializable(doc))


@app.route("/api/items/<item_id>", methods=["PUT"])
def update_item(item_id):
    """Optional: full update of item."""
    if not ObjectId.is_valid(item_id):
        return jsonify({"error": "Invalid item id"}), 400
    data = request.get_json()
    existing = items_col.find_one({"_id": ObjectId(item_id)})
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
    update_doc["updated_at"] = datetime.utcnow().isoformat()
    result = items_col.update_one(
        {"_id": ObjectId(item_id)},
        {"$set": update_doc},
    )
    updated = items_col.find_one({"_id": ObjectId(item_id)})
    return jsonify(to_json_serializable(updated))


@app.route("/api/books/cover", methods=["GET"])
def get_book_cover():
    isbn = re.sub(r"[^0-9Xx]", "", request.args.get("isbn", "").strip())
    if not isbn:
        return jsonify({"error": "isbn query parameter is required"}), 400
    if len(isbn) not in (10, 13):
        return jsonify({"error": "isbn must be a valid 10 or 13 character ISBN"}), 400
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
        return jsonify({"isbn": isbn, "cover_url": openlibrary_cover_url(isbn), "source": "openlibrary"})
    except json.JSONDecodeError:
        return jsonify({"isbn": isbn, "cover_url": openlibrary_cover_url(isbn), "source": "openlibrary"})

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
        cover_url = openlibrary_cover_url(isbn)

    return jsonify({"isbn": isbn, "cover_url": cover_url, "source": "google_books" if image_links else "openlibrary"})


@app.route("/api/items/<item_id>", methods=["DELETE"])
def delete_item(item_id):
    """Optional: delete item."""
    if not ObjectId.is_valid(item_id):
        return jsonify({"error": "Invalid item id"}), 400
    result = items_col.delete_one({"_id": ObjectId(item_id)})
    if result.deleted_count == 0:
        return jsonify({"error": "Item not found"}), 404
    return jsonify({"deleted": True}), 200


@app.route("/api/items/<item_id>/thoughts", methods=["POST"])
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
        {"_id": ObjectId(item_id)},
        {"$push": {"thoughts": entry}, "$set": {"updated_at": datetime.utcnow().isoformat()}},
    )
    if result.matched_count == 0:
        return jsonify({"error": "Item not found"}), 404
    doc = items_col.find_one({"_id": ObjectId(item_id)})
    return jsonify(to_json_serializable(doc))


@app.route("/api/items/<item_id>/thoughts/<int:idx>", methods=["DELETE"])
def delete_thought(item_id, idx):
    if not ObjectId.is_valid(item_id):
        return jsonify({"error": "Invalid item id"}), 400
    doc = items_col.find_one({"_id": ObjectId(item_id)})
    if not doc:
        return jsonify({"error": "Item not found"}), 404
    thoughts = doc.get("thoughts", [])
    if idx < 0 or idx >= len(thoughts):
        return jsonify({"error": "Thought index out of range"}), 400
    thoughts.pop(idx)
    items_col.update_one(
        {"_id": ObjectId(item_id)},
        {"$set": {"thoughts": thoughts, "updated_at": datetime.utcnow().isoformat()}},
    )
    updated = items_col.find_one({"_id": ObjectId(item_id)})
    return jsonify(to_json_serializable(updated))


@app.route("/api/items/<item_id>/review", methods=["POST"])
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
        {"_id": ObjectId(item_id)},
        {"$set": {"review": review, "updated_at": datetime.utcnow().isoformat()}},
    )
    if result.matched_count == 0:
        return jsonify({"error": "Item not found"}), 404
    doc = items_col.find_one({"_id": ObjectId(item_id)})
    return jsonify(to_json_serializable(doc))


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    debug = os.environ.get("FLASK_DEBUG", "").lower() in ("1", "true", "yes")
    app.run(debug=debug, host="0.0.0.0", port=port)