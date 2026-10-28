package main

import (
	"bytes"
	"fmt"
	"os"
	"os/exec"
	"strings"
)

// Signed browsers allowed to drive the binding; the team is the certificate's subject.OU.
const browserRequirement = `anchor apple generic and ((certificate leaf[subject.OU] = "EQHXZ8M8AV" and (identifier "com.google.Chrome" or identifier "com.google.Chrome.forTesting")) or (certificate leaf[subject.OU] = "UBF8T346G9" and identifier "com.microsoft.edgemac") or (certificate leaf[subject.OU] = "KL8N8XSYF4" and identifier "com.brave.Browser"))`

var browserIdentities = map[string]string{
	"com.google.Chrome":            "EQHXZ8M8AV",
	"com.google.Chrome.forTesting": "EQHXZ8M8AV",
	"com.microsoft.edgemac":        "UBF8T346G9",
	"com.brave.Browser":            "KL8N8XSYF4",
}

// codesign runs the system tool; tests substitute it.
var codesign = func(args ...string) ([]byte, error) {
	return exec.Command("/usr/bin/codesign", args...).CombinedOutput()
}

func browserParent() error {
	return verifyParent(fmt.Sprint(os.Getppid()))
}

// verifyParent validates the kernel process identity of the caller, never argv or ps paths.
func verifyParent(pid string) error {
	out, err := codesign("--verify", "-R", "="+browserRequirement, pid)
	if err == nil {
		return nil
	}
	// Chrome, Edge and Brave replace their bundle on disk while still running; until the user
	// relaunches, dynamic validation of the live process fails with exactly this condition even
	// though the running image is the signed browser the kernel started. Accept it only when the
	// running image carries one of our browser identities and the executable it was started from
	// still satisfies the full requirement.
	if !bytes.Contains(out, []byte("does not match what is running")) {
		return err
	}
	info, derr := codesign("-d", "-vv", pid)
	if derr != nil {
		return err
	}
	exe, identifier, team := signedIdentity(info)
	if exe == "" || browserIdentities[identifier] == "" || browserIdentities[identifier] != team {
		return err
	}
	if _, verr := codesign("--verify", "-R", "="+browserRequirement, exe); verr != nil {
		return verr
	}
	return nil
}

// signedIdentity reads the executable path and signed identity codesign prints for a process.
func signedIdentity(info []byte) (exe, identifier, team string) {
	for _, line := range strings.Split(string(info), "\n") {
		line = strings.TrimSpace(line)
		switch {
		case strings.HasPrefix(line, "Executable="):
			exe = strings.TrimPrefix(line, "Executable=")
		case strings.HasPrefix(line, "Identifier="):
			identifier = strings.TrimPrefix(line, "Identifier=")
		case strings.HasPrefix(line, "TeamIdentifier="):
			team = strings.TrimPrefix(line, "TeamIdentifier=")
		}
	}
	return exe, identifier, team
}
