package main

import (
	"crypto/tls"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

const (
	Version   = "1.0.0"
	BuildDate = "2026-04-02"
)

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

type Message struct {
	Type       string       `json:"type"`
	Data       string       `json:"data,omitempty"`
	Command    string       `json:"command,omitempty"`
	Rows       int          `json:"rows,omitempty"`
	Cols       int          `json:"cols,omitempty"`
	Cmd        string       `json:"cmd,omitempty"`
	Session    string       `json:"session,omitempty"`
	Sessions   []string     `json:"sessions,omitempty"`
	NewSession bool         `json:"newSession,omitempty"`
	Windows    []TmuxWindow `json:"windows,omitempty"`
	Index      int          `json:"index,omitempty"`
}

type TmuxWindow struct {
	Index  int    `json:"index"`
	Name   string `json:"name"`
	Active bool   `json:"active"`
}

type TmuxSession struct {
	cmd       *exec.Cmd
	ptmx      *os.File
	ws        *websocket.Conn
	wsMu      *sync.Mutex // Shared mutex for websocket writes
	sessionID string
}

func (ts *TmuxSession) start(attach bool, rows, cols int) error {
	// Ensure minimum size
	if rows < 24 {
		rows = 24
	}
	if cols < 80 {
		cols = 80
	}

	var args []string

	if attach {
		args = []string{"attach-session", "-t", ts.sessionID}
	} else {
		args = []string{
			"new-session", "-s", ts.sessionID,
			"-x", fmt.Sprintf("%d", cols),
			"-y", fmt.Sprintf("%d", rows),
		}
	}

	ts.cmd = exec.Command("tmux", args...)

	// Set proper environment for tmux
	// Use screen-256color since we're in tmux
	env := append(os.Environ(),
		"TERM=screen-256color",
		"LANG=en_US.UTF-8",
		"LC_ALL=en_US.UTF-8",
		"COLORTERM=truecolor",
	)
	ts.cmd.Env = env

	var err error
	ts.ptmx, err = pty.Start(ts.cmd)
	if err != nil {
		return err
	}

	// Set PTY size with proper dimensions
	winsize := &pty.Winsize{
		Rows: uint16(rows),
		Cols: uint16(cols),
		X:    0,
		Y:    0,
	}

	log.Printf("Setting PTY size: cols=%d, rows=%d (%dx%d)\n", cols, rows, cols, rows)
	if err := pty.Setsize(ts.ptmx, winsize); err != nil {
		log.Println("Failed to set PTY size:", err)
	}

	// Start reading output
	go ts.readOutput()

	// Send attached notification
	ts.wsMu.Lock()
	if ts.ws != nil {
		ts.ws.WriteJSON(Message{Type: "attached", Session: ts.sessionID})
	}
	ts.wsMu.Unlock()

	return nil
}

func (ts *TmuxSession) readOutput() {
	buf := make([]byte, 8192)
	for {
		n, err := ts.ptmx.Read(buf)
		if err != nil {
			if err != io.EOF {
				log.Println("Read error:", err)
			}
			break
		}

		if n > 0 {
			ts.wsMu.Lock()
			if ts.ws != nil {
				// Send binary data directly via WebSocket
				if err := ts.ws.WriteMessage(websocket.BinaryMessage, buf[:n]); err != nil {
					log.Println("WebSocket write error:", err)
					ts.wsMu.Unlock()
					break
				}
			}
			ts.wsMu.Unlock()
		}
	}

	// Notify client that session ended
	ts.wsMu.Lock()
	if ts.ws != nil {
		ts.ws.WriteJSON(Message{Type: "close"})
	}
	ts.wsMu.Unlock()
}

func (ts *TmuxSession) sendInput(data string) error {
	decoded, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return err
	}

	_, err = ts.ptmx.Write(decoded)
	return err
}

func (ts *TmuxSession) resize(rows, cols int) error {
	log.Printf("Resizing PTY to: cols=%d, rows=%d\n", cols, rows)
	return pty.Setsize(ts.ptmx, &pty.Winsize{Rows: uint16(rows), Cols: uint16(cols)})
}

func (ts *TmuxSession) close() {
	if ts.ptmx != nil {
		ts.ptmx.Close()
	}
	if ts.cmd != nil && ts.cmd.Process != nil {
		ts.cmd.Process.Kill()
	}
}

func (ts *TmuxSession) listWindows() ([]TmuxWindow, error) {
	cmd := exec.Command("tmux", "list-windows", "-t", ts.sessionID, "-F", "#{window_index}:#{window_name}:#{window_active}")
	output, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	windows := make([]TmuxWindow, 0)

	for _, line := range lines {
		if line == "" {
			continue
		}
		parts := strings.Split(line, ":")
		if len(parts) >= 3 {
			index := 0
			fmt.Sscanf(parts[0], "%d", &index)
			windows = append(windows, TmuxWindow{
				Index:  index,
				Name:   parts[1],
				Active: parts[2] == "1",
			})
		}
	}

	return windows, nil
}

func (ts *TmuxSession) selectWindow(index int) error {
	cmd := exec.Command("tmux", "select-window", "-t", fmt.Sprintf("%s:%d", ts.sessionID, index))
	return cmd.Run()
}

func listTmuxSessions() ([]string, error) {
	cmd := exec.Command("tmux", "list-sessions", "-F", "#{session_name}")
	output, err := cmd.Output()
	if err != nil {
		return []string{}, nil // No sessions or tmux not running
	}

	sessions := strings.Split(strings.TrimSpace(string(output)), "\n")
	var result []string
	for _, s := range sessions {
		if s != "" {
			result = append(result, s)
		}
	}
	return result, nil
}

func makeWebSocketHandler(defaultSession string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Println("Upgrade error:", err)
			return
		}
		defer ws.Close()

		var session *TmuxSession
		var wsMu sync.Mutex // Mutex to protect websocket writes

		// Helper function for safe websocket writes
		safeWriteJSON := func(msg Message) error {
			wsMu.Lock()
			defer wsMu.Unlock()
			return ws.WriteJSON(msg)
		}

		// Send ready message with available sessions and default session
		sessions, _ := listTmuxSessions()
		readyMsg := Message{
			Type:     "ready",
			Sessions: sessions,
			Session:  defaultSession, // Send default session name
		}
		safeWriteJSON(readyMsg)

	// Handle incoming messages
	for {
		var msg Message
		err := ws.ReadJSON(&msg)
		if err != nil {
			log.Println("Read error:", err)
			break
		}

		switch msg.Type {
		case "list":
			sessions, _ := listTmuxSessions()
			safeWriteJSON(Message{Type: "sessions", Sessions: sessions})

		case "start":
			sessionName := msg.Session
			if sessionName == "" {
				sessionName = fmt.Sprintf("wmux_%d", os.Getpid())
			}

			session = &TmuxSession{
				ws:        ws,
				wsMu:      &wsMu,
				sessionID: sessionName,
			}

			rows := msg.Rows
			cols := msg.Cols
			if rows == 0 {
				rows = 24
			}
			if cols == 0 {
				cols = 80
			}

			attach := !msg.NewSession
			if err := session.start(attach, rows, cols); err != nil {
				log.Println("Start error:", err)
				safeWriteJSON(Message{Type: "error", Data: err.Error()})
				session = nil
			}

		case "input":
			if session != nil {
				if err := session.sendInput(msg.Data); err != nil {
					log.Println("Input error:", err)
				}
			}

		case "resize":
			if session != nil && msg.Rows > 0 && msg.Cols > 0 {
				if err := session.resize(msg.Rows, msg.Cols); err != nil {
					log.Println("Resize error:", err)
				}
			}

		case "disconnect":
			if session != nil {
				session.close()
				safeWriteJSON(Message{Type: "close"})
				session = nil
			}

		case "list_windows":
			if session != nil {
				windows, err := session.listWindows()
				if err != nil {
					log.Println("List windows error:", err)
					safeWriteJSON(Message{Type: "error", Data: err.Error()})
				} else {
					safeWriteJSON(Message{Type: "windows", Windows: windows})
				}
			}

		case "select_window":
			if session != nil {
				if err := session.selectWindow(msg.Index); err != nil {
					log.Println("Select window error:", err)
					safeWriteJSON(Message{Type: "error", Data: err.Error()})
				}
			}

		case "kill_session":
			// Kill a tmux session by name
			if msg.Session != "" {
				cmd := exec.Command("tmux", "kill-session", "-t", msg.Session)
				if err := cmd.Run(); err != nil {
					log.Println("Kill session error:", err)
					safeWriteJSON(Message{Type: "error", Data: "Failed to kill session: " + err.Error()})
				} else {
					// Refresh session list
					sessions, err := listTmuxSessions()
					if err != nil {
						log.Println("List sessions error:", err)
						safeWriteJSON(Message{Type: "error", Data: err.Error()})
					} else {
						safeWriteJSON(Message{Type: "sessions", Sessions: sessions})
					}
				}
			}
		}
	}

	if session != nil {
		session.close()
	}
	}
}

type TailscaleStatus struct {
	Self struct {
		TailscaleIPs []string `json:"TailscaleIPs"`
	} `json:"Self"`
}

func checkTailscaleService() bool {
	// Check if tailscaled service is enabled and running
	cmd := exec.Command("systemctl", "is-active", "tailscaled")
	output, err := cmd.Output()
	if err != nil {
		return false
	}
	return strings.TrimSpace(string(output)) == "active"
}

func getTailscaleIP() (string, error) {
	// Get Tailscale status JSON
	cmd := exec.Command("tailscale", "status", "--json")
	output, err := cmd.Output()
	if err != nil {
		return "", fmt.Errorf("tailscale not running or not installed: %v", err)
	}

	var status TailscaleStatus
	if err := json.Unmarshal(output, &status); err != nil {
		return "", fmt.Errorf("failed to parse tailscale status: %v", err)
	}

	if len(status.Self.TailscaleIPs) == 0 {
		return "", fmt.Errorf("no tailscale IPs found")
	}

	// Return the first IPv4 address (usually the primary one)
	for _, ip := range status.Self.TailscaleIPs {
		if !strings.Contains(ip, ":") { // Skip IPv6
			return ip, nil
		}
	}

	// If no IPv4, use first IP
	return status.Self.TailscaleIPs[0], nil
}

type DiscoveredHost struct {
	Name string `json:"name"`
	URL  string `json:"url"`
	Type string `json:"type"` // "tailscale", "ssh", etc.
}

func makeDiscoverHostsHandler(port int) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var hosts []DiscoveredHost

		// Get Tailscale status
		cmd := exec.Command("tailscale", "status", "--json")
		output, err := cmd.Output()
		if err == nil {
			var status map[string]interface{}
			if err := json.Unmarshal(output, &status); err == nil {
				// Parse Tailscale peers
				if peers, ok := status["Peer"].(map[string]interface{}); ok {
					for _, peer := range peers {
						if peerMap, ok := peer.(map[string]interface{}); ok {
							if ips, ok := peerMap["TailscaleIPs"].([]interface{}); ok && len(ips) > 0 {
								if hostname, ok := peerMap["HostName"].(string); ok {
									hosts = append(hosts, DiscoveredHost{
										Name: hostname,
										URL:  fmt.Sprintf("http://%s:%d", ips[0], port),
										Type: "tailscale",
									})
								}
							}
						}
					}
				}
			}
		}

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(hosts)
	}
}

// handleMuxConnection handles both HTTP (redirect) and HTTPS on same port
func handleMuxConnection(rawConn net.Conn, tlsConfig *tls.Config, port int) {
	defer rawConn.Close()

	// Just do TLS - no HTTP detection for now
	tlsConn := tls.Server(rawConn, tlsConfig)

	// Handshake
	if err := tlsConn.Handshake(); err != nil {
		log.Printf("TLS handshake error: %v", err)
		return
	}

	// Serve
	server := &http.Server{Handler: http.DefaultServeMux}
	server.Serve(&singleUseListener{conn: tlsConn})
}

// firstByteConn prepends the first byte back to reads
type firstByteConn struct {
	net.Conn
	firstByte []byte
	used      bool
}

func (c *firstByteConn) Read(b []byte) (int, error) {
	if !c.used && len(c.firstByte) > 0 {
		c.used = true
		n := copy(b, c.firstByte)
		if n < len(b) {
			m, err := c.Conn.Read(b[n:])
			return n + m, err
		}
		return n, nil
	}
	return c.Conn.Read(b)
}

// singleUseConn wrapper
type singleUseConn struct {
	net.Conn
}

// singleUseListener serves one connection
type singleUseListener struct {
	conn net.Conn
}

func (l *singleUseListener) Accept() (net.Conn, error) {
	if l.conn != nil {
		conn := l.conn
		l.conn = nil
		return conn, nil
	}
	return nil, io.EOF
}

func (l *singleUseListener) Close() error {
	return nil
}

func (l *singleUseListener) Addr() net.Addr {
	return &net.TCPAddr{}
}

// readerConn wraps a net.Conn with a bufio.Reader
func main() {
	// Command line flags
	version := flag.Bool("version", false, "Show version information")
	bindAll := flag.Bool("bind-all", false, "Bind to all interfaces (0.0.0.0) instead of Tailscale only")
	port := flag.Int("port", 2022, "Port to listen on (default: 2022)")
	multiHost := flag.Bool("multi-host", false, "Enable multi-host mode (host selector interface)")
	exposeHosts := flag.Bool("expose-hosts", false, "Auto-discover hosts (requires --multi-host)")
	defaultSession := flag.String("default-session", "screen", "Default session to auto-connect on all machines (default: 'screen')")
	amuxURL := flag.String("amux-url", "http://localhost:2023", "URL for amux API server (default: http://localhost:2023)")
	tlsEnable := flag.Bool("tls", false, "Enable HTTPS/TLS")
	tlsCert := flag.String("tls-cert", "", "TLS certificate file (default: ~/.wmux/wmux.crt)")
	tlsKey := flag.String("tls-key", "", "TLS key file (default: ~/.wmux/wmux.key)")
	flag.Parse()

	if *version {
		fmt.Printf("wmux version %s (built %s)\n", Version, BuildDate)
		fmt.Println("Web-based tmux controller with mouse support")
		fmt.Println("https://github.com/gbraad/wmux")
		os.Exit(0)
	}

	// Set default TLS cert paths if not specified
	if *tlsCert == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			log.Fatal("Could not determine home directory:", err)
		}
		certPath := filepath.Join(home, ".wmux", "wmux.crt")
		tlsCert = &certPath
	}
	if *tlsKey == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			log.Fatal("Could not determine home directory:", err)
		}
		keyPath := filepath.Join(home, ".wmux", "wmux.key")
		tlsKey = &keyPath
	}

	log.Printf("wmux v%s - Web-based tmux Controller\n", Version)

	var bindAddr string

	if *bindAll {
		// User explicitly wants to bind to all interfaces
		bindAddr = fmt.Sprintf("0.0.0.0:%d", *port)
		log.Printf("WARNING: Binding to ALL interfaces (0.0.0.0)\n")
		log.Printf("WARNING: This exposes tmux sessions to anyone who can reach this server!\n")
	} else {
		// Check Tailscale
		if !checkTailscaleService() {
			log.Fatal("ERROR: Tailscale service is not running. Start with: sudo systemctl start tailscaled\n" +
				"       Or use --bind-all flag to bind to all interfaces (NOT RECOMMENDED)")
		}

		tailscaleIP, err := getTailscaleIP()
		if err != nil {
			log.Fatalf("ERROR: Failed to get Tailscale IP: %v\n"+
				"       Make sure you're connected: tailscale up\n"+
				"       Or use --bind-all flag to bind to all interfaces (NOT RECOMMENDED)\n", err)
		}

		bindAddr = fmt.Sprintf("%s:%d", tailscaleIP, *port)
		log.Printf("Binding to Tailscale interface: %s\n", bindAddr)
		log.Printf("Tailscale network detected and active\n")
	}

	// SPA: Always serve index.html for root, static files for everything else
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			http.ServeFile(w, r, "./public/index.html")
		} else {
			http.FileServer(http.Dir("./public")).ServeHTTP(w, r)
		}
	})

	// API endpoint for host discovery (if enabled)
	if *exposeHosts {
		http.HandleFunc("/api/discover", makeDiscoverHostsHandler(*port))
	}

	// WebSocket endpoint
	http.HandleFunc("/ws", makeWebSocketHandler(*defaultSession))

	// Config endpoint
	http.HandleFunc("/api/config", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(map[string]interface{}{
			"defaultSession": *defaultSession,
			"multiHost":      *multiHost,
			"exposeHosts":    *exposeHosts,
		})
	})

	// Apps proxy - forward /api/apps* to amux server
	proxyHandler := func(w http.ResponseWriter, r *http.Request) {
		targetPath := r.URL.Path
		if r.URL.RawQuery != "" {
			targetPath += "?" + r.URL.RawQuery
		}
		targetURL := *amuxURL + targetPath

		// Create proxy request
		proxyReq, err := http.NewRequest(r.Method, targetURL, r.Body)
		if err != nil {
			http.Error(w, "Failed to create proxy request", http.StatusInternalServerError)
			return
		}

		// Copy headers
		for key, values := range r.Header {
			for _, value := range values {
				proxyReq.Header.Add(key, value)
			}
		}

		// Execute request
		client := &http.Client{}
		resp, err := client.Do(proxyReq)
		if err != nil {
			http.Error(w, "Failed to reach amux: "+err.Error(), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()

		// Copy response headers
		for key, values := range resp.Header {
			for _, value := range values {
				w.Header().Add(key, value)
			}
		}

		// Copy status code
		w.WriteHeader(resp.StatusCode)

		// Copy body
		io.Copy(w, resp.Body)
	}

	http.HandleFunc("/api/apps", proxyHandler)
	http.HandleFunc("/api/apps/", proxyHandler)

	if *bindAll {
		log.Printf("WARNING: Exposed to all interfaces!\n")
	}

	if *tlsEnable {
		// Check if cert files exist
		if _, err := os.Stat(*tlsCert); os.IsNotExist(err) {
			log.Fatalf("TLS certificate file not found: %s\nGenerate with: ./gen-cert.sh", *tlsCert)
		}
		if _, err := os.Stat(*tlsKey); os.IsNotExist(err) {
			log.Fatalf("TLS key file not found: %s\nGenerate with: ./gen-cert.sh", *tlsKey)
		}

		log.Printf("Server running on https://%s (Tailscale)\n", bindAddr)

		// Use standard HTTPS server
		log.Fatal(http.ListenAndServeTLS(bindAddr, *tlsCert, *tlsKey, http.DefaultServeMux))
	} else {
		log.Printf("Server running on http://%s (Tailscale)\n", bindAddr)
		log.Fatal(http.ListenAndServe(bindAddr, nil))
	}
}
