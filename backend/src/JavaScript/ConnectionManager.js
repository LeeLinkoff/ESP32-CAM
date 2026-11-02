import net from 'node:net';
import { FrameChannel } from './FrameChannel.js';
import { DiagnosticsLog } from './DiagnosticsLog.js';

const modes = new Set(['usb', 'tcp', 'http', 'bluetooth']);
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function retry(action, limitMs = 20000, onFailure = () => {}) {
  const until = Date.now() + limitMs;
  let error;
  let attempt = 0;
  do {
    attempt++;
    try { return await action(); }
    catch (cause) {
      error = cause;
      onFailure(cause, attempt);
    }
    if (Date.now() < until) await pause(1100);
  } while (Date.now() < until);
  throw error;
}

export class ConnectionManager {
  constructor(diagnostics = new DiagnosticsLog()) {
    this.connection = null;
    this.configuration = null;
    this.diagnostics = diagnostics;
  }

  status() {
    const connected = Boolean(this.connection) &&
      (this.connection.kind !== 'stream' || !this.connection.channel?.closed);
    return { connected, ...(this.configuration || { mode: 'usb' }) };
  }

  async ports() {
    this.diagnostics.info('serial', 'Enumerating local serial/COM ports');
    try {
      const { SerialPort } = await import('serialport');
      const ports = (await SerialPort.list()).map((entry) => ({
        path: entry.path, manufacturer: entry.manufacturer || ''
      }));
      this.diagnostics.info('serial', 'Serial-port enumeration completed', {
        count: ports.length, ports: ports.map((entry) => entry.path)
      });
      return ports;
    } catch (error) {
      this.diagnostics.error('serial', 'Serial-port enumeration failed', { error: error.message });
      throw error;
    }
  }

  async connect(config) {
    const mode = String(config?.mode || 'usb').toLowerCase();
    if (!modes.has(mode)) throw new Error('Mode must be usb, tcp, http or bluetooth');
    const port = String(config.port || '').trim();
    const host = String(config.host || '').trim();
    const target = mode === 'usb' || mode === 'bluetooth' ? port : host;
    this.diagnostics.info('connection', 'Client transport selected', { mode, target });
    if ((mode === 'usb' || mode === 'bluetooth') && !port) throw new Error('Select a COM/serial port');
    if ((mode === 'tcp' || mode === 'http') && !host) throw new Error('Enter the ESP32-CAM IP address');

    // Mode is client-side only. Firmware keeps every configured service running.
    await this.disconnect();
    const next = { mode, port: mode === 'usb' || mode === 'bluetooth' ? port : undefined,
      host: mode === 'tcp' || mode === 'http' ? host : undefined };
    try {
      if (mode === 'http') {
        const baseUrl = `http://${host}`;
        await retry(async () => {
          const response = await fetch(`${baseUrl}/info`, { signal: AbortSignal.timeout(3000) });
          if (!response.ok) throw new Error(`ESP32 HTTP status ${response.status}`);
        }, 20000, (error, attempt) => this.diagnostics.warn('http', 'HTTP connection attempt failed', {
          attempt, host, error: error.message
        }));
        next.baseUrl = baseUrl;
        this.connection = { kind: 'http', baseUrl };
      } else if (mode === 'tcp') {
        const socket = await retry(async () => {
          const client = net.createConnection({ host, port: 3333 });
          try {
            await new Promise((resolve, reject) => {
              client.once('connect', resolve);
              client.once('error', reject);
              client.setTimeout(3000, () => reject(new Error('TCP connection timed out')));
            });
            return client;
          } catch (error) {
            client.destroy();
            throw error;
          }
        }, 20000, (error, attempt) => this.diagnostics.warn('tcp', 'TCP connection attempt failed', {
          attempt, host, port: 3333, error: error.message
        }));
        socket.setTimeout(0);
        this.connection = { kind: 'stream', stream: socket,
          channel: new FrameChannel(socket, 20000, (level, message, details) =>
            this.diagnostics.write(level, 'tcp', message, details)) };
      } else {
        // Windows Bluetooth Classic SPP must be paired first to expose a virtual COM port.
        const started = Date.now();
        this.diagnostics.info('serial', 'Opening serial connection', { mode, port, baudRate: 115200 });
        const { SerialPort } = await import('serialport');
        const serial = new SerialPort({ path: port, baudRate: 115200, autoOpen: false });
        await new Promise((resolve, reject) => serial.open((error) => error ? reject(error) : resolve()));
        this.diagnostics.info('serial', 'Serial port opened', { mode, port, elapsedMs: Date.now() - started });
        this.connection = { kind: 'stream', stream: serial,
          channel: new FrameChannel(serial, 20000, (level, message, details) =>
            this.diagnostics.write(level, mode, message, details)) };
      }
      this.configuration = next;
      this.diagnostics.info('connection', 'Client connected', { mode, target });
      return this.status();
    } catch (error) {
      this.connection = null;
      this.configuration = null;
      this.diagnostics.error('connection', 'Client connection failed', { mode, target, error: error.message });
      throw new Error(`Unable to connect using ${mode}: ${error.message}. USB remains available on the board.`);
    }
  }

  async disconnect() {
    if (this.connection) {
      this.diagnostics.info('connection', 'Disconnecting client transport', {
        mode: this.configuration?.mode || 'unknown'
      });
    }
    if (this.connection?.kind === 'stream') {
      const stream = this.connection.stream;
      if (typeof stream.destroy === 'function') stream.destroy();
      else if (typeof stream.close === 'function') stream.close();
    }
    this.connection = null;
    this.configuration = null;
  }

  requireConnection() {
    if (!this.connection) throw new Error('Connect to the ESP32-CAM first');
    return this.connection;
  }

  async httpRequest(path, options = {}) {
    const connection = this.requireConnection();
    const started = Date.now();
    this.diagnostics.debug('http', 'HTTP camera request started', { path });
    const response = await fetch(`${connection.baseUrl}${path}`, { ...options, signal: AbortSignal.timeout(20000) });
    if (!response.ok) {
      this.diagnostics.error('http', 'HTTP camera request failed', { path, status: response.status });
      throw new Error(`Camera HTTP request failed: ${response.status}`);
    }
    this.diagnostics.info('http', 'HTTP camera request completed', {
      path, status: response.status, elapsedMs: Date.now() - started
    });
    return response;
  }

  async info() {
    const connection = this.requireConnection();
    if (connection.kind === 'http') return this.httpRequest('/info').then((reply) => reply.json());
    return connection.channel.request('i');
  }

  async selfTest() {
    const connection = this.requireConnection();
    if (connection.kind === 'http') return this.httpRequest('/test').then((reply) => reply.json());
    return connection.channel.request('t');
  }

  async capture() {
    const connection = this.requireConnection();
    if (connection.kind === 'http') {
      const response = await this.httpRequest('/capture');
      return Buffer.from(await response.arrayBuffer());
    }
    return connection.channel.request('c');
  }

}

