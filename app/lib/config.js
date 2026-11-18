'use strict';

const path = require('path');
const { SSMClient, GetParameterCommand } = require('@aws-sdk/client-ssm');

const env = process.env;

// Non-secret settings come from environment variables (12-factor style).
// The only secret (the admin key) is read from SSM Parameter Store at startup.
const config = {
  port: Number(env.PORT || 3000),
  region: env.AWS_REGION || 'us-east-1',
  tableName: env.TABLE_NAME || '',
  bucketName: env.BUCKET_NAME || '',
  secretParam: env.SECRET_PARAM_NAME || '',
  adminKey: env.ADMIN_KEY || '', // local development only
  logFile: env.LOG_FILE || '',
  logSilent: env.LOG_SILENT === '1',
  uploadDir: env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'),
  // Optional: keep notes in a JSON file (used in Docker so a volume can persist them).
  notesFile: env.NOTES_FILE || '',
  // Which reverse proxies to trust for the real client IP (Express "trust proxy" setting).
  trustProxy: env.TRUST_PROXY || 'loopback',
  maxUploadBytes: Number(env.MAX_UPLOAD_BYTES || 2 * 1024 * 1024),
  appVersion: env.APP_VERSION || '1.0.0',
};

async function loadSecrets() {
  if (config.secretParam) {
    const ssm = new SSMClient({ region: config.region });
    const out = await ssm.send(
      new GetParameterCommand({ Name: config.secretParam, WithDecryption: true })
    );
    config.adminKey = out.Parameter.Value;
  }
  return config;
}

module.exports = { config, loadSecrets };
