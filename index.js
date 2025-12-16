const http = require("http");
const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, Partials, Events, EmbedBuilder } = require("discord.js");

/* ===============================
   Koyeb Healthcheck (HTTP)
================================ */
const PORT = process.env.PORT || 3000;
http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/plain" });
    res.end("OK");
  })
  .listen(PORT, () => console.log(`🌐 HTTP server listening on ${PORT}`));

/* ===============================
   ENV
================================ */
const LOG_CHANNEL_ID = process.env.MEE6_LOG_CHANNEL_ID;

/* ===============================
   Yetkili Roller
================================ */
const SICIL_ALLOWED_ROLE_IDS = [
  "1074347907685294118",
  "1101398761923674152",
  "1074347907685294116",
  "1074347907685294114",
  "1434952508094152804",
];

/* ===============================
   Storage (NDJSON)
================================ */
const DATA_DIR = path.join(__dirname, "data");
const ACTIONS_FILE = path.join(DATA_DIR, "actions.ndjson");

function appendJsonLine(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + "\n", "utf8");
}

function safeReadNdjson(file) {
  if (!fs.existsSync(file)) return [];
  const txt = fs.readFileSync(file, "utf8").trim();
  if (!txt) return [];
  return txt
    .split("\n")
    .filter(Boolean)
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/* ===============================
   Utils
================================ */
function extractMentionId(str) {
  if (!str) return null;
  const m = String(str).match(/<@!?(\d{15,25})>/);
  return m ? m[1] : null;
}

function fieldsToMap(embed) {
  const map = {};
  for (const f of embed.fields || []) {
    const key = (f.name || "").trim().toLowerCase();
    map[key] = (f.value || "").trim();
  }
  return map;
}

function detectActionType(embed) {
  const title = (embed.title || "").toLowerCase();
  const desc = (embed.description || "").toLowerCase();
  const authorName = (embed.author?.name || "").toLowerCase();
  const footer = (embed.footer?.text || "").toLowerCase();

  const haystack = `${authorName}\n${title}\n${desc}\n${footer}`;

  if (
    haystack.includes("mute") ||
    haystack.includes("timeout") ||
    haystack.includes("sustur") ||
    haystack.includes("unmute") // logda var
  ) {
    // UNMUTE ayrı event olsun istiyorsan burada "UNMUTE" da döndürebiliriz
    if (haystack.includes("unmute")) return "UNMUTE";
    return "MUTE";
  }

  if (haystack.includes("warn") || haystack.includes("uyarı") || haystack.includes("uyg")) {
    return "WARN";
  }

  return "UNKNOWN";
}

function parseMee6Embed(message) {
  if (!message.embeds?.length) return null;

  for (const e of message.embeds) {
    const fm = fieldsToMap(e);

    const userVal = fm["kullanıcı"] || fm["kullanici"] || null;
    const modVal = fm["moderatör"] || fm["moderator"] || null;
    const reasonVal = fm["neden"] || fm["sebep"] || null;

    const userId = extractMentionId(userVal);
    const moderatorId = extractMentionId(modVal);

    // Kullanıcı alanı yoksa bizim format değil
    if (!userId && !moderatorId && !reasonVal) continue;

    return {
      actionType: detectActionType(e),
      userId,
      moderatorId,
      reason: reasonVal || null,
      embedTitle: e.title || null,
      embedAuthor: e.author?.name || null,
    };
  }

  return null;
}

async function isAuthorized(message) {
  if (!message.guild) return false;

  let member = message.member;
  if (!member) {
    try {
      member = await message.guild.members.fetch(message.author.id);
    } catch {
      return false;
    }
  }

  const roles = member.roles?.cache;
  if (!roles) return false;

  return SICIL_ALLOWED_ROLE_IDS.some((id) => roles.has(id));
}

/* ===============================
   Discord Client
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

client.once(Events.ClientReady, () => {
  console.log(`✅ Bot ayakta: ${client.user.tag}`);
  console.log(`🧩 MEE6_LOG_CHANNEL_ID: ${LOG_CHANNEL_ID || "YOK"}`);
});

/* ===============================
   Main
================================ */
client.on(Events.MessageCreate, async (message) => {
  try {
    const content = (message.content || "").trim();

    /* -------- Komutlar (SADECE İNSAN) -------- */
    if (!message.author?.bot) {
      // !sicil
      if (content.toLowerCase().startsWith("!sicil")) {
        const ok = await isAuthorized(message);
        if (!ok) return; // yetkisize sessiz

        const target = message.mentions.users.first();
        if (!target) return message.reply("Kullanım: `!sicil @uye`");

        const records = safeReadNdjson(ACTIONS_FILE);

        const revokedIds = new Set(
          records
            .filter((r) => r.guildId === message.guildId && r.actionType === "REVOKE_MANUAL" && r.refMessageId)
            .map((r) => r.refMessageId)
        );

        const userRecs = records
          .filter((r) => r.guildId === message.guildId && r.userId === target.id)
          .filter((r) => !revokedIds.has(r.messageId))
          .sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));

        const warnCount = userRecs.filter((r) => r.actionType === "WARN").length;
        const muteCount = userRecs.filter((r) => r.actionType === "MUTE").length;

        const last = userRecs.slice(0, 10);
        const desc = last.length
          ? last
              .map((r, i) => {
                const when = r.ts ? new Date(r.ts).toLocaleString("tr-TR") : "bilinmiyor";
                const mod = r.moderatorId ? `<@${r.moderatorId}>` : "bilinmiyor";
                return `**${i + 1}.** ${when} • **${r.actionType}** • Mod: ${mod} • Neden: ${r.reason || "—"}`;
              })
              .join("\n")
          : "Kayıt yok.";

        const embed = new EmbedBuilder()
          .setTitle(`Sicil: ${target.username}`)
          .setDescription(desc)
          .addFields(
            { name: "Toplam WARN", value: String(warnCount), inline: true },
            { name: "Toplam MUTE", value: String(muteCount), inline: true },
            { name: "Toplam Kayıt", value: String(userRecs.length), inline: true }
          );

        return message.reply({ embeds: [embed] });
      }

      // !sicilsil <id> [neden]
      if (content.toLowerCase().startsWith("!sicilsil")) {
        const ok = await isAuthorized(message);
        if (!ok) return; // yetkisize sessiz

        const parts = content.split(/\s+/);
        const refMessageId = parts[1];
        const reason = parts.slice(2).join(" ").trim() || null;

        if (!refMessageId || !/^\d{15,25}$/.test(refMessageId)) {
          return message.reply("Kullanım: `!sicilsil <LOG_MESSAGE_ID> [neden]`");
        }

        const records = safeReadNdjson(ACTIONS_FILE);
        const exists = records.find((r) => r.guildId === message.guildId && r.messageId === refMessageId);
        if (!exists) return message.reply("❌ Bu ID ile kayıt bulunamadı. (Log mesaj ID’sini doğru kopyala)");

        const already = records.some(
          (r) => r.guildId === message.guildId && r.actionType === "REVOKE_MANUAL" && r.refMessageId === refMessageId
        );
        if (already) return message.reply("⚠️ Bu kayıt zaten kaldırılmış.");

        appendJsonLine(ACTIONS_FILE, {
          ts: new Date().toISOString(),
          guildId: message.guildId,
          source: "MANUAL",
          actionType: "REVOKE_MANUAL",
          refMessageId,
          moderatorId: message.author.id,
          reason,
        });

        return message.reply(`✅ Kayıt kaldırıldı. (ID: \`${refMessageId}\`)`);
      }
    }

    /* -------- Collector (LOG KANALI: BOT/WEBHOOK MESAJLARI DAHİL) -------- */
    if (!LOG_CHANNEL_ID) return;
    if (message.channelId !== LOG_CHANNEL_ID) return;

    const parsed = parseMee6Embed(message);
    if (parsed && parsed.userId) {
      const rec = {
        ts: new Date().toISOString(),
        guildId: message.guildId,
        messageId: message.id,
        source: "MEE6",
        ...parsed,
      };

      appendJsonLine(ACTIONS_FILE, rec);
      console.log("✅ ACTION SAVED:", rec.actionType, "user:", rec.userId, "mod:", rec.moderatorId || "?", "reason:", rec.reason || "-");
    }
  } catch (err) {
    console.error("[MessageCreate ERROR]", err);
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
