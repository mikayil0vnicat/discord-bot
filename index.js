const http = require("http");
const { Client, GatewayIntentBits, Partials, Events, EmbedBuilder } = require("discord.js");
const { Pool } = require("pg");

/* ===============================
   Koyeb Healthcheck
================================ */
const PORT = process.env.PORT || 3000;
http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("OK");
}).listen(PORT, () => console.log(`🌐 HTTP server listening on ${PORT}`));

/* ===============================
   ENV
================================ */
const TOKEN = process.env.TOKEN;
const LOG_CHANNEL_ID = process.env.MEE6_LOG_CHANNEL_ID;
const DATABASE_URL = process.env.DATABASE_URL;

if (!TOKEN || !LOG_CHANNEL_ID || !DATABASE_URL) {
  console.error("❌ ENV eksik: TOKEN / MEE6_LOG_CHANNEL_ID / DATABASE_URL");
  process.exit(1);
}

/* ===============================
   Yetkili Roller
================================ */
const AUTHORIZED_ROLES = [
  "1074347907685294118",
  "1101398761923674152",
  "1074347907685294116",
  "1074347907685294114",
  "1434952508094152804",
];

/* ===============================
   DB
================================ */
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

async function dbPing() {
  await pool.query("SELECT 1");
  console.log("✅ DB OK");
}

/* ===============================
   Helpers
================================ */
function hasPermission(member) {
  return member?.roles?.cache?.some((r) => AUTHORIZED_ROLES.includes(r.id));
}

function getAllSnowflakes(text) {
  if (!text) return [];
  const m = String(text).match(/\d{17,20}/g);
  return m ? Array.from(new Set(m)) : [];
}

function fieldsToMap(embed) {
  const map = {};
  for (const f of embed.fields || []) {
    const k = (f.name || "").trim().toLowerCase();
    map[k] = (f.value || "").trim();
  }
  return map;
}

function detectActionType(embed) {
  const title = (embed.title || "").toUpperCase();
  if (title.includes("UNMUTE")) return "UNMUTE";
  if (title.includes("MUTE")) return "MUTE";
  if (title.includes("WARN")) return "WARN";

  // bazen title farklı olur diye fallback:
  const all = JSON.stringify(embed.toJSON ? embed.toJSON() : embed);
  const up = all.toUpperCase();
  if (up.includes("UNMUTE")) return "UNMUTE";
  if (up.includes("MUTE") || up.includes("TIMEOUT")) return "MUTE";
  if (up.includes("WARN") || up.includes("UYARI")) return "WARN";
  return "UNKNOWN";
}

function parseMee6(msg) {
  if (!msg.embeds?.length) return null;

  // çoğu zaman ilk embed yetiyor, ama biz hepsini dolaşıyoruz
  for (const e of msg.embeds) {
    const fm = fieldsToMap(e);

    const userVal = fm["kullanıcı"] || fm["kullanici"] || fm["user"] || null;
    const modVal = fm["moderatör"] || fm["moderator"] || fm["mod"] || null;
    const reasonVal = fm["neden"] || fm["sebep"] || fm["reason"] || null;
    const durationVal = fm["süre"] || fm["sure"] || fm["duration"] || null;

    // Önce alanlardan id çıkarmayı dene
    const userIds = getAllSnowflakes(userVal);
    const modIds = getAllSnowflakes(modVal);

    let userId = userIds[0] || null;
    let moderatorId = modIds[0] || null;

    // Fail-safe: embed JSON içinde mention varsa oradan bul
    if (!userId) {
      const blob = JSON.stringify(e.toJSON ? e.toJSON() : e);
      const ids = getAllSnowflakes(blob);

      // ids içinde genelde önce kullanıcı, sonra mod geliyor
      // mod ile aynıysa kaydır
      if (ids.length) {
        userId = ids[0] || null;
        if (moderatorId && userId === moderatorId && ids[1]) userId = ids[1];
      }
    }
    if (!moderatorId) {
      const blob = JSON.stringify(e.toJSON ? e.toJSON() : e);
      const ids = getAllSnowflakes(blob);
      if (ids.length) moderatorId = ids[1] || ids[0] || null;
    }

    const actionType = detectActionType(e);

    // reason boşsa "Belirtilmemiş" vs da normalize edelim
    const reason = reasonVal ? String(reasonVal).replace(/`/g, "").trim() : null;

    // Burada userId yoksa kayıt anlamlı olmaz -> yine de loglayalım
    return {
      actionType,
      userId,
      moderatorId,
      reason: reason || null,
      duration: durationVal || null,
      embedTitle: e.title || null,
      embedAuthor: e.author?.name || null,
    };
  }

  return null;
}

/* ===============================
   Client
================================ */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildMembers,
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.once(Events.ClientReady, async () => {
  console.log(`✅ Bot ayakta: ${client.user.tag}`);
  console.log(`🧩 MEE6_LOG_CHANNEL_ID: ${LOG_CHANNEL_ID}`);
  console.log(`🛂 Sicil yetkili roller: ${AUTHORIZED_ROLES.length} adet`);
  try {
    await dbPing();
  } catch (e) {
    console.error("❌ DB bağlantı hatası:", e?.message || e);
    process.exit(1);
  }
});

/* ===============================
   Collector
================================ */
client.on(Events.MessageCreate, async (msg) => {
  try {
    if (msg.channelId !== LOG_CHANNEL_ID) return;

    const parsed = parseMee6(msg);
    if (!parsed) return;

    if (!parsed.userId) {
      console.log("⚠️ PARSE FAIL (userId yok) messageId:", msg.id);
      return; // userId yoksa sicil çalışmaz, boş yazmayalım
    }

    await pool.query(
      `INSERT INTO actions
        (guild_id, message_id, ts, source, action_type, user_id, moderator_id, reason, duration, embed_title, embed_author)
       VALUES ($1,$2,NOW(),'MEE6',$3,$4,$5,$6,$7,$8,$9,$10)
       ON CONFLICT (message_id) DO NOTHING`,
      [
        msg.guildId,
        msg.id,
        parsed.actionType,
        parsed.userId,
        parsed.moderatorId,
        parsed.reason,
        parsed.duration,
        parsed.embedTitle,
        parsed.embedAuthor,
      ]
    );

    console.log(`✅ ACTION SAVED: ${parsed.actionType} user:${parsed.userId} mod:${parsed.moderatorId || "-"}`);
  } catch (e) {
    console.error("❌ Collector error:", e?.message || e);
  }
});

/* ===============================
   Commands
================================ */
client.on(Events.MessageCreate, async (msg) => {
  try {
    if (!msg.guild || msg.author.bot) return;
    const text = (msg.content || "").trim();
    if (!text.startsWith("!")) return;

    const parts = text.slice(1).split(/\s+/);
    const cmd = (parts.shift() || "").toLowerCase();

    if (!hasPermission(msg.member)) return; // yetkisize sessiz

    if (cmd === "sicil") {
      const target = msg.mentions.users.first();
      if (!target) return msg.reply("Kullanım: `!sicil @uye`");

      // revokes hariç
      const rows = await pool.query(
        `SELECT a.*
         FROM actions a
         LEFT JOIN revokes r
           ON r.guild_id=a.guild_id AND r.ref_message_id=a.message_id
         WHERE a.guild_id=$1 AND a.user_id=$2 AND r.id IS NULL
         ORDER BY a.ts DESC
         LIMIT 10`,
        [msg.guildId, target.id]
      );

      const counts = await pool.query(
        `SELECT
           SUM(CASE WHEN a.action_type='WARN' THEN 1 ELSE 0 END) AS warn_count,
           SUM(CASE WHEN a.action_type='MUTE' THEN 1 ELSE 0 END) AS mute_count,
           COUNT(*) AS total_count
         FROM actions a
         LEFT JOIN revokes r
           ON r.guild_id=a.guild_id AND r.ref_message_id=a.message_id
         WHERE a.guild_id=$1 AND a.user_id=$2 AND r.id IS NULL`,
        [msg.guildId, target.id]
      );

      const c = counts.rows[0] || {};
      const warn = Number(c.warn_count || 0);
      const mute = Number(c.mute_count || 0);
      const total = Number(c.total_count || 0);

      if (!rows.rows.length) {
        const embed = new EmbedBuilder()
          .setTitle(`Sicil: ${target.username}`)
          .setDescription("Kayıt yok.")
          .addFields(
            { name: "Toplam WARN", value: String(warn), inline: true },
            { name: "Toplam MUTE", value: String(mute), inline: true },
            { name: "Toplam Kayıt", value: String(total), inline: true }
          );
        return msg.reply({ embeds: [embed] });
      }

      const desc = rows.rows
        .map((r, i) => {
          const when = new Date(r.ts).toLocaleString("tr-TR");
          const mod = r.moderator_id ? `<@${r.moderator_id}>` : "UNKNOWN";
          const dur = r.duration ? ` • Süre: ${r.duration}` : "";
          return `**${i + 1}.** ${when} • **${r.action_type}** • Mod: ${mod} • Neden: ${r.reason || "—"}${dur}\n🆔 \`${r.message_id}\``;
        })
        .join("\n");

      const embed = new EmbedBuilder()
        .setTitle(`Sicil: ${target.username}`)
        .setDescription(desc)
        .addFields(
          { name: "Toplam WARN", value: String(warn), inline: true },
          { name: "Toplam MUTE", value: String(mute), inline: true },
          { name: "Toplam Kayıt", value: String(total), inline: true }
        );

      return msg.reply({ embeds: [embed] });
    }

    if (cmd === "sicilsil") {
      const refId = parts[0];
      const reason = parts.slice(1).join(" ").trim() || null;
      if (!refId || !/^\d{17,20}$/.test(refId)) {
        return msg.reply("Kullanım: `!sicilsil <LOG_MESSAGE_ID> [neden]`");
      }

      // kayıt var mı?
      const ex = await pool.query(
        `SELECT 1 FROM actions WHERE guild_id=$1 AND message_id=$2 LIMIT 1`,
        [msg.guildId, refId]
      );
      if (!ex.rowCount) return msg.reply("❌ Bu ID ile kayıt bulunamadı.");

      // revoke yaz
      await pool.query(
        `INSERT INTO revokes (guild_id, ref_message_id, ts, moderator_id, reason)
         VALUES ($1,$2,NOW(),$3,$4)
         ON CONFLICT (guild_id, ref_message_id) DO NOTHING`,
        [msg.guildId, refId, msg.author.id, reason]
      );

      return msg.reply(`✅ Kayıt kaldırıldı. (ID: \`${refId}\`)`);
    }
  } catch (e) {
    console.error("❌ Command error:", e?.message || e);
  }
});

client.login(TOKEN);
