#!/bin/bash
set -e

echo "Building wmux Android app..."

# Copy web assets to Android assets folder
echo "Copying web assets..."
cp public/*.html public/*.js public/*.css android/app/src/main/assets/

# Build Android APK
cd android
./gradlew assembleDebug

echo ""
echo "Build complete!"
echo "APK location: android/app/build/outputs/apk/debug/app-debug.apk"
echo ""
echo "To install on device: adb install -r android/app/build/outputs/apk/debug/app-debug.apk"
