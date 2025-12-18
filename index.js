console.log("✅ BOOT:", new Date().toISOString());

const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require("discord.js");
const http = require("http");

/* ================== HEALTHCHECK ================== */
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
  })
  .listen(PORT, () => console.log("🌐 Web ping OK on port", PORT));

/* ================== ENV ================== */
const TOKEN = process.env.DISCORD_TOKEN;
const DATABASE_URL = process.env.DATABASE_URL;
const LOG_CHANNEL_ID = process.env.MEE6_LOG_CHANNEL_ID;

const MEE6_ID = "159985870458322944"; // sabit

const ALLOWED_ROLES = [
  "1074347907685294118", // boyka
  "1434952508094152804", // admin
  "1101398761923674152", // !
  "1074347907685294116", // yonetim
  "1074347907685294114", // moderator
];

if (!TOKEN) console.error("❌ DISCORD_TOKEN yok!");
if (!DATABASE_URL) console.warn("⚠️ DATABASE_URL yok (DB'siz çalışır)");
if (!LOG_CHANNEL_ID) console.error("❌ MEE6_LOG_CHANNEL_ID yok! (Mee6 yakalanamaz)");

/* ================== DISCORD CLIENT ================== */
const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  partials: [Partials.Channel, Partials.Message],
});

/* ================== DB (opsiyonel ama biz kullanacağız) ================== */
let pool = null;
let dbReady = false;

async function initDb() {
  if (!DATABASE_URL) return;

  try {
    const { Pool } = require("pg");
    pool = new Pool({
      connectionString: DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });

    await pool.query("SELECT 1");
    console.log("✅ DB bağlantı testi OK");

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

/* ================== HELPERS ================== */
function hasPermission(member) {
  return member?.roles?.cache?.some((r) => ALLOWED_ROLES.includes(r.id));
}

function extractIdFromMention(text) {
  const m = String(text || "").match(/<@!?(\d+)>/);
  return m ? m[1] : null;
}

/**
 * Senin format:
 * embed.title = null
 * embed.description gibi:
 *  "arch_joker uyarıldı\nSebep: calisma123"
 */
function parseMee6Embed(message) {
  const e = message.embeds?.[0];
  if (!e) return null;

  const title = (e.title || "").trim();
  const desc = (e.description || "").trim();
  const raw = `${title}\n${desc}`.trim();
  const allText = raw.toLowerCase();

  // Tür tespiti (title yoksa desc'ten)
  const type =
    allText.includes("[warn]") || allText.includes("uyarıldı") || allText.includes("warn")
      ? "warn"
      : allText.includes("[mute]") || allText.includes("timeout") || allText.includes("mute") || allText.includes("sustur")
      ? "mute"
      : null;

  if (!type) return null;

  // Önce mention'dan ID yakala (bazı ayarlarda mention gelebilir)
  let user_id = extractIdFromMention(raw);

  // Mention yoksa username çıkar (ilk kelime)
  let username = null;
  if (!user_id) {
    const firstLine = (title || desc).split("\n")[0] || "";
    // "arch_joker uyarıldı" -> "arch_joker"
    username = firstLine.split(" ")[0].trim() || null;
  }

  // Sebep
  let reason = "Belirtilmemiş";
  const reasonMatch = raw.match(/Sebep:\s*(.+)/i);
  if (reasonMatch && reasonMatch[1]) reason = reasonMatch[1].trim();

  return {
    type,
    user_id,      // null olabilir
    username,     // null olabilir
    moderator_id: null,
    reason,
  };
}

/* ================== READY ================== */
client.on("ready", async () => {
  console.log(`✅ Discord bağlandı: ${client.user.tag}`);
  console.log("ℹ️ Mee6 log kanal ID (ENV):", LOG_CHANNEL_ID);
  await initDb();
});

/* ================== MESSAGE ================== */
client.on("messageCreate", async (message) => {
  try {
    if (!message.guildId) return;

    // Debug: log kanalına gelen her mesajı yaz
    if (LOG_CHANNEL_ID && message.channelId === LOG_CHANNEL_ID) {
      console.log("🧪 LOG-CHANNEL MESSAGE:", {
        channelId: message.channelId,
        authorId: message.author?.id,
        authorName: message.author?.username,
        isWebhook: Boolean(message.webhookId),
        contentLen: message.content?.length || 0,
        embedCount: message.embeds?.length || 0,
        embedTitle: message.embeds?.[0]?.title || null,
        embedDescPreview: (message.embeds?.[0]?.description || "").slice(0, 120) || null,
      });
    }

    // Mee6 mi? (sende webhook olarak geliyor)
    const isMee6 =
      message.author?.id === MEE6_ID ||
      (message.author?.username || "").toLowerCase().includes("mee6") ||
      Boolean(message.webhookId); // log kanalında webhook -> çoğu zaman mee6

    // Mee6 log kanalındaysa işle
    if (LOG_CHANNEL_ID && message.channelId === LOG_CHANNEL_ID && isMee6) {
      const parsed = parseMee6Embed(message);
      console.log("📩 MEE6 görüldü. parsed=", parsed);

      if (!parsed) return;

      // user_id yoksa username ile bul (cache + fetch)
      if (!parsed.user_id && parsed.username) {
        let member =
          message.guild.members.cache.find(
            (m) => m.user.username.toLowerCase() === parsed.username.toLowerCase()
          );

        if (!member) {
          try {
            await message.guild.members.fetch({ query: parsed.username, limit: 10 });
            member =
              message.guild.members.cache.find(
                (m) => m.user.username.toLowerCase() === parsed.username.toLowerCase()
              );
          } catch {}
        }

        if (!member) {
          console.warn("❌ Kullanıcı bulunamadı (username):", parsed.username);
          return;
        }

        parsed.user_id = member.id;
      }

      if (!parsed.user_id) {
        console.warn("❌ user_id bulunamadı, kayıt atlandı:", parsed);
        return;
      }

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
          [
            message.guildId,
            parsed.user_id,
            parsed.moderator_id,
            parsed.type,
            parsed.reason,
            message.id,
          ]
        );
        console.log("✅ DB kayıt OK");
      } catch (e) {
        console.error("❌ DB insert hatası:", e?.message || e);
      }

      return;
    }

    // Komutlar botlardan gelmesin
    if (message.author.bot) return;

    // !sicil
    if (message.content.startsWith("!sicil")) {
      if (!hasPermission(message.member))
        return message.reply("❌ Bu komutu kullanma yetkin yok.");

      const target = message.mentions.users.first();
      if (!target) return message.reply("Kullanım: **!sicil @üye**");

      if (!dbReady) return message.reply("⚠️ DB hazır değil / bağlı değil.");

      const { rows } = await pool.query(
        `SELECT action_type, moderator_id, reason, action_at
         FROM actions
         WHERE guild_id=$1 AND user_id=$2
         ORDER BY action_at DESC
         LIMIT 10`,
        [message.guildId, target.id]
      );

      const warn = rows.filter((r) => r.action_type === "warn").length;
      const mute = rows.filter((r) => r.action_type === "mute").length;

      const embed = new EmbedBuilder()
        .setTitle(`Sicil: ${target.username}`)
        .addFields(
          { name: "Toplam WARN", value: String(warn), inline: true },
          { name: "Toplam MUTE", value: String(mute), inline: true },
          { name: "Toplam Kayıt", value: String(rows.length), inline: true }
        );

      if (rows.length === 0) embed.setDescription("Kayıt yok.");
      else {
        embed.addFields({
          name: "Son Kayıtlar",
          value: rows
            .map(
              (r) =>
                `• **${new Date(r.action_at).toLocaleString("tr-TR")}**
${r.action_type.toUpperCase()} | Mod: ${r.moderator_id ? `<@${r.moderator_id}>` : "Bilinmiyor"}
Neden: ${r.reason || "Belirtilmemiş"}`
            )
            .join("\n\n"),
        });
      }

      return message.reply({ embeds: [embed] });
    }
  } catch (err) {
    console.error("❌ messageCreate genel hata:", err?.message || err);
  }
});

/* ================== LOGIN ================== */
if (TOKEN) client.login(TOKEN);
