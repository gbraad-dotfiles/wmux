#!/bin/bash
set -e

NAME="wmux"
OUTPUT="${1:-wmux-arm64}"

echo "Building ARM64 binary (raspi/ampere)..."
GOOS=linux GOARCH=arm64 go build -o ${OUTPUT} .
echo "Built: ${OUTPUT}"
