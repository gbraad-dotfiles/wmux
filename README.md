# wmux - Web-based tmux Controller

Control your tmux sessions from a web browser with full mouse support!

## Features

- **Tailscale Security** - Binds only to Tailscale interface by default (secure by design)
- **Session Management** - Attach to existing sessions or create new ones
- **Mouse support** - Click to select panes, scroll, resize (touch toggle on mobile)
- **Window management** - Create, switch, and manage tmux windows
- **Split panes** - Horizontal and vertical splits with one click
- **Modern UI** - Clean web interface with tmux controls
- **Real-time** - WebSocket-based bidirectional communication via PTY
- **Fast** - Go backend with proper terminal emulation
- **Source Code Pro font** - Optimized for terminal display
- **Mobile optimized** - Works great on Android/iOS with keyboard toggle

## Quick Start

### Prerequisites

- **Tailscale** (recommended for secure access):
  ```bash
  # Install Tailscale: https://tailscale.com/download
  sudo systemctl start tailscaled
  tailscale up
  ```

### Running

#### Single-Host Mode (Default)

Run wmux on a single machine to access its tmux sessions:

```bash
# Build
cmake . && make
# Or: go build -o wmux

# Run with default session auto-connect
./wmux --default-session screen

# Or run without default session
./wmux
```

The server will automatically bind to your Tailscale IP address. Access it at the URL shown in the output.

**Default Session**: Use `--default-session <name>` to automatically connect to a specific session (e.g., "screen") on all machines. This session will be auto-selected if it exists.

#### Multi-Host Mode

Run wmux as a host manager to connect to multiple wmux servers:

```bash
./wmux --multi-host
```

This opens a host management interface where you can:
- Add multiple wmux servers manually (name + URL)
- Configure auto-connect session for each host (optional)
- Set auto-connect for your preferred host on startup
- Discover hosts automatically with `--expose-hosts`

**Perfect for:**
- Android/iOS app (package with Capacitor)
- Central dashboard for multiple servers
- Quick switching between machines
- Direct access to specific sessions on each host

#### Host Discovery

Enable automatic host discovery via Tailscale:

```bash
./wmux --multi-host --expose-hosts
```

This will scan your Tailscale network for wmux servers and show them in the discovered hosts section.

### Alternative: Bind to all interfaces

**WARNING**: This exposes tmux sessions to anyone who can reach the server!

```bash
./wmux --bind-all
# Access via: http://localhost:2022
```

## Usage

### Session Management

Open the hamburger menu (☰) to:
- **Attach to existing session** - Select from dropdown and click "Attach to Session"
- **Create new session** - Enter a name (or leave blank for auto-generated) and click "Create New Session"

The menu will show all available tmux sessions on the server.

### tmux Controls

All controls are available in the menu (☰):
- **Split Horizontal (─)** - Split the current pane horizontally (`Ctrl+b %`)
- **Split Vertical (│)** - Split the current pane vertically (`Ctrl+b "`)
- **New Window** - Create a new tmux window (`Ctrl+b c`)
- **Next/Prev Window** - Navigate between windows (`Ctrl+b n/p`)
- **Close Pane** - Close the current pane (`Ctrl+b x`)
- **Zoom Toggle** - Toggle pane zoom/fullscreen (`Ctrl+b z`)

### Security

**wmux is secure by default:**

- Binds only to Tailscale network interface
- Not accessible from public internet
- Only devices on your Tailscale network can connect
- Checks Tailscale service is running before starting
- WARNING: `--bind-all` flag bypasses this (use with caution!)

**Why Tailscale?**
- Zero-trust networking
- End-to-end encrypted
- Works across NATs and firewalls
- Access from phone, laptop, anywhere
- No port forwarding or VPN setup needed

### Mouse Support

tmux mouse mode is enabled by default, allowing you to:
- Click to select panes
- Scroll through terminal history
- Resize panes by dragging borders
- Right-click for context menus (tmux 3.2+)

### Keyboard Shortcuts

All standard tmux key bindings work! Default prefix is `Ctrl+b`.

Common shortcuts:
- `Ctrl+b %` - Split horizontally
- `Ctrl+b "` - Split vertically
- `Ctrl+b c` - Create new window
- `Ctrl+b n` - Next window
- `Ctrl+b p` - Previous window
- `Ctrl+b x` - Kill pane
- `Ctrl+b z` - Zoom pane

## Architecture

```
┌─────────────┐          ┌──────────────┐          ┌───────────┐
│   Browser   │  WebSocket │   Go Server  │   PTY    │   tmux    │
│  (xterm.js) │ ◄────────► │  (Gorilla)   │ ◄──────► │  Session  │
└─────────────┘            └──────────────┘          └───────────┘
```

- **Frontend**: xterm.js with Source Code Pro font, WebSocket client
- **Backend**: Go with Gorilla WebSocket + creack/pty for terminal emulation
- **tmux**: Attached via PTY for full terminal compatibility

## Configuration

### Command Line Options

```bash
./wmux [options]

Options:
  --version                 Show version information
  --port <number>           Port to listen on (default: 2022)
  --default-session <name>  Default session to auto-connect (default: "screen")
  --multi-host              Enable multi-host mode (host selector interface)
  --expose-hosts            Auto-discover hosts on Tailscale (requires --multi-host)
  --bind-all                Bind to all interfaces instead of Tailscale only
                            WARNING: Exposes tmux to public access!

Examples:
  # Single-host mode (default)
  ./wmux                                    # Auto-connect to "screen" session
  ./wmux --default-session main             # Auto-connect to "main" session
  ./wmux --default-session ""               # No auto-connect

  # Multi-host mode
  ./wmux --multi-host                       # Host manager for multiple servers
  ./wmux --multi-host --expose-hosts        # With automatic host discovery

  # Custom port
  ./wmux --port 8080                        # Run on port 8080

  # Insecure mode
  ./wmux --bind-all                         # Bind to 0.0.0.0 (NOT RECOMMENDED)
```

### Host Configuration (Multi-Host Mode)

When adding a host in multi-host mode:
- **Host Name**: Friendly name for the server
- **Host URL**: Full URL including protocol and port (e.g., http://100.x.x.x:2022)
- **Auto-connect Session**: (Optional) Specific session name to auto-attach to when connecting
  - If specified and the session exists, automatically attaches to it
  - If not specified or session doesn't exist, shows normal session selector
- **Auto-connect on startup**: Makes this host connect automatically when wmux starts

### Mobile Usage

On Android/iOS:
- **Mouse mode** (default): Touch acts as mouse clicks
- **Keyboard mode**: Tap the ⌨️ button (bottom-right) to enable keyboard
- **Toggle back**: Tap ✓ button or wait 30 seconds

## Requirements

- Go 1.18+
- tmux 3.0+ (3.5a recommended for best mouse support)
- **Tailscale** (recommended) - for secure network access
- Modern web browser with WebSocket support

### Android App

A native Android app is included that runs wmux in multi-host mode, allowing you to manage and connect to all your wmux servers from your phone.

#### Building the Android App

```bash
# Copy web assets to Android
cp public/*.html public/*.js public/*.css android/app/src/main/assets/

# Build APK (requires Android SDK from junglizer setup)
cd android
./gradlew assembleDebug

# Install on device
adb install -r app/build/outputs/apk/debug/app-debug.apk
```

Or use the build script:
```bash
bash build-android.sh
```

#### Android App Features

- Loads multi-host interface by default
- Stores host list in localStorage (persists between launches)
- Full WebView with JavaScript and WebSocket support
- Optimized for mobile with viewport handling
- Back button navigation support

#### Requirements

- Android SDK (same setup as junglizer)
- Android device/emulator with API level 24+ (Android 7.0+)
- ADB for installation

## Systemd Service

Run wmux as a systemd service:

### Installation

```bash
# Build and install binary
go build -o wmux
sudo cp wmux /usr/local/bin/

# Copy public files
sudo mkdir -p /usr/local/bin/public
sudo cp -r public/* /usr/local/bin/public/

# Install service file
sudo cp wmux.service /etc/systemd/system/wmux@.service

# Enable and start for your user
sudo systemctl enable wmux@$USER
sudo systemctl start wmux@$USER

# Check status
sudo systemctl status wmux@$USER
```

### Multi-Host Mode

```bash
# Install multi-host service
sudo cp wmux-multi@.service /etc/systemd/system/

# Enable and start
sudo systemctl enable wmux-multi@$USER
sudo systemctl start wmux-multi@$USER
```

### Custom Configuration

Edit the service file to customize:
- Port: Add `--port 8080` to ExecStart
- Bind all: Add `--bind-all` to ExecStart

### View Logs

```bash
# Follow logs
sudo journalctl -u wmux@$USER -f

# Multi-host logs
sudo journalctl -u wmux-multi@$USER -f
```

## RPM Package

Build an RPM package for Red Hat/Fedora/CentOS:

```bash
# Install build dependencies
sudo dnf install rpm-build golang tmux

# Build RPM
bash build-rpm.sh

# Install
sudo dnf install ~/rpmbuild/RPMS/x86_64/wmux-1.0.0-1.*.x86_64.rpm

# Start service
sudo systemctl enable wmux@$USER
sudo systemctl start wmux@$USER
```

The RPM includes:
- Binary in `/usr/bin/wmux`
- Web assets in `/usr/share/wmux/public/`
- Systemd service files
- Automatic service management

## Development

Build the binary:
```bash
# With CMake (recommended)
cmake . && make

# Or directly with Go
go build -o wmux

# Run
./wmux --default-session screen
```

## License

MIT

## Author

Gerard Braad
