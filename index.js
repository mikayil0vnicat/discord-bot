/*************************
 * Koyeb HTTP Healthcheck
 *************************/
const http = require("http");
const PORT = process.env.PORT || 3000;

http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "text/plain" });
  res.end("OK");
}).listen(PORT, () => {
  console.log(`🌐 HTTP server listening on ${PORT}`);
});

/*************************
 * Discord + Postgres
 *************************/
const { Client, GatewayIntentBits, Partials, Events, EmbedBuilder } = require("discord.js");
const { Pool } = require("pg");

/*************************
 * ENV
 *************************/
const TOKEN = process.env.TOKEN;
const LOG_CHANNEL_ID = process.env.MEE6_LOG_CHANNEL_ID;
const DATABASE_URL = process.env.DATABASE_URL;

if (!TOKEN || !LOG_CHANNEL_ID || !DATABASE_URL) {
  console.error("❌ ENV eksik (TOKEN / MEE6_LOG_CHANNEL_ID / DATABASE_URL)");
  process.exit(1);
}

/*************************
 * Yetkili Roller
 *************************/
const AUTHORIZED_ROLES = [
  "1074347907685294118",
  "1101398761923674152",
  "1074347907685294116",
  "1074347907685294114",
  "1434952508094152804",
];

/*************************
 * DB Pool
 *************************/
const pool = new Pool({
  connectionString: DATABASE_URL,
  ssl: { rejectUnauthorized: false },
});

(async () => {
  try {
    await pool.query("SELECT 1");
    console.log("✅ DB OK");
  } catch (e) {
    console.error("❌ DB bağlantı hatası", e);
    process.exit(1);
  }
})();

/*************************
 * Discord Client
 *************************/
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

/*************************
 * Ready
 *************************/
client.once(Events.ClientReady, () => {
  console.log(`✅ Bot ayakta: ${client.user.tag}`);
  console.log(`🧩 MEE6_LOG_CHANNEL_ID: ${LOG_CHANNEL_ID}`);
  console.log(`🛂 Sicil yetkili roller: ${AUTHORIZED_ROLES.length} adet`);
});

/*************************
 * Utils
 *************************/
function hasPermission(member) {
  return member.roles.cache.some(r => AUTHORIZED_ROLES.includes(r.id));
}

function extractId(text) {
  if (!text) return null;
  const m = text.match(/\d{17,19}/);
  return m ? m[0] : null;
}

/*************************
 * MEE6 LOG COLLECTOR
 *************************/
client.on(Events.MessageCreate, async (msg) => {
  if (msg.channelId !== LOG_CHANNEL_ID) return;
  if (!msg.embeds.length) return;

  const embed = msg.embeds[0];
  const title = embed.title || "";
  const fields = embed.fields || [];

  const userId = extractId(fields.find(f => f.name.toLowerCase().includes("kullanıcı"))?.value);
  const modId  = extractId(fields.find(f => f.name.toLowerCase().includes("moderatör"))?.value);
  const reason = fields.find(f => f.name.toLowerCase().includes("neden"))?.value || "-";
  const duration = fields.find(f => f.name.toLowerCase().includes("süre"))?.value || null;

  let actionType = null;

  if (title.includes("WARN")) actionType = "WARN";
  else if (title.includes("MUTE")) actionType = "MUTE";
  else if (title.includes("UNMUTE")) actionType = "UNMUTE";
  else return;

  try {
    await pool.query(
      `INSERT INTO actions
       (guild_id, message_id, ts, source, action_type, user_id, moderator_id, reason, duration, embed_title)
       VALUES ($1,$2,NOW(),'MEE6',$3,$4,$5,$6,$7,$8)
       ON CONFLICT (message_id) DO NOTHING`,
      [
        msg.guildId,
        msg.id,
        actionType,
        userId,
        modId,
        reason,
        duration,
        title,
      ]
    );

    console.log(`✅ ACTION SAVED: ${actionType} user:${userId} mod:${modId}`);
  } catch (e) {
    console.error("❌ ACTION SAVE ERROR", e);
  }
});

/*************************
 * COMMANDS
 *************************/
client.on(Events.MessageCreate, async (msg) => {
  if (!msg.guild || msg.author.bot) return;
  if (!msg.content.startsWith("!")) return;

  const args = msg.content.slice(1).trim().split(/\s+/);
  const cmd = args.shift().toLowerCase();

  if (!hasPermission(msg.member)) {
    return;
  }

  /******** !sicil ********/
  if (cmd === "sicil") {
    const target = msg.mentions.users.first();
    if (!target) return msg.reply("Kullanım: `!sicil @üye`");

    const res = await pool.query(
      `SELECT * FROM actions
       WHERE guild_id=$1 AND user_id=$2
       ORDER BY ts DESC`,
      [msg.guildId, target.id]
    );

    if (!res.rows.length) {
      return msg.reply("Kayıt yok.");
    }

    let warn = 0, mute = 0;
    const lines = res.rows.map((r, i) => {
      if (r.action_type === "WARN") warn++;
      if (r.action_type === "MUTE") mute++;
      return `**${i + 1}.** ${new Date(r.ts).toLocaleString()}
• **${r.action_type}**
• Mod: <@${r.moderator_id || "UNKNOWN"}>
• Neden: ${r.reason || "-"}
🆔 \`${r.message_id}\``;
    });

    const embed = new EmbedBuilder()
      .setTitle(`Sicil: ${target.username}`)
      .setDescription(lines.join("\n\n"))
      .addFields(
        { name: "Toplam WARN", value: String(warn), inline: true },
        { name: "Toplam MUTE", value: String(mute), inline: true },
        { name: "Toplam Kayıt", value: String(res.rows.length), inline: true },
      );

    return msg.reply({ embeds: [embed] });
  }

  /******** !sicilsil ********/
  if (cmd === "sicilsil") {
    const messageId = args[0];
    if (!messageId) return msg.reply("Kullanım: `!sicilsil <LOG_MESSAGE_ID>`");

    const del = await pool.query(
      `DELETE FROM actions
       WHERE guild_id=$1 AND message_id=$2`,
      [msg.guildId, messageId]
    );

    if (!del.rowCount) {
      return msg.reply("Bu ID ile kayıt bulunamadı.");
    }

    return msg.reply(`🗑️ Sicil silindi: \`${messageId}\``);
  }
});

/*************************
 * Login
 *************************/
client.login(TOKEN);
