# ⚡ STEVEN BOT v4.0 — SETUP GUIDE

---

## 📋 YOUR BOT INFO (already configured)
- **Bot Number:** +201118104987 (this is the WhatsApp the bot runs on)
- **Owner Number:** +201273323087 (YOUR number — only you can use owner commands)
- **Owner Name:** Steven
- **Default Prefix:** `.`

---

## ⚠️ REQUIRED FOR .song COMMAND — Install yt-dlp

The `.song` command needs `yt-dlp` installed on your server. Without it, `.song` will fail.

**On KataBump / Linux VPS, run in your server terminal:**
```bash
pip3 install -U yt-dlp
```
or if pip3 isn't available:
```bash
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp
chmod a+rx /usr/local/bin/yt-dlp
```

Verify it works:
```bash
yt-dlp --version
```

You only need to do this **once**. After that, `.song` will work reliably.

---

## 🚀 STEP 1 — CREATE SERVER ON KATABUMP

1. Go to **https://control.katabump.com**
2. Log in → click **"Create Server"**
3. Choose **Node.js** → **Node.js 18 LTS**
4. Name it anything (e.g. `steven-bot`)
5. Click **Create**

---

## 📁 STEP 2 — UPLOAD FILES

1. In your server panel click **"File Manager"**
2. Click **Upload** → upload **`StevenBot.zip`**
3. Right-click the ZIP → **Unzip / Extract**
4. Make sure `index.js` is in the **root** of your server folder

Your root should look like:
```
index.js
handler.js
config.js
database.js
package.json
commands/
utils/
database/
```

---

## ⚙️ STEP 3 — SET STARTUP COMMAND

1. Go to the **Startup** tab
2. Set the start command to:
```
node --max-old-space-size=256 index.js
```
3. Save

---

## ▶️ STEP 4 — START THE BOT

1. Click the **Console** tab
2. Click **▶ Start**
3. Wait 1–2 minutes for npm to install packages
4. You will see:

```
╔══════════════════════════════════════╗
║  🔑 PAIRING CODE: XXXX-XXXX          ║
╠══════════════════════════════════════╣
║  Open WhatsApp on +201118104987      ║
║  Settings → Linked Devices → Link   ║
║  with phone number → Enter code      ║
╚══════════════════════════════════════╝
```

---

## 📱 STEP 5 — LINK THE BOT NUMBER

1. Open WhatsApp on **+201118104987** (the bot's phone)
2. Tap **⋮ (3 dots)** → **Linked Devices**
3. Tap **Link a Device**
4. Tap **"Link with phone number instead"**
5. Enter the **pairing code** shown in console
6. Done! ✅

The bot will send a message to **your number (+201273323087)** saying it is online.

---

## 🔄 STEP 6 — KEEP IT RUNNING (IMPORTANT!)

KataBump free servers expire every **4 days**.
- Go to control.katabump.com → your server → **Renew**
- You can only renew within **2 days before expiry**
- ⚠️ Set a phone reminder every 3 days!

---

## 👑 YOUR OWNER COMMANDS

These only work from YOUR number (+201273323087):

| Command | What it does |
|---------|-------------|
| `.menu` | Show all commands |
| `.mode public` | Everyone can use bot |
| `.mode private` | Only you + sudo can use |
| `.addsudo +NUMBER` | Add a sudo/elite user |
| `.delsudo +NUMBER` | Remove sudo user |
| `.sudolist` | See all sudo users |
| `.broadcast <msg>` | Send to all groups |
| `.setprefix !` | Change prefix to ! |
| `.setbotname NAME` | Change bot name |
| `.restart` | Restart the bot |
| `.anticall on` | Auto-reject calls |
| `.autoreact on` | Auto-react to messages |
| `.bankai` | ⚠️ Kick everyone from group |
| `.abyss` | Lock group + tag all |

---

## ⭐ SUDO / ELITE TIER

Sudo users = your trusted people. They have **admin power in ALL groups** even without being group admin. They can use every command except owner-only ones.

```
.addsudo 96171234567    ← add by number
.addsudo @mention       ← add by mention  
.delsudo 96171234567    ← remove
.sudolist               ← see full list
```

---

## 🛡️ GROUP ADMIN COMMANDS

Used by group admins (or sudo users in any group):

| Command | What it does |
|---------|-------------|
| `.kick @user` | Kick a member |
| `.promote @user` | Make someone admin |
| `.demote @user` | Remove admin |
| `.warn @user` | Warn (3 = auto kick) |
| `.resetwarn @user` | Clear their warns |
| `.tagall <msg>` | Tag everyone |
| `.hidetag <msg>` | Silent tag everyone |
| `.mute` | Only admins can send |
| `.unmute` | Everyone can send |
| `.antilink on/off` | Delete links auto |
| `.antigroupmention on/off` | Block @everyone |
| `.antitag on/off` | Block mass tagging |
| `.autosticker on/off` | Auto sticker images |
| `.welcome on/off` | Welcome new members |
| `.goodbye on/off` | Goodbye leaving members |
| `.setwelcome <msg>` | Custom welcome text |
| `.setgoodbye <msg>` | Custom goodbye text |
| `.grouplink` | Get invite link |
| `.delete` | Delete replied message |

---

## 🎞️ MEDIA DOWNLOAD COMMANDS

| Command | What it does |
|---------|-------------|
| `.tiktok <url>` | TikTok no watermark |
| `.instagram <url>` | Instagram post/reel |
| `.facebook <url>` | Facebook video |
| `.twitter <url>` | Twitter/X video |
| `.ytvideo <title/url>` | YouTube video |
| `.song <title/url>` | YouTube audio/MP3 |
| `.pinterest <url>` | Pinterest image/video |
| `.lyrics <song - artist>` | Song lyrics |

---

## 🎭 FUN COMMANDS

| Command | What it does |
|---------|-------------|
| `.marry @user` | Propose marriage 💍 |
| `.accept` | Accept proposal |
| `.reject` | Reject proposal |
| `.divorce` | End marriage |
| `.spouse` | Check who someone married |
| `.hug/kiss/slap/poke @user` | Social reactions |
| `.pat/bite/cuddle/punch @user` | More reactions |
| `.pies <country>` | Girl photo by country |
| `.ship @user1 @user2` | Ship two people |
| `.gayrate @user` | Fun gay rate meter |
| `.tictactoe` | Play vs bot |
| `.truth` | Truth question |
| `.dare` | Dare challenge |
| `.joke` | Random joke |
| `.meme` | Reddit meme |
| `.flirt` | Pickup line |
| `.bomb` | Explosion animation |

---

## 🌍 PIES COUNTRIES

`.pies lebanon` `.pies egypt` `.pies russia` `.pies ukraine` `.pies turkey`
`.pies france` `.pies italy` `.pies spain` `.pies germany` `.pies brazil`
`.pies colombia` `.pies mexico` `.pies india` `.pies japan` `.pies korea`
`.pies thailand` `.pies morocco` `.pies jordan` `.pies iraq` `.pies syria`
`.pies algeria` `.pies saudi` `.pies uae` `.pies iran` `.pies usa`
`.pies philippines` `.pies indonesia` `.pies nigeria` `.pies greece`
`.pies romania` `.pies argentina` `.pies vietnam` `.pies china`
...and 20+ more! Type `.pies` alone to see the full list.

---

## 👾 ANIME COMMANDS

**SFW:** `.anime` `.waifu` `.neko` `.megumin` `.loli` `.konachan` `.random`

**NSFW 🔞:** `.hanime` `.hwaifu` `.hneko` `.milf`

Usage: `.hanime neko` `.anime waifu` `.hanime milf`

NSFW types: waifu, neko, milf, hentai, ecchi, feet, yuri, blowjob, trap

---

## 🖋️ TEXT EFFECTS

`.fire` `.neon` `.glitch` `.matrix` `.hacker` `.ice` `.thunder` `.devil`
`.snow` `.metallic` `.sand` `.light` `.leaves` `.purple` `.arena`
`.blackpink` `.impressive` `.1917`

Usage: `.fire Steven Bot`

---

## ❓ TROUBLESHOOTING

| Problem | Fix |
|---------|-----|
| Pairing code not showing | Wait 30s after start, check console |
| Bot not responding to anyone | Check `.mode public` |
| Admin commands not working | Bot must be group admin |
| TikTok/media failed | Try again, APIs sometimes timeout |
| Session expired | Delete `session/` folder, restart, re-pair |
| Server expired | Go to KataBump and click Renew |
| Bot crashed | Click Restart in console |
