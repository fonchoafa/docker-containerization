'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { config } = require('./config');

// ---------------------------------------------------------------- notes

function memoryNotes() {
  const items = new Map();
  return {
    kind: 'memory',
    async list() {
      return [...items.values()].map((n) => ({ ...n })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    // Return copies, like a real database would, so callers cannot mutate stored data.
    async get(id) {
      const note = items.get(id);
      return note ? { ...note } : null;
    },
    async create({ title, body }) {
      const note = { id: crypto.randomUUID(), title, body, createdAt: new Date().toISOString() };
      items.set(note.id, note);
      return { ...note };
    },
    async setAttachment(id, attachment) {
      const note = items.get(id);
      if (!note) return null;
      note.attachment = attachment;
      return { ...note };
    },
    async remove(id) {
      const note = items.get(id) || null;
      items.delete(id);
      return note;
    },
  };
}

function fileNotes() {
  const file = path.resolve(config.notesFile);
  let items = new Map();
  try {
    for (const n of JSON.parse(fs.readFileSync(file, 'utf8'))) items.set(n.id, n);
  } catch (err) {
    if (err.code !== 'ENOENT') throw err; // no file yet is fine, a corrupt file is not
  }

  // Writes are queued one after another and saved atomically (temp file, then rename),
  // so a crash or restart in the middle of a save cannot leave a half-written file.
  let queue = Promise.resolve();
  const save = () => {
    queue = queue.then(async () => {
      await fs.promises.mkdir(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      await fs.promises.writeFile(tmp, JSON.stringify([...items.values()], null, 2));
      await fs.promises.rename(tmp, file);
    });
    return queue;
  };

  return {
    kind: 'file',
    async list() {
      return [...items.values()].map((n) => ({ ...n })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async get(id) {
      const note = items.get(id);
      return note ? { ...note } : null;
    },
    async create({ title, body }) {
      const note = { id: crypto.randomUUID(), title, body, createdAt: new Date().toISOString() };
      items.set(note.id, note);
      await save();
      return { ...note };
    },
    async setAttachment(id, attachment) {
      const note = items.get(id);
      if (!note) return null;
      note.attachment = attachment;
      await save();
      return { ...note };
    },
    async remove(id) {
      const note = items.get(id) || null;
      items.delete(id);
      if (note) await save();
      return note;
    },
  };
}

function dynamoNotes() {
  const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
  const {
    DynamoDBDocumentClient,
    PutCommand,
    GetCommand,
    ScanCommand,
    UpdateCommand,
    DeleteCommand,
  } = require('@aws-sdk/lib-dynamodb');

  const doc = DynamoDBDocumentClient.from(new DynamoDBClient({ region: config.region }));
  const TableName = config.tableName;

  return {
    kind: 'dynamodb',
    async list() {
      // A Scan is fine for a small demo table; use Query with a key design for real workloads.
      const out = await doc.send(new ScanCommand({ TableName, Limit: 100 }));
      return (out.Items || []).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async get(id) {
      const out = await doc.send(new GetCommand({ TableName, Key: { id } }));
      return out.Item || null;
    },
    async create({ title, body }) {
      const note = { id: crypto.randomUUID(), title, body, createdAt: new Date().toISOString() };
      await doc.send(new PutCommand({ TableName, Item: note }));
      return note;
    },
    async setAttachment(id, attachment) {
      try {
        const out = await doc.send(
          new UpdateCommand({
            TableName,
            Key: { id },
            UpdateExpression: 'SET attachment = :a',
            ConditionExpression: 'attribute_exists(id)',
            ExpressionAttributeValues: { ':a': attachment },
            ReturnValues: 'ALL_NEW',
          })
        );
        return out.Attributes;
      } catch (err) {
        if (err.name === 'ConditionalCheckFailedException') return null;
        throw err;
      }
    },
    async remove(id) {
      const out = await doc.send(new DeleteCommand({ TableName, Key: { id }, ReturnValues: 'ALL_OLD' }));
      return out.Attributes || null;
    },
  };
}

// ---------------------------------------------------------------- files

function diskFiles() {
  const root = path.resolve(config.uploadDir);
  const resolveKey = (key) => {
    const target = path.resolve(root, key);
    if (!target.startsWith(root + path.sep)) throw new Error('invalid file key');
    return target;
  };
  return {
    kind: 'disk',
    async put(key, buffer) {
      const target = resolveKey(key);
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.writeFile(target, buffer);
    },
    async get(key) {
      const target = resolveKey(key);
      const stat = await fs.promises.stat(target);
      return { stream: fs.createReadStream(target), length: stat.size };
    },
    async del(key) {
      await fs.promises.rm(resolveKey(key), { force: true });
    },
  };
}

function s3Files() {
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
  const s3 = new S3Client({ region: config.region });
  const Bucket = config.bucketName;
  return {
    kind: 's3',
    async put(key, buffer, contentType) {
      await s3.send(
        new PutObjectCommand({ Bucket, Key: key, Body: buffer, ContentType: contentType, ServerSideEncryption: 'AES256' })
      );
    },
    async get(key) {
      const out = await s3.send(new GetObjectCommand({ Bucket, Key: key }));
      return { stream: out.Body, length: out.ContentLength };
    },
    async del(key) {
      await s3.send(new DeleteObjectCommand({ Bucket, Key: key }));
    },
  };
}

module.exports = {
  createNoteStore: () => (config.tableName ? dynamoNotes() : config.notesFile ? fileNotes() : memoryNotes()),
  createFileStore: () => (config.bucketName ? s3Files() : diskFiles()),
};
