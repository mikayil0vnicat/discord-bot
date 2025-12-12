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

  // Sadece sunucuda çalışsın
  if (!message.guild) return;

  // YETKİLİ ROL ID'LERİ
  const allowedRoleIds = [
    "BURAYA_ROLE_ID_1",
    "BURAYA_ROLE_ID_2"
  ];

  const hasAccess = message.member.roles.cache.hasAny(...allowedRoleIds);
  if (!hasAccess) {
    return message.reply("❌ Bu komutu kullanma yetkin yok.");
  }

  if (message.content.trim() === "!durum") {
    return message.reply("✈️ Take-off checklist complete.");
  }
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






