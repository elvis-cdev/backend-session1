-- TEAM_SCHEMA gets swapped for DB_SCHEMA (from your .env) by setup-db.js
-- you do not need to edit this file

CREATE TABLE IF NOT EXISTS TEAM_SCHEMA.events (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  venue TEXT NOT NULL,
  starts_at TIMESTAMPTZ NOT NULL,
  capacity INTEGER NOT NULL CHECK (capacity > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS TEAM_SCHEMA.registrations (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event_id BIGINT NOT NULL REFERENCES TEAM_SCHEMA.events(id),
  student_id TEXT NOT NULL CHECK (length(trim(student_id)) > 0),
  student_name TEXT NOT NULL CHECK (length(trim(student_name)) > 0),
  email TEXT NOT NULL,
  registration_number UUID NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT one_registration_per_student_per_event
    UNIQUE (event_id, student_id)
);
