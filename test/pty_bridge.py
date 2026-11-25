import os
import pty
import select
import tty


def write_all(fd, data):
    while data:
        data = data[os.write(fd, data):]


master, slave = pty.openpty()
tty.setraw(slave)
write_all(1, (os.ttyname(slave) + "\n").encode())
while True:
    ready, _, _ = select.select([master, 0], [], [])
    if master in ready:
        try:
            data = os.read(master, 65536)
        except OSError:
            data = b""
        if data:
            write_all(1, data)
    if 0 in ready:
        data = os.read(0, 65536)
        if not data:
            break
        write_all(master, data)
