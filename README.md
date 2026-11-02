# ESP32-CAM control — concurrent USB, Wi-Fi and Bluetooth

This is the **AI Thinker ESP32-CAM** camera project; it is separate from the SnookerIQ IMU/shot-detection code. The object-oriented firmware classes are preserved: `Settings`, `TransportManager`, `CommandProcessor`, `CameraController` and `FirmwareSelfTest`.

Open [ARCHITECTURE.html](ARCHITECTURE.html) in your browser for the SVG architecture diagram. The application consists of PlatformIO/Arduino C++ firmware, a local Node.js/TypeScript backend, and an Angular 21 frontend. The Python console is an independent alternative client.

## Critical behavior: MCU interfaces are always on

The ESP32-CAM starts these services **independently** at boot. Selecting one in Python or Angular/Node does **not** shut down another.

| Connection | Firmware endpoint | When available |
| --- | --- | --- |
| USB serial | USB-to-UART COM, 115200 | Always (with USB/UART adapter attached) |
| Bluetooth Classic SPP | `ESP32-CAM-Control`, paired COM | If Bluetooth starts successfully on the original ESP32 |
| Wi-Fi TCP | ESP32 IPv4, port `3333` | Wi-Fi credentials configured, network connected |
| Wi-Fi HTTP | `http://ESP32_IP/info`, `/test`, `/capture` | Same Wi-Fi connection, **alongside TCP** |

USB and Bluetooth remain available if Wi-Fi disconnects. Wi-Fi reconnects automatically and restarts **both** TCP and HTTP listeners. The MCU accepts one raw TCP client at a time, while its main loop services HTTP, Bluetooth and USB. Camera captures are serialized by the main loop; simultaneous high-throughput streams are not guaranteed on this memory-constrained board.

**`m` is client-only.** In the Python console, `m`, `m usb`, `m tcp`, `m http` and `m bluetooth` select which interface **Python** uses. The console never sends `m` to the MCU. In Angular, the dropdown selects which transport **Node.js** uses. No `/mode` or `/api/device/mode` endpoint exists. The ESP32-CAM accepts only `c`, `i`, `t` over line-oriented transports.

## Firmware build / flash (VS Code + PlatformIO)

1. Open **`firmware/`** (the directory containing `platformio.ini`) as the PlatformIO project.
2. The build environment is `esp32cam`, board `esp32cam`, framework Arduino.
3. For TCP/HTTP, set your **2.4 GHz** Wi-Fi SSID/password in `firmware/include/AppConfig.h`. Leave the SSID empty if you want USB + Bluetooth only. Bluetooth name is also defined there.
4. Build using PlatformIO ✓ or `firmware/build.bat`, then flash using PlatformIO Upload or `firmware/upload.bat`.
5. Use USB serial monitoring at **115200** to see Wi-Fi IP and the startup status messages.

Some USB/UART adapters require GPIO0 LOW to flash; release GPIO0 and reset to boot normally.

### Red LED status

For the AI Thinker ESP32-CAM **red LED on GPIO33** (active LOW):

- During initialization: **100 ms ON, 100 ms OFF**, using an independent FreeRTOS task, so it still blinks while camera startup blocks.
- Once the camera and transport startup finishes: **3 seconds ON, 3 seconds OFF**, repeating.
- If the camera cannot initialize: rapid blinking continues to indicate an error.

This is the **red** status LED, not the white flash LED on GPIO4. Physical hardware verification is still required.

## Python test console

Place `camera_cli.py`, `camera_cli.bat` and `platformio.ini` in the same `firmware/` folder. Close VS Code's Serial Monitor before opening a COM port.

Start with USB (prompts for a port if omitted):

```powershell
.\camera_cli.bat COM4
```

Or start directly on another interface:

```powershell
.\camera_cli.bat --mode tcp --host 192.168.1.50
.\camera_cli.bat --mode http --host 192.168.1.50
.\camera_cli.bat --mode bluetooth --bt-port COM8
```

Replace example ports/IPs with your actual values. Inside the console:

```text
m                 Shows Python's active connection
m tcp             Uses TCP from Python, prompts for ESP32 IP if needed
m http            Uses HTTP from Python
m bluetooth       Uses the paired Bluetooth virtual COM port
m usb             Uses USB COM port
i                 Camera information (sent to MCU)
t                 Firmware self-test (sent to MCU)
c                 Capture JPEG (sent to MCU)
q                 Exit
```

Only `i`, `t` and `c` are sent over the selected link. On Windows, `c` saves JPEG files under **`C:\temp`** by default. Use `--save-dir "D:\CameraShots"` to override. USB and Bluetooth require Python's `pyserial` (`py -3 -m pip install pyserial`); TCP and HTTP use the standard Python library only. `camera_cli.bat` locates an available Python 3 interpreter.

## Node.js + Angular

Run the backend and frontend **in separate terminals**. The backend must remain running for Angular API requests to work.

Backend terminal:

```bash
cd backend
npm install
npm start
```

`npm start` builds TypeScript with `tsc` and runs **`dist/TypeScript/server.js`**. The source entry point is `backend/src/TypeScript/server.ts`. The separate `backend/src/*.js` modules are maintained for JavaScript tests/alternate execution; keep them aligned with their TypeScript equivalents.

Frontend terminal:

```bash
cd frontend
npm install
npm start
```

Open `http://localhost:4200`. USB is the **default client choice**. Select Wi-Fi TCP, Wi-Fi HTTP, or Bluetooth SPP to switch the Node connection. For Wi-Fi, use the ESP32 IP printed on the USB serial monitor. For Bluetooth on Windows, pair `ESP32-CAM-Control` first and select its virtual COM port. **No device mode-setting occurs.**

### Connection lifecycle — no automatic MCU connection

- Starting Node **only opens its HTTP listener** on `127.0.0.1:3000`. It does not open COM4 or send a firmware command.
- Opening Angular **does not automatically call** `/api/ports`, `/api/status`, or `/api/logs`, and it does not connect to the MCU. The initial connection indicator is not a freshly queried Node status; use **Sync Node status** to check an already-running backend.
- Clicking **Connect** explicitly starts the client connection process. For USB/Bluetooth with no COM port selected, Angular first requests the available ports and selects the first one; use **Refresh ports** to verify or choose the correct port when multiple ports exist.
- Connect checks `GET /api/status` first to reuse an existing connection when its transport and target match. Otherwise it uses `POST /api/connect`. It does **not** automatically send an `i` command.
- Once connected, use **Camera info (i)**, **Run self-test (t)**, or **Capture image (c)**. Info results, including the raw JSON, appear in the Camera panel.
- If Node is not listening on port 3000, Angular displays a backend-unavailable error after an explicit request. No MCU connection was attempted. Failed diagnostics polling stops instead of repeatedly retrying against an offline backend.

### Angular rendering, themes, and diagnostics

- The frontend uses **Angular 21 signals with `OnPush` and zoneless change detection**. It does not load Zone.js or rely on manual `detectChanges()` calls. Async HTTP responses update the camera information, button availability, errors, and logs.
- The UI starts in a **light theme** unless a saved dark-theme preference exists; the header button switches themes and remembers the selection in browser storage.
- The **Diagnostics / logs** tab shows browser-side HTTP request/response traces and backend events. **Open logs in new window** opens an independent diagnostics view.
- Logs include COM enumeration/open failures, connection changes, MCU command durations, received camera-info JSON, request IDs, and errors. **Binary JPEG bytes and credentials are not logged.**
- The frontend retains recent UI logs in browser storage; the backend retains up to **500** entries in memory. Use severity filters, text search, refresh, download JSON, and clear logs.
- Backend events can be polled via `GET /api/logs?since=N`; `POST /api/logs/clear` clears backend history. Background refresh is active only in the Diagnostics tab when enabled. The standalone diagnostics pop-out starts with auto-refresh **off**; click **Refresh now** to fetch events and use the checkbox to enable polling. Failed offline polling disables itself.

Backend API calls can be checked without Angular:

```powershell
curl.exe -i http://127.0.0.1:3000/api/status
curl.exe -i http://127.0.0.1:3000/api/help
```

Through the Angular development proxy, use `http://localhost:4200/api/help`. HTTP 200 and JSON indicate the backend is responding through the selected route. `ECONNREFUSED 127.0.0.1:3000` means the development proxy could not reach Node; it does **not** establish a camera or COM-port failure.

The Angular browser cannot directly use raw TCP or Classic Bluetooth SPP; the local Node backend provides those adapters. The backend listens only on `127.0.0.1:3000` and Angular proxies `/api` to it.

## Device protocol

USB serial, Wi-Fi TCP and Bluetooth SPP share this LF-delimited protocol:

```text
CLIENT -> MCU: i\n
MCU -> CLIENT: {"ok":true,"cmd":"i","cameraReady":true,...}\n

CLIENT -> MCU: t\n
MCU -> CLIENT: {"ok":true,"cmd":"t","passed":true,"checks":{...},"details":{...}}\n

CLIENT -> MCU: c\n
MCU -> CLIENT: {"ok":true,"cmd":"c","mime":"image/jpeg","size":12345}\n
MCU -> CLIENT: [exactly 12345 binary JPEG bytes]
```

HTTP provides `GET /info` → JSON, `GET /test` → JSON, and `GET /capture` → `image/jpeg`. No firmware `m` command or `/mode` endpoint is implemented.

Node wraps all transports in these **10 endpoints** (also listed by `GET /api/help`):

| Method and route | Purpose |
| --- | --- |
| `GET /api/help` | JSON documentation of all API routes, methods and examples |
| `GET /api/ports` | List local Windows serial/BT virtual COM ports |
| `POST /api/connect` | Select **Node client** transport (`mode`, `port` or `host`) |
| `POST /api/disconnect` | Disconnect the Node client; do not affect MCU services |
| `GET /api/status` | Node client's current connection status |
| `GET /api/info` | Send `i` and return camera information as JSON |
| `GET /api/test` | Send `t` and return firmware self-test JSON |
| `GET /api/capture` | Send `c` and return `image/jpeg` binary data |
| `GET /api/logs?since=N` | Incremental backend diagnostics and traces |
| `POST /api/logs/clear` | Clear the in-memory backend log history |

Example USB request body for `POST /api/connect`:

```json
{"mode":"usb","port":"COM4"}
```

For TCP/HTTP, use `{"mode":"tcp","host":"192.168.1.50"}` or `{"mode":"http","host":"192.168.1.50"}`. For paired Bluetooth SPP, use `{"mode":"bluetooth","port":"COM8"}`. The selected port/IP must match the connected device.

## Self-tests

`t` or `GET /test` captures a JPEG, verifies camera initialization, sensor presence and JPEG markers. `passed` reflects **camera health**; `details.wifiConfigured` and `details.wifiConnected` are diagnostic, because Wi-Fi is not required for a good camera. PSRAM, heap and frame byte count are also reported. It does not change transport settings.

From `firmware/`, run desktop tests (no MCU needed):

```powershell
pio test -e native
py -3 -m unittest test_camera_cli.py
```

Windows PlatformIO `native` requires `gcc`/`g++` on PATH. To build ESP32 firmware use `pio run -e esp32cam`. Node backend TypeScript build/tests: `cd backend` then `npm run build` / `npm test`. Angular build: `cd frontend` then `npm run build`.

Compilation and unit tests do not prove live USB/COM4 behavior. Verify the runtime separately with Python, direct Node API calls, and the Angular Camera panel.

## Limitations / safety

- USB camera information has been exercised with the Python console. Verify the latest end-to-end Angular UI flow, red LED timing, JPEG capture, Bluetooth pairing and concurrent Wi-Fi/BT behavior on the actual board.
- ESP32 Wi-Fi and Bluetooth Classic share the 2.4 GHz radio and hardware memory; coexistence is supported, but throughput and connection stability depend on RF conditions, camera resolution and available heap.
- HTTP and raw TCP listeners have **no TLS, authentication or authorization**. Use only on a trusted local LAN; do not port-forward them to the internet.
- The Node backend is local-loopback only. Secure it before any remote exposure.
- Bluetooth Classic SPP is supported on **original ESP32**, not on all ESP32-S3 variants.
- No Wi-Fi provisioning UI or access point is included; credentials are compile-time settings in `AppConfig.h`.
