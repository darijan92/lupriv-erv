#!/bin/sh
set -e
echo "Running DB migrate..."
node src/db/migrate.js
echo "Starting API..."
exec node src/index.js
