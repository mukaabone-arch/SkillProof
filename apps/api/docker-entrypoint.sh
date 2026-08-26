#!/bin/sh
# Container entrypoint: apply pending migrations, then start the app —
# never the other way around, so the app can never run against a schema
# its own code expects but the DB doesn't have yet (see the incident this
# script exists to prevent: production was missing 3 migrations while
# running code that expected them).
#
# set -e: any non-zero exit here (including `prisma migrate deploy`
# failing) stops the script immediately, before `node` ever starts, and
# this container exits non-zero — ECS's circuit breaker rolls back rather
# than serving traffic against an unmigrated schema. Deliberately NOT
# piping prisma's output through anything (e.g. `| tee`) — a pipe's exit
# code is the LAST command's, not prisma's, which would silently defeat
# this whole fail-hard guarantee. Nothing is redirected, so migration
# output reaches the container's own stdout/stderr exactly like the app's
# own logs, and from there to CloudWatch via the existing awslogs driver.
set -eu

echo "Running database migrations..."
./node_modules/.bin/prisma migrate deploy

echo "Migrations applied. Starting application..."
# exec, not a plain call: replaces this shell with the node process (PID 1)
# instead of running it as a child, so ECS's SIGTERM on deploy/scale-in
# reaches the app directly rather than being caught by a wrapper shell.
exec node dist/main.js
