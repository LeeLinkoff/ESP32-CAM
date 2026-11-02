import test from 'node:test';
import assert from 'node:assert/strict';
import { ConnectionManager } from '../src/ConnectionManager.js';

test('switching client transport never sends an MCU mode command', async () => {
  const manager = new ConnectionManager();
  let previousClosed = false;
  manager.connection = { kind: 'stream', stream: { destroy() { previousClosed = true; } } };
  manager.configuration = { mode: 'usb', port: 'COM4' };

  const previousFetch = globalThis.fetch;
  const urls = [];
  globalThis.fetch = async (url) => {
    urls.push(String(url));
    return { ok: true, status: 200 };
  };
  try {
    const status = await manager.connect({ mode: 'http', host: '192.0.2.42' });
    assert.equal(previousClosed, true);
    assert.equal(status.mode, 'http');
    assert.equal(status.connected, true);
    assert.deepEqual(urls, ['http://192.0.2.42/info']);
    assert.equal(typeof manager.setDeviceMode, 'undefined');
  } finally {
    await manager.disconnect();
    globalThis.fetch = previousFetch;
  }
});
