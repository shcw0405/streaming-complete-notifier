#!/bin/zsh
cd "${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  echo '回响需要 Node.js 20 或以上版本。请安装后重新打开。'
  read -k 1
  exit 1
fi
if [ ! -d node_modules/smol-toml ]; then
  npm ci --no-audit --no-fund || exit 1
fi
node server.mjs --open
