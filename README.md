# Shelf — Your personal library

A centralized tracker for reading progress across **physical books**, **audiobooks**, and **graphic novels/comics**. Organize items by status (Reading / TBR / Finished / DNF), track progress by pages, chapters, or percent, and add chapter thoughts and overall reviews.

---

## Tech stack

- **Backend:** Flask, pymongo, python-dotenv, flask-cors
- **Frontend:** Vanilla HTML, CSS, JavaScript (no frameworks)
- **Database:** MongoDB Atlas

---

## MongoDB Atlas setup

1. Go to [MongoDB Atlas](https://cloud.mongodb.com) and sign in or create an account.
2. Create a new project (e.g. "Shelf").
3. Build a **free** cluster (M0), choose a region close to you.
4. Under **Security → Database Access**, add a database user (username + password). Note the password.
5. Under **Security → Network Access**, add your IP (or `0.0.0.0/0` for “allow from anywhere” for local dev only).
6. In the cluster view, click **Connect → Connect your application**. Copy the connection string (e.g. `mongodb+srv://USER:PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority`).
7. Replace `<password>` in that string with your actual database user password (and ensure no `<>` remain).

You will use this string as `MONGODB_URI` in `.env` below.

---

## Local setup (step-by-step)

### 1. Clone or download the repo

```bash
cd Shelf
```

### 2. Create a virtual environment

```bash
python3 -m venv venv
```

### 3. Activate the virtual environment

- **macOS/Linux:**
  ```bash
  source venv/bin/activate
  ```
- **Windows (Command Prompt):**
  ```cmd
  venv\Scripts\activate.bat
  ```
- **Windows (PowerShell):**
  ```powershell
  venv\Scripts\Activate.ps1
  ```

### 4. Install dependencies

```bash
pip install -r requirements.txt
```

### 5. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set:

- `MONGODB_URI` — your MongoDB Atlas connection string from the steps above.
- Optionally `DATABASE_NAME=shelf` (default is `shelf`).
- `GOOGLE_BOOKS_API_KEY` — required for Google Books cover lookup by ISBN.

### 6. (Optional) Seed sample data for demo

To add 5 sample library items:

```bash
python backend/seed.py
```

### 7. Run the Flask server

From the **project root** (`Shelf`):

```bash
cd backend && python app.py
```

Or, with Flask CLI (from project root):

```bash
cd backend && FLASK_APP=app flask run
```

By default the app runs at **http://127.0.0.1:5001** (port 5001 avoids conflict with macOS AirPlay on 5000). Set `PORT=5000` in your environment if you prefer.

### 8. Open the app

In your browser go to:

- **Landing:** http://127.0.0.1:5001/
- **Dashboard:** http://127.0.0.1:5001/dashboard

---

## Deploy to Render

This project is set up to run as a single Render **Web Service** using `render.yaml`.

### 1. Push your code to GitHub

Render deploys from your Git repository, so push this repo to GitHub first.

### 2. Create the service from Blueprint

1. In Render, click **New +** -> **Blueprint**.
2. Select your repository.
3. Render will detect `render.yaml` and propose a service named `shelf-web`.
4. Click **Apply**.

### 3. Set required environment variables

In Render service settings, set:

- `MONGODB_URI` (required): your MongoDB Atlas connection string.
- `DATABASE_NAME` (optional): defaults to `shelf`.
- `GOOGLE_BOOKS_API_KEY` (required for cover lookups): your Google Books API key.
- `MONGODB_TLS_INSECURE` (optional): keep `false` in production.

### 4. Redeploy and verify

After setting environment variables, redeploy once and open:

- `/` for landing page
- `/dashboard` for the app UI
- `/api/items/summary` for a quick health check

### Render runtime details

- **Build command:** `pip install -r requirements.txt`
- **Start command:** `cd backend && gunicorn app:app --bind 0.0.0.0:$PORT`
- **Python version:** `3.11.11` (from `render.yaml`)

---

## Project structure

```
Shelf/
├── backend/
│   ├── app.py          # Flask app + API routes
│   ├── config.py       # Reads MONGODB_URI from env
│   └── seed.py         # Optional: seed 5 sample items
├── frontend/
│   ├── index.html      # Landing page
│   ├── dashboard.html  # Library dashboard
│   ├── item.html       # Item detail (progress, thoughts, review)
│   ├── css/
│   │   └── style.css
│   └── js/
│       ├── main.js
│       ├── dashboard.js
│       └── item.js
├── .env.example
├── render.yaml
├── requirements.txt
└── README.md
```

---

## MongoDB collection structure

**Database:** `shelf` (or value of `DATABASE_NAME` in `.env`)

**Collection:** `items`

Each document shape:

| Field               | Type     | Description |
|---------------------|----------|-------------|
| `_id`               | ObjectId | Auto-generated |
| `title`             | string   | Required |
| `author`            | string   | Optional |
| `isbn`              | string   | Optional (stored as normalized 10/13 chars) |
| `format`            | string   | `Physical` \| `Audiobook` \| `Graphic Novel/Comic` |
| `status`            | string   | `Reading` \| `TBR` \| `Finished` \| `DNF` |
| `genre`             | string   | Optional |
| `progress_type`     | string   | `Pages` \| `Chapters` \| `Percent` |
| `progress_current`  | number   | For Pages/Chapters |
| `progress_total`    | number   | For Pages/Chapters |
| `percent`           | number   | 0–100 when progress_type is Percent |
| `notes`             | string   | Optional quick notes |
| `thoughts`          | array    | `{ chapter_or_marker, text, timestamp }` |
| `review`            | object   | `{ rating (1–5), review_text, updated_at }` |
| `created_at`        | string   | ISO date |
| `updated_at`        | string   | ISO date |

---

## API (minimum)

| Method | Path | Description |
|--------|------|-------------|
| POST   | `/api/items` | Create item |
| GET    | `/api/items` | List items (query: `status`, `format`, `genre`, `q`) |
| GET    | `/api/items/summary` | Counts: total and by status |
| GET    | `/api/items/<id>` | Item detail |
| GET    | `/api/books/cover?isbn=<isbn>` | Lookup cover image URL from Google Books |
| PUT    | `/api/items/<id>` | Update item (optional) |
| DELETE | `/api/items/<id>` | Delete item (optional) |
| POST   | `/api/items/<id>/thoughts` | Add chapter thought |
| POST   | `/api/items/<id>/review` | Add or update review |

---

## Core user flows

1. **Add a library item** — Title (required), author, format, status, genre, progress type and values (or percent), optional notes.
2. **View library** — Dashboard with summary counts, filter by status/format/genre, search by title.
3. **Open item detail** — Progress and metadata, add chapter thoughts (chapter/marker + text), add overall review (rating 1–5 + text).

---

## Optional features included

- **Seed script** (`backend/seed.py`) — 5 sample items for demo.
- **Summary API** (`GET /api/items/summary`) — Counts for dashboard.
- **PUT /api/items/<id>** and **DELETE /api/items/<id>** — Update and delete (optional).
- **Progress bar** on dashboard cards and item detail when using percent or computed percent from pages/chapters.
- **Simple error messages** on forms and API failures.

---

## Troubleshooting

- **SSL: CERTIFICATE_VERIFY_FAILED (macOS):** Python on macOS often can’t verify MongoDB Atlas’s SSL certificate. Two options:
  1. **Quick dev workaround:** In `.env` add `MONGODB_TLS_INSECURE=1`, then restart the Flask server. This skips certificate verification (use only for local development).
  2. **Proper fix:** Install/update SSL certs for your Python (e.g. run **Install Certificates.command** from your Python installation folder, or `pip install certifi` and ensure your environment uses it).
- **Connection refused / MongoDB error:** Check `MONGODB_URI` in `.env`, Atlas IP allow list, and that the password in the URI has no special characters unencoded (or encode them).
- **Flask not finding app:** Run from project root and use `flask --app backend.app run` or `cd backend && flask run`.
- **Blank or 404 on /dashboard:** Ensure you’re opening http://127.0.0.1:5001/dashboard (and that the server is running).
