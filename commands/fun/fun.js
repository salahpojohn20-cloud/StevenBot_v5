// commands/fun/fun.js — All fun commands
const db=require('../../database');
const APIs=require('../../utils/api');
const axios=require('axios');

// ── Marriage system ───────────────────────────────────────────────────────────
const marry={name:'marry',aliases:['propose'],category:'fun',description:'💍 Propose to someone',
async execute(sock,msg,args,extra){
  const men=msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  const t=men&&men[0];if(!t)return extra.reply('💍 Usage: .marry @user');
  if(t===extra.sender)return extra.reply('❌ You cannot marry yourself!');
  const tNum=t.split('@')[0].split(':')[0];
  if(db.getMarriage(extra.senderNum||extra.sender.split('@')[0]))return extra.reply('💔 You are already married! Use .divorce first.');
  if(db.getMarriage(tNum))return extra.reply(`💔 @${tNum} is already married to someone!`);
  db.setProposal(extra.senderNum||extra.sender.split('@')[0],tNum);
  await sock.sendMessage(extra.from,{text:`💍 *Marriage Proposal!*\n\n@${extra.senderNum||extra.sender.split('@')[0]} is proposing to @${tNum}!\n\n@${tNum} — type *.accept* to accept or *.reject* to decline 💕`,mentions:[extra.sender,t]},{quoted:msg});
}};

const accept={name:'accept',category:'fun',description:'Accept a marriage proposal',
async execute(sock,msg,args,extra){
  const sNum=extra.senderNum||extra.sender.split('@')[0];
  const proposals=db.getProposals();
  const key=Object.keys(proposals).find(k=>k.endsWith(`→${sNum}`));
  if(!key)return extra.reply('💔 No pending proposals for you.');
  const proposerNum=key.split('→')[0];
  db.setMarriage(sNum,proposerNum);db.clearProposal(key);
  await sock.sendMessage(extra.from,{text:`💒 *MARRIED!* 🎉\n\n💑 @${proposerNum} & @${sNum} are now married!\n\n❤️ Congratulations!`,mentions:[`${proposerNum}@s.whatsapp.net`,extra.sender]},{quoted:msg});
}};

const reject={name:'reject',category:'fun',description:'Reject a proposal',
async execute(sock,msg,args,extra){
  const sNum=extra.senderNum||extra.sender.split('@')[0];
  const proposals=db.getProposals();
  const key=Object.keys(proposals).find(k=>k.endsWith(`→${sNum}`));
  if(!key)return extra.reply('💔 No pending proposals.');
  const proposerNum=key.split('→')[0];
  db.clearProposal(key);
  await sock.sendMessage(extra.from,{text:`💔 @${sNum} rejected @${proposerNum}'s proposal!\n\n😢 Better luck next time...`,mentions:[extra.sender,`${proposerNum}@s.whatsapp.net`]},{quoted:msg});
}};

const divorce={name:'divorce',category:'fun',description:'Divorce your spouse 💔',
async execute(sock,msg,args,extra){
  const sNum=extra.senderNum||extra.sender.split('@')[0];
  const spouse=db.getMarriage(sNum);
  if(!spouse)return extra.reply('💔 You are not married to anyone!');
  db.deleteMarriage(sNum);
  await sock.sendMessage(extra.from,{text:`💔 *Divorced!*\n\n@${sNum} and @${spouse} are now divorced.\n\n😢 It is over...`,mentions:[extra.sender,`${spouse}@s.whatsapp.net`]},{quoted:msg});
}};

const spouse={name:'spouse',aliases:['married','partner'],category:'fun',description:'Check marriage status',
async execute(sock,msg,args,extra){
  const men=msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  const t=men&&men[0];
  const checkNum=t?t.split('@')[0].split(':')[0]:(extra.senderNum||extra.sender.split('@')[0]);
  const partner=db.getMarriage(checkNum);
  if(!partner)return extra.reply(`💔 ${t?`@${checkNum}`:'You'} ${t?'is':'are'} not married.`);
  await sock.sendMessage(extra.from,{text:`💑 @${checkNum} is married to @${partner} ❤️`,mentions:t?[t,`${partner}@s.whatsapp.net`]:[extra.sender,`${partner}@s.whatsapp.net`]},{quoted:msg});
}};

// ── Social reactions ──────────────────────────────────────────────────────────
const makeReaction=(name,emoji,textFn,apiType)=>({name,category:'fun',description:`${emoji} ${name.charAt(0).toUpperCase()+name.slice(1)} someone`,
async execute(sock,msg,args,extra){
  const men=msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  const t=men&&men[0];if(!t)return extra.reply(`${emoji} Usage: .${name} @user`);
  const caption=textFn(extra.pushName||extra.senderNum||extra.sender.split('@')[0],`@${t.split('@')[0].split(':')[0]}`);
  try{const buf=await APIs.anime(apiType,false);await sock.sendMessage(extra.from,{image:buf,caption,mentions:[t]},{quoted:msg});}
  catch{await sock.sendMessage(extra.from,{text:caption,mentions:[t]},{quoted:msg});}
}});

const hug=makeReaction('hug','🤗',(a,b)=>`🤗 ${a} hugs ${b}!`,'hug');
const kiss=makeReaction('kiss','💋',(a,b)=>`💋 ${a} kisses ${b}!`,'kiss');
const slap=makeReaction('slap','👋',(a,b)=>`👋 ${a} slaps ${b}!`,'slap');
const pat=makeReaction('pat','🥺',(a,b)=>`🥺 ${a} pats ${b}!`,'pat');
const poke=makeReaction('poke','👉',(a,b)=>`👉 ${a} pokes ${b}!`,'poke');
const bite=makeReaction('bite','😬',(a,b)=>`😬 ${a} bites ${b}!`,'bite');
const cuddle=makeReaction('cuddle','🥰',(a,b)=>`🥰 ${a} cuddles ${b}!`,'cuddle');
const punch=makeReaction('punch','👊',(a,b)=>`👊 ${a} punches ${b}!`,'kick');
const lick=makeReaction('lick','👅',(a,b)=>`👅 ${a} licks ${b}!`,'lick');

// ── Pies ──────────────────────────────────────────────────────────────────────
const COUNTRIES=['lebanon','egypt','russia','ukraine','turkey','france','italy','spain','germany','brazil','colombia','mexico','india','japan','korea','thailand','morocco','jordan','iraq','syria','algeria','saudi','uae','philippines','indonesia','malaysia','nigeria','greece','poland','romania','argentina','venezuela','peru','iran','pakistan','vietnam','china','usa','portugal','serbia','croatia','sweden','norway','denmark','finland','netherlands','kuwait','qatar','ethiopia','kenya','ghana','cuba','chile','southafrica'];

// ── Games & Fun ───────────────────────────────────────────────────────────────
const ship={name:'ship',category:'fun',description:'💘 Ship two people',
async execute(sock,msg,args,extra){
  const men=msg.message?.extendedTextMessage?.contextInfo?.mentionedJid||[];
  let p1,p2;
  if(men.length>=2){p1='@'+men[0].split('@')[0].split(':')[0];p2='@'+men[1].split('@')[0].split(':')[0];}
  else{const parts=args.join(' ').split(/[&+,]/);p1=parts[0]?.trim()||'Person1';p2=parts[1]?.trim()||'Person2';}
  const score=Math.floor(Math.random()*101);
  const bar='█'.repeat(Math.floor(score/10))+'░'.repeat(10-Math.floor(score/10));
  const res=score>=80?'💞 Perfect Match!':score>=60?'💕 Great!':score>=40?'💛 Good Friends':score>=20?'🤝 Acquaintances':'💔 Not Compatible';
  extra.reply(`💘 *Ship*\n\n👤 ${p1}\n👤 ${p2}\n\n[${bar}] ${score}%\n\n${res}`);
}};

const gayrate={name:'gayrate',category:'fun',description:'🌈 Fun gay rate',
async execute(sock,msg,args,extra){
  const men=msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  const t=men&&men[0];const name=t?`@${t.split('@')[0].split(':')[0]}`:(args.join(' ')||'you');
  const rate=Math.floor(Math.random()*101);
  const bar='🏳️‍🌈'.repeat(Math.floor(rate/20))+'⬜'.repeat(5-Math.floor(rate/20));
  const res=rate>80?'Absolutely fabulous! 💅':rate>60?'Pretty gay! 🌈':rate>40?'Somewhat 😏':rate>20?'A little 🤷':'Straight as an arrow! 📏';
  await sock.sendMessage(extra.from,{text:`🌈 *Gay Rate*\n\n👤 ${name}\n\n${bar} ${rate}%\n\n${res}`,mentions:t?[t]:[]},{quoted:msg});
}};

const bomb={name:'bomb',category:'fun',description:'💣 Explosion animation',
async execute(sock,msg,args,extra){
  const frames=['💣','💣 .','💣 . .','💣 . . .','💥','💥💥','💥💥💥','🔥💥🔥\n💥💥💥\n🔥💥🔥','☁️💨 All gone! 😂'];
  for(const f of frames){await sock.sendMessage(extra.from,{text:f},{quoted:msg});await new Promise(r=>setTimeout(r,500));}
}};

const JOKES=['Why dont scientists trust atoms? Because they make up everything! 😂','I told my wife she was drawing eyebrows too high. She looked surprised 😳','What do you call fake spaghetti? An impasta! 🍝','Why cant Elsa have a balloon? She will let it go 🎈'];
const joke={name:'joke',category:'fun',description:'😂 Random joke',
async execute(sock,msg,args,extra){
  try{const r=await axios.get('https://v2.jokeapi.dev/joke/Any?blacklistFlags=racist,sexist&type=twopart',{timeout:5000});extra.reply(`😂 *Joke*\n\n*Q:* ${r.data.setup}\n\n*A:* ${r.data.delivery}`);}
  catch{extra.reply(`😂 *Joke*\n\n${JOKES[Math.floor(Math.random()*JOKES.length)]}`);}
}};

const FLIRTS=['Are you a WiFi signal? Because I feel a strong connection 📶','Is your name Google? You have everything I have been searching for 🔍','Are you a camera? Every time I look at you I smile 📸','I must be a snowflake because I have fallen for you ❄️','Are you made of copper and tellurium? Because you are CuTe 🧪'];
const flirt={name:'flirt',category:'fun',description:'😘 Flirty pickup line',async execute(sock,msg,args,extra){extra.reply(`💘 *Flirt*\n\n${FLIRTS[Math.floor(Math.random()*FLIRTS.length)]}`);} };

const COMPLIMENTS=['You are the reason someone smiles today 😊','Your kindness is like a ray of sunshine ☀️','You have the best energy in the room 😄','You inspire everyone around you 🌟','You are stronger than you think 💪'];
const compliment={name:'compliment',category:'fun',description:'💝 Give a compliment',async execute(sock,msg,args,extra){extra.reply(`💝 *Compliment*\n\n${COMPLIMENTS[Math.floor(Math.random()*COMPLIMENTS.length)]}`);} };

const INSULTS=['You are not stupid, you just have bad luck thinking 🧠','I would roast you but my mom said I cannot burn trash 🗑️🔥','You are like a cloud — when you disappear it is a beautiful day ☁️','I would explain it but I left my crayons at home 🖍️'];
const insult={name:'insult',category:'fun',description:'🔥 Fun roast',async execute(sock,msg,args,extra){extra.reply(`🔥 *Roast*\n\n${INSULTS[Math.floor(Math.random()*INSULTS.length)]}`);} };

const TRUTHS=['What is the most embarrassing thing that ever happened to you? 😳','Have you ever lied to get out of trouble? 🤥','Who is your secret crush right now? 💕','What is a bad habit you try to hide? 🙈','Who in this group do you find most attractive? 😍'];
const truth={name:'truth',category:'fun',description:'💯 Truth question',async execute(sock,msg,args,extra){extra.reply(`💯 *TRUTH*\n\n${TRUTHS[Math.floor(Math.random()*TRUTHS.length)]}`);} };

const DARES=['Send a voice note singing your favorite song 🎤','Change your profile picture to a meme for 1 hour 😂','Do 20 push-ups and send proof 💪','Text your crush something nice 😍','Speak in rhymes for the next 10 minutes 🎵'];
const dare={name:'dare',category:'fun',description:'🎯 Dare challenge',async execute(sock,msg,args,extra){extra.reply(`🎯 *DARE*\n\n${DARES[Math.floor(Math.random()*DARES.length)]}`);} };

// Tic Tac Toe
const tttGames={};
const renderTTT=b=>{const s={0:'⬜','X':'❌','O':'⭕'};let o='';for(let i=0;i<3;i++)o+=b.slice(i*3,i*3+3).map(c=>s[c]||'⬜').join('')+'\n';return o;};
const checkTTT=b=>{const w=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];for(const[a,b2,c]of w)if(b[a]&&b[a]===b[b2]&&b[a]===b[c])return b[a];return b.every(c=>c!==0)?'draw':null;};
const botTTT=b=>{const w=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];for(const p of['O','X'])for(const[a,b2,c]of w){const cells=[b[a],b[b2],b[c]];if(cells.filter(x=>x===p).length===2&&cells.includes(0))return[a,b2,c][cells.indexOf(0)];}if(b[4]===0)return 4;const free=b.map((v,i)=>v===0?i:-1).filter(i=>i>=0);return free[Math.floor(Math.random()*free.length)];};
const tictactoe={name:'tictactoe',aliases:['ttt'],category:'fun',description:'🎮 Play Tic Tac Toe',
async execute(sock,msg,args,extra){
  const cmd=args[0]?.toLowerCase();const gid=extra.from+':'+(extra.senderNum||extra.sender.split('@')[0]);
  if(!cmd||cmd==='start'){tttGames[gid]={board:Array(9).fill(0)};return extra.reply(`🎮 *Tic Tac Toe*\n\nYou❌ vs Bot⭕\n\n${renderTTT(tttGames[gid].board)}\n1️⃣2️⃣3️⃣\n4️⃣5️⃣6️⃣\n7️⃣8️⃣9️⃣\n\nType .ttt <1-9>`);}
  const pos=parseInt(cmd)-1;const g=tttGames[gid];if(!g)return extra.reply('❌ No game. Type .ttt start');
  if(isNaN(pos)||pos<0||pos>8)return extra.reply('❌ Pick 1-9');
  if(g.board[pos]!==0)return extra.reply('❌ Spot taken!');
  g.board[pos]='X';let r=checkTTT(g.board);
  if(r){delete tttGames[gid];return extra.reply(`${renderTTT(g.board)}\n${r==='draw'?'🤝 Draw!':r==='X'?'🎉 You win!':'🤖 Bot wins!'}`);}
  const bp=botTTT(g.board);g.board[bp]='O';r=checkTTT(g.board);
  if(r){delete tttGames[gid];return extra.reply(`${renderTTT(g.board)}\n${r==='draw'?'🤝 Draw!':r==='O'?'🤖 Bot wins!':'🎉 You win!'}`);}
  extra.reply(`${renderTTT(g.board)}\n⏳ Your turn!`);
}};

// Extra fun
const eightball={name:'8ball',aliases:['ask8'],category:'fun',description:'🎱 Magic 8 ball',
async execute(sock,msg,args,extra){
  const q=args.join(' ');if(!q)return extra.reply('❌ Ask a question!');
  const a=['🎱 It is certain.','🎱 Without a doubt.','🎱 Yes, definitely.','🎱 Most likely.','🎱 Signs point to yes.','🎱 Reply hazy, try again.','🎱 Ask again later.','🎱 Cannot predict now.','🎱 Do not count on it.','🎱 My reply is no.','🎱 Very doubtful.','🎱 Absolutely not.'];
  extra.reply(`🎱 *Question:* ${q}\n\n${a[Math.floor(Math.random()*a.length)]}`);
}};

const roast={name:'roast',category:'fun',description:'🔥 Roast someone hard',
async execute(sock,msg,args,extra){
  const men=msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  const t=men&&men[0];const name=t?`@${t.split('@')[0].split(':')[0]}`:(args.join(' ')||'you');
  const roasts=[`${name} is the human version of a participation trophy.`,`${name} has the energy of a phone at 2% battery.`,`${name} is the reason shampoo bottles have instructions.`,`If ${name} was a spice, they would be flour.`,`${name}'s birth certificate is an apology letter.`,`${name} could not pour water out of a boot if instructions were on the heel.`];
  await sock.sendMessage(extra.from,{text:`🔥 *ROASTED*\n\n${roasts[Math.floor(Math.random()*roasts.length)]}`,mentions:t?[t]:[]},{quoted:msg});
}};

const rizz={name:'rizz',aliases:['pickup'],category:'fun',description:'😏 Rizz line',
async execute(sock,msg,args,extra){
  const lines=['Are you a WiFi? I feel a connection 📶','Do you have a name or can I call you mine?','Are you a charger? I am dead without you 🔋','You must be tired — running through my mind all day.','Are you French? Because Eiffel for you.'];
  extra.reply(`😏 *Rizz*\n\n"${lines[Math.floor(Math.random()*lines.length)]}"`);
}};

const coinflip={name:'coinflip',aliases:['flip','coin'],category:'fun',description:'🪙 Flip a coin',async execute(sock,msg,args,extra){extra.reply(`🪙 Flipping...\n\nResult: ${Math.random()<0.5?'*HEADS* 👑':'*TAILS* 🔄'}`);} };
const dice={name:'dice',aliases:['roll'],category:'fun',description:'🎲 Roll a dice',async execute(sock,msg,args,extra){const s=Math.min(Math.max(parseInt(args[0])||6,2),100);extra.reply(`🎲 Rolled a ${s}-sided dice\n\nResult: *${Math.floor(Math.random()*s)+1}*`);} };

const rps={name:'rps',category:'fun',description:'✂️ Rock Paper Scissors',
async execute(sock,msg,args,extra){
  const choices=['rock','paper','scissors'];const emojis={rock:'🪨',paper:'📄',scissors:'✂️'};
  const user=args[0]?.toLowerCase();if(!choices.includes(user))return extra.reply('❌ .rps rock/paper/scissors');
  const bot=choices[Math.floor(Math.random()*3)];
  let res;if(user===bot)res='🤝 Tie!';else if((user==='rock'&&bot==='scissors')||(user==='paper'&&bot==='rock')||(user==='scissors'&&bot==='paper'))res='🎉 You win!';else res='🤖 Bot wins!';
  extra.reply(`${emojis[user]} vs ${emojis[bot]}\n\n${res}`);
}};

const wyr={name:'wyr',category:'fun',description:'🤔 Would you rather',
async execute(sock,msg,args,extra){
  const q=[['Never use social media again','Never watch TV/movies again'],['Be able to fly','Be invisible'],['Have more time','Have more money'],['Know how you will die','Know when you will die'],['Talk to animals','Read minds']];
  const pick=q[Math.floor(Math.random()*q.length)];extra.reply(`🤔 *Would You Rather...*\n\n🅰️ ${pick[0]}\n\n*OR*\n\n🅱️ ${pick[1]}\n\n_Reply A or B!_`);
}};

const nhie={name:'nhie',category:'fun',description:'🙌 Never have I ever',
async execute(sock,msg,args,extra){
  const list=['Never have I ever lied to get out of trouble.','Never have I ever ghosted someone.','Never have I ever cried at a movie.','Never have I ever sent a text to the wrong person.','Never have I ever pretended to be asleep to avoid someone.','Never have I ever stayed up 24+ hours straight.'];
  extra.reply(`🙌 *Never Have I Ever*\n\n${list[Math.floor(Math.random()*list.length)]}\n\n_Type 🖐️ if you have!_`);
}};

const fact={name:'fact',aliases:['randomfact'],category:'fun',description:'🧠 Random fact',
async execute(sock,msg,args,extra){
  try{const r=await axios.get('https://uselessfacts.jsph.pl/random.json?language=en',{timeout:8000});extra.reply(`🧠 *Fact*\n\n${r.data?.text||'Try again!'}`);}
  catch{const f=['Honey never spoils — 3000 year old honey was found edible in Egypt.','A group of flamingos is called a flamboyance.','Wombats produce cube-shaped droppings.','Bananas are technically berries but strawberries are not.'];extra.reply(`🧠 *Fact*\n\n${f[Math.floor(Math.random()*f.length)]}`);}
}};

const quote={name:'quote',aliases:['motivation'],category:'fun',description:'💬 Inspirational quote',
async execute(sock,msg,args,extra){
  try{const r=await axios.get('https://api.quotable.io/random',{timeout:8000});extra.reply(`💬 *"${r.data.content}"*\n\n— _${r.data.author}_`);}
  catch{const q=[['"Do not watch the clock. Keep going."','Sam Levenson'],['"The only way to do great work is to love what you do."','Steve Jobs'],['"In the middle of every difficulty lies opportunity."','Einstein']];const p=q[Math.floor(Math.random()*q.length)];extra.reply(`💬 *${p[0]}*\n\n— _${p[1]}_`);}
}};

const horoscope={name:'horoscope',aliases:['zodiac'],category:'fun',description:'♈ Daily horoscope\nUsage: .horoscope <sign>',
async execute(sock,msg,args,extra){
  const sign=args[0]?.toLowerCase();const signs=['aries','taurus','gemini','cancer','leo','virgo','libra','scorpio','sagittarius','capricorn','aquarius','pisces'];
  if(!sign||!signs.includes(sign))return extra.reply(`♈ Usage: .horoscope <sign>\n\nSigns: ${signs.join(', ')}`);
  const emojis={aries:'♈',taurus:'♉',gemini:'♊',cancer:'♋',leo:'♌',virgo:'♍',libra:'♎',scorpio:'♏',sagittarius:'♐',capricorn:'♑',aquarius:'♒',pisces:'♓'};
  try{const r=await axios.post('https://aztro.sameerkumar.website/',null,{params:{sign,day:'today'},timeout:8000});const d=r.data;extra.reply(`${emojis[sign]} *${sign.charAt(0).toUpperCase()+sign.slice(1)} — Today*\n\n📖 ${d.description}\n\n💫 Lucky #: ${d.lucky_number}\n🎨 Color: ${d.color}\n❤️ Compatibility: ${d.compatibility}`);}
  catch{const msgs=['The stars say: take it easy today.','Today is powerful for decisions. Trust your gut.','The universe is aligning in your favor.'];extra.reply(`${emojis[sign]} *${sign}*\n\n${msgs[Math.floor(Math.random()*msgs.length)]}`);}
}};

const password={name:'password',aliases:['genpass'],category:'fun',description:'🔐 Generate strong password',
async execute(sock,msg,args,extra){
  const len=Math.min(Math.max(parseInt(args[0])||16,8),32);
  const chars='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_+-=';
  let pass='';for(let i=0;i<len;i++)pass+=chars[Math.floor(Math.random()*chars.length)];
  extra.reply(`🔐 *Password (${len} chars)*\n\n\`${pass}\`\n\n⚠️ _Do not share this!_`);
}};

const tweet={name:'tweet',aliases:['faketweet'],category:'fun',description:'🐦 Generate fake tweet',
async execute(sock,msg,args,extra){
  const men=msg.message?.extendedTextMessage?.contextInfo?.mentionedJid;
  const t=men&&men[0];
  const name=t?t.split('@')[0].split(':')[0]:(args[0]||extra.pushName||'User');
  const content=t?args.join(' '):args.slice(1).join(' ');
  if(!content)return extra.reply('❌ Usage: .tweet @user <text> or .tweet <name> <text>');
  const likes=Math.floor(Math.random()*50000)+100;const rts=Math.floor(Math.random()*10000)+50;
  extra.reply(`🐦 *Fake Tweet*\n\n👤 @${name}\n━━━━━━━━━━━━\n${content}\n━━━━━━━━━━━━\n❤️ ${likes.toLocaleString()}  🔁 ${rts.toLocaleString()}`);
}};

const age={name:'age',aliases:['birthday'],category:'fun',description:'🎂 Calculate age\nUsage: .age DD/MM/YYYY',
async execute(sock,msg,args,extra){
  const input=args[0];if(!input)return extra.reply('❌ Usage: .age <DD/MM/YYYY>');
  const[d,m,y]=input.split('/').map(Number);if(!d||!m||!y)return extra.reply('❌ Format: DD/MM/YYYY');
  const now=new Date();const born=new Date(y,m-1,d);let years=now.getFullYear()-born.getFullYear();let months=now.getMonth()-born.getMonth();
  if(months<0||(months===0&&now.getDate()<born.getDate())){years--;months+=12;}
  const nextBd=new Date(now.getFullYear(),m-1,d);if(nextBd<now)nextBd.setFullYear(now.getFullYear()+1);
  const days=Math.ceil((nextBd-now)/86400000);
  extra.reply(`🎂 *Age Calculator*\n\n📅 Born: ${d}/${m}/${y}\n🎉 Age: *${years} years*, ${months} months\n🗓️ Next birthday in: ${days} days${days===0?'\n\n🎊 *Happy Birthday!!*':''}`);
}};

module.exports=[marry,accept,reject,divorce,spouse,hug,kiss,slap,pat,poke,bite,cuddle,punch,lick,ship,gayrate,bomb,joke,flirt,compliment,insult,truth,dare,tictactoe,eightball,roast,rizz,coinflip,dice,rps,wyr,nhie,fact,quote,horoscope,password,tweet,age];
