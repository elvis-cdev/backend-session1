# Backend Session 1 — Campus Event Registration API

Welcome to the **Backend Engineering Journey**. 👋

In this session you will build a small API that stores campus events and student registrations in a real PostgreSQL database, using **Node.js** and **Express**. By the end you will have created an event, registered a student, rejected a duplicate, and understood how to protect the **last seat** when requests arrive at the same time.

Clone it, run it, break it, fix it.

---

## What's in this repo

```
backend-session1/
├── server.js        the API (routes for health, events, registration)
├── setup-db.js      creates your tables in the database
├── schema.sql       the table definitions (you don't edit this)
├── package.json     dependencies + the npm scripts
├── .env.example     template for your private settings
├── .gitignore       keeps .env and node_modules out of Git
└── README.md        you are here
```

You do **not** need to edit any code. The only file you create yourself is `.env`.

---

## Before you start

You need these installed:

| Tool | Check it with | Needed |
|------|---------------|--------|
| Node.js | `node --version` | 18 or newer |
| npm | `npm --version` | comes with Node |
| Git | `git --version` | any recent version |
| curl | `curl --version` | for testing (Windows: `curl.exe`) |

If any command says "not found", **pause and ask the facilitator.**

---

## ⏸ Pause: get your database URL

Your team has its **own private** PostgreSQL (Neon) connection URL and its **own schema**. Raise your hand and ask the facilitator for:

1. your team's **database URL**
2. your team's **schema name** (for example `student01`)

Rules, no exceptions:

- Never use another team's URL.
- Never paste the URL or password into the group chat, a public document, GitHub, or a message to the facilitator.
- Never screenshot your `.env` file.

---

## Quick start

### Kali / Linux

```bash
git clone https://github.com/elvis-cdev/backend-session1.git
cd backend-session1
npm install
cp .env.example .env
nano .env
npm run setup
npm start
```

### Windows (CMD)

```bat
git clone https://github.com/elvis-cdev/backend-session1.git
cd backend-session1
npm install
copy .env.example .env
notepad .env
npm run setup
npm start
```

> **Windows tip:** if Notepad asks you to save, choose **All files (\*.\*)** so the file is called `.env` and not `.env.txt`.

### What goes in `.env`

Open `.env` and replace the placeholders:

| Setting | What to put | Example |
|---------|-------------|---------|
| `DATABASE_URL` | the URL from your facilitator, **keep the quotes** | `"postgres://..."` |
| `DB_SCHEMA` | your team's schema name, no quotes, no `<` `>` | `student01` |
| `PORT` | leave it as is | `3000` |

Save the file.

### What you should see

- `npm run setup` prints: `Schema setup completed successfully (schema: student01).`
- `npm start` prints: `Event API running at http://localhost:3000`

Leave that terminal running. **Open a second terminal in the same folder** for the tests below.

---

## Test your API

Do these in order. Windows CMD users: use `curl.exe` and the Windows versions.

### 1. Health check and list events

```bash
curl -i http://localhost:3000/health
curl -i http://localhost:3000/events
```

Windows CMD:

```bat
curl.exe -i http://localhost:3000/health
curl.exe -i http://localhost:3000/events
```

Expected: `200 OK`, and `"database":"connected"` on the health check.

### 2. Create an event

Kali / Linux:

```bash
curl -i -X POST http://localhost:3000/events \
  -H 'Content-Type: application/json' \
  -d '{
    "title": "Backend Engineering Workshop",
    "description": "A campus backend design session",
    "venue": "IT Lab 5",
    "starts_at": "2026-10-24T10:00:00+03:00",
    "capacity": 100
  }'
```

Windows CMD:

```bat
curl.exe -i -X POST http://localhost:3000/events -H "Content-Type: application/json" -d "{\"title\":\"Backend Engineering Workshop\",\"description\":\"A campus backend design session\",\"venue\":\"IT Lab 5\",\"starts_at\":\"2026-10-24T10:00:00+03:00\",\"capacity\":100}"
```

Expected: `201 Created`. **Note the event `id` in the response.** You'll use it next.

### 3. Register a student

Replace `1` in the URL with **your real event id**, and replace `TEAMXX-001` with a unique test id (use fictional data only).

Kali / Linux:

```bash
curl -i -X POST http://localhost:3000/events/1/register \
  -H 'Content-Type: application/json' \
  -d '{
    "student_id": "TEAMXX-001",
    "student_name": "Test Student",
    "email": "student@example.com"
  }'
```

Windows CMD:

```bat
curl.exe -i -X POST http://localhost:3000/events/1/register -H "Content-Type: application/json" -d "{\"student_id\":\"TEAMXX-001\",\"student_name\":\"Test Student\",\"email\":\"student@example.com\"}"
```

Expected: `201` the first time. **Run the exact same command again** and you should get `409` (already registered).

### 4. Try to break it: invalid capacity

Kali / Linux:

```bash
curl -i -X POST http://localhost:3000/events \
  -H 'Content-Type: application/json' \
  -d '{"title":"Bad Event","venue":"Nowhere","starts_at":"2026-10-24T10:00:00+03:00","capacity":-5}'
```

Windows CMD:

```bat
curl.exe -i -X POST http://localhost:3000/events -H "Content-Type: application/json" -d "{\"title\":\"Bad Event\",\"venue\":\"Nowhere\",\"starts_at\":\"2026-10-24T10:00:00+03:00\",\"capacity\":-5}"
```

Expected: `400 Bad Request`.

### 5. Check it persists

Stop the server (`Ctrl + C`), start it again with `npm start`, then run `GET /events`. Your event is still there, because PostgreSQL stores it, not Node.

---

## How is the last seat protected?

Imagine an event with 1 seat left and two students hit **Register** at the same moment. Without protection, both requests could count "1 seat left" and both get in. That's a **race condition**.

Two things stop it:

1. **`SELECT ... FOR UPDATE`** locks the event row for the length of the transaction. Requests for the same event wait their turn, so each one sees the up-to-date count before deciding.
2. **`UNIQUE (event_id, student_id)`** in the database means the same student can never register twice for the same event, even if the app code has a bug.

Find both in `server.js` and `schema.sql`. Be ready to explain them in your own words.

---

## Troubleshooting

| Problem | Fix |
|---------|-----|
| `node` / `npm` not found | Pause and ask the facilitator. |
| `Cannot find module` | Run `npm install` inside the project folder. |
| `Cannot find file` | Check you're in the right folder and the filenames are right (`.js`, `.sql`, not `.txt`). |
| `DATABASE_URL is missing` | Your `.env` is missing or named wrong (check it isn't `.env.txt`). |
| `DB_SCHEMA is missing or invalid` | Add `DB_SCHEMA=yourschema` to `.env`, no quotes or angle brackets. |
| Database connection error | Check your team's URL privately. Never share it. |
| `relation does not exist` | Run `npm run setup` again and check `DB_SCHEMA`. |
| `400` | Fix the request body using the message in the response. |
| `409` | Duplicate student, or the event is full. |
| `500` | Look at the server terminal. Share only the error with the credentials removed. |
| SSL warning | Don't randomly change SSL settings. Ask the facilitator. |

If setup says a table already exists with different columns, **stop and ask for help.** Don't drop tables.

---

## Completion checklist

- [ ] I can explain what Node.js, Express and PostgreSQL each do
- [ ] `/health` works
- [ ] I can create and list an event
- [ ] Invalid capacity is rejected (400)
- [ ] A student can register once
- [ ] A duplicate registration is rejected (409)
- [ ] I can explain how the last seat is protected

---

## Break it, fix it (extra challenges)

- Fill an event to capacity, then register one more student. What do you get back?
- Send a request with broken JSON. Which part of `server.js` catches it?
- Register for an event id that doesn't exist. What status do you get?
- Add a `GET /events/:eventId` route that returns a single event.
- Add a route that lists who is registered for an event.

---

## Keep your secrets safe

`.env` is already in `.gitignore`, so Git won't pick it up. If you fork this repo or start your own project, **keep it that way.** A database URL pushed to GitHub is public the moment it lands, even if you delete it later.

## Production reminder

This is a classroom API. It has **no login, no organiser authorization, no verified student identity, no rate limiting** and none of the hardening a real production system needs. That's what the next sessions are for.

---

Built for the GDG backend journey by [Elvis Wambugu](https://github.com/elvis-cdev).
