const fs = require("fs")


global.ownernumber = ["6285777376772"]
global.Newname = "Julian-Cf"
global.status = "𝗣𝘂𝗯𝗹𝗶𝗰 𝗩𝗲𝗿𝘀𝗶𝗼𝗻"
global.owner = '𝗝𝘂𝗹𝗶𝗮𝗻'
global.namebot = 'julian-cf'
global.botv = '𝟭.𝟬'
global.v = '𝘃'
global.thumbnail = "https://files.catbox.moe/abgnqa.jpg"

//kontrol lampu rumah pake bot whatsapp via esp32
global.vps = "192.183.14.1"
global.port = "1883" 
global.usrmqtt = "kosong"
global.pass = "kosong"

let file = require.resolve(__filename);
fs.watchFile(file, () => {
    fs.unwatchFile(file);
    console.log(`Update ${__filename}`);
    delete require.cache[file];
    require(file);
});
