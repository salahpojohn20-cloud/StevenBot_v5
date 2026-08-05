const fs = require('fs');
const path = require('path');
const TEMP_DIR = path.join(process.cwd(), 'temp');

function initializeTempSystem() {
  const abs = path.resolve(TEMP_DIR);
  process.env.TMPDIR = abs; process.env.TMP = abs; process.env.TEMP = abs;
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  return TEMP_DIR;
}

function getTempDir() {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  return TEMP_DIR;
}

function createTempFilePath(prefix = 'tmp', ext = 'tmp') {
  return path.join(getTempDir(), `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`);
}

function deleteTempFile(fp) {
  try { if (fp && fs.existsSync(fp)) { fs.unlinkSync(fp); return true; } } catch {}
  return false;
}

function deleteTempFiles(fps) { if (Array.isArray(fps)) fps.forEach(deleteTempFile); }

module.exports = { initializeTempSystem, getTempDir, createTempFilePath, deleteTempFile, deleteTempFiles, TEMP_DIR };
