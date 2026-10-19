#!/bin/bash
# Autentifică o singură dată programul `claude` folosit de agent pentru
# task-urile trimise de pe telefon. Dublu-click pe fișier, apoi în fereastra
# care se deschide scrie /login și urmează pașii din browser. La final, /exit.
cd "$(dirname "$0")/../agent" || exit 1
BIN="$(/usr/bin/env node -e 'import("./tasks.js").then(m => console.log(m.findClaude("")))')"
if [ -z "$BIN" ]; then
  echo "Nu găsesc programul claude." >&2
  read -r -p "Apasă Enter ca să închizi."
  exit 1
fi
echo "Pornesc: $BIN"
echo "Scrie /login, autentifică-te în browser, apoi /exit."
echo
cd "$HOME" && exec "$BIN"
