require('dotenv').config();

const express = require('express');
const { Pool } = require('pg');
const { randomUUID } = require('node:crypto');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing from .env');
  process.exit(1);
}

const SCHEMA = process.env.DB_SCHEMA;
if (!SCHEMA || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(SCHEMA)) {
  console.error('DB_SCHEMA is missing or invalid in .env (example: student01)');
  process.exit(1);
}

// the schema name is a SQL identifier, not a query parameter ($1),
// so we put it in the text. it is safe because we validated it above.
const EVENTS = `${SCHEMA}.events`;
const REGISTRATIONS = `${SCHEMA}.registrations`;

const app = express();
app.use(express.json({ limit: '100kb' }));

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

pool.on('error', (error) => {
  console.error('Unexpected database pool error:', error.message);
});

app.get('/health', async (req, res) => {
  try {
    await pool.query('SELECT 1');
    res.json({ ok: true, database: 'connected' });
  } catch (error) {
    console.error('Health check failed:', error.message);
    res.status(503).json({ ok: false, database: 'disconnected' });
  }
});

app.get('/events', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, title, description, venue, starts_at, capacity, created_at
      FROM ${EVENTS}
      ORDER BY starts_at ASC
    `);
    res.json({ count: result.rows.length, events: result.rows });
  } catch (error) {
    console.error('List events failed:', error.message);
    res.status(500).json({ error: 'Could not fetch events' });
  }
});

app.post('/events', async (req, res) => {
  const { title, description, venue, starts_at, capacity } = req.body;

  if (typeof title !== 'string' || !title.trim() ||
      typeof venue !== 'string' || !venue.trim()) {
    return res.status(400).json({ error: 'Title and venue are required' });
  }

  if (description !== undefined && description !== null &&
      typeof description !== 'string') {
    return res.status(400).json({ error: 'Description must be text' });
  }

  if (!Number.isInteger(capacity) || capacity <= 0) {
    return res.status(400).json({ error: 'Capacity must be a positive integer' });
  }

  if (typeof starts_at !== 'string' || !starts_at.trim() ||
      !Number.isFinite(Date.parse(starts_at))) {
    return res.status(400).json({ error: 'A valid starts_at date is required' });
  }

  try {
    const result = await pool.query(
      `INSERT INTO ${EVENTS}
        (title, description, venue, starts_at, capacity)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, title, description, venue, starts_at, capacity, created_at`,
      [title.trim(), description?.trim() || null, venue.trim(), starts_at, capacity]
    );
    return res.status(201).json({
      message: 'Event created successfully',
      event: result.rows[0],
    });
  } catch (error) {
    console.error('Create event failed:', error.message, error.code || '');
    return res.status(500).json({
      error: 'Could not create event',
      code: error.code || 'UNKNOWN_ERROR',
    });
  }
});

app.post('/events/:eventId/register', async (req, res) => {
  const { eventId } = req.params;
  const { student_id, student_name, email } = req.body;

  if (!/^[1-9]\d{0,17}$/.test(eventId)) {
    return res.status(400).json({ error: 'Invalid event ID' });
  }

  if (typeof student_id !== 'string' || !student_id.trim() ||
      typeof student_name !== 'string' || !student_name.trim() ||
      typeof email !== 'string' ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({
      error: 'Valid student ID, name, and email are required',
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // FOR UPDATE locks this event row until COMMIT/ROLLBACK.
    // anyone else registering for the same event waits their turn here,
    // so the count below is always fresh. this protects the last seat.
    const eventResult = await client.query(
      `SELECT id, title, capacity
       FROM ${EVENTS}
       WHERE id = $1
       FOR UPDATE`,
      [eventId]
    );

    if (eventResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Event not found' });
    }

    const event = eventResult.rows[0];

    const countResult = await client.query(
      `SELECT COUNT(*)::int AS registered
       FROM ${REGISTRATIONS}
       WHERE event_id = $1`,
      [eventId]
    );

    if (countResult.rows[0].registered >= event.capacity) {
      await client.query('ROLLBACK');
      return res.status(409).json({ error: 'Event is full' });
    }

    const result = await client.query(
      `INSERT INTO ${REGISTRATIONS}
        (event_id, student_id, student_name, email, registration_number)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, event_id, student_id, student_name,
                 email, registration_number, created_at`,
      [eventId, student_id.trim(), student_name.trim(),
       email.trim().toLowerCase(), randomUUID()]
    );

    await client.query('COMMIT');
    return res.status(201).json({
      message: 'Registration successful',
      registration: result.rows[0],
    });
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});

    // 23505 = unique violation, the UNIQUE(event_id, student_id) rule caught a duplicate
    if (error.code === '23505') {
      return res.status(409).json({
        error: 'This student is already registered for this event',
      });
    }

    console.error('Registration failed:', error.message, error.code || '');
    return res.status(500).json({ error: 'Could not complete registration' });
  } finally {
    client.release();
  }
});

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400) {
    return res.status(400).json({ error: 'Invalid JSON request body' });
  }
  console.error('Unexpected API error:', error.message);
  return res.status(500).json({ error: 'Internal server error' });
});

const port = process.env.PORT || 3000;
const server = app.listen(port, () => {
  console.log(`Event API running at http://localhost:${port}`);
});

async function shutdown() {
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
