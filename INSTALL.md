# wmux + amux Installation Guide

## Quick Setup (Development)

```bash
# 1. Generate TLS certificate
cd ~/Projects/wmux
./gen-cert.sh

# 2. Start amux (application manager)
cd ~/Projects/amux
./amux &

# 3. Start wmux with TLS
cd ~/Projects/wmux
./wmux --multi-host --default-session screen --tls &

# 4. Access wmux
# Open browser to: https://100.65.21.80:2022
# (Accept the self-signed certificate warning)
```

## System Installation (Production)

### 1. Build binaries

```bash
# Build wmux
cd ~/Projects/wmux
go build -o wmux

# Build amux
cd ~/Projects/amux
go build -o amux
```

### 2. Install binaries

```bash
# Install wmux
sudo cp ~/Projects/wmux/wmux /usr/local/bin/
sudo chmod +x /usr/local/bin/wmux

# Install amux
sudo cp ~/Projects/amux/amux /usr/local/bin/
sudo chmod +x /usr/local/bin/amux
```

### 3. Generate TLS certificate

```bash
cd ~/Projects/wmux
./gen-cert.sh
# Certificate saved to ~/.wmux/wmux.crt and ~/.wmux/wmux.key
```

### 4. Install systemd service files

```bash
# Install amux service
sudo cp ~/Projects/amux/amux.service /etc/systemd/system/amux@.service

# Install wmux services
sudo cp ~/Projects/wmux/wmux@.service /etc/systemd/system/
sudo cp ~/Projects/wmux/wmux-multi@.service /etc/systemd/system/

# Reload systemd
sudo systemctl daemon-reload
```

### 5. Enable and start services

```bash
# Start amux for your user
sudo systemctl enable amux@$USER
sudo systemctl start amux@$USER

# Start wmux (choose one):

# Option A: Single-host mode
sudo systemctl enable wmux@$USER
sudo systemctl start wmux@$USER

# Option B: Multi-host mode (recommended)
sudo systemctl enable wmux-multi@$USER
sudo systemctl start wmux-multi@$USER
```

### 6. Check status

```bash
# Check amux
sudo systemctl status amux@$USER
sudo journalctl -u amux@$USER -f

# Check wmux
sudo systemctl status wmux-multi@$USER  # or wmux@$USER
sudo journalctl -u wmux-multi@$USER -f
```

### 7. Access wmux

Open your browser to:
- **HTTPS**: `https://100.65.21.80:2022` (recommended - clipboard works)
- **HTTP**: `http://100.65.21.80:2080` (auto-redirects to HTTPS)

For HTTPS, accept the self-signed certificate warning (click "Advanced" → "Proceed").

## Port Configuration

- **wmux HTTPS**: Port 2022
- **wmux HTTP redirect**: Port 2080 (when TLS enabled)
- **amux**: Port 2023 (HTTP, localhost only)

## Troubleshooting

### Certificate errors

```bash
# Regenerate certificate
cd ~/Projects/wmux
./gen-cert.sh

# Restart wmux
sudo systemctl restart wmux-multi@$USER
```

### amux not reachable

```bash
# Check if amux is running
curl http://localhost:2023/health

# Check logs
sudo journalctl -u amux@$USER -n 50
```

### Tailscale issues

```bash
# Check Tailscale status
tailscale status

# Restart Tailscale
sudo systemctl restart tailscaled
```

## Updating

```bash
# Pull latest changes
cd ~/Projects/wmux && git pull
cd ~/Projects/amux && git pull

# Rebuild
cd ~/Projects/wmux && go build -o wmux
cd ~/Projects/amux && go build -o amux

# Reinstall
sudo cp ~/Projects/wmux/wmux /usr/local/bin/
sudo cp ~/Projects/amux/amux /usr/local/bin/

# Restart services
sudo systemctl restart amux@$USER
sudo systemctl restart wmux-multi@$USER
```
