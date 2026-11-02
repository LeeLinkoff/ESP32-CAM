#!/usr/bin/env python3
"""ESP32-CAM command console: select the CLIENT transport with m (local only)."""

import argparse
import json
import socket
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

try:
    import serial
    from serial.tools import list_ports
except ImportError:
    serial = None
    list_ports = None


MODES = {"usb", "tcp", "http", "bluetooth"}
COMMANDS = """
==========================================================
 ESP32-CAM CLIENT CONSOLE  |  all MCU interfaces coexist
==========================================================
  i                Read camera information
  t                Run camera/firmware self-test
  c                Capture JPEG (Windows default: C:\\temp)
  m                Show THIS CLIENT'S connection mode
  m usb            Auto-find this client's USB serial port
  m tcp            Connect this client to Wi-Fi TCP :3333
  m http           Connect this client to Wi-Fi HTTP :80
  m bluetooth      Auto-find paired Bluetooth SPP COM
  help             Show commands
  q                Quit
----------------------------------------------------------
The m commands NEVER go to the ESP32-CAM. Only i, t, c do.
Close VS Code Serial Monitor before using the same COM port.
"""
MAX_JPEG_BYTES = 4 * 1024 * 1024
RESPONSE_TIMEOUT = 20.0


def normalize_port(value):
    return f"COM{value}" if value.isdecimal() else value


def is_bluetooth_port(entry):
    details = f"{getattr(entry, 'description', '')} {getattr(entry, 'hwid', '')}".lower()
    return "bluetooth" in details or "bthenum" in details


def is_usb_serial_port(entry):
    details = (f"{getattr(entry, 'description', '')} "
               f"{getattr(entry, 'manufacturer', '')} {getattr(entry, 'hwid', '')}").lower()
    return not is_bluetooth_port(entry) and (
        getattr(entry, "vid", None) is not None or
        any(keyword in details for keyword in
            ("esp32", "usb serial", "usb-serial", "usb to uart", "usb uart",
             "cp210", "ch340", "ch341", "ch910", "ftdi"))
    )


def autodetect_serial(baud, label):
    """Locate a serial adapter; do not require a firmware command during startup."""
    if serial is None or list_ports is None:
        raise RuntimeError("Automatic COM detection requires pyserial: py -3 -m pip install pyserial")

    ports = list(list_ports.comports())
    bluetooth = label == "Bluetooth SPP"
    candidates = ([entry for entry in ports if is_bluetooth_port(entry)]
                  if bluetooth else
                  [entry for entry in ports if is_usb_serial_port(entry)])
    if not candidates:
        available = ", ".join(entry.device for entry in ports) or "none"
        raise RuntimeError(f"No {label} serial adapter found (available ports: {available}). "
                           "Check the USB cable, driver, or Bluetooth pairing.")

    # Prefer recognizable camera ports, but confirm with the firmware response.
    candidates.sort(key=lambda entry: (
        "esp32" not in f"{entry.description} {entry.hwid}".lower(),
        entry.device.lower()
    ))
    print(f"Searching {len(candidates)} {label} COM port(s) for the ESP32-CAM...")
    if len(candidates) == 1:
        # Port discovery and firmware protocol detection are separate concerns.
        # The MCU may not implement 'i' or may return plain text instead of JSON.
        entry = candidates[0]
        print(f"  Using {entry.device}: {entry.description}")
        return entry.device, SerialAdapter(entry.device, baud)

    # Multiple adapters: use the information command only to disambiguate.
    for entry in candidates:
        adapter = None
        try:
            print(f"  Checking {entry.device}: {entry.description}")
            adapter = SerialAdapter(entry.device, baud)
            reply, _ = adapter.request("i", timeout=3.0)
            if reply.get("ok") is True and reply.get("cmd") in (None, "i"):
                print(f"  ESP32-CAM confirmed on {entry.device}.")
                return entry.device, adapter
        except (OSError, RuntimeError, ValueError, TimeoutError) as error:
            print(f"  {entry.device}: {error}")
        if adapter is not None:
            adapter.close()
    raise RuntimeError(f"Found multiple {label} serial port(s), but none returned a recognizable "
                       "camera information response. Close other serial monitors or specify a port override.")


def choose_host(configured):
    host = configured or input("ESP32-CAM IPv4 address (e.g. 192.168.1.50): ").strip()
    if not host or any(part in host for part in ("/", "://", "?", "#")):
        raise ValueError("Enter an IP address or hostname, without a URL scheme or path")
    return host


def read_response(reader, timeout=RESPONSE_TIMEOUT):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        line = reader.readline()
        if not line:
            continue
        message = line.decode("utf-8", errors="replace").strip()
        try:
            reply = json.loads(message)
        except json.JSONDecodeError:
            if message:
                print(f"[device] {message}")
            continue
        if isinstance(reply, dict) and isinstance(reply.get("ok"), bool):
            return reply
    raise TimeoutError("Timed out waiting for a JSON response")


def read_jpeg(reader, reply):
    size = reply.get("size")
    if reply.get("mime") != "image/jpeg" or type(size) is not int or not (0 < size <= MAX_JPEG_BYTES):
        raise ValueError(f"Invalid JPEG response header: {reply}")
    image = bytearray()
    deadline = time.monotonic() + max(RESPONSE_TIMEOUT, size / 5000)
    while len(image) < size and time.monotonic() < deadline:
        chunk = reader.read(min(4096, size - len(image)))
        if chunk:
            image.extend(chunk)
    if len(image) != size:
        raise TimeoutError(f"Incomplete JPEG: received {len(image)} of {size} bytes")
    if image[:2] != b"\xff\xd8" or image[-2:] != b"\xff\xd9":
        raise ValueError("JPEG start/end markers invalid")
    return bytes(image)


def stream_reply(reader, command, timeout=RESPONSE_TIMEOUT):
    reply = read_response(reader, timeout=timeout)
    if not reply["ok"]:
        return reply, None
    return reply, read_jpeg(reader, reply) if command == "c" else None


class SerialAdapter:
    def __init__(self, port, baud):
        if serial is None:
            raise RuntimeError("Serial mode requires pyserial: py -3 -m pip install pyserial")
        # Verified with the ESP32-CAM-MB/CH340 diagnostic: DTR=0, RTS=0
        # boots the firmware and answers 'i'; other tested combinations do not.
        self.port = serial.Serial(port=None, baudrate=baud, timeout=0.5,
                                  write_timeout=5, rtscts=False, dsrdtr=False)
        self.port.dtr = False
        self.port.rts = False
        self.port.port = port
        self.port.open()
        self.port.dtr = False
        self.port.rts = False
        time.sleep(0.8)  # Allow USB/UART adapters that reset on open to finish booting.
        self.port.reset_input_buffer()

    def request(self, command, timeout=RESPONSE_TIMEOUT):
        self.port.write((command + "\n").encode("ascii"))
        return stream_reply(self.port, command, timeout=timeout)

    def close(self):
        self.port.close()


class TcpAdapter:
    def __init__(self, host):
        self.socket = socket.create_connection((host, 3333), timeout=5)
        self.socket.settimeout(RESPONSE_TIMEOUT)
        self.reader = self.socket.makefile("rb")

    def request(self, command):
        self.socket.sendall((command + "\n").encode("ascii"))
        return stream_reply(self.reader, command)

    def close(self):
        self.reader.close()
        self.socket.close()


class HttpAdapter:
    def __init__(self, host):
        self.base_url = f"http://{host}"
        with urlopen(f"{self.base_url}/info", timeout=5) as response:
            if not json.load(response).get("ok"):
                raise RuntimeError("Camera HTTP info endpoint returned an error")

    def request(self, command):
        path = {"i": "/info", "t": "/test", "c": "/capture"}[command]
        with urlopen(self.base_url + path, timeout=RESPONSE_TIMEOUT) as response:
            if command != "c":
                return json.load(response), None
            image = response.read(MAX_JPEG_BYTES + 1)
            if not 4 <= len(image) <= MAX_JPEG_BYTES or image[:2] != b"\xff\xd8" or image[-2:] != b"\xff\xd9":
                raise ValueError("Invalid JPEG from camera HTTP endpoint")
            return {"ok": True, "cmd": "c", "mime": "image/jpeg", "size": len(image)}, image

    def close(self):
        pass


class CameraConsole:
    def __init__(self, args):
        self.args = args
        self.mode = None
        self.adapter = None
        self.usb_port = args.port
        self.bt_port = args.bt_port
        self.host = args.host

    def select(self, mode):
        # Local transport selection ONLY: never send an m command to the MCU.
        if mode == "bt":
            mode = "bluetooth"
        if mode not in MODES:
            raise ValueError("Valid transports: usb, tcp, http, bluetooth")
        if mode == self.mode and self.adapter is not None:
            print(f"Already connected via {mode}")
            return
        if mode == "usb":
            if self.usb_port:
                port = normalize_port(self.usb_port)
                new_adapter = SerialAdapter(port, self.args.baud)
            else:
                port, new_adapter = autodetect_serial(self.args.baud, "USB")
            self.usb_port = port
            destination = port
        elif mode == "bluetooth":
            if self.bt_port:
                port = normalize_port(self.bt_port)
                new_adapter = SerialAdapter(port, self.args.baud)
            else:
                port, new_adapter = autodetect_serial(self.args.baud, "Bluetooth SPP")
            self.bt_port = port
            destination = port
        else:
            host = choose_host(self.host)
            new_adapter = TcpAdapter(host) if mode == "tcp" else HttpAdapter(host)
            self.host = host
            destination = f"{host}:{3333 if mode == 'tcp' else 80}"
        old_adapter = self.adapter
        self.adapter = new_adapter
        self.mode = mode
        if old_adapter:
            old_adapter.close()
        print(f"Client connected via {mode.upper()} ({destination}). No MCU mode change.")

    def run(self):
        print(COMMANDS)
        self.select(self.args.mode)
        while True:
            try:
                command = input(f"[{self.mode}] command > ").strip().lower()
            except (EOFError, KeyboardInterrupt):
                print("\nClosing client connection.")
                break
            if command in {"q", "quit", "exit"}:
                break
            if command in {"help", "h", "?"}:
                print(COMMANDS)
                continue
            if command == "m":
                print(f"Client mode: {self.mode}. Firmware services are unchanged.")
                continue
            if command.startswith("m "):
                try:
                    self.select(command[2:].strip())
                except (OSError, RuntimeError, ValueError, TimeoutError, HTTPError, URLError) as error:
                    print(f"ERROR switching client connection: {error}")
                continue
            if command not in {"i", "c", "t"}:
                print("Unknown command. Type 'help'.")
                continue
            try:
                reply, image = self.adapter.request(command)
                print(json.dumps(reply, indent=2))
                if image is not None:
                    directory = Path(self.args.save_dir)
                    directory.mkdir(parents=True, exist_ok=True)
                    destination = directory / f"capture_{datetime.now():%Y%m%d_%H%M%S_%f}.jpg"
                    destination.write_bytes(image)
                    print(f"JPEG saved: {destination} ({len(image):,} bytes)")
                if command == "t":
                    print("SELF-TEST: " + ("PASS" if reply.get("passed") else "FAIL"))
            except (OSError, RuntimeError, ValueError, TimeoutError, HTTPError, URLError) as error:
                print(f"ERROR: {error}")
                print("If a JPEG stream was interrupted, switch away and reconnect before retrying.")
        if self.adapter:
            self.adapter.close()


def main():
    parser = argparse.ArgumentParser(description="ESP32-CAM client transport console")
    parser.add_argument("port", nargs="?", help="Optional USB COM override (normally auto-detected)")
    parser.add_argument("--mode", choices=sorted(MODES), default="usb", help="Initial client transport")
    parser.add_argument("--host", help="ESP32-CAM Wi-Fi IP/hostname (TCP and HTTP)")
    parser.add_argument("--bt-port", help="Paired Bluetooth SPP COM port")
    parser.add_argument("--baud", type=int, default=115200)
    default_dir = Path(r"C:\temp") if sys.platform == "win32" else Path(__file__).resolve().parent / "captures"
    parser.add_argument("--save-dir", default=str(default_dir), help="Destination for JPEG photos")
    args = parser.parse_args()
    try:
        CameraConsole(args).run()
    except (OSError, RuntimeError, ValueError, TimeoutError, HTTPError, URLError) as error:
        print(f"Cannot establish initial connection: {error}")
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
