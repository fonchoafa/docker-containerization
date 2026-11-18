'use strict';

const $ = (selector) => document.querySelector(selector);

async function api(path, options) {
  const res = await fetch(path, options);
  const isJson = (res.headers.get('content-type') || '').includes('application/json');
  const data = isJson ? await res.json() : null;
  if (!res.ok) throw new Error((data && data.error) || res.statusText);
  return data;
}

function show(text, isError) {
  const message = $('#message');
  message.textContent = text;
  message.className = isError ? 'msg error' : 'msg';
}

// Build DOM nodes with textContent only, so note text can never inject HTML.
function el(tag, props, ...children) {
  const node = Object.assign(document.createElement(tag), props || {});
  node.append(...children);
  return node;
}

function noteItem(note) {
  const actions = el('div', { className: 'actions' });

  if (note.attachment) {
    actions.append(
      el('a', { href: `/api/notes/${note.id}/attachment`, textContent: `Download ${note.attachment.name}` })
    );
  }

  const fileInput = el('input', {
    type: 'file',
    accept: 'image/png,image/jpeg,image/gif,image/webp,application/pdf,text/plain',
  });
  fileInput.addEventListener('change', async () => {
    if (!fileInput.files.length) return;
    const form = new FormData();
    form.append('file', fileInput.files[0]);
    try {
      await api(`/api/notes/${note.id}/attachment`, { method: 'POST', body: form });
      show('Attachment uploaded to S3.');
      await load();
    } catch (err) {
      show(err.message, true);
    }
  });
  actions.append(el('label', { className: 'file' }, 'Attach file ', fileInput));

  const remove = el('button', { className: 'danger', type: 'button', textContent: 'Delete' });
  remove.addEventListener('click', async () => {
    const key = window.prompt('Admin key (stored in AWS SSM Parameter Store):');
    if (!key) return;
    try {
      await api(`/api/notes/${note.id}`, { method: 'DELETE', headers: { 'x-admin-key': key } });
      show('Note deleted.');
      await load();
    } catch (err) {
      show(err.message, true);
    }
  });
  actions.append(remove);

  return el(
    'li',
    {},
    el('h3', { textContent: note.title }),
    el('p', { textContent: note.body }),
    el('small', { textContent: new Date(note.createdAt).toLocaleString() }),
    actions
  );
}

async function load() {
  const notes = await api('/api/notes');
  const list = $('#notes');
  list.replaceChildren(...notes.map(noteItem));
  if (!notes.length) list.append(el('li', { className: 'empty', textContent: 'No notes yet.' }));
}

async function loadStatus() {
  try {
    const health = await api('/health');
    $('#status').textContent =
      `v${health.version} · notes in ${health.storage.notes} · files in ${health.storage.files} · up ${health.uptimeSeconds}s`;
  } catch (err) {
    $('#status').textContent = 'Status unavailable';
  }
}

$('#note-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    await api('/api/notes', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: $('#title').value, body: $('#body').value }),
    });
    event.target.reset();
    show('Note saved.');
    await load();
  } catch (err) {
    show(err.message, true);
  }
});

load().catch((err) => show(err.message, true));
loadStatus();
