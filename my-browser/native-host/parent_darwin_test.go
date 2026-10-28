package main

import (
	"errors"
	"strings"
	"testing"
)

// Bug regression (2026-10-28): Chrome had updated on disk but was not relaunched; dynamic
// validation of the running browser failed and every binding was refused until a restart.
func TestVerifyParentAcceptsUpdatedButRunningBrowser(t *testing.T) {
	const chrome = "Executable=/Applications/Google Chrome.app/Contents/MacOS/Google Chrome\nIdentifier=com.google.Chrome\nFormat=app bundle with Mach-O thin (arm64)\nTeamIdentifier=EQHXZ8M8AV\n"
	cases := []struct {
		name     string
		verify   map[string]string // target -> failure text ("" = passes)
		info     string
		ok       bool
		staticOk bool
	}{
		{"running browser validates", map[string]string{"4242": ""}, chrome, true, false},
		{"updated on disk, identity and file still ours", map[string]string{"4242": "4242: the code on disk does not match what is running", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome": ""}, chrome, true, true},
		{"updated on disk but file no longer validates", map[string]string{"4242": "4242: the code on disk does not match what is running", "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome": "code object is not signed at all"}, chrome, false, true},
		{"updated on disk but running identity is not a browser", map[string]string{"4242": "4242: the code on disk does not match what is running"}, strings.Replace(chrome, "com.google.Chrome\n", "com.example.app\n", 1), false, false},
		{"team does not match the identifier", map[string]string{"4242": "4242: the code on disk does not match what is running"}, strings.Replace(chrome, "EQHXZ8M8AV", "UBF8T346G9", 1), false, false},
		{"any other dynamic failure is refused", map[string]string{"4242": "4242: code failed to satisfy specified code requirement(s)"}, chrome, false, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			staticChecked := false
			codesign = func(args ...string) ([]byte, error) {
				if args[0] == "-d" {
					return []byte(c.info), nil
				}
				target := args[len(args)-1]
				if strings.HasPrefix(target, "/") {
					staticChecked = true
				}
				msg, known := c.verify[target]
				if !known || msg != "" {
					if msg == "" {
						msg = "unexpected target " + target
					}
					return []byte(msg), errors.New("exit status 1")
				}
				return nil, nil
			}
			err := verifyParent("4242")
			if (err == nil) != c.ok {
				t.Fatalf("ok=%v want %v (err=%v)", err == nil, c.ok, err)
			}
			if staticChecked != c.staticOk {
				t.Fatalf("static file check ran=%v want %v", staticChecked, c.staticOk)
			}
		})
	}
}

func TestSignedIdentityParsesCodesignOutput(t *testing.T) {
	exe, id, team := signedIdentity([]byte("Executable=/Applications/Brave Browser.app/Contents/MacOS/Brave Browser\nIdentifier=com.brave.Browser\nTeamIdentifier=KL8N8XSYF4\n"))
	if exe != "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser" || id != "com.brave.Browser" || team != "KL8N8XSYF4" {
		t.Fatalf("got %q %q %q", exe, id, team)
	}
}
