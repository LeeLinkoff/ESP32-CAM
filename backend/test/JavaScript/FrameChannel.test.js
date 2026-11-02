import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { FrameChannel } from '../src/FrameChannel.js';

class MockStream extends EventEmitter {
  writes = [];
  write(bytes, callback) {
    this.writes.push(bytes);
    callback?.();
  }
}

test('reads JSON camera info and ignores serial boot text', async () => {
  const stream = new MockStream();
  const channel = new FrameChannel(stream);
  const result = channel.request('i');
  await new Promise((resolve) => setImmediate(resolve));
  stream.emit('data', Buffer.from('ESP32 boot\n{\"ok\":true,\"cmd\":\"i\",\"cameraReady\":true}\n'));
  assert.deepEqual(await result, { ok: true, cmd: 'i', cameraReady: true });
  assert.equal(stream.writes[0], 'i\n');
});

test('reads JPEG bytes including newline and arbitrary binary values', async () => {
  const stream = new MockStream();
  const channel = new FrameChannel(stream);
  const result = channel.request('c');
  await new Promise((resolve) => setImmediate(resolve));
  stream.emit('data', Buffer.concat([
    Buffer.from('{"ok":true,"cmd":"c","mime":"image/jpeg","size":4}\n'),
    Buffer.from([0xff]),
  ]));
  stream.emit('data', Buffer.from([0x0a, 0x00, 0xd9]));
  assert.deepEqual(await result, Buffer.from([0xff, 0x0a, 0x00, 0xd9]));
});

test('propagates firmware command errors', async () => {
  const stream = new MockStream();
  const channel = new FrameChannel(stream);
  const result = channel.request('nope');
  await new Promise((resolve) => setImmediate(resolve));
  stream.emit('data', Buffer.from('{"ok":false,"error":"unknown_command"}\n'));
  await assert.rejects(result, /unknown_command/);
});

test('receives firmware self-test JSON over the same command channel', async () => {
  const stream = new MockStream();
  const channel = new FrameChannel(stream);
  const result = channel.request('t');
  await new Promise((resolve) => setImmediate(resolve));
  stream.emit('data', Buffer.from('{"ok":true,"cmd":"t","passed":true,"checks":{"cameraInitialized":true}}\n'));
  assert.deepEqual(await result, {
    ok: true, cmd: 't', passed: true, checks: { cameraInitialized: true }
  });
  assert.equal(stream.writes[0], 't\n');
});

test('diagnostic tracing records command timing and JPEG size, never JPEG data', async () => {
  const stream = new MockStream();
  const events = [];
  const channel = new FrameChannel(stream, 20000, (level, message, details) => {
    events.push({ level, message, details });
  });
  const result = channel.request('c');
  await new Promise((resolve) => setImmediate(resolve));
  stream.emit('data', Buffer.concat([
    Buffer.from('{"ok":true,"cmd":"c","mime":"image/jpeg","size":4}\n'),
    Buffer.from([0xff, 0xd8, 0xff, 0xd9]),
  ]));
  assert.deepEqual(await result, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  assert.equal(events.at(-1).details.jpegBytes, 4);
  assert.equal(events.at(-1).details.command, 'c');
  assert.ok(events.at(-1).details.elapsedMs >= 0);
  assert.ok(!JSON.stringify(events).includes('ffd8ffd9'));
});
