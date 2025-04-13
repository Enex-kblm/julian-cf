require("./config.js");
const fs = require("fs");
const axios = require("axios");
const { getGroupAdmins } = require("./lib/library.js");
const sharp = require("sharp");
const os = require("os");
const { createCanvas, loadImage, registerFont } = require("canvas");
const path = require("path");
const ffmpeg = require("fluent-ffmpeg");
const ffmpegStatic = require("ffmpeg-static");
const { execSync } = require("child_process");
const chalk = require("chalk");
ffmpeg.setFfmpegPath(ffmpegStatic);
const mqtt = require("mqtt");

const mqttConfig = {
    host: `${global.vps}`,
    port: `${global.port}`, //! gausah diganti
    username: `${global.usrmqtt}`,  // Jika diperlukan
    password: `${global.pass}`   // Jika diperlukan
};

const clientMQTT = mqtt.connect(`mqtt://${mqttConfig.host}:${mqttConfig.port}`, {
    username: mqttConfig.username,
    password: mqttConfig.password
});

clientMQTT.on("connect", function () {
    console.log("Connected to MQTT broker");
});

// --- Logic untuk menyimpan data pengguna ---
const dbFolder = path.join(__dirname, "database");
if (!fs.existsSync(dbFolder)) {
  fs.mkdirSync(dbFolder, { recursive: true });
}
const penggunaFile = path.join(dbFolder, "pengguna.json");
let penggunaData = {};
if (fs.existsSync(penggunaFile)) {
  try {
    penggunaData = JSON.parse(fs.readFileSync(penggunaFile, "utf-8"));
  } catch (err) {
    console.error("Error membaca pengguna.json:", err);
    penggunaData = {};
  }
}
function simpanPengguna() {
  fs.writeFileSync(penggunaFile, JSON.stringify(penggunaData, null, 2));
}
function tambahPengguna(userId, pushName) {
  if (!penggunaData[userId]) {
    penggunaData[userId] = { pushName, firstSeen: new Date().toISOString() };
    simpanPengguna();
  }
  console.log("Jumlah pengguna bot:", Object.keys(penggunaData).length);
}
// --- Akhir logika data pengguna ---

// Helper fetchJson
const fetchJson = async (url, options = {}) => {
  let response = await axios.get(url, options);
  return response.data;
};

// Global object untuk menyimpan sesi confess, pending confess, blokir, dan ID anonim
global.confessSessions = global.confessSessions || {};
global.pendingConfess = global.pendingConfess || {};
global.confessBlock = global.confessBlock || {};
global.confessAnon = global.confessAnon || {};
global.shutdownMode = false;
function generateAnonId() {
  return Math.random().toString(36).substring(2, 8);
}

module.exports = async (fell, m) => {
  try {
    const body =
      (m.mtype === "conversation" && m.message.conversation) ||
      (m.mtype === "imageMessage" && m.message.imageMessage.caption) ||
      (m.mtype === "documentMessage" && m.message.documentMessage.caption) ||
      (m.mtype === "videoMessage" && m.message.videoMessage.caption) ||
      (m.mtype === "extendedTextMessage" && m.message.extendedTextMessage.text) ||
      (m.mtype === "buttonsResponseMessage" && m.message.buttonsResponseMessage.selectedButtonId) ||
      (m.mtype === "templateButtonReplyMessage" && m.message.templateButtonReplyMessage.selectedId) ||
      "";
    const prefixRegex = /^[°zZ#$@*+,.?=''():√%!¢£¥€π¤ΠΦ_&><`™©®Δ^βα~¦|/\\©^]/;
    const prefix = prefixRegex.test(body) ? body.match(prefixRegex)[0] : "."; "/"
    const isCmd = body.startsWith(prefix);
    const command = isCmd ? body.slice(prefix.length).trim().split(" ")[0].toLowerCase() : "";
    const args = body.trim().split(" ").slice(1);
    const text = args.join(" ");
    const budy = typeof m.text === "string" ? m.text : "";

    const sender = m.key.fromMe
      ? (fell.user.id.split(":")[0] + "@s.whatsapp.net" || fell.user.id)
      : (m.key.participant || m.key.remoteJid);
    const senderNumber = sender.split("@")[0];
    const pushname = m.pushName || senderNumber;

    const botNumber = await fell.decodeJid(fell.user.id);
    const isBot = botNumber.includes(senderNumber);

    // Data grup (jika ada)
    const groupMetadata = m.isGroup ? await fell.groupMetadata(m.chat).catch(e => {}) : "";
    const participants = m.isGroup ? await groupMetadata.participants : "";
    const groupAdmins = m.isGroup ? await getGroupAdmins(participants) : "";
    const isCreator = (m &&
      m.sender &&
      [botNumber, ...global.owner].map(v => v.replace(/[^0-9]/g, "") + "@s.whatsapp.net").includes(m.sender)) || false;

      if (isCmd) {
        const now = new Date();
        const formattedDate = now.toLocaleDateString();
        const formattedTime = now.toLocaleTimeString();
        console.log(
          ('\n') + 
          chalk.bold.cyan('======')+(" ")+chalk.bold.yellow("[")+(" ")+chalk.bold.cyan("LOG MESSAGE")+(" ")+chalk.bold.yellow("]")+(" ")+chalk.bold.cyan('======') + '\n'+
          chalk.bold.cyan('Command    : ') + chalk.bold.yellow(`${prefix}${command}`) + '\n' +
          chalk.bold.cyan('From       : ') + chalk.bold.yellow(`${pushname}`) + '\n' +
          chalk.bold.cyan('Chat Type  : ') + chalk.bold.yellow(`${m.isGroup ? "Group Chat" : "Private Chat"}`) + '\n' +
          chalk.bold.cyan('Args       : ') + chalk.bold.yellow(`${args.length}`) + '\n' +
          chalk.bold.cyan('Date       : ') + chalk.bold.yellow(`${formattedDate}`) + '\n' +
          chalk.bold.cyan('Time       : ') + chalk.bold.yellow(`${formattedTime}`) + '\n' +
          chalk.bold.cyan('====')+(" ")+chalk.bold.yellow("[")+(" ")+chalk.bold.cyan("© 2025 Juli-Cf")+(" ")+chalk.bold.yellow("]")+(" ")+chalk.bold.cyan('=====') + '\n' + '\n'
        );
      }

    // Jika shutdownMode aktif, semua perintah diabaikan kecuali "start"
    if (global.shutdownMode && command !== "start") {
      return;
    }

    // Kirim reaksi global (satu kali) untuk semua perintah
    if (isCmd) {
      try {
        await fell.sendMessage(m.chat, { react: { text: "⏱️", key: m.key } });
      } catch (err) {
        console.error("Error sending reaction:", err);
      }
    }

   // Forwarding pesan jika ada sesi aktif
if (!isCmd) {
  for (let sessionId in global.confessSessions) {
    const session = global.confessSessions[sessionId];
    if (session.active && (session.from === m.sender || session.to === m.sender)) {
      const target = session.from === m.sender ? session.to : session.from;
      
      try {
        // Jika pesan berupa image atau sticker, cek dulu apakah media key tersedia
        if (m.mtype === "imageMessage" || m.mtype === "stickerMessage") {
          // Cek apakah objek pesan mengandung media key
          if (m.msg && m.msg.mediaKey) {
            const mediaBuffer = await fell.downloadMediaMessage(m);
            if (m.mtype === "imageMessage") {
              await fell.sendMessage(
                target,
                { image: mediaBuffer },
                { contextInfo: { forwardingScore: 9999, isForwarded: true } }
              );
            } else if (m.mtype === "stickerMessage") {
              await fell.sendMessage(
                target,
                { sticker: mediaBuffer },
                { contextInfo: { forwardingScore: 9999, isForwarded: true } }
              );
            }
          } else {
            // Jika media key tidak ada, forward pesan sebagai teks (fallback)
            await fell.sendMessage(
              target,
              { text: budy + "\n\n[Media Forwarded as Text]" },
              { contextInfo: { forwardingScore: 9999, isForwarded: true } }
            );
          }
        } else {
          // Untuk pesan teks atau jenis lain, forward sebagai teks
          await fell.sendMessage(
            target,
            { text: budy },
            { contextInfo: { forwardingScore: 9999, isForwarded: true } }
          );
        }
      } catch (err) {
        console.error("Error forwarding media:", err);
        // Fallback: kirim pesan sebagai teks jika terjadi error
        await fell.sendMessage(
          target,
          { text: budy + "\n\n[Forward failed, sent as text instead]" },
          { contextInfo: { forwardingScore: 9999, isForwarded: true } }
        );
      }
      console.log(`Pesan dari ${m.sender} diteruskan ke ${target} (forwarded)`);
      return;
    }
  }
}

    
    // --- Switch-case perintah ---
    switch (command) {
      case "shutdown": {
        if (!global.ownernumber.includes(senderNumber))
          return m.reply("Perintah ini hanya dapat digunakan oleh owner!");
        global.shutdownMode = true;
        m.reply("Bot telah dimatikan. Semua perintah diabaikan kecuali perintah start.");
        break;
      }
      case "start": {
        if (!global.ownernumber.includes(senderNumber))
          return m.reply("Perintah ini hanya dapat digunakan oleh owner!");
        global.shutdownMode = false;
        m.reply("Bot telah dihidupkan kembali.");
        break;
      }
 

      case 'menu': {
        const osu = require("node-os-utils");
        const cpu = osu.cpu;
        const mem = osu.mem;
        const cpuUsage = await cpu.usage();
        const memInfo = await mem.info();
        const jumlahPengguna = Object.keys(penggunaData).length;
        const uptimeSeconds = process.uptime();
        const hours = Math.floor(uptimeSeconds / 3600);
        const minutes = Math.floor((uptimeSeconds % 3600) / 60);
        const seconds = Math.floor(uptimeSeconds % 60);
        const uptimeFormatted = `${hours}h ${minutes}m ${seconds}s`;
        const footer = "\n© 2025 Juli-Cf";
        const sapaan = `*Halo, ${pushname}! Selamat datang di bot Juli-Cf*.`;
        const penjelasan = `*Bot ini berfungsi untuk membantu kamu dalam mengelola confess, mengubah stiker, dan fitur-fitur menarik lainnya.*`;
        const menuText = `
${sapaan}
${penjelasan}

*[ Bot Info ]*
Name      : ${global.namebot}
Version   : ${global.v}${global.botv}
Status    : ${global.status}
User      : *${jumlahPengguna}*
Active    : *${uptimeFormatted}* 

*[ System Info ]*
• CPU  : *${cpuUsage}%* 
• RAM  : *${memInfo.usedMemMb}MB* / *${memInfo.totalMemMb}MB*

*[ Owner Info ]*
Owner     : ${global.owner}
Contact   : *${global.ownernumber}*
${footer}`;
await fell.sendMessage(
  m.chat,
  { 
     image: { url: "image/thumb.webp" },
    caption: menuText,
    contextInfo: {
      forwardingScore: 9999,
      isForwarded: true,
      forwardedNewsletterMessageInfo: {
        newsletterName: `${global.namebot}`,
        newsletterJid: `120363418043234176@newsletter`
      },
      externalAdReply: {
        title: `${global.namebot} ${global.v}${global.botv}`,
        body: `Bot by ${global.owner}`,
        thumbnailUrl: global.thumbnail,
        sourceUrl: "https://whatsapp.com/channel/0029Vaa4rPI4yltIJcEJyN1x",
        mediaType: 1,
        renderLargerThumbnail: true,
        externalAdReply: {
          mentionedJid: [m.sender]
        }
      }
    },
    // Tombol ditambahkan menggunakan property "buttons" (bisa juga memakai templateButtons jika diinginkan)
    buttons: [
      {
        buttonId: `${prefix}allmenu`,
        buttonText: {
          displayText: "ALL MENU"
        },
        type: 1
      }
    ],
    headerType: 1,
    viewOnce: true
  },
  { quoted: m }
);

break;
}


case "cekidch":
case "idch": {
  if (!text) return m.reply(example("linkchnya")); // ! Pastikan fungsi example() terdefinisi atau gunakan pesan contoh secara manual
  if (!text.includes("https://whatsapp.com/channel/"))
    return m.reply("Link tautan tidak valid");
  
  let result = text.split("https://whatsapp.com/channel/")[1];
  
  // ? Memanggil API untuk mendapatkan metadata newsletter channel
  let resData = await fell.newsletterMetadata("invite", result);
  
  let teks = `
*ID :* ${resData.id}
*Nama :* ${resData.name}
*Total Pengikut :* ${resData.subscribers}
*Status :* ${resData.state}
*Verified :* ${resData.verification == "VERIFIED" ? "Terverifikasi" : "Tidak"}
  `;
  
  // ! Kirim pesan dengan gambar dan contextInfo forwarding
  await fell.sendMessage(
    m.chat,
    {
      image: { url: "image/ch.webp" },
      caption: teks, // ! Menggunakan teks di sini sebagai caption
      contextInfo: {
        forwardingScore: 9999,
        isForwarded: true,
      }
    },
    { quoted: m }
  );
}
break;


      case "allmenu": {
        const footer = "\n© 2025 Juli-Cf";
        const menuText = `
[ BOT & INFO ]
• ${prefix}menu
• ${prefix}idch
• ${prefix}cekidch
• ${prefix}allmenu

[ CONFESS COMMANDS ]
• ${prefix}confess
• ${prefix}confirm
• ${prefix}editconfess
• ${prefix}delconfess
• ${prefix}batal
• ${prefix}tolak
• ${prefix}bukablokir
• ${prefix}bloklist
• ${prefix}balas
• ${prefix}selesai

[ STICKER COMMANDS ]
• ${prefix}brat / ${prefix}sbrat
• ${prefix}bratvid / ${prefix}bratvideo
• ${prefix}s
• ${prefix}simg
${footer}`;
        await fell.sendMessage(
          m.chat,
          {
            image: { url: "image/thumb.webp" },
            caption: menuText,
            contextInfo: { forwardingScore: 9999, isForwarded: true }
          },
          { quoted: m }
        );
        break;
      }
      case "confess": {
        if (!text)
          return m.reply(`Format salah. Gunakan:\n${prefix}confess nama|628xx|pesan`);
        const confParts = text.split("|");
        if (confParts.length < 3)
          return m.reply(`Format salah. Gunakan:\n${prefix}confess nama|628xx|pesan`);
        const nama = confParts[0].trim();
        const tujuan = confParts[1].trim();
        const pesan = confParts.slice(2).join("|").trim();
        if (!tujuan.startsWith("628"))
          return m.reply("Nomor tujuan harus diawali dengan 628");
        const tujuanJid = `${tujuan}@s.whatsapp.net`;
        let anonId = global.confessAnon[sender];
        if (anonId && global.confessBlock[tujuanJid] && global.confessBlock[tujuanJid][anonId]) {
          if (Date.now() < global.confessBlock[tujuanJid][anonId])
            return m.reply("Penerima telah menolak confess dari Anda. Silahkan coba lagi nanti.");
          else delete global.confessBlock[tujuanJid][anonId];
        }
        if (global.pendingConfess[sender] && global.pendingConfess[sender].tujuanJid === tujuanJid)
          return m.reply("Anda sudah memiliki confess pending untuk nomor tersebut. Silakan konfirmasi atau batalkan terlebih dahulu.");
        for (let sessionId in global.confessSessions) {
          const session = global.confessSessions[sessionId];
          if (session.from === sender && session.to === tujuanJid)
            return m.reply("Anda sudah mengirim confess ke nomor tersebut.");
        }
        let konfirmasiMsg = `
*Konfirmasi Confess:*

Nama  : *${nama}*
Nomor : *${tujuan}*
Pesan : ${pesan}

Periksa kembali data di atas. Jika sudah benar, ketik *${prefix}confirm*
Jika ingin membatalkan, ketik *${prefix}batal*`;
        m.reply(konfirmasiMsg);
        global.pendingConfess[sender] = { nama, tujuanJid, pesan, createdAt: Date.now() };
        break;
      }
      case "confirm": {
        if (!global.pendingConfess[sender])
          return m.reply("Tidak ada confess pending yang perlu dikonfirmasi.");
        const { nama, tujuanJid, pesan } = global.pendingConfess[sender];
        if (!global.confessAnon[sender]) {
          global.confessAnon[sender] = generateAnonId();
        }
        const anonId = global.confessAnon[sender];
        const confessMsg = `
Halo 👋, ada pesan untuk kamu nih

Dari  : *${nama}*
Pesan : ${pesan.split("\n").join("\n       ")}

Balas dengan: *${prefix}balas*
Akhiri sesi dengan: *${prefix}selesai*
Untuk tolak, ketik: *${prefix}tolak <alasan>*
Lihat blokir: *${prefix}bloklist*
ID Pengirim: *${anonId}*`;
        const sentMsg = await fell.sendMessage(tujuanJid, { text: confessMsg });
        m.reply("Confess telah dikirim!");
        for (let sessionId in global.confessSessions) {
          const session = global.confessSessions[sessionId];
          if (session.from === sender && session.to === tujuanJid)
            delete global.confessSessions[sessionId];
        }
        const sessionId = Date.now().toString();
        global.confessSessions[sessionId] = {
          id: sessionId,
          from: sender,
          anon: anonId,
          to: tujuanJid,
          pesan,
          active: false,
          msgId: sentMsg.key
        };
        delete global.pendingConfess[sender];
        break;
      }
      case "editconfess": {
        if (!text) return m.reply("Masukkan teks baru untuk confess Anda.");
        if (global.pendingConfess[sender]) {
          global.pendingConfess[sender].pesan = text;
          return m.reply("Confess pending Anda telah diperbarui. Ketik *" + prefix + "confirm* untuk mengirim ulang confess tersebut.");
        } else {
          let edited = false;
          for (let sessionId in global.confessSessions) {
            const session = global.confessSessions[sessionId];
            if (session.from === sender) {
              if (session.msgId) await fell.sendMessage(session.to, { delete: session.msgId });
              const newConfessMsg = `
Halo 👋, ada pesan untuk kamu nih

Dari  : *${session.nama || "Anon"}*
Pesan : ${text.split("\n").join("\n       ")}

Balas dengan: *${prefix}balas*
Akhiri sesi dengan: *${prefix}selesai*
Untuk tolak, ketik: *${prefix}tolak <alasan>*
Lihat blokir: *${prefix}bloklist*
ID Pengirim: *${session.anon}*`;
              const newMsg = await fell.sendMessage(session.to, { text: newConfessMsg });
              session.pesan = text;
              session.msgId = newMsg.key;
              edited = true;
            }
          }
          return edited
            ? m.reply("Confess aktif Anda telah diperbarui.")
            : m.reply("Tidak ada confess yang dapat diedit.");
        }
        break;
      }
      case "delconfess": {
        if (global.pendingConfess[sender]) {
          delete global.pendingConfess[sender];
          return m.reply("Confess pending Anda telah dihapus.");
        } else {
          let count = 0;
          for (let sessionId in global.confessSessions) {
            const session = global.confessSessions[sessionId];
            if (session.from === sender) {
              if (session.msgId) await fell.sendMessage(session.to, { delete: session.msgId });
              delete global.confessSessions[sessionId];
              count++;
            }
          }
          return count > 0
            ? m.reply("Confess aktif Anda telah dihapus.")
            : m.reply("Tidak ada confess yang dapat dihapus.");
        }
        break;
      }
      case "batal": {
        if (global.pendingConfess[sender]) {
          delete global.pendingConfess[sender];
          m.reply("Confess pending Anda telah dibatalkan.");
        } else {
          m.reply("Tidak ada confess pending.");
        }
        break;
      }
      case "tolak": {
        if (!text) return m.reply(`Format salah. Gunakan:\n${prefix}tolak <alasan>`);
        const blockDuration = 7 * 24 * 60 * 60 * 1000;
        let blockedCount = 0;
        for (let sessionId in global.confessSessions) {
          const session = global.confessSessions[sessionId];
          if (session.to === m.sender) {
            if (!global.confessBlock[m.sender]) {
              global.confessBlock[m.sender] = {};
            }
            global.confessBlock[m.sender][session.anon] = Date.now() + blockDuration;
            await fell.sendMessage(session.from, { text: "Confess Anda telah ditolak.\nAlasan: " + text });
            await fell.sendMessage(session.to, { text: "Sesi confess telah dihentikan karena Anda menolak confess." });
            if (session.msgId) await fell.sendMessage(session.to, { delete: session.msgId });
            delete global.confessSessions[sessionId];
            blockedCount++;
          }
        }
        m.reply("Anda telah menolak confess dari " + blockedCount + " pengirim.\nUntuk membuka blokir, ketik: " + prefix + "bukablokir <ID Pengirim>");
        break;
      }
      case "bukablokir": {
        if (!args[0]) return m.reply("Format salah. Gunakan:\n" + prefix + "bukablokir <ID Pengirim>");
        const unblockId = args[0].trim();
        if (global.confessBlock[m.sender] && global.confessBlock[m.sender][unblockId]) {
          delete global.confessBlock[m.sender][unblockId];
          m.reply("Blokir untuk ID " + unblockId + " telah dicabut.");
        } else {
          m.reply("Tidak ditemukan blokir untuk ID tersebut.");
        }
        break;
      }
      case "bloklist": {
        const blockList = global.confessBlock[m.sender];
        if (!blockList || Object.keys(blockList).length === 0) {
          return m.reply("Tidak ada blokir confess yang aktif.");
        }
        let msg = "Daftar blokir confess:\n";
        for (let anonId in blockList) {
          let expiry = blockList[anonId];
          let remaining = expiry - Date.now();
          if (remaining < 0) continue;
          let seconds = Math.floor(remaining / 1000);
          let minutes = Math.floor(seconds / 60);
          let hours = Math.floor(minutes / 60);
          let days = Math.floor(hours / 24);
          hours = hours % 24;
          minutes = minutes % 60;
          seconds = seconds % 60;
          msg += `ID: ${anonId} - Berakhir dalam ${days}d ${hours}h ${minutes}m ${seconds}s\n`;
        }
        m.reply(msg);
        break;
      }
      case "balas": {
        let foundSession = null;
        for (let sessionId in global.confessSessions) {
          const session = global.confessSessions[sessionId];
          if ((session.from === m.sender || session.to === m.sender) && !session.active) {
            foundSession = session;
            break;
          }
        }
        if (!foundSession) return m.reply("Tidak ada sesi confess yang tersedia untuk dibalas.");
        foundSession.active = true;
        await fell.sendMessage(foundSession.from, { text: "Mode balas telah diaktifkan. Pesan selanjutnya akan diteruskan ke lawan bicara." });
        await fell.sendMessage(foundSession.to, { text: "Mode balas telah diaktifkan. Pesan selanjutnya akan diteruskan ke lawan bicara." });
        m.reply("Mode balas aktif untuk sesi confess ini.");
        break;
      }
      case "selesai": {
        let foundSessionId = null;
        for (let sessionId in global.confessSessions) {
          const session = global.confessSessions[sessionId];
          if (session.from === m.sender || session.to === m.sender) {
            foundSessionId = sessionId;
            break;
          }
        }
        if (!foundSessionId) return m.reply("Tidak ada sesi confess yang bisa dihentikan.");
        const session = global.confessSessions[foundSessionId];
        await fell.sendMessage(session.from, { text: "Sesi confess telah dihentikan." });
        await fell.sendMessage(session.to, { text: "Sesi confess telah dihentikan." });
        delete global.confessSessions[foundSessionId];
        m.reply("Sesi confess berhasil dihentikan.");
        break;
      }
      case "brat":
      case "sbrat": {
        const quo =
          args.length >= 1
            ? args.join(" ")
            : m.quoted?.text || m.quoted?.caption || m.quoted?.description || null;
        if (!quo) return m.reply("Masukkan teksnya, woi!");
        async function brat(text) {
          try {
            return await new Promise((resolve, reject) => {
              if (!text) return reject("Missing text input");
              axios
                .get("https://brat.caliphdev.com/api/brat", {
                  params: { text },
                  responseType: "arraybuffer",
                })
                .then((res) => {
                  const image = Buffer.from(res.data);
                  if (image.length <= 10240) return reject("Failed generate brat");
                  return resolve({ success: true, image });
                })
                .catch((err) => reject(err));
            });
          } catch (e) {
            return { success: false, errors: e };
          }
        }
        const buf = await brat(quo);
        if (!buf.success) return m.reply("Terjadi error saat membuat stiker brat.");
        await fell.sendImageAsSticker(m.chat, buf.image, m, {
          packname: "Juli-Cf",
          author: "Julian",
        });
        break;
      }
      case "simg": {
        const quotedMsg = m.quoted;
        if (!quotedMsg)
          return m.reply("Mohon reply pesan stiker yang ingin diubah ke gambar.");
        if (!quotedMsg.mimetype || !quotedMsg.mimetype.includes("webp"))
          return m.reply("Pesan yang direply bukan stiker.");
        const stickerBuffer = await fell.downloadMediaMessage(m.quoted);
        try {
          const imageBuffer = await sharp(stickerBuffer).png().toBuffer();
          await fell.sendMessage(
            m.chat,
            { image: imageBuffer, caption: "Stiker berhasil dikonversi menjadi gambar." },
            { quoted: m }
          );
        } catch (err) {
          console.error(err);
          m.reply("Terjadi kesalahan saat mengonversi stiker ke gambar.");
        }
        break;
      }
      case "bratvideo":
      case "bratvid": {
        if (!text) return m.reply(`Contoh: ${prefix + command} hai`);
        if (text.length > 250) return m.reply(`Karakter terbatas, max 250!`);
        const words = text.split(" ");
        const tempDir = path.join(process.cwd(), "lib");
        if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
        const framePaths = [];
        try {
          // Buat frame video untuk setiap penambahan kata
          for (let i = 0; i < words.length; i++) {
            const currentText = words.slice(0, i + 1).join(" ");
            const res = await axios
              .get(
                `https://brat.caliphdev.com/api/brat?text=${encodeURIComponent(currentText)}`,
                { responseType: "arraybuffer" }
              )
              .catch((e) => e.response);
            const framePath = path.join(tempDir, `frame${i}.mp4`);
            fs.writeFileSync(framePath, res.data);
            framePaths.push(framePath);
          }
          // Buat file list untuk menggabungkan frame-frame video
          const fileListPath = path.join(tempDir, "filelist.txt");
          let fileListContent = "";
          for (let i = 0; i < framePaths.length; i++) {
            fileListContent += `file '${framePaths[i]}'\n`;
            fileListContent += `duration 0.7\n`;
          }
          fileListContent += `file '${framePaths[framePaths.length - 1]}'\n`;
          fileListContent += `duration 2\n`;
          fs.writeFileSync(fileListPath, fileListContent);
          const outputVideoPath = path.join(tempDir, "output.mp4");
          // Gabungkan frame-frame menjadi video menggunakan ffmpegStatic
          execSync(
            `${ffmpegStatic} -y -f concat -safe 0 -i ${fileListPath} -vf "fps=30" -c:v libx264 -preset ultrafast -pix_fmt yuv420p ${outputVideoPath}`
          );
          // Kirim video hasil konversi sebagai stiker animasi
          await fell.sendImageAsSticker(
            m.chat,
            outputVideoPath,
            m,
            {
              packname: "Juli-Cf",
              author: "Julian",
            }
          );
          // Hapus file-file sementara
          framePaths.forEach((frame) => {
            if (fs.existsSync(frame)) fs.unlinkSync(frame);
          });
          if (fs.existsSync(fileListPath)) fs.unlinkSync(fileListPath);
          if (fs.existsSync(outputVideoPath)) fs.unlinkSync(outputVideoPath);
        } catch (e) {
          console.error(e);
          m.reply("Terjadi kesalahan");
        }
        break;
      }

      case 'lampu':
        if (!global.ownernumber.includes(senderNumber))
          return m.reply("Perintah ini hanya dapat digunakan oleh owner!");
        if (!args[0]) {
            m.reply(`Gunakan perintah "${prefix}lampu on" atau "${prefix}lampu off"`);
            break;
        }
        if (args[0].toLowerCase() === 'on') {
            clientMQTT.publish('lampu/kamar', 'ON', {}, (err) => {
                if (err) m.reply('Gagal mengirim perintah lampu ON!');
                else m.reply('Lampu dinyalakan');
            });
        } else if (args[0].toLowerCase() === 'off') {
            clientMQTT.publish('lampu/kamar', 'OFF', {}, (err) => {
                if (err) m.reply('Gagal mengirim perintah lampu OFF!');
                else m.reply('Lampu dimatikan');
            });
        } else {
            m.reply('Perintah tidak dikenal. Gunakan "!lampu on" atau "!lampu off"');
        }
        break;
        


      default:
        if (budy.startsWith("=>")) {
          if (!isCreator) return;
          try {
            m.reply(require("util").format(eval(`(async () => { return ${budy.slice(3)} })()`)));
          } catch (e) {
            m.reply(String(e));
          }
        }
        if (budy.startsWith(">")) {
          if (!isCreator) return;
          let kode = budy.trim().split(/ +/)[1];
          let teks;
          try {
            teks = /await/i.test(kode)
              ? eval("(async() => { " + kode + " })()")
              : eval(kode);
          } catch (e) {
            teks = e;
          } finally {
            await m.reply(require("util").format(teks));
          }
        }
        if (budy.startsWith("$")) {
          if (!isCreator) return;
          require("child_process").exec(budy.slice(2), (err, stdout) => {
            if (err) return m.reply(`${err}`);
            if (stdout) return m.reply(stdout);
          });
        }
        break;
    }
  } catch (err) {
    console.log(require("util").format(err));
  }
};

let file = require.resolve(__filename);
fs.watchFile(file, () => {
  fs.unwatchFile(file);
  console.log(`Update ${__filename}`);
  delete require.cache[file];
  require(file);
});
