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

  // 🔴 1️⃣ MEE6 LOG KANALI KONTROLÜ (HERKES İÇİN)
  if (message.channelId === process.env.MEE6_LOG_CHANNEL_ID) {
    console.log("📌 MEE6 LOG MESAJI ALGILANDI");
    // ileride buraya parse + kayıt gelecek
    return;
  }

  // 🔐 2️⃣ YETKILI ROL ID'LERI
  const ALLOWED_ROLE_IDS = [
    "1074347907652941183", // Boyka
    "1434952508904152804"  // Admin
  ];

  const hasPermission = message.member?.roles.cache.some(role =>
    ALLOWED_ROLE_IDS.includes(role.id)
  );

  const prefix = "!";

// Sadece ! ile başlayan mesajlar komut
if (!message.content.startsWith(prefix)) return;

// Yetki kontrolü SADECE komutlar için
if (!hasPermission) {
  return message.reply("❌ Bu komutu kullanmaya yetkin yok.");
}

  // 🧪 3️⃣ KOMUTLAR
  if (message.content === "!durum") {
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












