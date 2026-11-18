'use strict';

const path = require('path');
const crypto = require('crypto');
const express = require('express');
const helmet = require('helmet');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const { config, loadSecrets } = require('./lib/config');
const log = require('./lib/logger');
const { createNoteStore, createFileStore } = require('./lib/store');

const ALLOWED_TYPES = new Set([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/webp',
  'application/pdf',
  'text/plain',
]);
const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const handle = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function buildApp({ notes, files }) {
  const app = express();
  app.disable('x-powered-by');
  // nginx sits in front and forwards the real client IP (X-Forwarded-For).
  // TRUST_PROXY says which proxy addresses to believe: 'loopback' on a single server,
  // 'uniquelocal' in Docker, where nginx has a private network address.
  app.set('trust proxy', config.trustProxy);

  // The site is served over plain HTTP, so the default "upgrade-insecure-requests"
  // CSP directive must be off or browsers would try to load /app.js over HTTPS and fail.
  app.use(
    helmet({
      contentSecurityPolicy: { useDefaults: true, directives: { 'upgrade-insecure-requests': null } },
    })
  );
  app.use(express.json({ limit: '10kb' }));

  app.use((req, res, next) => {
    const start = process.hrtime.bigint();
    res.on('finish', () => {
      log.info('request', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Number((process.hrtime.bigint() - start) / 1000000n),
        ip: req.ip,
      });
    });
    next();
  });

  app.param('id', (req, res, next, id) => {
    if (!ID_PATTERN.test(id)) return res.status(400).json({ error: 'invalid note id' });
    next();
  });

  const writeLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: config.maxUploadBytes, files: 1 },
    fileFilter: (req, file, cb) => {
      if (ALLOWED_TYPES.has(file.mimetype)) return cb(null, true);
      cb(Object.assign(new Error('file type not allowed (png, jpeg, gif, webp, pdf, txt)'), { status: 415 }));
    },
  });

  function requireAdmin(req, res, next) {
    if (!config.adminKey) return res.status(403).json({ error: 'admin key is not configured' });
    const supplied = Buffer.from(req.get('x-admin-key') || '');
    const expected = Buffer.from(config.adminKey);
    if (supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) {
      log.warn('admin authentication failed', { ip: req.ip });
      return res.status(401).json({ error: 'invalid admin key' });
    }
    next();
  }

  app.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      version: config.appVersion,
      uptimeSeconds: Math.round(process.uptime()),
      storage: { notes: notes.kind, files: files.kind },
    });
  });

  app.get('/api/notes', handle(async (req, res) => res.json(await notes.list())));

  app.post(
    '/api/notes',
    writeLimiter,
    handle(async (req, res) => {
      const { title, body } = req.body || {};
      if (typeof title !== 'string' || !title.trim() || title.length > 100) {
        return res.status(400).json({ error: 'title is required (max 100 characters)' });
      }
      if (body !== undefined && (typeof body !== 'string' || body.length > 1000)) {
        return res.status(400).json({ error: 'body must be text of at most 1000 characters' });
      }
      const note = await notes.create({ title: title.trim(), body: (body || '').trim() });
      log.info('note created', { id: note.id });
      res.status(201).json(note);
    })
  );

  app.post(
    '/api/notes/:id/attachment',
    writeLimiter,
    upload.single('file'),
    handle(async (req, res) => {
      const note = await notes.get(req.params.id);
      if (!note) return res.status(404).json({ error: 'note not found' });
      if (!req.file) return res.status(400).json({ error: 'a "file" field is required' });

      const safeName = req.file.originalname.replace(/[^A-Za-z0-9._-]/g, '_').slice(-80) || 'file';
      const key = `notes/${note.id}/${crypto.randomUUID()}-${safeName}`;
      const previousKey = note.attachment ? note.attachment.key : null;
      await files.put(key, req.file.buffer, req.file.mimetype);
      const updated = await notes.setAttachment(note.id, {
        key,
        name: safeName,
        type: req.file.mimetype,
        size: req.file.size,
      });
      if (previousKey) await files.del(previousKey);
      log.info('attachment uploaded', { id: note.id, bytes: req.file.size });
      res.status(201).json(updated);
    })
  );

  app.get(
    '/api/notes/:id/attachment',
    handle(async (req, res) => {
      const note = await notes.get(req.params.id);
      if (!note || !note.attachment) return res.status(404).json({ error: 'no attachment' });
      const file = await files.get(note.attachment.key);
      res.setHeader('Content-Type', note.attachment.type);
      res.setHeader('Content-Disposition', `attachment; filename="${note.attachment.name}"`);
      if (file.length) res.setHeader('Content-Length', String(file.length));
      file.stream.on('error', () => res.destroy());
      file.stream.pipe(res);
    })
  );

  app.delete(
    '/api/notes/:id',
    requireAdmin,
    handle(async (req, res) => {
      const removed = await notes.remove(req.params.id);
      if (!removed) return res.status(404).json({ error: 'note not found' });
      if (removed.attachment) await files.del(removed.attachment.key);
      log.info('note deleted', { id: req.params.id });
      res.status(204).end();
    })
  );

  app.use(express.static(path.join(__dirname, 'public')));

  app.use((req, res) => res.status(404).json({ error: 'not found' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(413).json({ error: `file too large (max ${config.maxUploadBytes} bytes)` });
    }
    if (err.name === 'MulterError') return res.status(400).json({ error: err.message });
    const status = err.status || err.statusCode || 500;
    if (status >= 500) {
      log.error('unhandled error', { path: req.path, error: err.message });
      return res.status(500).json({ error: 'internal error' });
    }
    res.status(status).json({ error: err.message });
  });

  return app;
}

async function main() {
  await loadSecrets();
  const notes = createNoteStore();
  const files = createFileStore();
  const app = buildApp({ notes, files });
  const server = app.listen(config.port, () => {
    log.info('server started', {
      port: config.port,
      version: config.appVersion,
      notesStore: notes.kind,
      filesStore: files.kind,
      secretLoaded: Boolean(config.adminKey),
    });
  });
  process.on('SIGTERM', () => {
    log.info('shutting down');
    server.close(() => process.exit(0));
  });
}

if (require.main === module) {
  main().catch((err) => {
    log.error('startup failed', { error: err.message });
    process.exit(1);
  });
}

module.exports = { buildApp };
