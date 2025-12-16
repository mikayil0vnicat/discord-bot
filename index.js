const http = require("http");
const { Client, GatewayIntentBits, Partials, Events } = require("discord.js");

/* ===============================
   Koyeb Healthcheck (HTTP)
================================ */
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("OK");
}).listen(PORT, () => {
  console.log(`🌐 HTTP server listening on ${PORT}`);
});

/* ===============================
   Discord Client
================================ */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // MEE6 loglarını okuyabilmek için şart
  ],
  partials: [Partials.Channel, Partials.Message],
});

const LOG_CHANNEL_ID = process.env.MEE6_LOG_CHANNEL_ID;

/* ===============================
   Yardımcı: Embed + content birleştir
================================ */
function extractText(message) {
  const parts = [];

  if (message.content) parts.push(message.content);

  if (message.embeds?.length) {
    for (const e of message.embeds) {
      if (e.title) parts.push(`[EMBED TITLE] ${e.title}`);
      if (e.description) parts.push(`[EMBED DESC] ${e.description}`);
      if (e.fields?.length) {
        for (const f of e.fields) {
          parts.push(`[FIELD] ${f.name}: ${f.value}`);
        }
      }
      if (e.footer?.text) parts.push(`[FOOTER] ${e.footer.text}`);
    }
  }

  return parts.join("\n").trim();
}

/* ===============================
   Ready
================================ */
client.once(Events.ClientReady, () => {
  console.log(`✅ Bot ayakta: ${client.user.tag}`);
  console.log(`🧩 MEE6_LOG_CHANNEL_ID: ${LOG_CHANNEL_ID || "YOK"}`);
});

/* ===============================
   LOG KANALI DEBUG DİNLEYİCİ
   (warn gelmese bile MESAJ düşerse log basar)
================================ */
client.on(Events.MessageCreate, async (message) => {
  try {
    if (!LOG_CHANNEL_ID) return;

    if (message.channelId === LOG_CHANNEL_ID) {
      const text = extractText(message);

      console.log("📥 LOG CHANNEL MESSAGE");
      console.log("  author:", message.author?.tag);
      console.log("  bot?:", message.author?.bot);
      console.log("  webhook?:", Boolean(message.webhookId));
      console.log("  messageId:", message.id);
      console.log("  text:");
      console.log(text || "(EMPTY)");
      console.log("--------------------------------------------------");
    }
  } catch (err) {
    console.error("[LOG CHANNEL ERROR]", err);
  }
});

/* ===============================
   Login
================================ */
if (!process.env.TOKEN) {
  console.error("❌ TOKEN yok (Koyeb Environment Variables)");
  process.exit(1);
}

client.login(process.env.TOKEN);

