// commands/general/help.js — Shows info about a specific command
const db = require('../../database');
const { loadCommands } = require('../../utils/commandLoader');

module.exports = {
  name: 'help',
  aliases: ['cmdinfo'],
  category: 'general',
  description: 'Get detailed info about a command',

  async execute(sock, msg, args, extra) {
    const prefix = db.getPrefix();
    const cmdName = args[0]?.toLowerCase().replace(/^\./, '');

    // No argument — show mini guide
    if (!cmdName) {
      return extra.reply(
        `📖 *Help Guide*\n\n` +
        `Usage: *${prefix}help <command>*\n\n` +
        `Examples:\n` +
        `▸ ${prefix}help tiktok\n` +
        `▸ ${prefix}help marry\n` +
        `▸ ${prefix}help kick\n` +
        `▸ ${prefix}help pies\n\n` +
        `Type *${prefix}menu* to see all commands.`
      );
    }

    const commands = loadCommands();
    const cmd = commands.get(cmdName);

    if (!cmd) {
      // Suggest similar commands
      const all = [...commands.keys()].filter(k => commands.get(k).name === k);
      const similar = all.filter(k => k.includes(cmdName) || cmdName.includes(k)).slice(0, 5);
      return extra.reply(
        `❌ Command *${prefix}${cmdName}* not found.\n\n` +
        (similar.length ? `💡 Similar: ${similar.map(s => `${prefix}${s}`).join(', ')}` : `Type *${prefix}menu* to see all commands.`)
      );
    }

    // Build info card
    const aliases = cmd.aliases?.filter(a => a !== cmdName) || [];
    const flags = [];
    if (cmd.ownerOnly)      flags.push('👑 Owner only');
    if (cmd.adminOnly)      flags.push('🛡️ Admin / Sudo');
    if (cmd.modOnly)        flags.push('⭐ Sudo+');
    if (cmd.groupOnly)      flags.push('👥 Groups only');
    if (cmd.privateOnly)    flags.push('💬 Private only');
    if (cmd.botAdminNeeded) flags.push('🤖 Bot must be admin');
    if (!flags.length)      flags.push('🌐 Everyone');

    let text = `📖 *Command Info*\n`;
    text += `▬▬▬▬▬▬▬▬▬▬▬▬\n`;
    text += `🔷 Command: *${prefix}${cmd.name}*\n`;
    text += `📁 Category: *${cmd.category}*\n`;
    text += `📝 Description: ${cmd.description || 'No description'}\n`;
    if (aliases.length) text += `♻️ Aliases: ${aliases.map(a => `${prefix}${a}`).join(', ')}\n`;
    text += `🔒 Access: ${flags.join(', ')}\n`;
    text += `▬▬▬▬▬▬▬▬▬▬▬▬\n`;
    text += `> _${db.getBotName()}_`;

    extra.reply(text);
  }
};
