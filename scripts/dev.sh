#!/usr/bin/env bash
# Starts backend and frontend dev servers together.
# Usage: ./scripts/dev.sh   (run from repo root)

set -e

(cd backend && npm run dev) &
BACKEND_PID=$!

(cd frontend && npm run dev) &
FRONTEND_PID=$!

trap "kill $BACKEND_PID $FRONTEND_PID" EXIT
wait
