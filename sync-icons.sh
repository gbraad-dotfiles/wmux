#!/bin/bash
# Sync icons from source (icon.svg) to all locations
# Run this after updating icon.svg

set -e

echo "Generating icons from icon.svg..."

# Generate web icons from SVG
magick -background transparent icon.svg -resize 192x192 PNG32:public/icon-192.png
magick -background transparent icon.svg -resize 512x512 PNG32:public/icon-512.png

# Sync to capacitor www
cp public/icon-192.png wmux-capacitor/www/
cp public/icon-512.png wmux-capacitor/www/

# Sync to Android assets
cp public/icon-192.png wmux-capacitor/android/app/src/main/assets/public/
cp public/icon-512.png wmux-capacitor/android/app/src/main/assets/public/

# Generate Android launcher icons (create directories first)
mkdir -p wmux-capacitor/android/app/src/main/res/mipmap-mdpi
mkdir -p wmux-capacitor/android/app/src/main/res/mipmap-hdpi
mkdir -p wmux-capacitor/android/app/src/main/res/mipmap-xhdpi
mkdir -p wmux-capacitor/android/app/src/main/res/mipmap-xxhdpi
mkdir -p wmux-capacitor/android/app/src/main/res/mipmap-xxxhdpi

magick -background transparent icon.svg -resize 48x48 PNG32:wmux-capacitor/android/app/src/main/res/mipmap-mdpi/ic_launcher.png
magick -background transparent icon.svg -resize 48x48 PNG32:wmux-capacitor/android/app/src/main/res/mipmap-mdpi/ic_launcher_round.png
magick -background transparent icon.svg -resize 72x72 PNG32:wmux-capacitor/android/app/src/main/res/mipmap-hdpi/ic_launcher.png
magick -background transparent icon.svg -resize 72x72 PNG32:wmux-capacitor/android/app/src/main/res/mipmap-hdpi/ic_launcher_round.png
magick -background transparent icon.svg -resize 96x96 PNG32:wmux-capacitor/android/app/src/main/res/mipmap-xhdpi/ic_launcher.png
magick -background transparent icon.svg -resize 96x96 PNG32:wmux-capacitor/android/app/src/main/res/mipmap-xhdpi/ic_launcher_round.png
magick -background transparent icon.svg -resize 144x144 PNG32:wmux-capacitor/android/app/src/main/res/mipmap-xxhdpi/ic_launcher.png
magick -background transparent icon.svg -resize 144x144 PNG32:wmux-capacitor/android/app/src/main/res/mipmap-xxhdpi/ic_launcher_round.png
magick -background transparent icon.svg -resize 192x192 PNG32:wmux-capacitor/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png
magick -background transparent icon.svg -resize 192x192 PNG32:wmux-capacitor/android/app/src/main/res/mipmap-xxxhdpi/ic_launcher_round.png

echo "✓ Icons synced successfully"
echo ""
echo "Source: icon.svg (root)"
echo "Web: public/icon-{192,512}.png"
echo "Android: wmux-capacitor/android/app/src/main/res/mipmap-*/ic_launcher*.png"
