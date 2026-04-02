package main

import (
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"strings"
	"time"
)

type XpraSession struct {
	Display    int
	Port       int
	AppName    string
	Command    string
	Process    *os.Process
	Attached   bool
	ServerHost string
}

type XpraSessionInfo struct {
	Display  int    `json:"display"`
	Port     int    `json:"port"`
	AppName  string `json:"app_name"`
	URL      string `json:"url"`
	WSURL    string `json:"ws_url"`
	Attached bool   `json:"attached"`
}

func (am *AppsManager) StartXpraApp(appName string, command string) (*XpraSession, error) {
	// Check if app is already running in xpra
	for _, session := range am.xpraSessions {
		if session.AppName == appName {
			log.Printf("Xpra session already exists for %s on display :%d", appName, session.Display)
			return session, nil
		}
	}

	// Allocate display
	display := am.allocateXpraDisplay()
	port := am.config.XpraStartPort + display - am.config.XpraStartDisplay

	// Stop any existing session on this display
	stopCmd := exec.Command("xpra", "stop", fmt.Sprintf(":%d", display))
	stopCmd.Run() // Ignore errors if nothing is running

	// Wrap in shell if command needs it:
	// - Has shell variables ($VAR or ${VAR})
	// - Multi-line or has pipes/conditionals
	needsShell := strings.Contains(command, "$") ||
		strings.Contains(command, "\n") ||
		strings.Contains(command, "|") ||
		strings.Contains(command, "&&") ||
		strings.Contains(command, "||") ||
		strings.Contains(command, "if ") ||
		strings.Contains(command, "for ") ||
		strings.Contains(command, "while ")

	startCommand := command
	if needsShell {
		// Get user's shell from environment or use sh
		shell := os.Getenv("SHELL")
		if shell == "" {
			shell = "/bin/sh"
		}

		// Use login shell (-l) to load user's environment
		// For multi-line commands, use $'...' which interprets escape sequences
		if strings.Contains(command, "\n") {
			// Multi-line: escape single quotes and wrap in $'...'
			escapedCmd := strings.ReplaceAll(command, "'", "'\\''")
			startCommand = fmt.Sprintf("%s -l -c $'export APPNAME=%s\\n%s'", shell, appName, escapedCmd)
		} else {
			// Single-line: use regular quoting
			envCmd := fmt.Sprintf("export APPNAME=%s; %s", appName, command)
			startCommand = fmt.Sprintf("%s -l -c %q", shell, envCmd)
		}
	}

	// Build xpra command
	args := []string{
		"start",
		fmt.Sprintf(":%d", display),
		fmt.Sprintf("--bind-tcp=0.0.0.0:%d", port),
		"--html=on",
		"--auth=none",
		"--cursors=no",           // Disable custom cursors (fixes huge cursor)
		"--dpi=96",               // Set DPI explicitly
		"--desktop-scaling=off",  // Disable desktop scaling
		"--notifications=no",     // Disable notification sounds
		"--bell=no",              // Disable system bell
		"--encoding=rgb",         // Use RGB encoding for better colors
		"--compress=0",           // Disable compression for better quality
		fmt.Sprintf("--start=%s", startCommand),
		"--daemon=yes",
	}

	// Start Xpra session
	cmd := exec.Command("xpra", args...)

	// Log the actual commands being executed
	log.Printf("Xpra starting on :%d (port %d)", display, port)
	log.Printf("Command to execute: %s", command)
	log.Printf("Full xpra command: %s %s", cmd.Path, strings.Join(cmd.Args[1:], " "))

	// Capture output for debugging
	output, err := cmd.CombinedOutput()
	if err != nil {
		log.Printf("Xpra start failed: %v\nOutput: %s", err, string(output))
		return nil, fmt.Errorf("failed to start xpra: %v - %s", err, string(output))
	}
	log.Printf("Xpra started successfully: %s", string(output))

	// Wait for xpra to be ready by checking if the port is open
	// Use direct dialer to bypass proxy settings
	log.Printf("Waiting for xpra to be ready on port %d...", port)
	ready := false
	var lastErr error
	dialer := &net.Dialer{
		Timeout: 200 * time.Millisecond,
	}
	for i := 0; i < 100; i++ { // Try for 10 seconds (100 * 100ms)
		conn, err := dialer.Dial("tcp", fmt.Sprintf("127.0.0.1:%d", port))
		if err == nil {
			conn.Close()
			ready = true
			log.Printf("Xpra is ready after %dms", i*100)
			break
		}
		lastErr = err
		time.Sleep(100 * time.Millisecond)
	}

	if !ready {
		log.Printf("Xpra port %d not accessible after 10 seconds. Last error: %v", port, lastErr)
		return nil, fmt.Errorf("xpra started but port %d is not accessible after 10 seconds: %v", port, lastErr)
	}

	session := &XpraSession{
		Display:    display,
		Port:       port,
		AppName:    appName,
		Command:    command,
		Process:    nil, // Daemonized, no process handle
		Attached:   true,
		ServerHost: am.config.ServerHost,
	}

	am.xpraSessions[display] = session

	return session, nil
}

func (am *AppsManager) allocateXpraDisplay() int {
	// Find next available display
	for i := am.config.XpraStartDisplay; i < am.config.XpraStartDisplay+100; i++ {
		if _, exists := am.xpraSessions[i]; !exists {
			return i
		}
	}
	return am.config.XpraStartDisplay
}

func (s *XpraSession) Info() *XpraSessionInfo {
	// Return proxied URL through wmux instead of direct xpra port
	// This allows HTTPS to HTTPS connection (no mixed content)
	return &XpraSessionInfo{
		Display:  s.Display,
		Port:     s.Port,
		AppName:  s.AppName,
		URL:      fmt.Sprintf("/xpra/%d/index.html", s.Display),
		WSURL:    fmt.Sprintf("/xpra/%d/websocket", s.Display),
		Attached: s.Attached,
	}
}

func (s *XpraSession) Stop() error {
	// Run xpra stop command
	cmd := exec.Command("xpra", "stop", fmt.Sprintf(":%d", s.Display))
	output, err := cmd.CombinedOutput()

	if err != nil {
		log.Printf("xpra stop output: %s", string(output))
		return fmt.Errorf("failed to stop xpra display %d: %v", s.Display, err)
	}

	log.Printf("Stopped xpra display :%d - %s", s.Display, string(output))
	return nil
}

// CheckXpraInstalled checks if xpra is available
func CheckXpraInstalled() bool {
	_, err := exec.LookPath("xpra")
	return err == nil
}
