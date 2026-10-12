#!/usr/bin/env bash
# 在 Mac 上安裝「開機後自動啟動」的存錢計畫伺服器（用 launchd）
set -euo pipefail
cd "$(dirname "$0")/.."
PROJECT_DIR="$(pwd)"

NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ]; then
  echo "找不到 node，請先安裝 Node.js 22 以上（https://nodejs.org）"
  exit 1
fi
if ! "$NODE_BIN" -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 13) ? 0 : 1)'; then
  echo "Node 版本太舊：$("$NODE_BIN" -v)，需要 22.13 以上"
  exit 1
fi

LABEL="com.savingplan.server"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG_DIR="$PROJECT_DIR/server/data/logs"
mkdir -p "$LOG_DIR" "$HOME/Library/LaunchAgents"

cat > "$PLIST" <<PLIST_EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE_BIN</string>
    <string>$PROJECT_DIR/server/server.js</string>
  </array>
  <key>WorkingDirectory</key>
  <string>$PROJECT_DIR</string>
  <key>RunAtLoad</key>
  <true/>
  <key>KeepAlive</key>
  <true/>
  <key>StandardOutPath</key>
  <string>$LOG_DIR/server.log</string>
  <key>StandardErrorPath</key>
  <string>$LOG_DIR/server.log</string>
</dict>
</plist>
PLIST_EOF

launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$PLIST"

echo "伺服器已安裝，並會在開機或登入後自動啟動。"
echo "下一步：node server/server.js add-user <帳號>"
echo "日誌：$LOG_DIR/server.log"
