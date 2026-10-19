#!/bin/bash
# Instalează agentul Veghe ca LaunchAgent: pornește singur la login
# și repornește dacă se oprește. Rulează din nou oricând, ca să-l actualizezi.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="ro.betania.controllaptop.agent"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOGDIR="$HOME/Library/Logs/ControlLaptop"
NODE="$(command -v node || true)"

if [ -z "$NODE" ]; then
  echo "Nu găsesc node. Instalează Node.js (https://nodejs.org) și rulează din nou." >&2
  exit 1
fi

mkdir -p "$LOGDIR" "$HOME/Library/LaunchAgents"

# Agentul rulează dintr-o copie din Application Support, nu din folderul
# proiectului: Desktop, Documents și Downloads sunt protejate de macOS, iar o
# cerere de acces fără răspuns l-ar bloca chiar la pornire.
APPDIR="$HOME/Library/Application Support/ControlLaptop/agent"
mkdir -p "$APPDIR"
rsync -a --delete --exclude 'test/' "$ROOT/agent/" "$APPDIR/"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>$APPDIR/server.js</string>
  </array>
  <key>WorkingDirectory</key><string>$APPDIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Interactive</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StandardOutPath</key><string>$LOGDIR/agent.log</string>
  <key>StandardErrorPath</key><string>$LOGDIR/agent.log</string>
</dict>
</plist>
EOF

# Rulat dintr-un task al agentului (de pe telefon): oprirea agentului ar opri
# și task-ul, deci și scriptul ăsta, înainte să-l repornească. Cerem doar
# repornirea; agentul o face singur când se termină task-ul.
if [ -n "${CONTROL_LAPTOP_AGENT:-}" ]; then
  touch "$HOME/Library/Application Support/ControlLaptop/restart-requested"
  echo "Agentul se repornește singur, cu codul nou, imediat după ce se termină task-ul curent."
  exit 0
fi

# Dacă rula deja, îl oprim ca să pornească noua versiune. Oprirea se termină
# după ce launchctl a revenit; pornit prea devreme, bootstrap eșuează cu
# „Input/output error” și agentul rămâne oprit.
SERVICE="gui/$(id -u)/$LABEL"
launchctl bootout "$SERVICE" 2>/dev/null || true
# Un agent blocat nu răspunde la SIGTERM; launchd îl oprește forțat după ~20 s.
for _ in $(seq 1 60); do
  launchctl print "$SERVICE" >/dev/null 2>&1 || break
  sleep 0.5
done
for incercare in $(seq 1 10); do
  launchctl bootstrap "gui/$(id -u)" "$PLIST" 2>/dev/null && break
  if [ "$incercare" -eq 10 ]; then
    echo "Nu pot porni agentul (launchctl bootstrap a eșuat de 10 ori)." >&2
    exit 1
  fi
  sleep 1
done

sleep 1
CONFIG="$HOME/Library/Application Support/ControlLaptop/config.json"
for _ in 1 2 3 4 5; do [ -f "$CONFIG" ] && break; sleep 1; done

echo "Agentul rulează. Jurnal: $LOGDIR/agent.log"
echo "Config (cu tokenul pentru iPhone): $CONFIG"
echo
echo "Prima captură de ecran va cere permisiunea Screen Recording pentru node:"
echo "System Settings → Privacy & Security → Screen Recording → bifează node."
