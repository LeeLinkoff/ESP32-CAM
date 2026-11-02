"""Run: python -m unittest test_camera_cli.py (no MCU required)."""

import io
import json
import unittest
from contextlib import redirect_stdout
from types import SimpleNamespace
from unittest.mock import patch

from camera_cli import CameraConsole, HttpAdapter, autodetect_serial


class FakeAdapter:
    def __init__(self, label):
        self.label = label
        self.commands = []
        self.closed = False

    def request(self, command, timeout=None):
        self.commands.append(command)
        return getattr(self, "reply", {"ok": True, "cmd": command}), None

    def close(self):
        self.closed = True


class CameraCliTests(unittest.TestCase):
    def test_initial_usb_connection_autodetects_without_prompt(self):
        args = SimpleNamespace(port=None, bt_port=None, host=None,
                               baud=115200, mode="usb", save_dir="captures")
        adapter = FakeAdapter("USB")
        console = CameraConsole(args)
        with (patch("camera_cli.autodetect_serial", return_value=("COM7", adapter)) as discover,
              patch("builtins.input", side_effect=["q"]),
              redirect_stdout(io.StringIO())):
            console.run()
        discover.assert_called_once_with(115200, "USB")
        self.assertEqual(console.usb_port, "COM7")
        self.assertTrue(adapter.closed)

    def test_autodetect_probes_usb_candidates_and_confirms_camera(self):
        ports = [
            SimpleNamespace(device="COM1", description="Communications Port", hwid="ACPI", vid=None),
            SimpleNamespace(device="COM6", description="USB-SERIAL CH340", hwid="USB VID:PID=1A86:7523", vid=0x1A86),
            SimpleNamespace(device="COM8", description="Silicon Labs CP210x", hwid="USB VID:PID=10C4:EA60", vid=0x10C4),
        ]
        rejected = FakeAdapter("not camera")
        rejected.reply = {"ok": False, "error": "unknown command"}
        confirmed = FakeAdapter("camera")

        def open_port(port, baud):
            self.assertEqual(baud, 115200)
            return {"COM6": rejected, "COM8": confirmed}[port]

        with (patch("camera_cli.serial", object()),
              patch("camera_cli.list_ports", SimpleNamespace(comports=lambda: ports)),
              patch("camera_cli.SerialAdapter", side_effect=open_port) as serial_adapter,
              patch("builtins.input", side_effect=AssertionError("COM detection must not prompt")),
              redirect_stdout(io.StringIO())):
            port, adapter = autodetect_serial(115200, "USB")
        self.assertEqual(port, "COM8")
        self.assertIs(adapter, confirmed)
        self.assertEqual([call.args[0] for call in serial_adapter.call_args_list], ["COM6", "COM8"])
        self.assertEqual(rejected.commands, ["i"])
        self.assertTrue(rejected.closed)
        self.assertFalse(confirmed.closed)

    def test_bluetooth_detection_ignores_usb_ports(self):
        ports = [
            SimpleNamespace(device="COM4", description="USB-SERIAL CH340", hwid="USB VID:PID", vid=0x1A86),
            SimpleNamespace(device="COM12", description="Standard Serial over Bluetooth link", hwid="BTHENUM", vid=None),
        ]
        bluetooth = FakeAdapter("bluetooth")
        with (patch("camera_cli.serial", object()),
              patch("camera_cli.list_ports", SimpleNamespace(comports=lambda: ports)),
              patch("camera_cli.SerialAdapter", return_value=bluetooth) as serial_adapter,
              redirect_stdout(io.StringIO())):
            port, adapter = autodetect_serial(115200, "Bluetooth SPP")
        self.assertEqual(port, "COM12")
        self.assertIs(adapter, bluetooth)
        serial_adapter.assert_called_once_with("COM12", 115200)

    def test_m_changes_only_local_adapter(self):
        args = SimpleNamespace(
            port="COM4", bt_port="COM8", host="192.0.2.42", baud=115200,
            mode="usb", save_dir="captures",
        )
        usb = FakeAdapter("usb")
        tcp = FakeAdapter("tcp")
        console = CameraConsole(args)
        with (patch("camera_cli.SerialAdapter", return_value=usb),
              patch("camera_cli.TcpAdapter", return_value=tcp),
              patch("builtins.input", side_effect=["m tcp", "m", "i", "q"]),
              redirect_stdout(io.StringIO())):
            console.run()
        self.assertEqual(console.mode, "tcp")
        self.assertEqual(usb.commands, [])
        self.assertEqual(tcp.commands, ["i"])
        self.assertTrue(usb.closed)
        self.assertTrue(tcp.closed)

    def test_http_adapter_uses_info_test_capture_endpoints(self):
        jpeg = b"\xff\xd8payload\xff\xd9"
        opened = []

        def fake_urlopen(url, timeout):
            opened.append(url)
            if url.endswith("/capture"):
                return io.BytesIO(jpeg)
            if url.endswith("/test"):
                return io.BytesIO(json.dumps({"ok": True, "cmd": "t", "passed": True}).encode())
            return io.BytesIO(b'{"ok":true,"cmd":"i"}')

        with patch("camera_cli.urlopen", side_effect=fake_urlopen):
            adapter = HttpAdapter("192.0.2.42")
            report, image = adapter.request("c")
            self.assertEqual(image, jpeg)
            self.assertEqual(report["size"], len(jpeg))
            self.assertTrue(adapter.request("t")[0]["passed"])
        self.assertEqual(opened, [
            "http://192.0.2.42/info",
            "http://192.0.2.42/capture",
            "http://192.0.2.42/test",
        ])


if __name__ == "__main__":
    unittest.main()
