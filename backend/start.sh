#!/bin/sh
echo "Starting BullMQ Worker Node..."
npx ts-node src/worker.ts &

echo "Starting Express Gateway Server on port ${PORT:-7860}..."
PORT=${PORT:-7860} npx ts-node src/gateway.ts
