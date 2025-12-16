require("dotenv").config();

const { Client, GatewayIntentBits, Partials } = require("discord.js");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

process.on("unhandledRejection", (err) => {
  console.error("[unhandledRejection]", err);
});

process.on("uncaughtException", (err) => {
  console.error("[uncaughtException]", err);
});

client.once("ready", () => {
  console.log(`✅ Bot ayakta: ${client.user.tag}`);
});

if (!process.env.TOKEN) {
  console.error("❌ TOKEN yok. .env dosyasına TOKEN=... ekle");
  process.exit(1);
}

client.login(process.env.TOKEN);
