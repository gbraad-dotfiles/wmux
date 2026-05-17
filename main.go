package main

import (
	"crypto/tls"
	"embed"
	"encoding/base64"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/creack/pty"
	"github.com/gorilla/websocket"
)

//go:embed public
var publicFS embed.FS

const (
	Version   = "1.0.2"
	BuildDate = "2026-04-05"
)

// Apps configuration and management
type AppsConfig struct {
	AppsPath         string
	XpraEnabled      bool
	XpraStartDisplay int
	XpraStartPort    int
	ServerHost       string // Hostname or IP for xpra URLs
}

type AppsManager struct {
	config       *AppsConfig
	apps         map[string]*App
	xpraSessions map[int]*XpraSession
}

type AppSummary struct {
	Name    string   `json:"name"`
	Title   string   `json:"title"`
	Path    string   `json:"path"`
	Actions []string `json:"actions"`
}

type RunAppRequest struct {
	Target string `json:"target"` // "screen", "new", or session name
	Mode   string `json:"mode"`   // "terminal", "xpra", "vnc"
	Action string `json:"action"` // optional, defaults to "run"
}

var upgrader = websocket.Upgrader{
	CheckOrigin: func(r *http.Request) bool {
		return true
	},
}

var appsManager *AppsManager

type Alias struct {
	Name    string `json:"name"`
	Command string `json:"command"`
}

type DevenvExecPrefixCache struct {
	runtime    string
	user       string
	updatedAt  time.Time
}

var (
	aliasesCache []*Alias
	aliasesMu    sync.Mutex

	devenvExecPrefixCache      DevenvExecPrefixCache
	devenvExecPrefixCacheMu    sync.Mutex
)

func loadAliasesCache() {
	shell := os.Getenv("SHELL")
	if shell == "" {
		return
	}
	cmd := exec.Command(shell, "-i", "-c", "alias")
	cmd.Env = os.Environ()
	output, err := cmd.Output()
	if err != nil {
		return
	}
	aliases := make([]*Alias, 0)
	for _, line := range strings.Split(string(output), "\n") {
		line = strings.TrimSpace(line)
		line = strings.TrimPrefix(line, "alias ")
		eqIdx := strings.Index(line, "=")
		if eqIdx < 1 {
			continue
		}
		name := strings.TrimSpace(line[:eqIdx])
		command := strings.Trim(strings.TrimSpace(line[eqIdx+1:]), "'\"")
		if name != "" && command != "" {
			aliases = append(aliases, &Alias{Name: name, Command: command})
		}
	}
	aliasesMu.Lock()
	aliasesCache = aliases
	aliasesMu.Unlock()
	log.Printf("Loaded %d aliases", len(aliases))
}

type Message struct {
	Type       string        `json:"type"`
	Data       string        `json:"data,omitempty"`
	Command    string        `json:"command,omitempty"`
	Rows       int           `json:"rows,omitempty"`
	Cols       int           `json:"cols,omitempty"`
	Cmd        string        `json:"cmd,omitempty"`
	Session    string        `json:"session,omitempty"`
	Sessions   []string      `json:"sessions,omitempty"`
	NewSession bool          `json:"newSession,omitempty"`
	Windows    []TmuxWindow  `json:"windows,omitempty"`
	Apps       []*AppSummary `json:"apps,omitempty"`
	Aliases    []*Alias      `json:"aliases,omitempty"`
	Index      int           `json:"index,omitempty"`
	Prefix     []string      `json:"prefix,omitempty"` // For DirectSession
	Target     string        `json:"target,omitempty"` // For DirectSession
}

type TmuxWindow struct {
	Index  int    `json:"index"`
	Name   string `json:"name"`
	Active bool   `json:"active"`
}

// Session interface for both TmuxSession and DirectSession
type Session interface {
	sendInput(data string) error
	resize(rows, cols int) error
	close()
	listWindows() ([]TmuxWindow, error)
	selectWindow(index int) error
	renameWindow(index int, name string) error
	newWindow() error
	nextWindow() error
	prevWindow() error
	killWindow(index int) error
	splitHorizontal() error
	splitVertical() error
	killPane() error
	zoomPane() error
}

type TmuxSession struct {
	cmd       *exec.Cmd
	ptmx      *os.File
	ws        *websocket.Conn
	wsMu      *sync.Mutex // Shared mutex for websocket writes
	sessionID string
	command   string      // Optional command to execute in session
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
		// Check if session exists, create it if not
		check := exec.Command("tmux", "has-session", "-t", ts.sessionID)
		if check.Run() != nil {
			// Session doesn't exist - create it
			log.Printf("Session '%s' not found, creating it", ts.sessionID)
			createArgs := []string{"new-session", "-d", "-s", ts.sessionID,
				"-x", fmt.Sprintf("%d", cols),
				"-y", fmt.Sprintf("%d", rows)}
			
			// Add command if specified
			if ts.command != "" {
				createArgs = append(createArgs, ts.command)
			}
			
			create := exec.Command("tmux", createArgs...)
			if err := create.Run(); err != nil {
				return fmt.Errorf("failed to create session '%s': %v", ts.sessionID, err)
			}
		}
		args = []string{"attach-session", "-t", ts.sessionID}
	} else {
		args = []string{
			"new-session", "-s", ts.sessionID,
			"-x", fmt.Sprintf("%d", cols),
			"-y", fmt.Sprintf("%d", rows),
		}
		
		// Add command if specified
		if ts.command != "" {
			args = append(args, ts.command)
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

func (ts *TmuxSession) renameWindow(index int, name string) error {
	cmd := exec.Command("tmux", "rename-window", "-t", fmt.Sprintf("%s:%d", ts.sessionID, index), name)
	return cmd.Run()
}

func (ts *TmuxSession) newWindow() error {
	cmd := exec.Command("tmux", "new-window", "-t", ts.sessionID)
	return cmd.Run()
}

func (ts *TmuxSession) nextWindow() error {
	cmd := exec.Command("tmux", "next-window", "-t", ts.sessionID)
	return cmd.Run()
}

func (ts *TmuxSession) prevWindow() error {
	cmd := exec.Command("tmux", "previous-window", "-t", ts.sessionID)
	return cmd.Run()
}

func (ts *TmuxSession) killWindow(index int) error {
	cmd := exec.Command("tmux", "kill-window", "-t", fmt.Sprintf("%s:%d", ts.sessionID, index))
	return cmd.Run()
}

func (ts *TmuxSession) splitHorizontal() error {
	cmd := exec.Command("tmux", "split-window", "-h", "-t", ts.sessionID)
	return cmd.Run()
}

func (ts *TmuxSession) splitVertical() error {
	cmd := exec.Command("tmux", "split-window", "-v", "-t", ts.sessionID)
	return cmd.Run()
}

func (ts *TmuxSession) killPane() error {
	cmd := exec.Command("tmux", "kill-pane", "-t", ts.sessionID)
	return cmd.Run()
}

func (ts *TmuxSession) zoomPane() error {
	cmd := exec.Command("tmux", "resize-pane", "-Z", "-t", ts.sessionID)
	return cmd.Run()
}

// DirectSession represents a direct connection to a container/VM tmux session
type DirectSession struct {
	cmd       *exec.Cmd
	ptmx      *os.File
	ws        *websocket.Conn
	wsMu      *sync.Mutex
	sessionID string
	prefix    []string // Command prefix (e.g., ["podman", "exec", "-it", "dotfedorasys"])
	target    string   // Target session name in container (e.g., "screen")
}

func (ds *DirectSession) start(rows, cols int) error {
	// Ensure minimum size
	if rows < 24 {
		rows = 24
	}
	if cols < 80 {
		cols = 80
	}

	// First, check if target session exists, create if it doesn't
	checkArgs := append(ds.prefix, "tmux", "has-session", "-t", ds.target)
	checkCmd := exec.Command(checkArgs[0], checkArgs[1:]...)
	if err := checkCmd.Run(); err != nil {
		// Session doesn't exist, create it
		log.Printf("Session '%s' not found in container, creating it", ds.target)
		createArgs := append(ds.prefix, "tmux", "new-session", "-d", "-s", ds.target,
			"-x", fmt.Sprintf("%d", cols),
			"-y", fmt.Sprintf("%d", rows))
		createCmd := exec.Command(createArgs[0], createArgs[1:]...)
		if err := createCmd.Run(); err != nil {
			return fmt.Errorf("failed to create session '%s': %v", ds.target, err)
		}
	}

	// Build command: <prefix> tmux attach -t <target>
	args := append(ds.prefix, "tmux", "attach", "-t", ds.target)
	
	log.Printf("Starting DirectSession: %v", args)
	ds.cmd = exec.Command(args[0], args[1:]...)

	// Set proper environment
	env := append(os.Environ(),
		"TERM=screen-256color",
		"LANG=en_US.UTF-8",
		"LC_ALL=en_US.UTF-8",
		"COLORTERM=truecolor",
	)
	ds.cmd.Env = env

	var err error
	ds.ptmx, err = pty.Start(ds.cmd)
	if err != nil {
		return fmt.Errorf("failed to start PTY: %v", err)
	}

	// Set PTY size
	winsize := &pty.Winsize{
		Rows: uint16(rows),
		Cols: uint16(cols),
		X:    0,
		Y:    0,
	}

	log.Printf("Setting DirectSession PTY size: cols=%d, rows=%d\n", cols, rows)
	if err := pty.Setsize(ds.ptmx, winsize); err != nil {
		log.Println("Failed to set PTY size:", err)
	}

	// Start reading output
	go ds.readOutput()

	// Send attached notification
	ds.wsMu.Lock()
	if ds.ws != nil {
		ds.ws.WriteJSON(Message{Type: "attached", Session: ds.sessionID})
	}
	ds.wsMu.Unlock()

	return nil
}

func (ds *DirectSession) readOutput() {
	buf := make([]byte, 8192)
	for {
		n, err := ds.ptmx.Read(buf)
		if err != nil {
			if err != io.EOF {
				log.Println("DirectSession read error:", err)
			}
			break
		}

		if n > 0 {
			ds.wsMu.Lock()
			if ds.ws != nil {
				if err := ds.ws.WriteMessage(websocket.BinaryMessage, buf[:n]); err != nil {
					log.Println("DirectSession WebSocket write error:", err)
					ds.wsMu.Unlock()
					break
				}
			}
			ds.wsMu.Unlock()
		}
	}

	// Notify close
	ds.wsMu.Lock()
	if ds.ws != nil {
		ds.ws.WriteJSON(Message{Type: "close"})
	}
	ds.wsMu.Unlock()
}

func (ds *DirectSession) sendInput(data string) error {
	decoded, err := base64.StdEncoding.DecodeString(data)
	if err != nil {
		return err
	}
	_, err = ds.ptmx.Write(decoded)
	return err
}

func (ds *DirectSession) resize(rows, cols int) error {
	winsize := &pty.Winsize{
		Rows: uint16(rows),
		Cols: uint16(cols),
		X:    0,
		Y:    0,
	}
	return pty.Setsize(ds.ptmx, winsize)
}

func (ds *DirectSession) close() {
	if ds.ptmx != nil {
		ds.ptmx.Close()
	}
	if ds.cmd != nil && ds.cmd.Process != nil {
		ds.cmd.Process.Kill()
	}
}

// Tmux control methods for DirectSession - execute commands through container
func (ds *DirectSession) listWindows() ([]TmuxWindow, error) {
	// Build command: <prefix> tmux list-windows -t <target> -F '#{window_index}:#{window_name}:#{window_active}'
	args := append(ds.prefix, "tmux", "list-windows", "-t", ds.target, "-F", "#{window_index}:#{window_name}:#{window_active}")
	
	cmd := exec.Command(args[0], args[1:]...)
	output, err := cmd.Output()
	if err != nil {
		return nil, err
	}

	windows := []TmuxWindow{}
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
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

func (ds *DirectSession) selectWindow(index int) error {
	args := append(ds.prefix, "tmux", "select-window", "-t", fmt.Sprintf("%s:%d", ds.target, index))
	cmd := exec.Command(args[0], args[1:]...)
	return cmd.Run()
}

func (ds *DirectSession) renameWindow(index int, name string) error {
	args := append(ds.prefix, "tmux", "rename-window", "-t", fmt.Sprintf("%s:%d", ds.target, index), name)
	cmd := exec.Command(args[0], args[1:]...)
	return cmd.Run()
}

func (ds *DirectSession) newWindow() error {
	args := append(ds.prefix, "tmux", "new-window", "-t", ds.target)
	cmd := exec.Command(args[0], args[1:]...)
	return cmd.Run()
}

func (ds *DirectSession) nextWindow() error {
	args := append(ds.prefix, "tmux", "next-window", "-t", ds.target)
	cmd := exec.Command(args[0], args[1:]...)
	return cmd.Run()
}

func (ds *DirectSession) prevWindow() error {
	args := append(ds.prefix, "tmux", "previous-window", "-t", ds.target)
	cmd := exec.Command(args[0], args[1:]...)
	return cmd.Run()
}

func (ds *DirectSession) killWindow(index int) error {
	args := append(ds.prefix, "tmux", "kill-window", "-t", fmt.Sprintf("%s:%d", ds.target, index))
	cmd := exec.Command(args[0], args[1:]...)
	return cmd.Run()
}

func (ds *DirectSession) splitHorizontal() error {
	args := append(ds.prefix, "tmux", "split-window", "-h", "-t", ds.target)
	cmd := exec.Command(args[0], args[1:]...)
	return cmd.Run()
}

func (ds *DirectSession) splitVertical() error {
	args := append(ds.prefix, "tmux", "split-window", "-v", "-t", ds.target)
	cmd := exec.Command(args[0], args[1:]...)
	return cmd.Run()
}

func (ds *DirectSession) killPane() error {
	args := append(ds.prefix, "tmux", "kill-pane", "-t", ds.target)
	cmd := exec.Command(args[0], args[1:]...)
	return cmd.Run()
}

func (ds *DirectSession) zoomPane() error {
	args := append(ds.prefix, "tmux", "resize-pane", "-Z", "-t", ds.target)
	cmd := exec.Command(args[0], args[1:]...)
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

// Apps management methods

func newAppsManager(config *AppsConfig) *AppsManager {
	return &AppsManager{
		config:       config,
		apps:         make(map[string]*App),
		xpraSessions: make(map[int]*XpraSession),
	}
}

func (am *AppsManager) loadApps() error {
	files, err := filepath.Glob(filepath.Join(am.config.AppsPath, "*.md"))
	if err != nil {
		return err
	}

	for _, file := range files {
		// Skip README.md files
		basename := filepath.Base(file)
		if strings.EqualFold(basename, "README.md") {
			continue
		}

		app, err := ParseActionFile(file)
		if err != nil {
			log.Printf("Warning: Failed to parse %s: %v", file, err)
			continue
		}
		am.apps[app.Name] = app
	}

	log.Printf("Loaded %d apps from %s", len(am.apps), am.config.AppsPath)
	return nil
}

// HTTP Handlers for Apps API

func (am *AppsManager) handleListApps(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Scan directory fresh each time to pick up new files
	pattern := filepath.Join(am.config.AppsPath, "*.md")
	files, err := filepath.Glob(pattern)
	if err != nil {
		http.Error(w, "Failed to scan apps directory", http.StatusInternalServerError)
		return
	}

	apps := make([]*AppSummary, 0)
	for _, file := range files {
		// Skip README.md files
		basename := filepath.Base(file)
		if strings.EqualFold(basename, "README.md") {
			continue
		}

		app, err := ParseActionFile(file)
		if err != nil {
			log.Printf("Warning: failed to parse %s: %v", file, err)
			continue
		}
		apps = append(apps, &AppSummary{
			Name:    app.Name,
			Title:   app.Title,
			Path:    app.Path,
			Actions: app.ListActions(),
		})
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"apps": apps,
	})
}

func (am *AppsManager) handleGetApp(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Extract app name from path: /api/apps/{name}
	path := strings.TrimPrefix(r.URL.Path, "/api/apps/")
	parts := strings.Split(path, "/")
	if len(parts) == 0 || parts[0] == "" {
		http.Error(w, "App name required", http.StatusBadRequest)
		return
	}
	name := parts[0]

	// Parse fresh from disk
	appPath := filepath.Join(am.config.AppsPath, name+".md")
	app, err := ParseActionFile(appPath)
	if err != nil {
		http.Error(w, "App not found", http.StatusNotFound)
		return
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"name":    app.Name,
		"title":   app.Title,
		"path":    app.Path,
		"actions": app.ListActions(),
		"vars":    app.Vars,
	})
}

func (am *AppsManager) handleRunApp(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Extract app name from path: /api/apps/{name}/run
	path := strings.TrimPrefix(r.URL.Path, "/api/apps/")
	parts := strings.Split(path, "/")
	if len(parts) < 2 || parts[0] == "" {
		http.Error(w, "App name required", http.StatusBadRequest)
		return
	}
	name := parts[0]

	// Re-parse the actionfile to get latest actions
	appPath := filepath.Join(am.config.AppsPath, name+".md")
	app, err := ParseActionFile(appPath)
	if err != nil {
		http.Error(w, "App not found or failed to parse", http.StatusNotFound)
		return
	}

	// Parse request body
	var req RunAppRequest
	if r.Body != nil {
		json.NewDecoder(r.Body).Decode(&req)
	}

	// Auto-detect GUI apps: if app has run-xpra or run-desktop action, use xpra mode
	if req.Mode == "" || req.Mode == "terminal" {
		if app.HasAction("run-xpra") || app.HasAction("run-desktop") {
			req.Mode = "xpra"
			log.Printf("Auto-detected desktop app %s (has GUI action), switching to xpra mode", name)
		} else {
			req.Mode = "terminal"
		}
	}

	if req.Action == "" {
		// Convention: prefer run-xpra, fallback to run-desktop for GUI apps, run for terminal apps
		if req.Mode == "xpra" {
			if app.HasAction("run-xpra") {
				req.Action = "run-xpra"
			} else {
				req.Action = "run-desktop"
			}
		} else {
			req.Action = "run"
		}
	}
	if req.Target == "" {
		req.Target = "screen" // Default to "screen" session
	}

	log.Printf("Running %s/%s in target=%s mode=%s", name, req.Action, req.Target, req.Mode)

	// Execute the action
	if req.Mode == "xpra" {
		// Look for run-xpra action, fallback to run-desktop
		xpraAction := "run-xpra"
		if !app.HasAction(xpraAction) {
			xpraAction = req.Action // Use run-desktop
		}

		// Get the command from the action
		action, exists := app.Actions[xpraAction]
		if !exists {
			http.Error(w, fmt.Sprintf("Action '%s' not found", xpraAction), http.StatusBadRequest)
			return
		}

		// Get command - will be passed to shell with env vars set
		command := action.Code
		log.Printf("Command from actionfile: %q", command)
		log.Printf("Available actionfile vars: %+v", app.Vars)

		// Expand only actionfile vars (e.g., $cmd -> /usr/bin/vivaldi)
		// Leave APPNAME/APPSHOME for shell expansion
		for varName, varValue := range app.Vars {
			before := command
			command = strings.ReplaceAll(command, "$"+varName, varValue)
			command = strings.ReplaceAll(command, "${"+varName+"}", varValue)
			if before != command {
				log.Printf("Replaced $%s with %s", varName, varValue)
			}
		}

		// Trim whitespace
		command = strings.TrimSpace(command)

		// Start xpra session with the expanded command
		session, err := am.StartXpraApp(name, command)
		if err != nil {
			http.Error(w, fmt.Sprintf("Failed to start xpra: %v", err), http.StatusInternalServerError)
			return
		}

		json.NewEncoder(w).Encode(map[string]interface{}{
			"status":  "success",
			"mode":    "xpra",
			"session": session.Info(),
		})
		return
	}

	result, err := app.ExecuteAction(req.Action, req.Target, req.Mode)
	if err != nil {
		log.Printf("Execution failed: %v", err)
		http.Error(w, fmt.Sprintf("Execution failed: %v", err), http.StatusInternalServerError)
		return
	}

	log.Printf("Execution result: %s (exit code: %d)", result.Output, result.ExitCode)
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status": "success",
		"result": result,
		"target": req.Target,
	})
}

func (am *AppsManager) handleListXpraSessions(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	sessions := make([]*XpraSessionInfo, 0)
	for _, session := range am.xpraSessions {
		sessions = append(sessions, session.Info())
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"sessions": sessions,
	})
}

func (am *AppsManager) handleStopXpra(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var req struct {
		AppName string `json:"appName"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	// Find and stop the xpra session for this app
	for display, session := range am.xpraSessions {
		if session.AppName == req.AppName {
			log.Printf("Stopping xpra session for %s on display :%d", req.AppName, display)

			if err := session.Stop(); err != nil {
				// Log the error but still clean up tracking
				// Session might already be stopped, which is fine
				log.Printf("Failed to stop xpra session (continuing cleanup): %v", err)
			}

			// Remove from tracking regardless
			delete(am.xpraSessions, display)

			json.NewEncoder(w).Encode(map[string]interface{}{
				"status":  "success",
				"message": fmt.Sprintf("Stopped xpra session for %s", req.AppName),
			})
			return
		}
	}

	http.Error(w, "Session not found", http.StatusNotFound)
}

func (am *AppsManager) proxyWebSocket(w http.ResponseWriter, r *http.Request, port int, path string) {
	// Upgrade connection to websocket
	targetURL := fmt.Sprintf("ws://localhost:%d%s", port, path)

	log.Printf("Proxying WebSocket: %s -> %s", r.URL.Path, targetURL)

	// Get WebSocket subprotocols from client
	requestHeader := make(http.Header)
	if protocols := r.Header.Get("Sec-WebSocket-Protocol"); protocols != "" {
		requestHeader.Set("Sec-WebSocket-Protocol", protocols)
		log.Printf("Client requested protocols: %s", protocols)
	}

	// Connect to backend xpra websocket with subprotocols
	backendConn, backendResp, err := websocket.DefaultDialer.Dial(targetURL, requestHeader)
	if err != nil {
		log.Printf("Failed to dial backend websocket: %v", err)
		http.Error(w, "Failed to connect to xpra websocket", http.StatusBadGateway)
		return
	}
	defer backendConn.Close()

	// Get negotiated subprotocol from backend
	negotiatedProtocol := backendResp.Header.Get("Sec-WebSocket-Protocol")
	if negotiatedProtocol != "" {
		log.Printf("Backend negotiated protocol: %s", negotiatedProtocol)
	}

	// Upgrade client connection with negotiated subprotocol
	responseHeader := http.Header{}
	if negotiatedProtocol != "" {
		responseHeader.Set("Sec-WebSocket-Protocol", negotiatedProtocol)
	}
	clientConn, err := upgrader.Upgrade(w, r, responseHeader)
	if err != nil {
		log.Printf("Failed to upgrade client connection: %v", err)
		return
	}
	defer clientConn.Close()

	// Proxy messages bidirectionally
	errChan := make(chan error, 2)

	// Client -> Backend
	go func() {
		for {
			msgType, msg, err := clientConn.ReadMessage()
			if err != nil {
				errChan <- err
				return
			}
			if err := backendConn.WriteMessage(msgType, msg); err != nil {
				errChan <- err
				return
			}
		}
	}()

	// Backend -> Client
	go func() {
		for {
			msgType, msg, err := backendConn.ReadMessage()
			if err != nil {
				errChan <- err
				return
			}
			if err := clientConn.WriteMessage(msgType, msg); err != nil {
				errChan <- err
				return
			}
		}
	}()

	// Wait for error from either direction
	<-errChan
	log.Printf("WebSocket proxy closed")
}

func (am *AppsManager) handleXpraProxy(w http.ResponseWriter, r *http.Request) {
	// Extract display from path: /xpra/:display/...
	path := strings.TrimPrefix(r.URL.Path, "/xpra/")
	parts := strings.SplitN(path, "/", 2)
	if len(parts) == 0 {
		http.Error(w, "Invalid xpra path", http.StatusBadRequest)
		return
	}

	displayStr := parts[0]
	var display int
	fmt.Sscanf(displayStr, "%d", &display)

	// Find the session for this display
	session, exists := am.xpraSessions[display]
	if !exists {
		http.Error(w, "Xpra session not found", http.StatusNotFound)
		return
	}

	// Build target URL
	targetPath := "/"
	if len(parts) > 1 {
		targetPath = "/" + parts[1]
	}
	if r.URL.RawQuery != "" {
		targetPath += "?" + r.URL.RawQuery
	}
	targetURL := fmt.Sprintf("http://localhost:%d%s", session.Port, targetPath)

	// For WebSocket upgrade requests, proxy the websocket connection
	if r.Header.Get("Upgrade") == "websocket" {
		am.proxyWebSocket(w, r, session.Port, targetPath)
		return
	}

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
		http.Error(w, "Failed to reach xpra: "+err.Error(), http.StatusBadGateway)
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

func makeWebSocketHandler(defaultSession string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ws, err := upgrader.Upgrade(w, r, nil)
		if err != nil {
			log.Println("Upgrade error:", err)
			return
		}
		defer ws.Close()

		var session *TmuxSession
		var directSession *DirectSession
		var wsMu sync.Mutex // Mutex to protect websocket writes

		// Helper to get active session as interface
		getSession := func() Session {
			if directSession != nil {
				return directSession
			}
			if session != nil {
				return session
			}
			return nil
		}

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

		case "list_apps":
			// Get apps list from AppsManager
			apps := make([]*AppSummary, 0)
			if appsManager != nil {
				pattern := filepath.Join(appsManager.config.AppsPath, "*.md")
				files, err := filepath.Glob(pattern)
				if err == nil {
					for _, file := range files {
						basename := filepath.Base(file)
						if strings.EqualFold(basename, "README.md") {
							continue
						}
						app, err := ParseActionFile(file)
						if err != nil {
							log.Printf("Warning: failed to parse %s: %v", file, err)
							continue
						}
						apps = append(apps, &AppSummary{
							Name:    app.Name,
							Title:   app.Title,
							Path:    app.Path,
							Actions: app.ListActions(),
						})
					}
				}
			}
			safeWriteJSON(Message{Type: "apps", Apps: apps})

		case "start":
			sessionName := msg.Session
			if sessionName == "" {
				sessionName = fmt.Sprintf("wmux_%d", os.Getpid())
			}

			session = &TmuxSession{
				ws:        ws,
				wsMu:      &wsMu,
				sessionID: sessionName,
				command:   msg.Cmd,
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

		case "start_direct":
			// Direct connection to container/VM tmux
			sessionName := msg.Session
			if sessionName == "" {
				sessionName = fmt.Sprintf("wmux_direct_%d", os.Getpid())
			}

			// Close existing session if any
			if session != nil {
				session.close()
				session = nil
			}
			if directSession != nil {
				directSession.close()
				directSession = nil
			}

			// msg.Prefix contains the exec command prefix
			// msg.Target contains the target tmux session name (default: "screen")
			target := msg.Target
			if target == "" {
				target = "screen"
			}

			directSession = &DirectSession{
				ws:        ws,
				wsMu:      &wsMu,
				sessionID: sessionName,
				prefix:    msg.Prefix,
				target:    target,
			}

			rows := msg.Rows
			cols := msg.Cols
			if rows == 0 {
				rows = 24
			}
			if cols == 0 {
				cols = 80
			}

			if err := directSession.start(rows, cols); err != nil {
				log.Println("Start direct error:", err)
				safeWriteJSON(Message{Type: "error", Data: err.Error()})
				directSession = nil
			}

		case "input":
			activeSession := getSession()
			if activeSession != nil {
				if err := activeSession.sendInput(msg.Data); err != nil {
					log.Println("Input error:", err)
				}
			}

		case "resize":
			activeSession := getSession()
			if activeSession != nil && msg.Rows > 0 && msg.Cols > 0 {
				if err := activeSession.resize(msg.Rows, msg.Cols); err != nil {
					log.Println("Resize error:", err)
				}
			}

		case "disconnect":
			if session != nil {
				session.close()
				safeWriteJSON(Message{Type: "close"})
				session = nil
			}
			if directSession != nil {
				directSession.close()
				safeWriteJSON(Message{Type: "close"})
				directSession = nil
			}

		case "list_aliases":
			// Serve from cache immediately
			aliasesMu.Lock()
			cached := aliasesCache
			aliasesMu.Unlock()
			safeWriteJSON(Message{Type: "aliases", Aliases: cached})
			// Refresh cache in background
			go loadAliasesCache()

		case "get_clipboard":
			if session != nil {
				// Try to get tmux selection - check if in copy mode
				captureCmd := exec.Command("tmux", "display-message", "-p", "-t", session.sessionID, "#{pane_in_mode}")
				output, _ := captureCmd.Output()
				inCopyMode := strings.TrimSpace(string(output)) == "1"

				if inCopyMode {
					// In copy mode - send copy command then get buffer
					exec.Command("tmux", "send-keys", "-t", session.sessionID, "-X", "copy-selection").Run()
					time.Sleep(50 * time.Millisecond)
				}

				// Get tmux paste buffer content
				cmd := exec.Command("tmux", "show-buffer")
				bufOutput, err := cmd.Output()
				if err == nil && len(bufOutput) > 0 {
					safeWriteJSON(Message{Type: "clipboard", Data: string(bufOutput)})
				}
			}

		case "list_windows":
			activeSession := getSession()
			if activeSession != nil {
				windows, err := activeSession.listWindows()
				if err != nil {
					log.Println("List windows error:", err)
					safeWriteJSON(Message{Type: "error", Data: err.Error()})
				} else {
					safeWriteJSON(Message{Type: "windows", Windows: windows})
				}
			}

		case "select_window":
			activeSession := getSession()
			if activeSession != nil {
				if err := activeSession.selectWindow(msg.Index); err != nil {
					log.Println("Select window error:", err)
					safeWriteJSON(Message{Type: "error", Data: err.Error()})
				}
			}

		case "rename_window":
			activeSession := getSession()
			if activeSession != nil {
				if err := activeSession.renameWindow(msg.Index, msg.Data); err != nil {
					log.Println("Rename window error:", err)
					safeWriteJSON(Message{Type: "error", Data: err.Error()})
				}
			}

		case "new_window":
			activeSession := getSession()
			if activeSession != nil {
				if err := activeSession.newWindow(); err != nil {
					log.Println("New window error:", err)
					safeWriteJSON(Message{Type: "error", Data: err.Error()})
				}
			}

		case "next_window":
			activeSession := getSession()
			if activeSession != nil {
				if err := activeSession.nextWindow(); err != nil {
					log.Println("Next window error:", err)
					safeWriteJSON(Message{Type: "error", Data: err.Error()})
				}
			}

		case "prev_window":
			activeSession := getSession()
			if activeSession != nil {
				if err := activeSession.prevWindow(); err != nil {
					log.Println("Previous window error:", err)
					safeWriteJSON(Message{Type: "error", Data: err.Error()})
				}
			}

		case "kill_window":
			activeSession := getSession()
			if activeSession != nil {
				if err := activeSession.killWindow(msg.Index); err != nil {
					log.Println("Kill window error:", err)
					safeWriteJSON(Message{Type: "error", Data: err.Error()})
				}
			}

		case "split_horizontal":
			activeSession := getSession()
			if activeSession != nil {
				if err := activeSession.splitHorizontal(); err != nil {
					log.Println("Split horizontal error:", err)
					safeWriteJSON(Message{Type: "error", Data: err.Error()})
				}
			}

		case "split_vertical":
			activeSession := getSession()
			if activeSession != nil {
				if err := activeSession.splitVertical(); err != nil {
					log.Println("Split vertical error:", err)
					safeWriteJSON(Message{Type: "error", Data: err.Error()})
				}
			}

		case "kill_pane":
			activeSession := getSession()
			if activeSession != nil {
				if err := activeSession.killPane(); err != nil {
					log.Println("Kill pane error:", err)
					safeWriteJSON(Message{Type: "error", Data: err.Error()})
				}
			}

		case "zoom_pane":
			activeSession := getSession()
			if activeSession != nil {
				if err := activeSession.zoomPane(); err != nil {
					log.Println("Zoom pane error:", err)
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

// Machine and Devenv types and handlers
type MachineInstance struct {
	Name   string `json:"name"`
	Status string `json:"status"`
}

type DevenvInstance struct {
	Name   string `json:"name"`
	Status string `json:"status"`
}

// handleListMachines returns running machines
func handleListMachines(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	// Execute machine_running_targets function from zsh
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/zsh"
	}

	cmd := exec.Command(shell, "-i", "-c", "source ~/.dotfiles/zsh/.zshrc.d/machine.zsh && machine_running_targets")
	output, err := cmd.Output()
	if err != nil {
		log.Printf("Failed to get running machines: %v", err)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"machines": []MachineInstance{},
		})
		return
	}

	machines := make([]MachineInstance, 0)
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) >= 1 {
			name := parts[0]
			status := "Running"
			if len(parts) > 1 {
				status = strings.Trim(strings.Join(parts[1:], " "), "[]")
			}
			machines = append(machines, MachineInstance{
				Name:   name,
				Status: status,
			})
		}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"machines": machines,
	})
}

// handleListMachinePrefixes returns available machine prefixes for creation
func handleListMachinePrefixes(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/zsh"
	}

	cmd := exec.Command(shell, "-i", "-c", "source ~/.dotfiles/zsh/.zshrc.d/machine.zsh && machine_prefixes")
	output, err := cmd.Output()
	if err != nil {
		log.Printf("Failed to get machine prefixes: %v", err)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"prefixes": []string{},
		})
		return
	}

	prefixes := make([]string, 0)
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			prefixes = append(prefixes, line)
		}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"prefixes": prefixes,
	})
}

// handleConnectMachine connects to a machine's screen session
func handleConnectMachine(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var req struct {
		Name string `json:"name"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		http.Error(w, "Machine name required", http.StatusBadRequest)
		return
	}

	// Execute machine <name> screen command
	// This will be handled by the existing tmux session connection
	// We just need to return the command to execute
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "success",
		"command": fmt.Sprintf("machine %s screen", req.Name),
	})
}

// handleListDevenvs returns running devenvs
func handleListDevenvs(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/zsh"
	}

	cmd := exec.Command(shell, "-i", "-c", "source ~/.dotfiles/zsh/.zshrc.d/devenv.zsh && devenv_running_targets")
	output, err := cmd.Output()
	if err != nil {
		log.Printf("Failed to get running devenvs: %v", err)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"devenvs": []DevenvInstance{},
		})
		return
	}

	devenvs := make([]DevenvInstance, 0)
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	for _, line := range lines {
		if line == "" {
			continue
		}
		parts := strings.Fields(line)
		if len(parts) >= 1 {
			name := parts[0]
			status := "Up"
			if len(parts) > 1 {
				status = strings.Trim(strings.Join(parts[1:], " "), "[]")
			}
			devenvs = append(devenvs, DevenvInstance{
				Name:   name,
				Status: status,
			})
		}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"devenvs": devenvs,
	})
}

// handleListDevenvPrefixes returns available devenv prefixes for creation
func handleListDevenvPrefixes(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/zsh"
	}

	cmd := exec.Command(shell, "-i", "-c", "source ~/.dotfiles/zsh/.zshrc.d/devenv.zsh && devenv_prefixes")
	output, err := cmd.Output()
	if err != nil {
		log.Printf("Failed to get devenv prefixes: %v", err)
		json.NewEncoder(w).Encode(map[string]interface{}{
			"prefixes": []string{},
		})
		return
	}

	prefixes := make([]string, 0)
	lines := strings.Split(strings.TrimSpace(string(output)), "\n")
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line != "" {
			prefixes = append(prefixes, line)
		}
	}

	json.NewEncoder(w).Encode(map[string]interface{}{
		"prefixes": prefixes,
	})
}

// handleConnectDevenv connects to a devenv's screen session
func handleConnectDevenv(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	var req struct {
		Name string `json:"name"`
	}

	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		http.Error(w, "Invalid request", http.StatusBadRequest)
		return
	}

	if req.Name == "" {
		http.Error(w, "Devenv name required", http.StatusBadRequest)
		return
	}

	// Execute devenv <name> screen command
	json.NewEncoder(w).Encode(map[string]interface{}{
		"status":  "success",
		"command": fmt.Sprintf("devenv %s screen", req.Name),
	})
}

// handleMachineExecPrefix returns the command prefix for executing tmux commands in a machine
func handleMachineExecPrefix(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	name := r.URL.Query().Get("name")
	if name == "" {
		http.Error(w, "Machine name required", http.StatusBadRequest)
		return
	}

	// Machine uses SSH, need to parse config from ~/.config/containers/macadam/machine/qemu/{name}.json
	// For now, return basic SSH command
	json.NewEncoder(w).Encode(map[string]interface{}{
		"prefix": []string{"ssh", name},
		"type":   "machine",
	})
}

// handleDevenvExecPrefix returns the command prefix for executing tmux commands in a devenv
func handleDevenvExecPrefix(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")

	name := r.URL.Query().Get("name")
	if name == "" {
		http.Error(w, "Devenv name required", http.StatusBadRequest)
		return
	}

	devenvExecPrefixCacheMu.Lock()
	runtime := devenvExecPrefixCache.runtime
	user := devenvExecPrefixCache.user
	devenvExecPrefixCacheMu.Unlock()

	if runtime == "" {
		runtime = "podman"
	}
	if user == "" {
		user = "gbraad"
	}

	containerName := name + "sys"

	json.NewEncoder(w).Encode(map[string]interface{}{
		"prefix": []string{runtime, "exec", "-it", containerName, "sudo", "-i", "-u", user},
		"type":   "devenv",
	})
}

// readerConn wraps a net.Conn with a bufio.Reader
var devenvExecPrefixCacheInterval = flag.Duration("devenv-exec-cache-interval", 5*time.Minute, "Interval for refreshing devenv exec prefix cache")

func refreshDevenvExecPrefixCache() {
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/zsh"
	}

	runtime := "podman"
	cmd := exec.Command(shell, "-i", "-c", "dotini devenv --get devenv.runtime")
	output, err := cmd.Output()
	if err == nil {
		runtime = strings.TrimSpace(string(output))
		if runtime == "" {
			runtime = "podman"
		}
	}

	user := "gbraad"
	userCmd := exec.Command(shell, "-i", "-c", "dotini devenv --get devenv.user")
	userOutput, err := userCmd.Output()
	if err == nil {
		user = strings.TrimSpace(string(userOutput))
		if user == "" {
			user = "gbraad"
		}
	}

	devenvExecPrefixCacheMu.Lock()
	devenvExecPrefixCache.runtime = runtime
	devenvExecPrefixCache.user = user
	devenvExecPrefixCache.updatedAt = time.Now()
	devenvExecPrefixCacheMu.Unlock()

	log.Printf("Refreshed devenv exec prefix cache: runtime=%s, user=%s", runtime, user)
}

func main() {
	// Command line flags
	version := flag.Bool("version", false, "Show version information")
	bindAll := flag.Bool("bind-all", false, "Bind to all interfaces (0.0.0.0) instead of Tailscale only")
	port := flag.Int("port", 2022, "Port to listen on (default: 2022)")
	multiHost := flag.Bool("multi-host", false, "Enable multi-host mode (host selector interface)")
	exposeHosts := flag.Bool("expose-hosts", false, "Auto-discover hosts (requires --multi-host)")
	defaultSession := flag.String("default-session", "screen", "Default session to auto-connect on all machines (default: 'screen')")
	noApps := flag.Bool("no-apps", false, "Disable apps functionality")
	appsPath := flag.String("apps-path", "", "Path to .dotapps directory (default: ~/.dotapps)")
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

	// Set default paths
	home, err := os.UserHomeDir()
	if err != nil {
		log.Fatal("Could not determine home directory:", err)
	}

	// Set default TLS cert paths if not specified
	if *tlsCert == "" {
		certPath := filepath.Join(home, ".wmux", "wmux.crt")
		tlsCert = &certPath
	}
	if *tlsKey == "" {
		keyPath := filepath.Join(home, ".wmux", "wmux.key")
		tlsKey = &keyPath
	}

	// Set default apps path if not specified
	if *appsPath == "" {
		*appsPath = filepath.Join(home, ".dotapps")
	}

	log.Printf("wmux v%s - Web-based tmux Controller\n", Version)

	// Pre-load aliases cache in background
	go loadAliasesCache()

	// Pre-load devenv exec prefix cache in background
	refreshDevenvExecPrefixCache()
	go func() {
		ticker := time.NewTicker(*devenvExecPrefixCacheInterval)
		defer ticker.Stop()
		for {
			<-ticker.C
			refreshDevenvExecPrefixCache()
		}
	}()

	// Ensure default session exists
	if *defaultSession != "" {
		if err := exec.Command("tmux", "has-session", "-t", *defaultSession).Run(); err != nil {
			log.Printf("Creating default tmux session '%s'", *defaultSession)
			exec.Command("tmux", "new-session", "-d", "-s", *defaultSession).Run()
		}
	}

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

	// Check if local ./public directory exists, otherwise use embedded
	var publicDir http.FileSystem
	var useLocalPublic bool
	if _, err := os.Stat("./public"); err == nil {
		log.Println("Using local ./public directory")
		publicDir = http.Dir("./public")
		useLocalPublic = true
	} else {
		log.Println("Using embedded public directory")
		publicSubFS, err := fs.Sub(publicFS, "public")
		if err != nil {
			log.Fatal("Failed to get embedded public directory:", err)
		}
		publicDir = http.FS(publicSubFS)
		useLocalPublic = false
	}

	// SPA: Always serve index.html for root, static files for everything else
	http.HandleFunc("/", func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/" {
			if useLocalPublic {
				http.ServeFile(w, r, "./public/index.html")
			} else {
				data, err := publicDir.(http.FileSystem).Open("index.html")
				if err != nil {
					http.Error(w, "Failed to read index.html", http.StatusInternalServerError)
					return
				}
				defer data.Close()
				w.Header().Set("Content-Type", "text/html")
				io.Copy(w, data)
			}
		} else {
			http.FileServer(publicDir).ServeHTTP(w, r)
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
			"appsEnabled":    !*noApps,
		})
	})

	// Extract server IP from bindAddr for xpra URLs
	serverHost := strings.Split(bindAddr, ":")[0]

	// Machines API endpoints
	http.HandleFunc("/api/machines", handleListMachines)
	http.HandleFunc("/api/machines/prefixes", handleListMachinePrefixes)
	http.HandleFunc("/api/machines/connect", handleConnectMachine)
	http.HandleFunc("/api/machines/exec-prefix", handleMachineExecPrefix)

	// Devenvs API endpoints
	http.HandleFunc("/api/devenvs", handleListDevenvs)
	http.HandleFunc("/api/devenvs/prefixes", handleListDevenvPrefixes)
	http.HandleFunc("/api/devenvs/connect", handleConnectDevenv)
	http.HandleFunc("/api/devenvs/exec-prefix", handleDevenvExecPrefix)

	// Apps functionality (if enabled)
	if !*noApps {
		appsConfig := &AppsConfig{
			AppsPath:         *appsPath,
			XpraEnabled:      true,
			XpraStartDisplay: 10,
			XpraStartPort:    10000,
			ServerHost:       serverHost,
		}

		appsManager = newAppsManager(appsConfig)

		// Load apps from .dotapps directory
		if err := appsManager.loadApps(); err != nil {
			log.Printf("Warning: Failed to load apps: %v", err)
		}

		// Register apps API endpoints
		http.HandleFunc("/api/apps", func(w http.ResponseWriter, r *http.Request) {
			if r.Method == "GET" {
				appsManager.handleListApps(w, r)
			} else {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			}
		})

		http.HandleFunc("/api/apps/", func(w http.ResponseWriter, r *http.Request) {
			path := r.URL.Path

			// /api/apps/{name}/run
			if strings.HasSuffix(path, "/run") && r.Method == "POST" {
				appsManager.handleRunApp(w, r)
				return
			}

			// /api/apps/{name}
			if r.Method == "GET" {
				appsManager.handleGetApp(w, r)
				return
			}

			http.Error(w, "Not found", http.StatusNotFound)
		})

		http.HandleFunc("/api/xpra/sessions", func(w http.ResponseWriter, r *http.Request) {
			if r.Method == "GET" {
				appsManager.handleListXpraSessions(w, r)
			} else {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			}
		})

		http.HandleFunc("/api/xpra/stop", func(w http.ResponseWriter, r *http.Request) {
			if r.Method == "POST" {
				appsManager.handleStopXpra(w, r)
			} else {
				http.Error(w, "Method not allowed", http.StatusMethodNotAllowed)
			}
		})

		// Proxy /xpra/:display/* to localhost:port for HTTPS support
		http.HandleFunc("/xpra/", func(w http.ResponseWriter, r *http.Request) {
			appsManager.handleXpraProxy(w, r)
		})

		log.Printf("Apps functionality enabled (apps path: %s)", *appsPath)
	} else {
		log.Printf("Apps functionality disabled (--no-apps)")
	}

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
