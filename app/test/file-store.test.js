'use strict';

// Notes saved in a JSON file must survive a restart (this is what a Docker volume relies on).
const os = require('node:os');
const fs = require('node:fs');
const path = require('node:path');
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'notes-file-test-'));
process.env.NOTES_FILE = path.join(dir, 'data', 'notes.json');
process.env.LOG_SILENT = '1';
delete process.env.TABLE_NAME;

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { createNoteStore } = require('../lib/store');

after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('starts empty when the file does not exist yet', async () => {
  const store = createNoteStore();
  assert.equal(store.kind, 'file');
  assert.deepEqual(await store.list(), []);
});

test('notes and attachments survive a "restart" (new store reading the same file)', async () => {
  const first = createNoteStore();
  const note = await first.create({ title: 'Persist me', body: 'still here' });
  await first.setAttachment(note.id, { key: 'notes/x/a.txt', name: 'a.txt' });

  const second = createNoteStore(); // simulates the container starting again
  const loaded = await second.get(note.id);
  assert.equal(loaded.title, 'Persist me');
  assert.equal(loaded.attachment.name, 'a.txt');
});

test('removed notes stay removed after a restart', async () => {
  const first = createNoteStore();
  const note = await first.create({ title: 'Delete me' });
  await first.remove(note.id);
  assert.equal(await createNoteStore().get(note.id), null);
});

test('many quick writes all end up in the file', async () => {
  const store = createNoteStore();
  await Promise.all(Array.from({ length: 20 }, (_, i) => store.create({ title: `n${i}` })));
  const titles = (await createNoteStore().list()).map((n) => n.title);
  for (let i = 0; i < 20; i++) assert.ok(titles.includes(`n${i}`));
});
