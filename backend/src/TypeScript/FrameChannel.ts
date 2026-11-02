// @ts-nocheck
// TypeScript runtime copy of ../FrameChannel.js; keep behavior aligned with the Node tests.
// Serial, TCP and Bluetooth SPP share the same LF-terminated JSON / binary protocol.
export class FrameChannel {
  constructor(stream, timeoutMs = 20000, diagnostic = () => {}) {
    this.stream = stream;
    this.timeoutMs = timeoutMs;
    this.diagnostic = diagnostic;
    this.buffer = Buffer.alloc(0);
    this.pending = null;
    this.tail = Promise.resolve();
    this.closed = false;
    stream.on('data', (chunk) => this.onData(chunk));
    stream.on('error', (error) => this.fail(error));
    stream.on('close', () => this.fail(new Error('Camera connection closed')));
  }

  request(command) {
    // One request at a time: no interleaving binary JPEG payloads.
    const operation = this.tail.catch(() => {}).then(() => this.send(command));
    this.tail = operation;
    return operation;
  }

  send(command) {
    return new Promise((resolve, reject) => {
      if (this.closed) return reject(new Error('Camera connection is closed'));
      this.buffer = Buffer.alloc(0);
      const timer = setTimeout(() => this.fail(new Error(`Timed out waiting for '${command}'`)), this.timeoutMs);
      this.pending = { command, resolve, reject, timer, header: null, started: Date.now() };
      this.diagnostic('debug', 'Sending MCU command', { command });
      this.stream.write(`${command}\n`, (error) => {
        if (error) this.fail(error);
      });
    });
  }

  onData(chunk) {
    if (!this.pending) {
      // A serial adapter may reset the ESP32 on open. Never log raw boot bytes.
      this.diagnostic('debug', 'Unsolicited MCU data while idle (possible boot/status output)', {
        bytes: chunk.length
      });
      return;
    }
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.parse();
  }

  parse() {
    while (this.pending) {
      const request = this.pending;
      if (!request.header) {
        const newline = this.buffer.indexOf(10);
        if (newline < 0) {
          if (this.buffer.length > 4096) this.fail(new Error('Invalid camera response header'));
          return;
        }
        const line = this.buffer.subarray(0, newline).toString('utf8').trim();
        this.buffer = this.buffer.subarray(newline + 1);
        let header;
        try { header = JSON.parse(line); }
        catch {
          if (line) this.diagnostic('debug', 'Ignored non-JSON serial line', { length: line.length });
          continue;
        } // USB boot messages may precede the first JSON reply.
        if (!header || typeof header !== 'object' || typeof header.ok !== 'boolean') continue;
        this.diagnostic('debug', 'MCU JSON response received', {
          command: request.command, ok: header.ok,
          jpegBytes: Number.isSafeInteger(header.size) ? header.size : undefined
        });
        if (!header.ok) return this.finish(new Error(header.error || 'Camera rejected command'));
        if (request.command === 'c') {
          if (!Number.isSafeInteger(header.size) || header.size <= 0 || header.size > 4 * 1024 * 1024 || header.mime !== 'image/jpeg') {
            return this.finish(new Error('Invalid JPEG payload header'));
          }
          request.header = header;
        } else {
          return this.finish(null, header);
        }
      }
      if (request.header) {
        if (this.buffer.length < request.header.size) return;
        const jpg = Buffer.from(this.buffer.subarray(0, request.header.size));
        this.buffer = this.buffer.subarray(request.header.size);
        return this.finish(null, jpg);
      }
    }
  }

  finish(error, value) {
    if (!this.pending) return;
    const { resolve, reject, timer, command, started } = this.pending;
    clearTimeout(timer);
    this.pending = null;
    this.buffer = Buffer.alloc(0);
    this.diagnostic(error ? 'error' : 'info', error ? 'MCU request failed' : 'MCU request completed', {
      command, elapsedMs: Date.now() - started,
      ...(error ? { error: error.message } : {}),
      ...(!error && Buffer.isBuffer(value) ? { jpegBytes: value.length } : {})
    });
    if (error) reject(error);
    else resolve(value);
  }

  fail(error) {
    if (this.closed) return;
    this.diagnostic(this.pending ? 'warn' : 'info', 'Transport stream closed', {
      reason: error.message
    });
    this.closed = true;
    this.finish(error);
  }
}

