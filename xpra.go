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

	// Build xpra command - just pass the command directly to xpra
	args := []string{
		"start",
		fmt.Sprintf(":%d", display),
		fmt.Sprintf("--bind-tcp=0.0.0.0:%d", port),
		"--html=on",
		"--auth=none",
		fmt.Sprintf("--start=%s", command),
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
	log.Printf("Waiting for xpra to be ready on port %d...", port)
	ready := false
	var lastErr error
	for i := 0; i < 100; i++ { // Try for 10 seconds (100 * 100ms)
		conn, err := net.DialTimeout("tcp", fmt.Sprintf("localhost:%d", port), 200*time.Millisecond)
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
		URL:      fmt.Sprintf("/xpra/%d/", s.Display),
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
