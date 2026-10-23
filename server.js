
require('dotenv').config();

const express = require('express');
const dns = require('node:dns').promises;
const { Pool } = require('pg');
const { randomUUID } = require('node:crypto');

if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is missing from .env');
  process.exit(1);
}

const SCHEMA = process.env.DB_SCHEMA;

if (!SCHEMA || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(SCHEMA)) {
  console.error(
    'DB_SCHEMA is missing or invalid in .env (example: student01)'
  );
  process.exit(1);
}

const EVENTS = `${SCHEMA}.events`;
const REGISTRATIONS = `${SCHEMA}.registrations`;

const app = express();
app.use(express.json({ limit: '100kb' }));

let pool;
let server;

app.get('/health', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT current_database() AS database,
             current_schema() AS schema
    `);

    res.json({
      ok: true,
      database: 'connected',
      ...result.rows[0],
    });
  } catch (error) {
    console.error('Health check failed:', {
      message: error.message,
      code: error.code,
    });

    res.status(503).json({
      ok: false,
      database: 'disconnected',
      code: error.code || 'UNKNOWN_ERROR',
    });
  }
});

app.get('/events', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, title, description, venue, starts_at, capacity, created_at
      FROM ${EVENTS}
      ORDER BY starts_at ASC
    `);

    res.json({
      count: result.rows.length,
      events: result.rows,
    });
  } catch (error) {
    console.error('List events failed:', error.message);
    res.status(500).json({ error: 'Could not fetch events' });
  }
});

app.post('/events', async (req, res) => {
  const { title, description, venue, starts_at, capacity } = req.body;

  if (
    typeof title !== 'string' ||
    !title.trim() ||
    typeof venue !== 'string' ||
    !venue.trim()
  ) {
    return res.status(400).json({
      error: 'Title and venue are required',
    });
  }

  if (
    description !== undefined &&
    description !== null &&
    typeof description !== 'string'
  ) {
    return res.status(400).json({
      error: 'Description must be text',
    });
  }

  if (!Number.isInteger(capacity) || capacity <= 0) {
    return res.status(400).json({
      error: 'Capacity must be a positive integer',
    });
  }

  if (
    typeof starts_at !== 'string' ||
    !starts_at.trim() ||
    !Number.isFinite(Date.parse(starts_at))
  ) {
    return res.status(400).json({
      error: 'A valid starts_at date is required',
    });
  }

  try {
    const result = await pool.query(
      `INSERT INTO ${EVENTS}
        (title, description, venue, starts_at, capacity)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, title, description, venue, starts_at,
                 capacity, created_at`,
      [
        title.trim(),
        description?.trim() || null,
        venue.trim(),
        starts_at,
        capacity,
      ]
    );

    return res.status(201).json({
      message: 'Event created successfully',
      event: result.rows[0],
    });
  } catch (error) {
    console.error(
      'Create event failed:',
      error.message,
      error.code || ''
    );

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

  if (
    typeof student_id !== 'string' ||
    !student_id.trim() ||
    typeof student_name !== 'string' ||
    !student_name.trim() ||
    typeof email !== 'string' ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())
  ) {
    return res.status(400).json({
      error: 'Valid student ID, name, and email are required',
    });
  }

  let client;

  try {
    client = await pool.connect();
    await client.query('BEGIN');

    // Lock the event row to prevent two requests from taking
    // the final available seat at the same time.
    const eventResult = await client.query(
      `SELECT id, title, capacity
       FROM ${EVENTS}
       WHERE id = $1
       FOR UPDATE`,
      [eventId]
    );

    if (eventResult.rowCount === 0) {
      await client.query('ROLLBACK');

      return res.status(404).json({
        error: 'Event not found',
      });
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

      return res.status(409).json({
        error: 'Event is full',
      });
    }

    const result = await client.query(
      `INSERT INTO ${REGISTRATIONS}
        (event_id, student_id, student_name, email, registration_number)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, event_id, student_id, student_name,
                 email, registration_number, created_at`,
      [
        eventId,
        student_id.trim(),
        student_name.trim(),
        email.trim().toLowerCase(),
        randomUUID(),
      ]
    );

    await client.query('COMMIT');

    return res.status(201).json({
      message: 'Registration successful',
      registration: result.rows[0],
    });
  } catch (error) {
    if (client) {
      await client.query('ROLLBACK').catch(() => {});
    }

    if (error.code === '23505') {
      return res.status(409).json({
        error: 'This student is already registered for this event',
      });
    }

    console.error(
      'Registration failed:',
      error.message,
      error.code || ''
    );

    return res.status(500).json({
      error: 'Could not complete registration',
    });
  } finally {
    client?.release();
  }
});

app.use((error, req, res, next) => {
  if (error instanceof SyntaxError && error.status === 400) {
    return res.status(400).json({
      error: 'Invalid JSON request body',
    });
  }

  console.error('Unexpected API error:', error.message);

  return res.status(500).json({
    error: 'Internal server error',
  });
});

async function startServer() {
  const dbUrl = new URL(process.env.DATABASE_URL);

  // Resolve IPv4 explicitly. Keep the original hostname for TLS verification.
  const { address } = await dns.lookup(dbUrl.hostname, {
    family: 4,
  });

  console.log('Connecting to Neon over IPv4:', address);

  pool = new Pool({
    host: address,
    port: Number(dbUrl.port || 5432),
    database: decodeURIComponent(dbUrl.pathname.slice(1)),
    user: decodeURIComponent(dbUrl.username),
    password: decodeURIComponent(dbUrl.password),
    ssl: {
      rejectUnauthorized: true,
      servername: dbUrl.hostname,
    },
    connectionTimeoutMillis: 15000,
    idleTimeoutMillis: 30000,
    max: 5,
    keepAlive: true,
  });

  pool.on('error', (error) => {
    console.error('Unexpected database pool error:', {
      message: error.message,
      code: error.code,
    });
  });

  // Verify the connection before announcing that the API is ready.
  const result = await pool.query(
    'SELECT current_database() AS database, current_schema() AS schema'
  );

  console.log('Database connected:', result.rows[0]);

  const port = Number(process.env.PORT || 3000);

  server = app.listen(port, () => {
    console.log(`Event API running at http://localhost:${port}`);
  });
}

async function shutdown() {
  console.log('\nShutting down API...');

  if (server) {
    server.close();
  }

  if (pool) {
    await pool.end();
  }

  process.exit(0);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

startServer().catch((error) => {
  console.error('Could not start API:', {
    message: error.message,
    code: error.code,
  });

  if (pool) {
    pool.end().finally(() => process.exit(1));
  } else {
    process.exit(1);
  }
});
