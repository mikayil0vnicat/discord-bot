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
  .listen(PORT, () => {
    console.log(`🌐 HTTP server listening on ${PORT}`);
  });

/* ===============================
   ENV
================================ */
const LOG_CHANNEL_ID = process.env.MEE6_LOG_CHANNEL_ID;

/* ===============================
   Yetkili Roller (ID)
================================ */
const ROLE_YONETIM = "601898693448433666";
const ROLE_MOD = "984473220801507398";
const ROLE_EXTRA = "1074347907685294118"; // senin ekle dediğin

/* ===============================
   Utils
================================ */
function appendJsonLine(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, JSON.stringify(obj) + "\n", "utf8");
}

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

  // MEE6 bazen action'ı title'da, bazen author'da, bazen desc/footer'da verir
  const haystack = `${authorName}\n${title}\n${desc}\n${footer}`;

  // MUTE/TIMEOUT önce kontrol (bazı metinlerde warn kelimesi de geçebiliyor)
  if (
    haystack.includes("mute") ||
    haystack.includes("muted") ||
    haystack.includes("timeout") ||
    haystack.includes("time out") ||
    haystack.includes("sustur") ||
    haystack.includes("susturuldu") ||
    haystack.includes("susturma")
  ) {
    return "MUTE";
  }

  if (
    haystack.includes("[warn]") ||
    haystack.includes("warn") ||
    haystack.includes("warning") ||
    haystack.includes("uyarı") ||
    haystack.includes("uyari") ||
    haystack.includes("uyg") // sende görünen UYG
  ) {
    return "WARN";
  }

  return "UNKNOWN";
}

function parseMee6Embed(message) {
  if (!message.embeds?.length) return null;

  for (const e of message.embeds) {
    const fm = fieldsToMap(e);

    // Senin log formatın:
    // Kullanıcı / Moderatör / Neden
    const userVal = fm["kullanıcı"] || fm["kullanici"] || null;
    const modVal = fm["moderatör"] || fm["moderator"] || null;
    const reasonVal = fm["neden"] || fm["sebep"] || null;

    const userId = extractMentionId(userVal);
    const moderatorId = extractMentionId(modVal);

    // Kullanıcı yakalanmıyorsa bu embed bizim işimiz olmayabilir
    if (!userId && !moderatorId && !reasonVal) continue;

    const actionType = detectActionType(e);

    return {
      actionType,
      userId,
      moderatorId,
      reason: reasonVal || null,
      embedTitle: e.title || null,
      embedDesc: e.description || null,
      embedAuthor: e.author?.name || null,
      embedFooter: e.footer?.text || null,
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

  return roles.has(ROLE_YONETIM) || roles.has(ROLE_MOD) || roles.has(ROLE_EXTRA);
}

/* ===============================
   Discord Client
================================ */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent, // MEE6 loglarını okumak için
    GatewayIntentBits.GuildMembers,   // rol kontrolü için
  ],
  partials: [Partials.Channel, Partials.Message],
});

process.on("unhandledRejection", (err) => console.error("[unhandledRejection]", err));
process.on("uncaughtException", (err) => console.error("[uncaughtException]", err));

client.once(Events.ClientReady, () => {
  console.log(`✅ Bot ayakta: ${client.user.tag}`);
  console.log(`🧩 MEE6_LOG_CHANNEL_ID: ${LOG_CHANNEL_ID || "YOK"}`);
});

/* ===============================
   Main
================================ */
client.on(Events.MessageCreate, async (message) => {
  try {
    /* -------- !sicil komutu -------- */
    if (!message.author?.bot && message.content?.toLowerCase().startsWith("!sicil")) {
      const ok = await isAuthorized(message);
      if (!ok) {
        await message.reply("❌ Bu komutu kullanmak için yetkin yok.");
        return;
      }

      const target = message.mentions.users.first();
      if (!target) {
        await message.reply("Kullanım: `!sicil @uye`");
        return;
      }

      const file = path.join(__dirname, "data", "actions.ndjson");
      if (!fs.existsSync(file)) {
        await message.reply("Henüz kayıt yok.");
        return;
      }

      const lines = fs.readFileSync(file, "utf8").trim().split("\n").filter(Boolean);
      const records = lines
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean);

      const userRecs = records
        .filter((r) => r.guildId === message.guildId && r.userId === target.id)
        .sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));

      const warnCount = userRecs.filter((r) => r.actionType === "WARN").length;
      const muteCount = userRecs.filter((r) => r.actionType === "MUTE").length;

      const last = userRecs.slice(0, 10);

      const desc = last.length
        ? last
            .map((r, i) => {
              const when = r.ts ? new Date(r.ts).toLocaleString("tr-TR") : "bilinmiyor";
              const mod = r.moderatorId ? `<@${r.moderatorId}>` : "bilinmiyor";
              const type = r.actionType || "UNKNOWN";
              const reason = r.reason || "—";
              return `**${i + 1}.** ${when} • **${type}** • Mod: ${mod} • Neden: ${reason}`;
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

      await message.reply({ embeds: [embed] });
      return;
    }

    /* -------- Collector: MEE6 log kanalı -------- */
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

      appendJsonLine(path.join(__dirname, "data", "actions.ndjson"), rec);

      console.log(
        "✅ ACTION SAVED:",
        rec.actionType,
        "user:",
        rec.userId,
        "mod:",
        rec.moderatorId || "?",
        "reason:",
        rec.reason || "-"
      );
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
