#!/bin/bash

echo "Setting up wmux - Capacitor Edition"
echo ""

# Step 1: Install dependencies
echo "Installing dependencies..."
npm install
echo "Dependencies installed"
echo ""

# Step 2: Copy public files to www/
echo "Copying public files to www/..."
mkdir -p www

if [ -d "../public" ]; then
  # Copy all public files except index.html (we'll use host-manager.html as index)
  cp ../public/*.css www/
  cp ../public/*.js www/ 2>/dev/null || true
  cp ../public/*.json www/ 2>/dev/null || true
  cp ../public/*.ttf www/ 2>/dev/null || true
  cp ../public/*.png www/ 2>/dev/null || true

  # Use host-manager.html as the main index for multi-host mode
  cp ../public/host-manager.html www/index.html
  cp ../public/connect.html www/

  echo "Public files copied (using host-manager as index)"
else
  echo "WARNING: Public directory not found at ../public/"
  exit 1
fi
echo ""

# Step 3: Add Android platform
echo "Adding Android platform..."
node node_modules/@capacitor/cli/bin/capacitor add android 2>/dev/null || echo "   (Android platform already exists)"
echo "Android platform ready"
echo ""

# Step 4: Sync Capacitor
echo "Syncing Capacitor..."
node node_modules/@capacitor/cli/bin/capacitor sync
echo "Capacitor synced"
echo ""

# Done
echo "Setup complete!"
echo ""
echo "To build and run:"
echo "  cd android"
echo "  ./gradlew assembleDebug"
echo "  adb install -r app/build/outputs/apk/debug/app-debug.apk"
