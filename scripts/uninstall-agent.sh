#!/bin/bash
# Oprește agentul și scoate pornirea automată. Config-ul și istoricul de
# task-uri rămân în ~/Library/Application Support/ControlLaptop.
LABEL="ro.betania.controllaptop.agent"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
rm -f "$HOME/Library/LaunchAgents/$LABEL.plist"
echo "Agentul a fost oprit și nu mai pornește la login."
