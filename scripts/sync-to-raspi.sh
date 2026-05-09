#!/bin/bash
set -e

RASPI_HOST="${RASPI_HOST:-gbraad@100.84.158.125}"
RASPI_DIR="${RASPI_DIR:-~/Projects/wmux}"

echo "=== Building ARM64 binary for Raspberry Pi ==="
GOOS=linux GOARCH=arm64 go build -o wmux-arm64 .
echo "Built: wmux-arm64"

echo ""
echo "=== Syncing wmux to Raspberry Pi ==="
echo "Host: $RASPI_HOST"
echo "Dir:  $RASPI_DIR"
echo ""

ssh ${RASPI_HOST} "mkdir -p ${RASPI_DIR}"

rsync -avz \
    --progress \
    --delete \
    --exclude '.git/' \
    --exclude 'wmux' \
    --exclude 'wmux-arm64' \
    --exclude '*.rpm' \
    --exclude 'rpmbuild/' \
    --exclude 'CMakeFiles/' \
    --exclude 'CMakeCache.txt' \
    --exclude 'cmake_install.cmake' \
    --exclude '.claude/' \
    --exclude 'wmux-capacitor/android/app/build/' \
    --exclude 'wmux-capacitor/android/.gradle/' \
    --exclude 'wmux-capacitor/node_modules/' \
    ./ ${RASPI_HOST}:${RASPI_DIR}/

echo ""
echo "=== Syncing ARM64 binary ==="
rsync -avz --progress wmux-arm64 ${RASPI_HOST}:${RASPI_DIR}/wmux

ssh ${RASPI_HOST} "chmod +x ${RASPI_DIR}/wmux"

echo ""
echo "=== Sync complete! ==="
echo ""
echo "To run on Pi:"
echo "  ssh $RASPI_HOST 'cd $RASPI_DIR && ./wmux --bind-all'"
