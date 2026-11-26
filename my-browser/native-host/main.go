// Native Messaging bootstrap only. Page data and model requests never use this process.
package main

import (
	"bytes"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"time"
)

const hostName = "com.makecindy.browser"

var identity = regexp.MustCompile(`^chrome-extension://[a-p]{32}/$`)

type binding struct {
	Port   int    `json:"port"`
	Client string `json:"clientId"`
	Key    string `json:"publicKey"`
}
type endpoint struct {
	Token string `json:"token"`
}

func main() {
	timer := time.AfterFunc(15*time.Second, func() { os.Exit(1) })
	defer timer.Stop()
	result := map[string]any{"ok": false, "error": "NATIVE_BINDING_FAILED"}
	if err := run(); err == nil {
		result = map[string]any{"ok": true}
	} else {
		fmt.Fprintln(os.Stderr, "Cindy browser binding unavailable")
		if err.Error() == "BROWSER_CALLER_UNVERIFIED" {
			result["error"] = err.Error()
		}
	}
	data, _ := json.Marshal(result)
	_ = binary.Write(os.Stdout, binary.LittleEndian, uint32(len(data)))
	_, _ = os.Stdout.Write(data)
}
func run() error {
	if len(os.Args) < 2 || !identity.MatchString(os.Args[1]) {
		return errors.New("origin")
	}
	if err := browserParent(); err != nil {
		return errors.New("BROWSER_CALLER_UNVERIFIED")
	}
	var size uint32
	if binary.Read(os.Stdin, binary.LittleEndian, &size) != nil || size == 0 || size > 8192 {
		return errors.New("size")
	}
	raw := make([]byte, size)
	if _, err := io.ReadFull(os.Stdin, raw); err != nil {
		return err
	}
	var b binding
	if json.Unmarshal(raw, &b) != nil || b.Port < 18810 || b.Port > 18909 || !regexp.MustCompile(`^[a-f0-9-]{36}$`).MatchString(b.Client) || len(b.Key) > 2048 || !regexp.MustCompile(`^[A-Za-z0-9_-]+$`).MatchString(b.Key) {
		return errors.New("binding")
	}
	// Config is installed next to the executable by Cindy, not supplied in browser input.
	exe, err := os.Executable()
	if err != nil {
		return err
	}
	f := filepath.Join(filepath.Dir(exe), "connections", strconv.Itoa(b.Port)+".json")
	raw, err = os.ReadFile(f)
	if err != nil || len(raw) > 1024 {
		return errors.New("endpoint")
	}
	var ep endpoint
	if json.Unmarshal(raw, &ep) != nil || !regexp.MustCompile(`^[a-f0-9]{64}$`).MatchString(ep.Token) {
		return errors.New("token")
	}
	payload, _ := json.Marshal(map[string]any{"clientId": b.Client, "publicKey": b.Key, "origin": strings.TrimSuffix(os.Args[1], "/")})
	req, _ := http.NewRequest("POST", "http://127.0.0.1:"+strconv.Itoa(b.Port)+"/native/bind", bytes.NewReader(payload))
	req.Header.Set("Authorization", "Bearer "+ep.Token)
	req.Header.Set("Content-Type", "application/json")
	// Never route bootstrap credentials through the user's proxy or follow redirects.
	client := &http.Client{Transport: &http.Transport{Proxy: nil}, Timeout: 5 * time.Second, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
	res, err := client.Do(req)
	if err != nil {
		return err
	}
	defer res.Body.Close()
	if res.StatusCode != http.StatusOK {
		return errors.New("denied")
	}
	return nil
}
