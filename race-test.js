
const BASE_URL = process.env.API_URL || 'http://localhost:3000';
const TOTAL_REQUESTS = 20;
const CAPACITY = 5;

async function request(path, options = {}) {
  const response = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  });

  const body = await response.json().catch(() => ({}));

  return {
    status: response.status,
    body,
  };
}

async function main() {
  console.log(`API: ${BASE_URL}`);
  console.log(`Creating a test event with ${CAPACITY} seats...`);

  // Each run creates a fresh event, so old test registrations
  // cannot affect this run's result.
  const created = await request('/events', {
    method: 'POST',
    body: JSON.stringify({
      title: `Race Condition Lab ${new Date().toISOString()}`,
      description: 'Temporary workshop concurrency test',
      venue: 'Workshop Test Venue',
      starts_at: new Date(Date.now() + 86400000).toISOString(),
      capacity: CAPACITY,
    }),
  });

  if (created.status !== 201 || !created.body.event?.id) {
    console.error('Could not create test event:', created);
    process.exitCode = 1;
    return;
  }

  const eventId = created.body.event.id;

  console.log(`Test event ID: ${eventId}`);
  console.log(`Sending ${TOTAL_REQUESTS} requests concurrently...\n`);

  const results = await Promise.all(
    Array.from({ length: TOTAL_REQUESTS }, async (_, index) => {
      const number = index + 1;

      try {
        const result = await request(
          `/events/${eventId}/register`,
          {
            method: 'POST',
            body: JSON.stringify({
              student_id: `RACE-${eventId}-${number}`,
              student_name: `Test Student ${number}`,
              email: `race-${eventId}-${number}@example.test`,
            }),
          }
        );

        return {
          student: number,
          status: result.status,
          message: result.body.message || result.body.error || '',
        };
      } catch (error) {
        return {
          student: number,
          status: 'NETWORK ERROR',
          message: error.message,
        };
      }
    })
  );

  const accepted = results.filter(r => r.status === 201).length;
  const full = results.filter(r => r.status === 409).length;
  const other = results.filter(
    r => r.status !== 201 && r.status !== 409
  );

  console.log('--- RESULTS ---');
  console.log(`Accepted (201): ${accepted}`);
  console.log(`Rejected as full (409): ${full}`);
  console.log(`Other responses: ${other.length}`);

  if (other.length) {
    console.log('\nUnexpected responses:');
    console.table(other);
  }

  console.log('\n--- VERDICT ---');

  if (accepted > CAPACITY) {
    console.log(
      `OVERBOOKING DETECTED: ${accepted} students accepted for ${CAPACITY} seats!`
    );
  } else if (accepted === CAPACITY && full === TOTAL_REQUESTS - CAPACITY) {
    console.log(
      'PASS: exactly five students accepted; the other fifteen were rejected.'
    );
  } else {
    console.log(
      'INCONCLUSIVE: inspect the response counts and server logs.'
    );
  }

  console.log(
    `\nKeep this event ID for discussion: ${eventId}`
  );
  console.log('No records were deleted by this script.');
}

main().catch(error => {
  console.error('Race test failed:', error.message);
  process.exitCode = 1;
});
