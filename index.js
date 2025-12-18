console.log("✅ BOOT:", new Date().toISOString());

const { Client, GatewayIntentBits, Partials, EmbedBuilder } = require("discord.js");
const http = require("http");

/* ================== HEALTHCHECK ================== */
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("OK");
}).listen(PORT, () => console.log("🌐 Web ping OK on port", PORT));

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

/* ================== DB ================== */
let pool = null;
let dbReady = false;

async function initDb() {
  if (!DATABASE_URL) return;
  try {
    const { Pool } = require("pg");
    pool = new Pool({ connectionString: DATABASE_URL, ssl: { rejectUnauthorized: false } });

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

    // action_at yoksa ekle (eski şema fix)
    await pool.query(`
      ALTER TABLE actions
      ADD COLUMN IF NOT EXISTS action_at TIMESTAMPTZ NOT NULL DEFAULT NOW();
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
  return member?.roles?.cache?.some(r => ALLOWED_ROLES.includes(r.id));
}

function extractIdFromMention(text) {
  const m = String(text || "").match(/<@!?(\d+)>/);
  return m ? m[1] : null;
}

// Display name / nick / global / username ile üye bul
async function resolveMemberIdByName(guild, name) {
  if (!name) return null;
  const q = String(name).trim().toLowerCase();

  // 1) cache içinde dene
  let member =
    guild.members.cache.find(m =>
      (m.displayName || "").toLowerCase() === q ||
      (m.nickname || "").toLowerCase() === q ||
      (m.user.globalName || "").toLowerCase() === q ||
      (m.user.username || "").toLowerCase() === q
    );

  if (member) return member.id;

  // 2) fetch query ile dene (Discord arama)
  try {
    await guild.members.fetch({ query: name, limit: 25 });
    member =
      guild.members.cache.find(m =>
        (m.displayName || "").toLowerCase() === q ||
        (m.nickname || "").toLowerCase() === q ||
        (m.user.globalName || "").toLowerCase() === q ||
        (m.user.username || "").toLowerCase() === q
      );
    if (member) return member.id;
  } catch {}

  // 3) "arch_joker uyarıldı" gibi ise ilk token + varyant dene
  const token = q.split(/\s+/)[0];
  if (token && token !== q) {
    try {
      await guild.members.fetch({ query: token, limit: 25 });
      member =
        guild.members.cache.find(m =>
          (m.displayName || "").toLowerCase() === token ||
          (m.nickname || "").toLowerCase() === token ||
          (m.user.globalName || "").toLowerCase() === token ||
          (m.user.username || "").toLowerCase() === token
        );
      if (member) return member.id;
    } catch {}
  }

  return null;
}

/**
 * Senin format:
 * embed.title = null
 * embed.description:
 *  "arch_joker uyarıldı\nSebep: calisma123"
 */
function parseMee6Embed(message) {
  const e = message.embeds?.[0];
  if (!e) return null;

  const title = (e.title || "").trim();
  const desc = (e.description || "").trim();
  const raw = `${title}\n${desc}`.trim();
  const lower = raw.toLowerCase();

  const type =
    lower.includes("[warn]") || lower.includes("uyarıldı") || lower.includes("warn")
      ? "warn"
      : (lower.includes("[mute]") || lower.includes("timeout") || lower.includes("mute") || lower.includes("sustur"))
      ? "mute"
      : null;

  if (!type) return null;

  let reason = "Belirtilmemiş";
  const rm = raw.match(/Sebep:\s*(.+)/i);
  if (rm?.[1]) reason = rm[1].trim();

  // Mention varsa direkt ID
  const user_id = extractIdFromMention(raw);

  // Mention yoksa ilk satırdan isim çek
  let name = null;
  if (!user_id) {
    const firstLine = (desc || title).split("\n")[0] || "";
    name = firstLine.replace(/uyarıldı/i, "").trim(); // "arch_joker uyarıldı" -> "arch_joker"
    if (!name) name = firstLine.split(" ")[0].trim();
  }

  return { type, user_id: user_id || null, name, moderator_id: null, reason };
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

    // --- DEBUG: log kanalında gelen her şeyi bas ---
    if (LOG_CHANNEL_ID && message.channelId === LOG_CHANNEL_ID) {
      console.log("🧪 LOG-CHANNEL MESSAGE:", {
        channelId: message.channelId,
        authorId: message.author?.id,
        authorName: message.author?.username,
        isWebhook: Boolean(message.webhookId),
        embedCount: message.embeds?.length || 0,
        embedTitle: message.embeds?.[0]?.title || null,
        embedDescPreview: (message.embeds?.[0]?.description || "").slice(0, 140) || null,
      });
    }

    // --- Mee6 yakalama (sende webhook olarak geliyor) ---
    const isMee6 =
      message.author?.id === MEE6_ID ||
      (message.author?.username || "").toLowerCase().includes("mee6") ||
      (LOG_CHANNEL_ID && message.channelId === LOG_CHANNEL_ID && Boolean(message.webhookId));

    if (LOG_CHANNEL_ID && message.channelId === LOG_CHANNEL_ID && isMee6) {
      const parsed = parseMee6Embed(message);
      console.log("📩 MEE6 görüldü. parsed=", parsed);

      if (!parsed) return;

      // user_id yoksa name ile çöz
      if (!parsed.user_id && parsed.name) {
        const id = await resolveMemberIdByName(message.guild, parsed.name);
        if (!id) {
          console.warn("❌ Üye ID bulunamadı. name=", parsed.name);
          return;
        }
        parsed.user_id = id;
      }

      if (!parsed.user_id) {
        console.warn("❌ user_id yok, kayıt atlandı:", parsed);
        return;
      }

      if (!dbReady) {
        console.warn("⚠️ DB hazır değil, kayıt atlandı.");
        return;
      }

      try {
        const r = await pool.query(
          `INSERT INTO actions
           (guild_id, user_id, moderator_id, action_type, reason, source_message_id)
           VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (source_message_id) DO NOTHING`,
          [message.guildId, parsed.user_id, parsed.moderator_id, parsed.type, parsed.reason, message.id]
        );
        console.log("✅ DB kayıt OK (rowCount):", r.rowCount);
      } catch (e) {
        console.error("❌ DB insert hatası:", e?.message || e);
      }
      return;
    }

    if (message.author.bot) return;

    // --- DB durum komutu ---
    if (message.content === "!dbdurum") {
      if (!hasPermission(message.member)) return;
      if (!dbReady) return message.reply("⚠️ DB hazır değil.");

      const c = await pool.query(`SELECT COUNT(*)::int AS count FROM actions WHERE guild_id=$1`, [message.guildId]);
      return message.reply(`DB durum: Bu sunucuda toplam kayıt = **${c.rows[0].count}**`);
    }

    // --- Manuel test kaydı: !testkayit @uye sebep ---
    if (message.content.startsWith("!testkayit")) {
      if (!hasPermission(message.member)) return message.reply("❌ Yetkin yok.");
      if (!dbReady) return message.reply("⚠️ DB hazır değil.");

      const target = message.mentions.users.first();
      if (!target) return message.reply("Kullanım: **!testkayit @üye sebep**");

      const reason = message.content.split(" ").slice(2).join(" ").trim() || "test";
      const r = await pool.query(
        `INSERT INTO actions (guild_id, user_id, moderator_id, action_type, reason, source_message_id)
         VALUES ($1,$2,$3,'warn',$4,$5)
         ON CONFLICT (source_message_id) DO NOTHING`,
        [message.guildId, target.id, message.author.id, reason, `manual-${Date.now()}`]
      );

      return message.reply(`✅ Test kaydı eklendi. (rowCount=${r.rowCount}) Şimdi: **!sicil @üye**`);
    }

    // --- Sicil ---
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

      const warn = rows.filter(r => r.action_type === "warn").length;
      const mute = rows.filter(r => r.action_type === "mute").length;

      const embed = new EmbedBuilder()
        .setTitle(`Sicil: ${target.username}`)
        .addFields(
          { name: "Toplam WARN", value: String(warn), inline: true },
          { name: "Toplam MUTE", value: String(mute), inline: true },
          { name: "Toplam Kayıt", value: String(rows.length), inline: true }
        );

      if (rows.length === 0) {
        embed.setDescription("Kayıt yok.");
      } else {
        embed.addFields({
          name: "Son Kayıtlar",
          value: rows.map(r =>
            `• **${new Date(r.action_at).toLocaleString("tr-TR")}**
${r.action_type.toUpperCase()} | Mod: ${r.moderator_id ? `<@${r.moderator_id}>` : "Bilinmiyor"}
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

/* ================== LOGIN ================== */
if (TOKEN) client.login(TOKEN);
