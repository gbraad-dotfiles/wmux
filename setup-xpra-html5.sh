#!/bin/bash
# Install xpra HTML5 client (required for web-based GUI apps)

set -e

echo "Installing xpra HTML5 client..."

# Download from GitHub
cd /tmp
curl -L https://github.com/Xpra-org/xpra-html5/archive/refs/heads/master.zip -o xpra-html5.zip

# Extract
unzip -q xpra-html5.zip

# Install to system directory
sudo cp -r xpra-html5-master/html5 /usr/share/xpra/www

# Clean up
rm -rf xpra-html5-master xpra-html5.zip

echo "✓ xpra HTML5 client installed to /usr/share/xpra/www"
echo "  You can now run GUI applications through wmux with xpra mode"
