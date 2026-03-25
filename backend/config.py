"""Configuration for Shelf backend. Reads MONGODB_URI from environment."""
import os
from dotenv import load_dotenv

# Load .env from project root (parent of backend/)
_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
load_dotenv(os.path.join(_root, ".env"))

MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017")
DATABASE_NAME = os.getenv("DATABASE_NAME", "shelf")
ITEMS_COLLECTION = "items"
GOOGLE_BOOKS_API_KEY = os.getenv("GOOGLE_BOOKS_API_KEY", "").strip()
# Set to 1 or true to skip SSL cert verification (macOS dev workaround for CERTIFICATE_VERIFY_FAILED)
MONGODB_TLS_INSECURE = os.getenv("MONGODB_TLS_INSECURE", "").lower() in ("1", "true", "yes")

# Allowed values for validation
FORMATS = ["Physical", "Audiobook", "Series (Chapter Based)"]
STATUSES = ["Reading", "TBR", "Finished", "DNF"]
PROGRESS_TYPES = ["Pages", "Chapters", "Percent", "Time"]
