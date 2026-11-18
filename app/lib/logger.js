'use strict';

const fs = require('fs');
const { config } = require('./config');

// Structured JSON logs, one object per line. They go to stdout (systemd journal)
// and, when LOG_FILE is set, to a file that the CloudWatch agent ships to CloudWatch Logs.
// Never pass secrets (admin key, tokens) to these functions.
let stream = null;

function openFile() {
  if (!config.logFile || stream) return;
  stream = fs.createWriteStream(config.logFile, { flags: 'a' });
  stream.on('error', (err) => {
    process.stderr.write(JSON.stringify({ level: 'error', msg: 'log file error', error: err.message }) + '\n');
    stream = null;
  });
}

function write(level, msg, extra) {
  const line = JSON.stringify({ time: new Date().toISOString(), level, msg, ...extra }) + '\n';
  if (!config.logSilent) process.stdout.write(line);
  openFile();
  if (stream) stream.write(line);
}

module.exports = {
  info: (msg, extra) => write('info', msg, extra),
  warn: (msg, extra) => write('warn', msg, extra),
  error: (msg, extra) => write('error', msg, extra),
};
