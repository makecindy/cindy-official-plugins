package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"syscall"
)

func browserParent() error {
	// Query the immediate parent and verify its Authenticode publisher. No path or
	// script text comes from the extension message or command-line origin.
	script := fmt.Sprintf(`$ErrorActionPreference='Stop'; $p=Get-CimInstance Win32_Process -Filter 'ProcessId = %d'; $exe=$p.ExecutablePath; if ($exe -ieq (Join-Path $env:SystemRoot 'System32\cmd.exe')) {$p=Get-CimInstance Win32_Process -Filter ('ProcessId = '+$p.ParentProcessId);$exe=$p.ExecutablePath}; $name=[IO.Path]::GetFileName($exe); $s=Get-AuthenticodeSignature -LiteralPath $exe; if ($s.Status -ne 'Valid') {exit 1}; $signer=$s.SignerCertificate.GetNameInfo([System.Security.Cryptography.X509Certificates.X509NameType]::SimpleName,$false); $ok=($name -ieq 'chrome.exe' -and $signer -eq 'Google LLC') -or ($name -ieq 'msedge.exe' -and $signer -eq 'Microsoft Corporation') -or ($name -ieq 'brave.exe' -and $signer -eq 'Brave Software, Inc.') -or ($name -ieq 'Tabbit Browser.exe' -and $signer -eq '北京三快在线科技有限公司'); if (-not $ok) {exit 1}`, os.Getppid())
	cmd := exec.Command(filepath.Join(os.Getenv("SystemRoot"), "System32", "WindowsPowerShell", "v1.0", "powershell.exe"), "-NoProfile", "-NonInteractive", "-Command", script)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000}
	return cmd.Run()
}
