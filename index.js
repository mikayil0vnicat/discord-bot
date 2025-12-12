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
  if (!message.guild) return;

  // SADECE BU ROLLER KULLANABİLİR
  const allowedRoles = ["1074347907685294118", "1434952508094152804", "1074347907685294116"];

  const hasAccess = message.member.roles.cache.some(role =>
    allowedRoles.includes(role.name)
  );

  if (!hasAccess) return;

  if (message.content === "!durum") {
    message.reply("✈ Take-off checklist complete.");
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





