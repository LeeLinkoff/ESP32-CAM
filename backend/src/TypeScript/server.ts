// @ts-nocheck
// TypeScript runtime copy of ../server.js; keep behavior aligned with the Node tests.
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { ConnectionManager } from './ConnectionManager.js';
import { DiagnosticsLog } from './DiagnosticsLog.js';

const diagnostics = new DiagnosticsLog();
const camera = new ConnectionManager(diagnostics);
const port = Number(process.env.PORT || 3000);
let nextRequestId = 0;

const apiHelp = {
  name: 'ESP32-CAM Control API',
  basePath: '/api',
  endpoints: [
    { method: 'GET', path: '/api/help', description: 'List every available API endpoint.' },
    { method: 'GET', path: '/api/status', description: 'Get current client connection status.' },
    { method: 'GET', path: '/api/ports', description: 'List available serial/COM ports.' },
    { method: 'POST', path: '/api/connect', description: 'Connect the client to the selected transport.',
      body: { mode: 'usb | bluetooth | tcp | http', port: 'COM4 (USB/Bluetooth)', host: 'device IP (TCP/HTTP)' } },
    { method: 'POST', path: '/api/disconnect', description: 'Disconnect the current client transport.', body: {} },
    { method: 'GET', path: '/api/info', description: 'Send i to the camera and return its information as JSON.' },
    { method: 'GET', path: '/api/test', description: 'Run camera firmware self-tests (t) and return JSON.' },
    { method: 'GET', path: '/api/capture', description: 'Capture an image (c) and return image/jpeg bytes.' },
    { method: 'GET', path: '/api/logs', description: 'Read backend diagnostic events.', query: '?since=0' },
    { method: 'POST', path: '/api/logs/clear', description: 'Clear in-memory backend diagnostic events.', body: {} }
  ]
};

const json = (response, code, value) => {
  response.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
};

async function readJson(request) {
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 4096) throw new Error('Request body is too large');
  }
  return body ? JSON.parse(body) : {};
}

const server = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost');
  const path = url.pathname;
  const requestId = `api-${Date.now().toString(36)}-${++nextRequestId}`;
  const started = Date.now();
  const traceRequest = path !== '/api/logs';
  response.setHeader('X-Request-ID', requestId);
  response.once('finish', () => {
    if (traceRequest) diagnostics.info('api', 'HTTP response finished', {
      requestId, method: request.method, path, statusCode: response.statusCode,
      elapsedMs: Date.now() - started
    });
  });
  response.once('close', () => {
    if (traceRequest && !response.writableFinished) diagnostics.error('api', 'HTTP response closed before completion', {
      requestId, method: request.method, path, statusCode: response.statusCode,
      elapsedMs: Date.now() - started
    });
  });
  request.once('aborted', () => diagnostics.warn('api', 'Browser/proxy aborted HTTP request', {
    requestId, method: request.method, path, elapsedMs: Date.now() - started
  }));
  try {
    if (request.method === 'GET' && path === '/api/logs') {
      const since = Number(url.searchParams.get('since') || '0');
      const afterId = Number.isSafeInteger(since) && since >= 0 ? since : 0;
      return json(response, 200, diagnostics.list(afterId));
    }
    if (request.method === 'POST' && path === '/api/logs/clear') {
      diagnostics.clear();
      return json(response, 200, diagnostics.list());
    }
    if (traceRequest) {
      diagnostics.info('api', 'HTTP request received', { requestId, method: request.method, path });
    }
    if (request.method === 'GET' && path === '/api/help') return json(response, 200, apiHelp);
    if (request.method === 'GET' && path === '/api/status') {
      const status = camera.status();
      diagnostics.info('api', 'Connection status returned to Angular', {
        requestId, connected: status.connected, mode: status.mode, port: status.port, host: status.host
      });
      return json(response, 200, { ...status, requestId });
    }
    if (request.method === 'GET' && path === '/api/ports') return json(response, 200, await camera.ports());
    if (request.method === 'POST' && path === '/api/connect') {
      const config = await readJson(request);
      diagnostics.info('api', 'Angular requested transport connection', {
        requestId, mode: config.mode, port: config.port, host: config.host
      });
      const status = await camera.connect(config);
      if (!status.connected) throw new Error('Transport opened but backend status reports disconnected');
      diagnostics.info('api', 'Transport connect result returned to Angular', {
        requestId, connected: status.connected, mode: status.mode, port: status.port, host: status.host
      });
      return json(response, 200, { ...status, requestId });
    }
    if (request.method === 'POST' && path === '/api/disconnect') {
      await camera.disconnect();
      const status = camera.status();
      diagnostics.info('api', 'Transport disconnect result returned to Angular', {
        requestId, connected: status.connected, mode: status.mode
      });
      return json(response, 200, { ...status, requestId });
    }
    if (request.method === 'GET' && path === '/api/info') {
      const status = camera.status();
      diagnostics.info('api', 'Angular requested camera info (i)', {
        requestId, connected: status.connected, mode: status.mode, port: status.port, host: status.host
      });
      const info = await camera.info();
      diagnostics.info('api', 'Camera info (i) returned to Angular', {
        requestId, ok: info.ok, cmd: info.cmd, cameraReady: info.cameraReady,
        board: info.board, sensorPid: info.sensorPid
      });
      return json(response, 200, { ...info, requestId });
    }
    if (request.method === 'GET' && path === '/api/test') return json(response, 200, await camera.selfTest());
    if (request.method === 'GET' && path === '/api/capture') {
      const image = await camera.capture();
      response.writeHead(200, {
        'Content-Type': 'image/jpeg', 'Content-Length': image.length, 'Cache-Control': 'no-store'
      });
      return response.end(image);
    }
    return json(response, 404, { ok: false, error: 'Not found' });
  } catch (error) {
    diagnostics.error('api', 'API request failed', {
      requestId, method: request.method, path, error: error.message,
      connected: camera.status().connected, mode: camera.status().mode
    });
    if (response.headersSent) {
      response.destroy(error);
      return;
    }
    const badRequest = /invalid|select|enter|required|too large|JSON|mode must/i.test(error.message);
    return json(response, badRequest ? 400 : 503, {
      ok: false, error: error.message, requestId,
      connected: camera.status().connected, mode: camera.status().mode
    });
  }
});

// Loopback only: local Angular UI / reverse proxy. Do not expose unauthenticated device APIs.
server.listen(port, '127.0.0.1', () => {
  diagnostics.info('backend', `ESP32-CAM backend listening on http://127.0.0.1:${port}`);
  diagnostics.info('backend', 'Running Node entry point', {
    file: fileURLToPath(import.meta.url), nodeVersion: process.version, pid: process.pid
  });
  diagnostics.info('backend', 'Start is listening only; use Connect in Angular to open the MCU interface');
});
server.on('error', (error) => {
  diagnostics.error('backend', 'HTTP listener failed', { port, error: error.message });
  process.exitCode = 1;
});

