#!/bin/sh
# Builds phonekey.xpi from src/.

set -e

cd "$(dirname "$0")"
rm -f phonekey.xpi
cd src
zip -qr9X ../phonekey.xpi .
cd ..
echo "Built phonekey.xpi ($(du -h phonekey.xpi | cut -f1))"
