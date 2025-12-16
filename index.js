const http = require("http");
const fs = require("fs");
const path = require("path");
const { Client, GatewayIntentBits, Partials, Events, EmbedBuilder } = require("discord.js");

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
   ENV
================================ */
const LOG_CHANNEL_ID = process.env.MEE6_LOG_CHANNEL_ID;

// Yetkili roller (sen daha önce vermiştin)
const ROLE_YONETIM = "601898693448433666";
const ROLE_MOD = "984473220801507398";

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

// MEE6 embedinden "action" çıkar
function parseMee6Embed(message) {
  if (!message.embeds?.length) return null;

  // MEE6 bazen birden çok embed atabilir; ilk anlamlıyı bulalım
  for (const e of message.embeds) {
    const fm = fieldsToMap(e);

    // Senin örnekte isimler Türkçe:
    // "kullanıcı", "moderatör", "neden"
    const userVal = fm["kullanıcı"] || fm["kullanici"] || null;
    const modVal = fm["moderatör"] || fm["moderator"] || fm["moderatör:"] || null;
    const reasonVal = fm["neden"] || fm["sebep"] || null;

    const userId = extractMentionId(userVal);
    const moderatorId = extractMentionId(modVal);

    // actionType yakalama (mute örneğini görünce kesinleştiririz)
    const title = (e.title || "").toLowerCase();
    const desc = (e.description || "").toLowerCase();
    let actionType = "UNKNOWN";
    if (title.includes("warn") || title.includes("uyarı") || desc.includes("warn") || desc.includes("uyarı")) actionType = "WARN";
    if (title.includes("mute") || title.includes("sustur") || title.includes("timeout") || desc.includes("mute") || desc.includes("sustur") || desc.includes("timeout")) actionType = "MUTE";

    // En azından kullanıcı veya moderatör yakalanıyorsa bu kaydı alalım
    if (userId || moderatorId || reasonVal) {
      return {
        actionType,
        userId,
        moderatorId,
        reason: reasonVal || null,
        embedTitle: e.title || null,
        embedDesc: e.description || null,
      };
    }
  }

  return null;
}

function isAuthorized(member) {
  if (!member) return false;
  return member.roles?.cache?.has(ROLE_YONETIM) || member.roles?.cache?.has(ROLE_MOD);
}

/* ===============================
   Discord Client
================================ */
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

client.once(Events.ClientReady, () => {
  console.log(`✅ Bot ayakta: ${client.user.tag}`);
  console.log(`🧩 MEE6_LOG_CHANNEL_ID: ${LOG_CHANNEL_ID || "YOK"}`);
});

/* ===============================
   1) Collect: MEE6 log kanalını oku
   2) Parse: Kullanıcı/Moderatör/Neden
   3) Store: NDJSON'a yaz (sonra DB'ye geçeceğiz)
================================ */
client.on(Events.MessageCreate, async (message) => {
  try {
    // --- Komutlar (sicil) ---
    if (!message.author?.bot && message.content?.startsWith("!sicil")) {
      if (!isAuthorized(message.member)) return;

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
      const records = lines.map((l) => {
        try { return JSON.parse(l); } catch { return null; }
      }).filter(Boolean);

      const userRecs = records
        .filter(r => r.guildId === message.guildId && r.userId === target.id)
        .sort((a, b) => (b.ts || "").localeCompare(a.ts || ""));

      const warnCount = userRecs.filter(r => r.actionType === "WARN").length;
      const muteCount = userRecs.filter(r => r.actionType === "MUTE").length;

      const last = userRecs.slice(0, 10);

      const desc = last.length
        ? last.map((r, i) => {
            const when = r.ts ? new Date(r.ts).toLocaleString("tr-TR") : "bilinmiyor";
            const mod = r.moderatorId ? `<@${r.moderatorId}>` : "bilinmiyor";
            const type = r.actionType || "UNKNOWN";
            const reason = r.reason || "—";
            return `**${i + 1}.** ${when} • **${type}** • Mod: ${mod} • Neden: ${reason}`;
          }).join("\n")
        : "Kayıt yok.";

      const embed = new EmbedBuilder()
        .setTitle(`Sicil: ${target.tag}`)
        .setDescription(desc)
        .addFields(
          { name: "Toplam WARN", value: String(warnCount), inline: true },
          { name: "Toplam MUTE", value: String(muteCount), inline: true },
          { name: "Toplam Kayıt", value: String(userRecs.length), inline: true },
        );

      await message.reply({ embeds: [embed] });
      return;
    }

    // --- Collector sadece log kanalında çalışsın ---
    if (!LOG_CHANNEL_ID) return;
    if (message.channelId !== LOG_CHANNEL_ID) return;

    // Ham kayıt (debug için)
    appendJsonLine(path.join(__dirname, "data", "mee6_raw.ndjson"), {
      ts: new Date().toISOString(),
      guildId: message.guildId,
      channelId: message.channelId,
      messageId: message.id,
      authorTag: message.author?.tag ?? null,
      isBot: Boolean(message.author?.bot),
      isWebhook: Boolean(message.webhookId),
      embeds: (message.embeds || []).map(e => ({
        title: e.title ?? null,
        description: e.description ?? null,
        fields: (e.fields || []).map(f => ({ name: f.name, value: f.value, inline: f.inline })),
      })),
      content: message.content ?? "",
    });

    // Parse + actions kaydı
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
