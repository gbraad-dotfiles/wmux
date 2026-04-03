#!/bin/bash
# Sync icons from source (icon.svg) to all locations
# Run this after updating icon.svg

set -e

echo "Generating icons from icon.svg..."

# Generate web icons from SVG
magick icon.svg -resize 192x192 -background none public/icon-192.png
magick icon.svg -resize 512x512 -background none public/icon-512.png

# Sync to capacitor www
cp public/icon-192.png wmux-capacitor/www/
cp public/icon-512.png wmux-capacitor/www/

# Sync to Android assets
cp public/icon-192.png wmux-capacitor/android/app/src/main/assets/public/
cp public/icon-512.png wmux-capacitor/android/app/src/main/assets/public/

# Generate Android launcher icons
magick icon.svg -resize 48x48 -background none wmux-capacitor/android/app/src/main/res/mipmap-mdpi/ic_launcher.png
magick icon.svg -resize 48x48 -background none wmux-capacitor/android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png
magick icon.svg -resize 72x72 -background none wmux-capacitor/android/app/src/main/res/mipmap-hdpi/ic_launcher.png
magick icon.svg -resize 72x72 -background none wmux-capacitor/android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png
magick icon.svg -resize 96x96 -background none wmux-capacitor/android/app/src/main/res/mipmap-xhdpi/ic_launcher.png
magick icon.svg -resize 96x96 -background none wmux-capacitor/android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png
magick icon.svg -resize 144x144 -background none wmux-capacitor/android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png
magick icon.svg -resize 144x144 -background none wmux-capacitor/android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png
magick icon.svg -resize 192x192 -background none wmux-capacitor/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png
magick icon.svg -resize 192x192 -background none wmux-capacitor/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png

# Generate Android foreground icons (adaptive)
magick icon.svg -resize 162x162 -background none -gravity center -extent 162x162 wmux-capacitor/android/app/src/main/res/mipmap-mdpi/ic_launcher_foreground.png
magick icon.svg -resize 162x162 -background none -gravity center -extent 162x162 wmux-capacitor/android/app/src/main/res/mipmap-hdpi/ic_launcher_foreground.png
magick icon.svg -resize 216x216 -background none -gravity center -extent 216x216 wmux-capacitor/android/app/src/main/res/mipmap-xhdpi/ic_launcher_foreground.png
magick icon.svg -resize 324x324 -background none -gravity center -extent 324x324 wmux-capacitor/android/app/src/main/res/mipmap-xxhdpi/ic_launcher_foreground.png
magick icon.svg -resize 432x432 -background none -gravity center -extent 432x432 wmux-capacitor/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_foreground.png

echo "✓ Icons synced successfully"
echo ""
echo "Source: icon.svg (root)"
echo "Web: public/icon-{192,512}.png"
echo "Android: wmux-capacitor/android/app/src/main/res/mipmap-*/ic_launcher*.png"
