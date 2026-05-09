#!/bin/bash
set -e

REMOTE_HOST="${1:-gbraad@100.84.158.125}"
REMOTE_DIR="${REMOTE_DIR:-~/Projects/wmux}"
SERVICE_NAME="wmux"

echo "=== Setting up wmux service on ${REMOTE_HOST} ==="

ssh ${REMOTE_HOST} "cat > /tmp/${SERVICE_NAME}.service << 'EOF'
[Unit]
Description=wmux - Web-based tmux Controller
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${REMOTE_HOST%%@*}
Group=${REMOTE_HOST%%@*}
WorkingDirectory=${REMOTE_DIR}
ExecStart=${REMOTE_DIR}/wmux --default-session screen --tls
Restart=always
RestartSec=5s

Environment=\"TERM=xterm-256color\"

StandardOutput=journal
StandardError=journal
SyslogIdentifier=wmux

[Install]
WantedBy=multi-user.target
EOF
sudo mv /tmp/${SERVICE_NAME}.service /etc/systemd/system/${SERVICE_NAME}.service
sudo systemctl daemon-reload
sudo systemctl enable ${SERVICE_NAME}
pkill wmux 2>/dev/null || true
sleep 1
sudo systemctl restart ${SERVICE_NAME}
sleep 2
sudo systemctl status ${SERVICE_NAME} --no-pager"

echo ""
echo "=== Done! wmux service is running on ${REMOTE_HOST} ==="
