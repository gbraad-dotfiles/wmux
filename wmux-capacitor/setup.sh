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
  # Remove existing files to avoid permission issues with read-only files
  rm -rf www/*

  # Copy all public files (SPA mode)
  cp -r ../public/* www/

  echo "Public files copied (SPA mode with multi-host support)"
else
  echo "WARNING: Public directory not found at ../public/"
  exit 1
fi
echo ""

# Step 3: Add Android platform
echo "Adding Android platform..."
npx cap add android 2>/dev/null || echo "   (Android platform already exists)"
echo "Android platform ready"
echo ""

# Step 3.5: Remove Capacitor default resources
echo "Removing Capacitor default resources..."
if [ -d "android/app/src/main/res" ]; then
  # Remove ALL Capacitor-generated image resources except values/
  rm -rf android/app/src/main/res/mipmap-*
  rm -rf android/app/src/main/res/drawable-*

  # Keep drawable/ but remove all PNGs, create minimal black splash.png
  mkdir -p android/app/src/main/res/drawable
  rm -f android/app/src/main/res/drawable/*.png
  # Create a 1x1 black pixel splash (minimal size)
  convert -size 1x1 xc:black android/app/src/main/res/drawable/splash.png 2>/dev/null || echo "   (ImageMagick not available, skipping splash)"

  echo "Default resources removed"
else
  echo "WARNING: Android res directory not found"
fi
echo ""

# Step 3.6: Generate Android icons from icon.svg
echo "Generating Android icons..."
cd ..
bash sync-icons.sh > /dev/null 2>&1 || echo "   (Icon generation failed - run sync-icons.sh manually)"
cd wmux-capacitor
echo "Icons generated"
echo ""

# Step 4: Sync Capacitor
echo "Syncing Capacitor..."
npx cap sync
echo "Capacitor synced"
echo ""

# Done
echo "Setup complete!"
echo ""
echo "To build and run:"
echo "  cd android"
echo "  ./gradlew assembleDebug"
echo "  adb install -r app/build/outputs/apk/debug/app-debug.apk"
