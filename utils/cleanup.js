const fs = require('fs');
const path = require('path');
const { getTempDir } = require('./tempManager');

const INTERVAL = 10 * 60 * 1000;
const MAX_AGE  = 30 * 60 * 1000;
let timer = null;

function cleanupOldFiles() {
  try {
    const dir = getTempDir();
    if (!fs.existsSync(dir)) return;
    const now = Date.now();
    let del = 0;
    for (const f of fs.readdirSync(dir)) {
      const fp = path.join(dir, f);
      try {
        const s = fs.statSync(fp);
        if (!s.isDirectory() && now - s.mtimeMs > MAX_AGE) { fs.unlinkSync(fp); del++; }
      } catch {}
    }
    if (del > 0) console.log(`🧹 Cleaned ${del} temp files`);
  } catch (e) { console.error('Cleanup error:', e.message); }
}

function startCleanup() {
  cleanupOldFiles();
  timer = setInterval(cleanupOldFiles, INTERVAL);
  console.log('✅ Cleanup system started');
}

function stopCleanup() { if (timer) { clearInterval(timer); timer = null; } }

process.on('SIGINT', () => { stopCleanup(); process.exit(0); });
process.on('SIGTERM', () => { stopCleanup(); process.exit(0); });

module.exports = { cleanupOldFiles, startCleanup, stopCleanup };
