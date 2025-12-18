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

function clean(str = "") {
  return String(str).replace(/\s+/g, " ").trim();
}

// Mee6 embed'inden warn/mute yakalamaya çalışır (format değişse de yakalaması için esnek yazdım)
function parseMee6Action(message) {
  if (!message.embeds?.length) return null;

  const e = message.embeds[0];
  const text = clean([e.title, e.description, ...(e.fields?.map(f => `${f.name} ${f.value}`) || [])].join(" | ")).toLowerCase();

  // tür
  let type = null;
  if (text.includes("warn")) type = "warn";
  if (text.includes("mute") || text.includes("muted")) type = "mute";
  if (!type) return null;

  // kullanıcı ve moderator id yakalama (mention varsa)
  const ids = [...message.content.matchAll(/<@!?(\d+)>/g)].map(m => m[1]);
  const embedIds = [...(e.description || "").matchAll(/<@!?(\d+)>/g)].map(m => m[1]);
  const allIds = [...ids, ...embedIds];

  // genelde ilk mention user, ikinci mention mod olur; yoksa null bırakırız
  const userId = allIds[0] || null;
  const modId = allIds[1] || null;

  // sebep (bulamazsa boş)
  let reason = "";
  const desc = clean(e.description || "");
  // basit reason sezgisi
  if (desc.length && desc.length < 300) reason = desc;

  return { type, userId, modId, reason };
}

async function writeSicilRecord(guild, record) {
  const store = await guild.channels.fetch(SICIL_STORE_CHANNEL_ID).catch(() => null);
  if (!store?.isTextBased()) return false;

  const ts = Date.now();
  // Makine-okur format: SICIL|ts|type|userId|modId|reason
  const line = `SICIL|${ts}|${record.type}|${record.userId || "unknown"}|${record.modId || "unknown"}|${clean(record.reason).slice(0, 300)}`;
  await store.send(line);
  return true;
}

async function getSicilSummary(guild, targetUserId, scanLimit = 500) {
  const store = await guild.channels.fetch(SICIL_STORE_CHANNEL_ID).catch(() => null);
  if (!store?.isTextBased()) throw new Error("Sicil kayıt kanalı bulunamadı ya da text değil.");

  let before;
  let warn = 0, mute = 0;
  const last = [];

  // son scanLimit mesajı tarar (parça parça)
  while (last.length < scanLimit) {
    const batch = await store.messages.fetch({ limit: 100, before }).catch(() => null);
    if (!batch || batch.size === 0) break;

    for (const msg of batch.values()) {
      const c = msg.content || "";
      if (!c.startsWith("SICIL|")) continue;

      // SICIL|ts|type|userId|modId|reason
      const parts = c.split("|");
      if (parts.length < 6) continue;

      const type = parts[2];
      const userId = parts[3];
      const modId = parts[4];
      const reason = parts.slice(5).join("|");

      if (userId !== targetUserId) continue;

      if (type === "warn") warn++;
      if (type === "mute") mute++;

      // son 10 kaydı tut
      if (last.length < 10) {
        const date = new Date(Number(parts[1]));
        last.push(`• ${date.toLocaleString()} — **${type.toUpperCase()}** — mod: <@${modId}> — ${reason ? `sebep: ${reason}` : ""}`);
      }
    }

    before = batch.last().id;
    if (warn + mute >= scanLimit) break;
  }

  return { warn, mute, last };
}

client.on("ready", () => {
  console.log(`✅ Bot online: ${client.user.tag}`);
});

client.on("messageCreate", async (message) => {
  if (!message.guild || message.author.bot === false && message.author.id === client.user.id) return;

  // 1) Mee6 logdan kayıt yakala -> sicil kanalına yaz
  if (message.channel.id === MEE6_LOG_CHANNEL_ID) {
    const rec = parseMee6Action(message);
    if (!rec) return;

    // userId yoksa hiç yazmayalım (sicil işe yaramaz)
    if (!rec.userId) {
      console.log("Mee6 action yakalandı ama userId bulunamadı (format farklı olabilir).");
      return;
    }

    await writeSicilRecord(message.guild, rec).catch(err => {
      console.error("Sicil record write error:", err);
    });
    return;
  }

  // 2) !sicil komutu
  if (!message.content?.toLowerCase().startsWith("!sicil")) return;

  // izin (isteğe bağlı)
  // if (!message.member.permissions.has(PermissionsBitField.Flags.ManageMessages)) return;

  const target = message.mentions.users.first();
  if (!target) {
    return message.reply("Kullanım: `!sicil @uye`");
  }

  try {
    const summary = await getSicilSummary(message.guild, target.id, 500);

    const lines = [];
    lines.push(`**${target.tag}** sicil özeti:`);
    lines.push(`• Warn: **${summary.warn}**`);
    lines.push(`• Mute: **${summary.mute}**`);

    if (summary.last.length) {
      lines.push("");
      lines.push("**Son kayıtlar:**");
      lines.push(summary.last.join("\n"));
    } else {
      lines.push("");
      lines.push("_Kayıt bulunamadı (ya hiç yok, ya da tarama limiti dışında)._");
    }

    await message.reply(lines.join("\n"));
  } catch (e) {
    console.error(e);
    await message.reply("Sicil okunurken hata oldu. Kanal ID/izinleri kontrol et.");
  }
});

client.login(process.env.TOKEN);
