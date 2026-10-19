#!/bin/bash
# Instalare Veghe cu un singur dublu-click.
# Pornește agentul, pune hook-urile și spune ce permisiuni să dai.
set -euo pipefail

cd "$(dirname "$0")"

echo "=============================================="
echo "   Veghe — instalare"
echo "=============================================="
echo

# 1. Node
if ! command -v node >/dev/null 2>&1; then
  echo "❌ Nu găsesc Node.js. Instalează-l de pe https://nodejs.org (versiunea LTS),"
  echo "   apoi deschide din nou acest fișier."
  echo
  read -r -p "Apasă Enter ca să închizi."
  exit 1
fi
echo "✅ Node.js $(node --version)"

# 2. Agentul (pornește la login, repornește singur)
echo
echo "→ Pornesc agentul…"
bash scripts/install-agent.sh

# 3. Hook-uri (stare exactă + aprobări de pe telefon)
echo
echo "→ Instalez hook-urile pentru Claude…"
node scripts/install-hooks.mjs

# 4. Tailscale (doar verificare + sfat)
echo
if command -v tailscale >/dev/null 2>&1 || [ -d "/Applications/Tailscale.app" ]; then
  echo "✅ Tailscale pare instalat. Loghează-te cu același cont și pe iPhone."
else
  echo "ℹ️  Pentru a vedea laptopul de pe telefon de oriunde, instalează Tailscale"
  echo "   pe Mac și pe iPhone (același cont): https://tailscale.com/download"
  echo "   Fără Tailscale, aplicația merge doar în rețeaua locală / pe Mac."
fi

echo
echo "=============================================="
echo "   Gata! Ce mai trebuie o singură dată:"
echo "=============================================="
echo "1. Permisiune ecran: la prima captură, bifează 'node' în"
echo "   System Settings → Privacy & Security → Screen Recording."
echo "2. Login Claude (pentru task-uri): dublu-click pe"
echo "   scripts/login-claude.command → scrie /login → /exit."
echo "3. Împerechează iPhone-ul: deschide aplicația de Mac (fila Setări)"
echo "   și scanează codul QR, sau vezi README.md secțiunea 7."
echo
read -r -p "Apasă Enter ca să închizi."
