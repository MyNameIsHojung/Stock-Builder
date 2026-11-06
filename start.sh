#!/usr/bin/env bash
# Start Stock Builder server in the background and open the browser.
#   ./start.sh            (port 4545)
#   PORT=5000 ./start.sh
#   NO_OPEN=1 ./start.sh  (don't open browser)
set -euo pipefail
cd "$(dirname "$0")"

PORT="${PORT:-4545}"
PID_FILE=".server.pid"
LOG_FILE="logs/server.log"
URL="http://localhost:${PORT}"

if [[ -f "$PID_FILE" ]] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
  echo "이미 실행 중이에요 (PID $(cat "$PID_FILE")) → $URL"
  exit 0
fi
rm -f "$PID_FILE"

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
  echo "포트 $PORT 가 이미 사용 중이에요. PORT=다른번호 ./start.sh 로 실행해주세요." >&2
  exit 1
fi

command -v node >/dev/null || { echo "node 가 필요해요 (v18+)" >&2; exit 1; }

# Trust the macOS keychain CAs too, so quote fetches work behind
# TLS-inspecting company networks (private root CA). Node 22.15+/23.8+.
export NODE_USE_SYSTEM_CA=1

mkdir -p logs
echo "[$(date '+%Y-%m-%d %H:%M:%S')] start" >> "$LOG_FILE"
PORT="$PORT" nohup node server.js >> "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

for _ in $(seq 1 50); do
  if curl -s -o /dev/null "$URL/api/state"; then
    echo "🏗️  Stock Builder 시작! → $URL  (PID $(cat "$PID_FILE"), 로그: $LOG_FILE)"
    [[ "${NO_OPEN:-0}" == "1" ]] || open "$URL" 2>/dev/null || true
    exit 0
  fi
  if ! kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then break; fi
  sleep 0.2
done

echo "서버 시작에 실패했어요. 로그를 확인해주세요:" >&2
tail -n 20 "$LOG_FILE" >&2
rm -f "$PID_FILE"
exit 1
