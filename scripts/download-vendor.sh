#!/bin/bash
# Download xterm.js vendor libraries for wmux

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
VENDOR_DIR="$PROJECT_ROOT/public/vendor"

echo "Downloading xterm.js vendor libraries..."

# Create vendor directory if it doesn't exist
mkdir -p "$VENDOR_DIR"

cd "$VENDOR_DIR"

# Download xterm.js core
echo "Downloading xterm.js..."
curl -L -o xterm.js https://cdn.jsdelivr.net/npm/xterm@5.3.0/lib/xterm.js

# Download xterm.css
echo "Downloading xterm.css..."
curl -L -o xterm.css https://cdn.jsdelivr.net/npm/xterm@5.3.0/css/xterm.css

# Download xterm-addon-fit
echo "Downloading xterm-addon-fit..."
curl -L -o xterm-addon-fit.js https://cdn.jsdelivr.net/npm/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js

# Download xterm-addon-web-links
echo "Downloading xterm-addon-web-links..."
curl -L -o xterm-addon-web-links.js https://cdn.jsdelivr.net/npm/xterm-addon-web-links@0.9.0/lib/xterm-addon-web-links.js

echo ""
echo "Vendor libraries downloaded successfully:"
ls -lh "$VENDOR_DIR"
