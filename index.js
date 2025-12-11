const { Client, GatewayIntentBits, ActivityType } = require('discord.js');

// İstemciyi oluştur
const client = new Client({
    intents: [GatewayIntentBits.Guilds]
});

// Bot hazır olunca çalışır
client.on('ready', () => {
    console.log(client.user.tag + " aktif!");

    client.user.setPresence({
        activities: [
            {
                name: "Yakında en iyi şekilde geleceğim...",
                type: ActivityType.Watching
            }
        ],
        status: "online"
    });
});

// BURAYA YENİ TOKENINI YAZ
client.login(process.env.TOKEN);


