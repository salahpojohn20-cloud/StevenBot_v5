const fs = require('fs');
const path = require('path');

const loadCommands = () => {
  const commands = new Map();
  const dir = path.join(__dirname, '..', 'commands');
  if (!fs.existsSync(dir)) return commands;

  for (const cat of fs.readdirSync(dir)) {
    const catPath = path.join(dir, cat);
    if (!fs.statSync(catPath).isDirectory()) continue;
    for (const file of fs.readdirSync(catPath).filter(f => f.endsWith('.js'))) {
      try {
        const cmd = require(path.join(catPath, file));
        // Support both single export and array export
        const list = Array.isArray(cmd) ? cmd : [cmd];
        for (const c of list) {
          if (!c || !c.name) continue;
          c.category = c.category || cat;
          commands.set(c.name.toLowerCase(), c);
          if (c.aliases) {
            for (const a of c.aliases) commands.set(a.toLowerCase(), c);
          }
        }
      } catch (e) {
        console.error(`[LOADER] Failed ${file}: ${e.message}`);
      }
    }
  }
  return commands;
};

module.exports = { loadCommands };
