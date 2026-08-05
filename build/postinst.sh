#!/bin/bash
# Post-installation script for the .deb package.
#
# NOTE: naming this through `fpm: ['--after-install=...']` REPLACES the postinst
# electron-builder would otherwise generate — including its chrome-sandbox
# chmod. That step has to be repeated here, or the app refuses to start with
# "The SUID sandbox helper binary was found, but is not configured correctly",
# because the renderer now runs with `sandbox: true`.
set -e

SANDBOX='/opt/Raven Forge Launcher/chrome-sandbox'
if [ -f "$SANDBOX" ]; then
  chown root:root "$SANDBOX" || true
  chmod 4755 "$SANDBOX" || true
fi

# Make the launcher appear in application menus.
update-desktop-database /usr/share/applications 2>/dev/null || true
