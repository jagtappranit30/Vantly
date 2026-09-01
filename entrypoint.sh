#!/bin/bash
set -e

# Only perform DB check if SQL_HOST is explicitly configured in environment
if [ -n "$SQL_HOST" ]; then
  DB_PORT="${SQL_PORT:-5432}"
  echo "Checking database connectivity ($SQL_HOST:$DB_PORT)..."
  MAX_RETRIES=30
  COUNTER=0
  until nc -z -w 2 "$SQL_HOST" "$DB_PORT" || [ $COUNTER -ge $MAX_RETRIES ]; do
    echo "Database at $SQL_HOST:$DB_PORT not reachable yet ($COUNTER/$MAX_RETRIES)..."
    sleep 1
    COUNTER=$((COUNTER+1))
  done

  if nc -z -w 2 "$SQL_HOST" "$DB_PORT"; then
    echo "Database connected! Ensuring target database exists..."
    node -e '
      const { Client } = require("pg");
      async function ensureDb() {
        const client = new Client({
          host: process.env.SQL_HOST,
          port: parseInt(process.env.SQL_PORT || "5432", 10),
          user: process.env.SQL_ADMIN_USER || process.env.SQL_USER || "postgres",
          password: process.env.SQL_ADMIN_PASSWORD || process.env.SQL_PASSWORD || "postgres",
          database: "postgres"
        });
        try {
          await client.connect();
          const dbName = process.env.SQL_DB_NAME || "productive_point";
          const res = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
          if (res.rowCount === 0) {
            console.log(`Creating database "${dbName}"...`);
            await client.query(`CREATE DATABASE "${dbName}"`);
            console.log(`Database "${dbName}" created successfully!`);
          }
        } catch (e) {
          console.warn("Note on database initialization:", e.message);
        } finally {
          await client.end().catch(() => {});
        }
      }
      ensureDb();
    ' || true

    echo "Running migrations..."
    npx drizzle-kit push --config=src/db/drizzle.config.ts || echo "Warning: Migration push skipped."
  else
    echo "Warning: Database check timed out for '$SQL_HOST:$DB_PORT'. Starting application..."
  fi
fi

echo "Starting Productive Point application..."
export NODE_ENV=production
exec npm start

