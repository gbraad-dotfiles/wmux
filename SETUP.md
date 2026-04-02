# wmux Setup Guide

## Prerequisites

### Required Packages
```bash
# Fedora/RHEL
sudo dnf install tmux golang

# For GUI app support (xpra)
sudo dnf install xpra
```

## GUI Applications (xpra) Setup

wmux can run GUI applications through xpra. The HTML5 client is not packaged in Fedora repos and must be installed manually.

### Install xpra HTML5 Client

Run the included setup script:
```bash
./setup-xpra-html5.sh
```

Or manually:
```bash
cd /tmp
curl -L https://github.com/Xpra-org/xpra-html5/archive/refs/heads/master.zip -o xpra-html5.zip
unzip -q xpra-html5.zip
sudo cp -r xpra-html5-master/html5 /usr/share/xpra/www
rm -rf xpra-html5-master xpra-html5.zip
```

Verify installation:
```bash
ls /usr/share/xpra/www/
# Should show: connect.html, index.html, js/, css/, etc.
```

## TLS Certificates

Generate self-signed certificates for HTTPS:
```bash
./gen-cert.sh
```

Certificates will be stored in `~/.wmux/`:
- `~/.wmux/wmux.crt`
- `~/.wmux/wmux.key`

## Building wmux

```bash
go build -o wmux
```

## Running wmux

### Single Host Mode
```bash
./wmux --tls
```

### Multi-Host Mode
```bash
./wmux --multi-host --expose-hosts --tls
```

### Disable Apps
```bash
./wmux --tls --no-apps
```

## Systemd Service

Install as systemd service:
```bash
# Single user service
sudo cp wmux@.service /etc/systemd/system/
sudo systemctl enable --now wmux@$USER

# Multi-host service
sudo cp wmux-multi@.service /etc/systemd/system/
sudo systemctl enable --now wmux-multi@$USER
```

## Application Files (.dotapps)

Place application definition files in `~/.dotapps/`:

Example `~/.dotapps/firefox.md`:
```markdown
# Firefox

### vars
```sh
cmd=/usr/bin/firefox
```

### check
```sh
[ -x $cmd ]
```

### default alias run-desktop
```sh
$cmd
```
```

GUI apps (with `run-desktop` action) will automatically use xpra mode.
