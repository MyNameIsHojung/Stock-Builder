#!/usr/bin/env bash
# Stop the Stock Builder server started by ./start.sh
set -euo pipefail
cd "$(dirname "$0")"

PID_FILE=".server.pid"

if [[ ! -f "$PID_FILE" ]]; then
  echo "실행 중인 서버가 없어요 (.server.pid 없음)"
  exit 0
fi

PID="$(cat "$PID_FILE")"
if ! kill -0 "$PID" 2>/dev/null; then
  echo "PID $PID 는 이미 종료되어 있어요"
  rm -f "$PID_FILE"
  exit 0
fi

kill "$PID"
for _ in $(seq 1 25); do
  kill -0 "$PID" 2>/dev/null || break
  sleep 0.2
done
if kill -0 "$PID" 2>/dev/null; then
  echo "정상 종료가 안 돼서 강제 종료해요"
  kill -9 "$PID"
fi
rm -f "$PID_FILE"
echo "[$(date '+%Y-%m-%d %H:%M:%S')] stop" >> logs/server.log
echo "🛑 Stock Builder 종료 (PID $PID)"
