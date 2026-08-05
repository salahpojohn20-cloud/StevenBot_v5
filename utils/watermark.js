/**
 * StevenBot V5 — Creator Watermark
 * This file is hardcoded and cannot be overridden by settings.
 * 
 * CREATOR: Steven (+201273323087)
 * Built for personal use. All rights reserved.
 */

const CREATOR = {
  name:   '𝕊𝕥𝕖𝕧𝕖𝕟',
  number: '201273323087',
  jid:    '201273323087@s.whatsapp.net',
  tag:    '@201273323087',
  credit: '✨ *Created by 𝕊𝕥𝕖𝕧𝕖𝕟* | +201273323087',
  footer: '_Powered by 𝕊𝕥𝕖𝕧𝕖𝕟 Bot — made by 𝕊𝕥𝕖𝕧𝕖𝕟 (+201273323087)_',
  stamp:  '> ✨ 𝕊𝕥𝕖𝕧𝕖𝕟 Bot | by 𝕊𝕥𝕖𝕧𝕖𝕟'
};

function printCreatorInfo() {
  console.log('\n╔══════════════════════════════════════╗');
  console.log('║     ✨ STEVEN BOT — BY STEVEN        ║');
  console.log('║     Creator : +201273323087          ║');
  console.log('║     Version : 5.0.0                  ║');
  console.log('╚══════════════════════════════════════╝\n');
}

function getCredit() { return CREATOR.credit; }
function getFooter() { return CREATOR.footer; }
function getStamp() { return CREATOR.stamp; }
function getCreatorJid() { return CREATOR.jid; }
function getCreatorNum() { return CREATOR.number; }

module.exports = { CREATOR, printCreatorInfo, getCredit, getFooter, getStamp, getCreatorJid, getCreatorNum };
