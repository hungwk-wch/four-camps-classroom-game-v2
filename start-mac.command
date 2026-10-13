#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "未找到 Node.js。請先安裝 Node.js LTS。"
  read -n 1 -s -r -p "按任何鍵結束..."
  exit 1
fi
if [ ! -d node_modules ]; then
  npm install || exit 1
fi
npm start
