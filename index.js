console.log("✅ BOOT: index.js çalıştı:", new Date().toISOString());

const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require("discord.js");
const http = require("http");

// ==== Render healthcheck için HTTP ====
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("OK");
}).listen(PORT, () => console.log("🌐 Web ping OK on port", PORT));

// ==== ENV ====
const TOKEN = process.env.DISCORD_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;

if (!TOKEN) {
  console.error("❌ DISCORD_TOKEN yok! Render > Environment'a ekle.");
  // Token yoksa bot zaten bağlanamaz, ama web ping yine çalışır.
}

// ==== Sabitler ====
const MEE6_ID = "159985870458322944";
const LOG_CHANNEL_ID = "1449073111495610400";

const ALLOWED_ROLES = [
  "1074347907685294118", // boyka
  "1434952508094152804", // admin
  "1101398761923674152", // !
  "1074347907685294116", // yonetim
  "1074347907685294114", // moderator
];

// ==== Discord Client ====
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel, Partials.Message],
});

// ==== DB (opsiyonel) ====
let pool = null;
let dbReady = false;

async function initDbIfPossible() {
  if (!DATABASE_URL) {
    console.warn("⚠️ DATABASE_URL yok. Bot çalışacak ama DB kaydı yapmayacak.");
    return;
  }

  try {
    const { Pool } = require("pg");
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });

    // Bağlantı test
    await pool.query("SELECT 1");
    console.log("✅ DB bağlantı testi OK");

    // Tablo
    await pool.query(`
      CREATE TABLE IF NOT EXISTS actions (
        id BIGSERIAL PRIMARY KEY,
        guild_id TEXT NOT NULL,
        user_id TEXT NOT NULL,
        moderator_id TEXT,
        action_type TEXT NOT NULL CHECK (action_type IN ('warn','mute')),
        reason TEXT,
        action_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        source_message_id TEXT UNIQUE
      );
    `);

    dbReady = true;
    console.log("✅ DB tablo hazır");
  } catch (e) {
    dbReady = false;
    console.error("❌ DB init hatası (bot kapanmaz):", e?.message || e);
  }
}

function hasPermission(member) {
  return member?.roles?.cache?.some(r => ALLOWED_ROLES.includes(r.id));
}

function pickField(embed, name) {
  return embed.fields?.find(f => f.name?.toLowerCase() === name.toLowerCase())?.value ?? "";
}

function extractId(text) {
  const m = String(text || "").match(/<@!?(\d+)>/);
  return m ? m[1] : null;
}

function parseMee6Embed(message) {
  const e = message.embeds?.[0];
  if (!e) return null;

  const title = (e.title || "").toLowerCase();
  const type =
    title.includes("[warn]") ? "warn" :
    (title.includes("mute") || title.includes("timeout")) ? "mute" :
    null;

  if (!type) return null;

  const user_id = extractId(pickField(e, "Kullanıcı"));
  const moderator_id = extractId(pickField(e, "Moderatör"));
  const reason = pickField(e, "Neden") || "Belirtilmemiş";

  if (!user_id) return null;
  return { type, user_id, moderator_id, reason };
}

client.on("ready", async () => {
  console.log(`✅ Discord bağlandı: ${client.user.tag}`);
  await initDbIfPossible();
});

client.on("messageCreate", async (message) => {
  try {
    if (!message.guildId) return;

    // ---- MEE6 LOG ----
    if (message.channelId === LOG_CHANNEL_ID && message.author?.id === MEE6_ID) {
      const parsed = parseMee6Embed(message);
      if (!parsed) return;

      console.log("📩 MEE6 yakalandı:", parsed);

      if (!dbReady) {
        console.warn("⚠️ DB hazır değil, kayıt atlandı.");
        return;
      }

      try {
        await pool.query(
          `INSERT INTO actions
           (guild_id, user_id, moderator_id, action_type, reason, source_message_id)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (source_message_id) DO NOTHING`,
          [message.guildId, parsed.user_id, parsed.moderator_id, parsed.type, parsed.reason, message.id]
        );
        console.log("✅ DB kayıt OK");
      } catch (e) {
        console.error("❌ DB insert hatası (bot kapanmaz):", e?.message || e);
      }

      return;
    }

    if (message.author.bot) return;

    // ---- !sicil ----
    if (message.content.startsWith("!sicil")) {
      if (!hasPermission(message.member))
        return message.reply("❌ Bu komutu kullanma yetkin yok.");

      const target = message.mentions.users.first();
      if (!target)
        return message.reply("Kullanım: **!sicil @üye**");

      if (!dbReady) {
        return message.reply("⚠️ DB bağlı değil / hazır değil. (DATABASE_URL veya DB bağlantısı kontrol)");
      }

      const { rows } = await pool.query(
        `SELECT action_type, moderator_id, reason, action_at
         FROM actions
         WHERE guild_id=$1 AND user_id=$2
         ORDER BY action_at DESC
         LIMIT 10`,
        [message.guildId, target.id]
      );

      const warn = rows.filter(r => r.action_type === "warn").length;
      const mute = rows.filter(r => r.action_type === "mute").length;

      const embed = new EmbedBuilder()
        .setTitle(`Sicil: ${target.username}`)
        .addFields(
          { name: "Toplam WARN", value: String(warn), inline: true },
          { name: "Toplam MUTE", value: String(mute), inline: true },
          { name: "Toplam Kayıt", value: String(rows.length), inline: true },
        );

      if (rows.length === 0) embed.setDescription("Kayıt yok.");
      else {
        embed.addFields({
          name: "Son Kayıtlar",
          value: rows.map(r =>
            `• **${new Date(r.action_at).toLocaleString("tr-TR")}**
${r.action_type.toUpperCase()} | Mod: <@${r.moderator_id ?? "0"}>
Neden: ${r.reason || "Belirtilmemiş"}`
          ).join("\n\n")
        });
      }

      return message.reply({ embeds: [embed] });
    }
  } catch (err) {
    console.error("❌ messageCreate genel hata:", err?.message || err);
  }
});

// Discord login (token yoksa deneme)
if (TOKEN) client.login(TOKEN);
