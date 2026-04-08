"""Shared MongoDB connection for Shelf backend."""
from pymongo import MongoClient
from config import (
    MONGODB_URI, DATABASE_NAME, MONGODB_TLS_INSECURE,
    ITEMS_COLLECTION, USERS_COLLECTION,
)

client = MongoClient(MONGODB_URI, tlsAllowInvalidCertificates=MONGODB_TLS_INSECURE)
db = client[DATABASE_NAME]
items_col = db[ITEMS_COLLECTION]
users_col = db[USERS_COLLECTION]

# Indexes
users_col.create_index("email", unique=True)
items_col.create_index("user_id")
