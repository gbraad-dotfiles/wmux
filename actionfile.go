package main

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"strings"
)

type App struct {
	Name    string
	Title   string
	Path    string
	Vars    map[string]string
	Actions map[string]*Action
	Shared  string // Shared code block
}

type Action struct {
	Name    string
	Aliases []string
	Code    string
	Type    string // "sh", "ini", etc.
}

type ExecutionResult struct {
	Output   string `json:"output"`
	ExitCode int    `json:"exit_code"`
	Error    string `json:"error,omitempty"`
}

// ParseActionFile parses a markdown actionfile
func ParseActionFile(path string) (*App, error) {
	content, err := os.ReadFile(path)
	if err != nil {
		return nil, err
	}

	name := filepath.Base(path)
	name = strings.TrimSuffix(name, ".md")

	app := &App{
		Name:    name,
		Path:    path,
		Vars:    make(map[string]string),
		Actions: make(map[string]*Action),
	}

	// Parse markdown
	lines := strings.Split(string(content), "\n")

	var currentAction *Action
	var currentCode bytes.Buffer
	var inCodeBlock bool
	var codeType string

	for i := 0; i < len(lines); i++ {
		line := lines[i]

		// H1 - App title
		if strings.HasPrefix(line, "# ") && app.Title == "" {
			app.Title = strings.TrimPrefix(line, "# ")
			continue
		}

		// H3 - Action name
		if strings.HasPrefix(line, "### ") {
			// Save previous action if exists
			if currentAction != nil && inCodeBlock {
				currentAction.Code = currentCode.String()
				inCodeBlock = false
				currentCode.Reset()
			}
			if currentAction != nil {
				app.addAction(currentAction)
			}

			// Parse action name and aliases
			actionLine := strings.TrimPrefix(line, "### ")
			parts := strings.Fields(actionLine)

			currentAction = &Action{
				Name:    parts[0],
				Aliases: parts[1:],
			}
			continue
		}

		// Code block start
		if strings.HasPrefix(line, "```") {
			if !inCodeBlock {
				// Starting code block
				inCodeBlock = true
				codeType = strings.TrimPrefix(line, "```")
				codeType = strings.TrimSpace(codeType)

				// Remove "evaluate" modifier if present
				codeType = strings.Replace(codeType, " evaluate", "", 1)

				if currentAction != nil {
					currentAction.Type = codeType
				}
			} else {
				// Ending code block
				if currentAction != nil {
					currentAction.Code = currentCode.String()
				}
				inCodeBlock = false
				currentCode.Reset()
			}
			continue
		}

		// Inside code block
		if inCodeBlock {
			currentCode.WriteString(line)
			currentCode.WriteString("\n")
		}
	}

	// Save last action
	if currentAction != nil {
		if inCodeBlock {
			currentAction.Code = currentCode.String()
		}
		app.addAction(currentAction)
	}

	// Parse vars from "vars" action if exists
	if varsAction, exists := app.Actions["vars"]; exists {
		app.parseVars(varsAction.Code)
	}

	// Store shared code
	if sharedAction, exists := app.Actions["shared"]; exists {
		app.Shared = sharedAction.Code
	}

	return app, nil
}

func (a *App) addAction(action *Action) {
	// Add primary action name
	a.Actions[action.Name] = action

	// Add aliases
	for _, alias := range action.Aliases {
		a.Actions[alias] = action
	}
}

// parseVars extracts variables from shell code
func (a *App) parseVars(code string) {
	lines := strings.Split(code, "\n")
	// Allow both uppercase and lowercase variable names
	re := regexp.MustCompile(`^([A-Za-z_][A-Za-z0-9_]*)=(.+)$`)

	for _, line := range lines {
		line = strings.TrimSpace(line)
		if matches := re.FindStringSubmatch(line); matches != nil {
			varName := matches[1]
			varValue := matches[2]

			// Remove quotes if present
			varValue = strings.Trim(varValue, `"'`)

			a.Vars[varName] = varValue
		}
	}
}

func (a *App) ListActions() []string {
	seen := make(map[string]bool)
	actions := make([]string, 0)

	for name, action := range a.Actions {
		// Only list primary names (not aliases)
		if name == action.Name && !seen[name] {
			actions = append(actions, name)
			seen[name] = true
		}
	}

	return actions
}

func (a *App) ExecuteAction(actionName string, target string, mode string) (*ExecutionResult, error) {
	action, exists := a.Actions[actionName]
	if !exists {
		return nil, fmt.Errorf("action '%s' not found", actionName)
	}

	// Prepare environment
	env := os.Environ()

	// Add vars from actionfile
	for k, v := range a.Vars {
		env = append(env, fmt.Sprintf("%s=%s", k, v))
	}

	// Add APPNAME
	env = append(env, fmt.Sprintf("APPNAME=%s", a.Name))

	// Prepare script
	script := ""

	// Include shared code if exists
	if a.Shared != "" {
		script += a.Shared + "\n\n"
	}

	// Add the action code
	script += action.Code

	// Determine execution mode
	if mode == "xpra" {
		// Xpra mode - return command for xpra execution
		return &ExecutionResult{
			Output:   fmt.Sprintf("Xpra mode: command prepared for %s", a.Name),
			ExitCode: 0,
		}, nil
	} else if target != "" {
		// Terminal app - run in tmux
		return a.executeInTmux(script, env, target)
	} else {
		// Non-interactive - run directly (for check, install, etc.)
		return a.executeDirect(script, env)
	}
}

func (a *App) executeInTmux(script string, env []string, target string) (*ExecutionResult, error) {
	sessionName := target
	if target == "new" {
		sessionName = a.Name
	}

	// Get user's shell
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}

	// Escape single quotes in script
	escapedScript := strings.ReplaceAll(script, "'", "'\\''")

	// Create environment setup commands
	envSetup := ""
	for _, e := range env {
		if strings.HasPrefix(e, "APPNAME=") || strings.HasPrefix(e, "APPTITLE=") {
			envSetup += fmt.Sprintf("export %s; ", e)
		}
	}

	// Build full script
	fullScript := fmt.Sprintf("%s%s", envSetup, escapedScript)

	var tmuxCmd *exec.Cmd
	if target == "new" {
		// Create new session with the command
		tmuxCmd = exec.Command("tmux", "new-session", "-d", "-s", sessionName,
			shell, "-l", "-c", fullScript)
	} else {
		// Create new window in existing session with the command
		tmuxCmd = exec.Command("tmux", "new-window", "-t", sessionName, "-n", a.Name,
			shell, "-l", "-c", fullScript)
	}

	output, err := tmuxCmd.CombinedOutput()
	exitCode := 0
	errMsg := ""

	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		}
		errMsg = err.Error()
	}

	return &ExecutionResult{
		Output:   fmt.Sprintf("Launched '%s' in tmux session '%s'\n%s", a.Name, sessionName, string(output)),
		ExitCode: exitCode,
		Error:    errMsg,
	}, nil
}

func (a *App) executeDirect(script string, env []string) (*ExecutionResult, error) {
	// Execute directly (for non-interactive commands like check, install)
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/bash"
	}

	cmd := exec.Command(shell, "-c", script)
	cmd.Env = env

	output, err := cmd.CombinedOutput()
	exitCode := 0
	errMsg := ""

	if err != nil {
		if exitErr, ok := err.(*exec.ExitError); ok {
			exitCode = exitErr.ExitCode()
		}
		errMsg = err.Error()
	}

	return &ExecutionResult{
		Output:   string(output),
		ExitCode: exitCode,
		Error:    errMsg,
	}, nil
}

// HasAction checks if action exists
func (a *App) HasAction(name string) bool {
	_, exists := a.Actions[name]
	return exists
}
