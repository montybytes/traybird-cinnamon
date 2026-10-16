#!/usr/bin/env bash

APPLET_UUID="traybird@montybytes"
TARGET_DIR="${HOME}/.local/share/cinnamon/applets/${APPLET_UUID}"

mkdir -p "${TARGET_DIR}"
cp metadata.json applet.js "${TARGET_DIR}/"

echo "Success: Applet files installed to ${TARGET_DIR}"
echo "Restart Cinnamon to load the applet (Alt+F2, type 'r', press Enter)."