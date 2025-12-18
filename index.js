import "dotenv/config";
import {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionsBitField,
} from "discord.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message],
});

const MEE6_LOG_CHANNEL_ID = process.env.MEE6_LOG_CHANNEL_ID;
const SICIL_STORE_CHANNEL_ID = process.env.SICIL_STORE_CHANNEL_ID;

// ===== utils =====
function clean(str = "") {
  return String(str).replace(/\s+/g, " ").trim();
}

function toTextFromEmbed(e) {
  const parts = [];
  if (e?.title) parts.push(`TITLE: ${e.title}`);
  if (e?.description) parts.push(`DESC: ${e.description}`);
  if (e?.author?.name) parts.push(`AUTHOR: ${e.author.name}`);
  if (e?.footer?.text) parts.push(`FOOTER: ${e.footer.text}`);

  if (Array.isArray(e?.fields) && e.fields.length) {
    for (const f of e.fields) {
      parts.push(`FIELD: ${f?.name || ""} ${f?.value || ""}`);
    }
  }
  return clean(parts.join(" | "));
}

function extractMentionIdsFromText(text) {
  return [...String(text).matchAll(/<@!?(\d+)>/g)].map((m) => m[1]);
}

// MEE6 log mesajından warn/mute yakalamaya çalışır (title/desc boş olsa bile fields vb.)
function parseMee6Action(message) {
  if (!message.embeds?.length) return null;

  const e = message.embeds[0];
  const embedText = toTextFromEmbed(e);
  const allTextLower = embedText.toLowerCase();

  let type = null;
  if (allTextLower.includes("warn")) type = "warn";
  if (allTextLower.includes("mute") || allTextLower.includes("muted") || allTextLower.includes("timeout")) type = "mute";
  if (!type) return null;

  // user/mod ID yakalama (mentionlar embed/fields içinde olur genelde)
  const ids = [
    ...extractMentionIdsFromText(message.content),
    ...extractMentionIdsFromText(e?.description),
    ...extractMentionIdsFromText(e?.title),
    ...extractMentionIdsFromText(e?.author?.name),
    ...extractMentionIdsFromText(e?.footer?.text),
    ...(Array.isArray(e?.fields)
      ? e.fields.flatMap((f) => [
          ...extractMentionIdsFromText(f?.name),
          ...extractMentionIdsFromText(f?.value),
        ])
      : []),
  ].filter(Boolean);

  // çoğu formatta: ilk mention hedef user, ikinci mention moderator olur
  const userId = ids[0] || null;
  const modId = ids[1] || null;

  // reason: embed textten kısa bir özet
  // (çok uzunsa kırpıyoruz)
  const reason = clean(embedText).slice(0, 300);

  return { type, userId, modId, reason };
}

async function writeSicilRecord(guild, record, sourceMessageId) {
  const store = await guild.channels.fetch(SICIL_STORE_CHANNEL_ID).catch(() => null);
  if (!store?.isTextBased()) throw new Error("SICIL_STORE_CHANNEL_ID kanal bulunamadı ya da text değil.");

  const ts = Date.now();

  // Makine-okur format: SICIL|ts|type|userId|modId|sourceMsgId|reason
  const line = `SICIL|${ts}|${record.type}|${record.userId || "unknown"}|${record.modId || "unknown"}|${sourceMessageId || "unknown"}|${clean(record.reason).slice(0, 300)}`;
  await store.send(line);
}

async function getSicilSummary(guild, targetUserId, scanLimit = 600) {
  const store = await guild.channels.fetch(SICIL_STORE_CHANNEL_ID).catch(() => null);
  if (!store?.isTextBased()) throw new Error("Sicil kayıt kanalı bulunamadı ya da text değil.");

  let before;
  let warn = 0,
    mute = 0;
  const last = [];

  let scanned = 0;

  while (scanned < scanLimit) {
    const batch = await store.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch || batch.size === 0) break;

    for (const msg of batch.values()) {
      scanned++;

      const c = msg.content || "";
      if (!c.startsWith("SICIL|")) continue;

      // SICIL|ts|type|userId|modId|sourceMsgId|reason
      const parts = c.split("|");
      if (parts.length < 7) continue;

      const ts = Number(parts[1]);
      const type = parts[2];
      const userId = parts[3];
      const modId = parts[4];
      const reason = parts.slice(6).join("|");

      if (userId !== targetUserId) continue;

      if (type === "warn") warn++;
      if (type === "mute") mute++;

      if (last.length < 10) {
        const date = Number.isFinite(ts) ? new Date(ts).toLocaleString() : "unknown time";
        last.push(`• ${date} — **${type.toUpperCase()}** — mod: <@${modId}> — ${reason ? `sebep: ${reason}` : ""}`);
      }
    }

    before = batch.last().id;
    if (scanned >= scanLimit) break;
  }

  return { warn, mute, last, scanned };
}

// ===== events =====
client.on("ready", () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
  console.log(`✅ Mee6 log kanal ID (ENV): ${MEE6_LOG_CHANNEL_ID}`);
  console.log(`✅ Sicil store kanal ID (ENV): ${SICIL_STORE_CHANNEL_ID}`);
});

client.on("messageCreate", async (message) => {
  try {
    if (!message.guild) return;
    if (message.author?.bot && message.author?.id === client.user.id) return;

    // 1) Mee6 log kanalından gelenleri kaydet
    if (message.channel.id === MEE6_LOG_CHANNEL_ID) {
      // Debug (senin ekrandaki gibi)
      const e = message.embeds?.[0];
      console.log("🧾 LOG-CHANNEL MESSAGE:", {
        channelId: message.channel.id,
        authorId: message.author?.id,
        authorName: message.author?.username,
        isWebhook: !!message.webhookId,
        embedCount: message.embeds?.length || 0,
        embedTitle: e?.title ?? null,
        embedDescPreview: e?.description ? clean(e.description).slice(0, 80) : null,
        embedFieldsCount: e?.fields?.length || 0,
      });

      const rec = parseMee6Action(message);
      console.log("📌 MEE6 görüldü. parsed=", rec);

      if (!rec) return;
      if (!rec.userId || rec.userId === "unknown") {
        console.log("⚠️ userId bulunamadı; bu kayıt atlandı (format farklı).");
        return;
      }

      await writeSicilRecord(message.guild, rec, message.id);
      console.log("✅ Sicile yazıldı:", rec.type, rec.userId);
      return;
    }

    // 2) !sicil komutu
    if (!message.content?.toLowerCase().startsWith("!sicil")) return;

    // İstersen yetki şartı koy:
    // if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) {
    //   return message.reply("Bu komut için yetkin yok.");
    // }

    const target = message.mentions.users.first();
    if (!target) return message.reply("Kullanım: `!sicil @uye`");

    const summary = await getSicilSummary(message.guild, target.id, 600);

    const lines = [];
    lines.push(`**${target.tag}** sicil özeti:`);
    lines.push(`• Warn: **${summary.warn}**`);
    lines.push(`• Mute: **${summary.mute}**`);
    lines.push(`• Taranan kayıt mesajı: **${summary.scanned}**`);
    if (summary.last.length) {
      lines.push("");
      lines.push("**Son kayıtlar:**");
      lines.push(summary.last.join("\n"));
    } else {
      lines.push("");
      lines.push("_Kayıt bulunamadı (ya hiç yok, ya da tarama limiti dışında)._");
    }

    await message.reply(lines.join("\n"));
  } catch (err) {
    console.error("messageCreate genel hata:", err);
    // crash olmasın diye swallow + kullanıcıya bilgi
    if (message?.content?.toLowerCase?.().startsWith("!sicil")) {
      await message.reply("Hata oldu. Kanal ID/izinleri kontrol et (loglara bak).").catch(() => {});
    }
  }
});

client.login(process.env.TOKEN);
