// Koyeb health check için mini HTTP server
const http = require('http');
http.createServer((req, res) => res.end("OK")).listen(process.env.PORT || 3000);
const { Client, GatewayIntentBits, ActivityType } = require('discord.js');

// İstemciyi oluştur
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});
client.on("messageCreate", async (message) => {
  if (message.author.bot) return;
  if (message.content !== "!durum") return;

  // 🔐 YETKİLİ ROL ID'LERİ
  const ALLOWED_ROLE_IDS = [
    "1074347907685294118", // Boyka
    "1434952508094152804"  // Admin
  ];

  const hasPermission = message.member?.roles?.cache?.some(role =>
    ALLOWED_ROLE_IDS.includes(role.id)
  );

  if (!hasPermission) return; // ❌ yetkisizse sessizce yok say

  return message.reply("✈️ Take-off checklist complete.");
});



// Bot hazır olunca çalışır
client.on('ready', () => {
    console.log(client.user.tag + " aktif!");

    client.user.setPresence({
        activities: [
            {
                name: "Yakında en iyi şekilde geleceğim...",
                type: ActivityType.Watching
            }
        ],
        status: "online"
    });
});

// BURAYA YENİ TOKENINI YAZ
client.login(process.env.TOKEN);









