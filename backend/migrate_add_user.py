"""
One-time migration: assign all existing items (with no user_id) to a specific user.
Usage: python migrate_add_user.py <user_email>
"""
import sys
from db import items_col, users_col


def migrate(email):
    user = users_col.find_one({"email": email.lower().strip()})
    if not user:
        print(f"No user found with email: {email}")
        sys.exit(1)
    user_id = str(user["_id"])
    result = items_col.update_many(
        {"user_id": {"$exists": False}},
        {"$set": {"user_id": user_id}},
    )
    print(f"Updated {result.modified_count} items to user_id={user_id} ({email})")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python migrate_add_user.py <user_email>")
        sys.exit(1)
    migrate(sys.argv[1])
