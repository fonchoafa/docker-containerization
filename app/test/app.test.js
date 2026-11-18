'use strict';

// Set the environment BEFORE the app modules are loaded.
const os = require('node:os');
const path = require('node:path');
process.env.ADMIN_KEY = 'test-admin-key';
process.env.LOG_SILENT = '1';
process.env.UPLOAD_DIR = path.join(os.tmpdir(), `cloud-notes-test-${process.pid}`);
delete process.env.TABLE_NAME;
delete process.env.BUCKET_NAME;
delete process.env.SECRET_PARAM_NAME;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { buildApp } = require('../server');
const { createNoteStore, createFileStore } = require('../lib/store');

let server;
let base;

before(async () => {
  const app = buildApp({ notes: createNoteStore(), files: createFileStore() });
  await new Promise((resolve) => {
    server = app.listen(0, '127.0.0.1', resolve);
  });
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

const json = (path, options = {}) =>
  fetch(base + path, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers || {}) },
  });

test('health endpoint reports ok', async () => {
  const res = await fetch(`${base}/health`);
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.status, 'ok');
});

test('CSP does not force HTTPS upgrades (site is served over HTTP)', async () => {
  const res = await fetch(`${base}/health`);
  const csp = res.headers.get('content-security-policy') || '';
  assert.ok(csp.includes("default-src 'self'"));
  assert.ok(!csp.includes('upgrade-insecure-requests'));
});

test('rejects a note without a title', async () => {
  const res = await json('/api/notes', { method: 'POST', body: JSON.stringify({ body: 'x' }) });
  assert.equal(res.status, 400);
});

test('rejects malformed JSON with 400', async () => {
  const res = await json('/api/notes', { method: 'POST', body: '{bad json' });
  assert.equal(res.status, 400);
});

test('rejects a bad note id', async () => {
  const res = await fetch(`${base}/api/notes/not-a-uuid/attachment`);
  assert.equal(res.status, 400);
});

test('note lifecycle: create, attach, download, protected delete', async () => {
  const created = await json('/api/notes', {
    method: 'POST',
    body: JSON.stringify({ title: 'First note', body: 'hello cloud' }),
  });
  assert.equal(created.status, 201);
  const note = await created.json();

  const listed = await (await fetch(`${base}/api/notes`)).json();
  assert.ok(listed.some((n) => n.id === note.id));

  const form = new FormData();
  form.append('file', new Blob(['attachment body'], { type: 'text/plain' }), 'hello.txt');
  const uploaded = await fetch(`${base}/api/notes/${note.id}/attachment`, { method: 'POST', body: form });
  assert.equal(uploaded.status, 201);

  const download = await fetch(`${base}/api/notes/${note.id}/attachment`);
  assert.equal(download.status, 200);
  assert.equal(await download.text(), 'attachment body');

  const noKey = await fetch(`${base}/api/notes/${note.id}`, { method: 'DELETE' });
  assert.equal(noKey.status, 401);

  const wrongKey = await fetch(`${base}/api/notes/${note.id}`, { method: 'DELETE', headers: { 'x-admin-key': 'nope' } });
  assert.equal(wrongKey.status, 401);

  const deleted = await fetch(`${base}/api/notes/${note.id}`, {
    method: 'DELETE',
    headers: { 'x-admin-key': 'test-admin-key' },
  });
  assert.equal(deleted.status, 204);

  const after = await (await fetch(`${base}/api/notes`)).json();
  assert.ok(!after.some((n) => n.id === note.id));
});

test('rejects disallowed upload types', async () => {
  const created = await json('/api/notes', { method: 'POST', body: JSON.stringify({ title: 'Upload test' }) });
  const note = await created.json();
  const form = new FormData();
  form.append('file', new Blob(['MZ'], { type: 'application/x-msdownload' }), 'bad.exe');
  const res = await fetch(`${base}/api/notes/${note.id}/attachment`, { method: 'POST', body: form });
  assert.equal(res.status, 415);
});
