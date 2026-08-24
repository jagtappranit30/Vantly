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
    echo "Database connected! Running migrations..."
    npx drizzle-kit push --config=src/db/drizzle.config.ts || echo "Warning: Migration push skipped."
  else
    echo "Warning: Database check timed out for '$SQL_HOST:$DB_PORT'. Starting application..."
  fi
fi

echo "Starting Vantly application..."
export NODE_ENV=production
exec npm start

