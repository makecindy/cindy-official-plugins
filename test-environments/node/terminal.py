#!/usr/bin/env python3
"""A real, owned PTY for interactive development tools; no desktop Terminal UI."""
import errno
import fcntl
import os
import pty
import select
import signal
import struct
import sys
import termios
import time

child, master = pty.fork()
if child == 0:
    fcntl.ioctl(0, termios.TIOCSWINSZ, struct.pack('HHHH', 40, 120, 0, 0))
    os.environ.setdefault('TERM', 'xterm-256color')
    os.execvp(sys.argv[1], sys.argv[1:])

stopping_at = None
reaped = False

def forward(sig, _frame):
    global stopping_at
    if not reaped:
        try:
            os.killpg(child, sig)
        except ProcessLookupError:
            pass
    if stopping_at is None:
        stopping_at = time.monotonic()

signal.signal(signal.SIGTERM, forward)
signal.signal(signal.SIGINT, forward)
signal.signal(signal.SIGHUP, forward)
while True:
    ready, _, _ = select.select([master], [], [], 0.05)
    if ready:
        try:
            data = os.read(master, 65536)
            if data:
                os.write(1, data)
        except OSError as exc:
            if exc.errno != errno.EIO:
                raise
    ended, status = os.waitpid(child, os.WNOHANG)
    if ended:
        reaped = True
        os.close(master)
        sys.exit(os.waitstatus_to_exitcode(status) if os.WIFEXITED(status) else 128 + os.WTERMSIG(status))
    if stopping_at is not None and time.monotonic() - stopping_at > 4:
        try:
            os.killpg(child, signal.SIGKILL)
        except ProcessLookupError:
            pass
