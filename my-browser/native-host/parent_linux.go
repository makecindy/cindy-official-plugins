package main

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
)

func browserParent() error {
	exe, err := os.Readlink(fmt.Sprintf("/proc/%d/exe", os.Getppid()))
	if err != nil {
		return err
	}
	allowed := map[string]bool{"/opt/google/chrome/chrome": true, "/opt/google/chrome-for-testing/chrome": true, "/usr/lib/chromium/chromium": true, "/usr/lib/chromium-browser/chromium-browser": true, "/opt/microsoft/msedge/msedge": true, "/opt/brave.com/brave/brave": true}
	if !allowed[exe] {
		return errors.New("browser")
	}
	// Executable and ancestors must be root-owned and not writable by other users.
	for p := exe; ; p = filepath.Dir(p) {
		s, e := os.Stat(p)
		if e != nil {
			return e
		}
		st, ok := s.Sys().(*syscall.Stat_t)
		if !ok || st.Uid != 0 || s.Mode().Perm()&0022 != 0 {
			return errors.New("ownership")
		}
		if p == "/" {
			break
		}
	}
	return nil
}
