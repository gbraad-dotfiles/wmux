package main

import (
	"fmt"
	"os"
	"os/exec"
)

type XpraSession struct {
	Display    int
	Port       int
	AppName    string
	Command    string
	Process    *os.Process
	Attached   bool
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
	// Allocate display
	display := am.allocateXpraDisplay()
	port := am.config.XpraStartPort + display - am.config.XpraStartDisplay

	// Start Xpra session
	cmd := exec.Command("xpra", "start",
		fmt.Sprintf(":%d", display),
		fmt.Sprintf("--bind-tcp=0.0.0.0:%d", port),
		"--html=on",
		fmt.Sprintf("--start=%s", command),
		"--daemon=no",
	)

	err := cmd.Start()
	if err != nil {
		return nil, fmt.Errorf("failed to start xpra: %v", err)
	}

	session := &XpraSession{
		Display:  display,
		Port:     port,
		AppName:  appName,
		Command:  command,
		Process:  cmd.Process,
		Attached: true,
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
	return &XpraSessionInfo{
		Display:  s.Display,
		Port:     s.Port,
		AppName:  s.AppName,
		URL:      fmt.Sprintf("http://localhost:%d", s.Port),
		WSURL:    fmt.Sprintf("ws://localhost:%d/websocket", s.Port),
		Attached: s.Attached,
	}
}

func (s *XpraSession) Stop() error {
	if s.Process != nil {
		return s.Process.Kill()
	}
	return nil
}

// CheckXpraInstalled checks if xpra is available
func CheckXpraInstalled() bool {
	_, err := exec.LookPath("xpra")
	return err == nil
}
