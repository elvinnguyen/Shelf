"""
Optional: Seed script to add 5 sample library items for demo.
Run from project root: python backend/seed.py
Requires .env with MONGODB_URI (or default local MongoDB).
"""
import os
import sys
from datetime import datetime

# Add parent so we can load config
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from dotenv import load_dotenv
_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(os.path.join(_root, ".env"))

from pymongo import MongoClient

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
DATABASE_NAME = os.getenv("DATABASE_NAME", "shelf")
ITEMS_COLLECTION = "items"

SAMPLES = [
    {
        "title": "Project Hail Mary",
        "author": "Andy Weir",
        "format": "Physical",
        "status": "Reading",
        "genre": "Sci-Fi",
        "progress_type": "Pages",
        "progress_current": 180,
        "progress_total": 476,
        "percent": None,
        "notes": "Hard to put down.",
        "thoughts": [
            {"chapter_or_marker": "Ch 5", "text": "Loved the science bits.", "timestamp": datetime.utcnow().isoformat()},
        ],
        "review": None,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    },
    {
        "title": "Atomic Habits",
        "author": "James Clear",
        "format": "Audiobook",
        "status": "Finished",
        "genre": "Self-Help",
        "progress_type": "Chapters",
        "progress_current": 20,
        "progress_total": 20,
        "percent": None,
        "notes": None,
        "thoughts": [],
        "review": {"rating": 5, "review_text": "Clear and actionable. Recommended.", "updated_at": datetime.utcnow().isoformat()},
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    },
    {
        "title": "Saga, Vol. 1",
        "author": "Brian K. Vaughan",
        "format": "Series (Chapter Based)",
        "status": "TBR",
        "genre": "Graphic Novel",
        "progress_type": "Percent",
        "progress_current": None,
        "progress_total": None,
        "percent": 0,
        "notes": "On the shelf.",
        "thoughts": [],
        "review": None,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    },
    {
        "title": "The Midnight Library",
        "author": "Matt Haig",
        "format": "Physical",
        "status": "DNF",
        "genre": "Fiction",
        "progress_type": "Pages",
        "progress_current": 80,
        "progress_total": 304,
        "percent": None,
        "notes": "Stopped around page 80; not for me.",
        "thoughts": [],
        "review": None,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    },
    {
        "title": "Deep Work",
        "author": "Cal Newport",
        "format": "Audiobook",
        "status": "Reading",
        "genre": "Productivity",
        "progress_type": "Percent",
        "progress_current": None,
        "progress_total": None,
        "percent": 45,
        "notes": None,
        "thoughts": [
            {"chapter_or_marker": "Part 2", "text": "Rule 2: Embrace boredom.", "timestamp": datetime.utcnow().isoformat()},
        ],
        "review": None,
        "created_at": datetime.utcnow().isoformat(),
        "updated_at": datetime.utcnow().isoformat(),
    },
]


def main():
    client = MongoClient(MONGODB_URI)
    db = client[DATABASE_NAME]
    col = db[ITEMS_COLLECTION]
    result = col.insert_many(SAMPLES)
    print(f"Inserted {len(result.inserted_ids)} sample items into {DATABASE_NAME}.{ITEMS_COLLECTION}")


if __name__ == "__main__":
    main()
