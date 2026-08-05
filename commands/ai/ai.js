// commands/ai/ai.js
const APIs=require('../../utils/api');
const axios=require('axios');

const gptimage={name:'gptimage',aliases:['imagine','genimage'],category:'ai',description:'Generate AI image (free, no key needed)',
async execute(sock,msg,args,extra){
  const prompt=args.join(' ');if(!prompt)return extra.reply('❌ Usage: .gptimage <description>\nExample: .gptimage a dragon flying over a city at night');
  await extra.reply('🎨 _Generating your image..._');
  try{
    const buf=await APIs.generateImage(prompt);
    await sock.sendMessage(extra.from,{image:buf,caption:`🎨 *Generated Image*\n📝 ${prompt}`},{quoted:msg});
  }catch(e){extra.reply('❌ Image generation failed: '+e.message);}
}};

module.exports=[gptimage];
