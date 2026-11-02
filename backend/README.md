# ESP32-CAM Node.js backend — TypeScript conversion

These files convert `ConnectionManager.js`, `FrameChannel.js`, and `server.js` to TypeScript while retaining the existing routes and device protocols.

## Copy into the existing backend

1. Copy the three `.ts` files in `src/` to your existing `backend/src/` folder.
2. Copy `tsconfig.json` to `backend/`.
3. In your *existing* `backend/package.json`, keep its current dependencies and use these scripts (merge, do not replace the entire file):

```json
"scripts": {
  "build": "tsc -p tsconfig.json",
  "start": "node dist/server.js"
}
```

4. Ensure your existing `package.json` includes `"type": "module"` for ES module output. Keep any other existing fields.
5. From the backend directory, run:

```cmd
npm install
npm install serialport
npm install --save-dev typescript @types/node
npm run build
npm start
```

The emitted files will be in `dist/`. The `.js` extensions in TypeScript relative imports are deliberate for Node.js ES modules.

**Behavior retained:** `/api/status`, `/api/ports`, `/api/connect`, `/api/disconnect`, `/api/info`, `/api/capture`, `/api/device/mode`, serial/USB, Bluetooth SPP, TCP, and HTTP.

**Important:** The original `ConnectionManager.js` sends a device `m <mode>` command when the selected transport changes. That behavior is unchanged by this TypeScript conversion. It is separate from the question of whether transport selection should also change device firmware mode.
