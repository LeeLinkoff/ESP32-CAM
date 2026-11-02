import test from 'node:test';
import assert from 'node:assert/strict';
import { DiagnosticsLog } from '../src/DiagnosticsLog.js';

test('diagnostic log retains bounded timestamped events and incremental cursor', () => {
  const log = new DiagnosticsLog(2, false);
  log.info('serial', 'Opening COM4', { port: 'COM4' });
  log.warn('serial', 'Opening delayed', { elapsedMs: 400 });
  log.error('serial', 'Access denied', { code: 'EACCES' });
  const batch = log.list(1);
  assert.equal(batch.latestId, 3);
  assert.equal(batch.entries.length, 2);
  assert.deepEqual(batch.entries.map((event) => event.id), [2, 3]);
  assert.match(batch.entries[0].time, /^\d{4}-\d\d-\d\dT/);
  assert.deepEqual(log.list(3).entries, []);
});

test('clearing logs preserves increasing event IDs for polling clients', () => {
  const log = new DiagnosticsLog(10, false);
  log.info('backend', 'Ready');
  log.clear();
  assert.equal(log.list().entries.length, 1);
  assert.equal(log.list().entries[0].message, 'Log cleared by user');
  assert.equal(log.list(1).latestId, 2);
});
