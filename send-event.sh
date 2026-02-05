#!/bin/bash
# Send event to AI HQ server

TYPE="${1:-}"
TOOL="${2:-}"
SERVER_URL="${AI_HQ_SERVER:-http://localhost:3456}"

# Get working directory
CWD="${CLAUDE_CWD:-$(pwd)}"

# Create stable session ID from hostname + working directory
SESSION_KEY="$(hostname)-$CWD"
SESSION_ID=$(echo -n "$SESSION_KEY" | md5sum | cut -c1-12)

# Extract folder name for title
TITLE=$(basename "$CWD")

curl -s -X POST "$SERVER_URL/event" \
  -H "Content-Type: application/json" \
  -d "{\"type\":\"$TYPE\",\"tool\":\"$TOOL\",\"sessionId\":\"$SESSION_ID\",\"title\":\"$TITLE\"}" \
  --connect-timeout 2 \
  > /dev/null 2>&1 || true
