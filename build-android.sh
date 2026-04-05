#!/bin/bash
set -e

echo "Building wmux Android app..."

# Sync web assets to www folder first
echo "Syncing web assets to www..."
mkdir -p wmux-capacitor/www
rm -rf wmux-capacitor/www/*
cp -r public/* wmux-capacitor/www/

# Copy to Android assets folder
echo "Copying to Android assets..."
mkdir -p wmux-capacitor/android/app/src/main/assets/public
# Remove read-only files first to avoid permission errors
rm -rf wmux-capacitor/android/app/src/main/assets/public/*
cp -r public/* wmux-capacitor/android/app/src/main/assets/public/

# Remove Capacitor default resources
echo "Removing Capacitor default resources..."
if [ -d "wmux-capacitor/android/app/src/main/res" ]; then
  # Remove ALL Capacitor-generated image resources except values/
  rm -rf wmux-capacitor/android/app/src/main/res/mipmap-*
  rm -rf wmux-capacitor/android/app/src/main/res/drawable-*

  # Keep drawable/ but remove all PNGs, create minimal black splash.png
  mkdir -p wmux-capacitor/android/app/src/main/res/drawable
  rm -f wmux-capacitor/android/app/src/main/res/drawable/*.png
  # Create a 1x1 black pixel splash (minimal size)
  convert -size 1x1 xc:black wmux-capacitor/android/app/src/main/res/drawable/splash.png 2>/dev/null || echo "   (ImageMagick not available, skipping splash creation)"
fi

# Build Android APK
echo "Building APK..."
cd wmux-capacitor/android
./gradlew assembleDebug

echo ""
echo "Build complete!"
echo "APK location: wmux-capacitor/android/app/build/outputs/apk/debug/app-debug.apk"
echo ""
echo "To install on device: adb install -r wmux-capacitor/android/app/build/outputs/apk/debug/app-debug.apk"
