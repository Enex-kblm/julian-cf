//! ===================================================================
//! LIBRARY.JS - Fungsi Helper untuk Bot WhatsApp
//! ===================================================================

const { proto, getContentType } = require('@fizzxydev/baileys-pro'); // ! Mengimpor proto & getContentType dari @fizzxydev/baileys-pro
const fs = require('fs'); // ! Modul file system
const { tmpdir } = require("os"); // ! Untuk mendapatkan direktori temporary OS
const Crypto = require("crypto"); // ! Untuk operasi kriptografi, misalnya membuat random bytes
const { createCanvas } = require("canvas"); // ! Untuk manipulasi gambar menggunakan canvas
const os = require("os"); // ! Modul os untuk mendapatkan informasi OS
const path = require("path"); // ! Modul path untuk mengelola path file
const ffmpeg = require("fluent-ffmpeg"); // ! Modul ffmpeg untuk konversi media
const ffmpegStatic = require("ffmpeg-static"); // ! Versi statis ffmpeg
ffmpeg.setFfmpegPath(ffmpegStatic); // ! Set path ffmpeg ke versi statis

const webp = require("node-webpmux"); // ! Modul untuk memanipulasi file WebP dan metadata EXIF
const Jimp = require('jimp'); // ! Untuk manipulasi gambar (alternatif)
const { spawn } = require('child_process'); // ! Untuk menjalankan proses eksternal (ffmpeg)
const axios = require("axios"); // ! Modul untuk melakukan HTTP request

//! ===================================================================
//! FUNCTION: smsg() - Serialisasi Pesan Masuk
//! ===================================================================
function smsg(fell, m, store) {
  if (!m) return m; //? Jika pesan kosong, kembalikan pesan itu
  let M = proto.WebMessageInfo; //todo: Mendapatkan prototipe pesan
  if (m.key) {
    m.id = m.key.id; // * Set ID pesan
    m.isBaileys = m.id.startsWith('BAE5') && m.id.length === 16; // * Tandai pesan yang dikirim oleh Baileys
    m.chat = m.key.remoteJid; // * Set JID chat
    m.fromMe = m.key.fromMe; // * Tandai apakah pesan berasal dari bot
    m.isGroup = m.chat.endsWith('@g.us'); // * Tentukan apakah chat adalah grup
    m.sender = fell.decodeJid(m.fromMe && fell.user.id || m.participant || m.key.participant || m.chat || ''); // * Dapatkan sender
    if (m.isGroup) m.participant = fell.decodeJid(m.key.participant) || ''; // * Jika grup, set participant
  }
  if (m.message) {
    m.mtype = getContentType(m.message); //? Dapatkan tipe konten pesan
    m.msg = (m.mtype == 'viewOnceMessage' 
             ? m.message[m.mtype].message[getContentType(m.message[m.mtype].message)]
             : m.message[m.mtype]); // * Ambil pesan sebenarnya, jika viewOnce maka ambil pesan tersembunyi
    //todo: Mengatur properti body pesan dari berbagai kemungkinan field
    m.body = m.message.conversation || m.msg.caption || m.msg.text ||
      (m.mtype == 'listResponseMessage') && m.msg.singleSelectReply.selectedRowId ||
      (m.mtype == 'buttonsResponseMessage') && m.msg.selectedButtonId ||
      (m.mtype == 'viewOnceMessage') && m.msg.caption || m.text;
    let quoted = m.quoted = m.msg.contextInfo ? m.msg.contextInfo.quotedMessage : null;
    m.mentionedJid = m.msg.contextInfo ? m.msg.contextInfo.mentionedJid : [];
    if (m.quoted) {
      let type = getContentType(quoted);
      m.quoted = m.quoted[type]; // * Set quoted message berdasarkan tipe konten
      if (['productMessage'].includes(type)) {
        type = getContentType(m.quoted);
        m.quoted = m.quoted[type];
      }
      if (typeof m.quoted === 'string') m.quoted = { text: m.quoted };
      m.quoted.mtype = type;
      m.quoted.id = m.msg.contextInfo.stanzaId;
      m.quoted.chat = m.msg.contextInfo.remoteJid || m.chat;
      m.quoted.isBaileys = m.quoted.id ? m.quoted.id.startsWith('BAE5') && m.quoted.id.length === 16 : false;
      m.quoted.sender = fell.decodeJid(m.msg.contextInfo.participant);
      m.quoted.fromMe = m.quoted.sender === (fell.user && fell.user.id);
      m.quoted.text = m.quoted.text || m.quoted.caption || m.quoted.conversation || m.quoted.contentText || m.quoted.selectedDisplayText || m.quoted.title || '';
      m.quoted.mentionedJid = m.msg.contextInfo ? m.msg.contextInfo.mentionedJid : [];
      //todo: Fungsi untuk mendapatkan objek pesan yang dikutip
      m.getQuotedObj = m.getQuotedMessage = async () => {
        if (!m.quoted.id) return false;
        let q = await store.loadMessage(m.chat, m.quoted.id, fell);
        return exports.smsg(fell, q, store);
      };
      ////* Membuat objek palsu untuk quoted agar mendukung delete dan download
      let vM = m.quoted.fakeObj = M.fromObject({
        key: { remoteJid: m.quoted.chat, fromMe: m.quoted.fromMe, id: m.quoted.id },
        message: quoted,
        ...(m.isGroup ? { participant: m.quoted.sender } : {})
      });
      m.quoted.delete = () => fell.sendMessage(m.quoted.chat, { delete: vM.key });
      m.quoted.download = () => fell.downloadMediaMessage(m.quoted);
    }
  }
  if (m.msg.url) m.download = () => fell.downloadMediaMessage(m.msg);
  m.text = m.msg.text || m.msg.caption || m.message.conversation || m.msg.contentText || m.msg.selectedDisplayText || m.msg.title || '';
  m.reply = (text, chatId = m.chat, options = {}) =>
    (Buffer.isBuffer(text)
      ? fell.sendMedia(chatId, text, "file", "", m, { ...options })
      : fell.sendText(chatId, text, m, { ...options }));
  return m;
}

//! ===================================================================
//! FUNCTION: imageToWebp() - Konversi Gambar ke Format WebP
//! ===================================================================
async function imageToWebp(media) {
  //todo: Membuat file sementara untuk input dan output
  const tmpFileOut = path.join(tmpdir(), `${Crypto.randomBytes(6).readUIntLE(0,6).toString(36)}.webp`);
  const tmpFileIn = path.join(tmpdir(), `${Crypto.randomBytes(6).readUIntLE(0,6).toString(36)}.jpg`);
  fs.writeFileSync(tmpFileIn, media); // * Tulis media ke file input
  await new Promise((resolve, reject) => {
    ffmpeg(tmpFileIn)
      .on("error", reject) //? Jika terjadi error, reject promise
      .on("end", () => resolve(true)) //? Setelah selesai, resolve promise
      .addOutputOptions([
        "-vcodec", "libwebp", // * Gunakan codec libwebp
        "-vf", "scale='min(320,iw)':min'(320,ih)':force_original_aspect_ratio=decrease,fps=15,pad=320:320:-1:-1:color=white@0.0,split[a][b];[a]palettegen=reserve_transparent=on:transparency_color=ffffff[p];[b][p]paletteuse"
      ])
      .toFormat("webp")
      .save(tmpFileOut); // * Simpan output ke file webp
  });
  const buff = fs.readFileSync(tmpFileOut); // * Baca file output sebagai buffer
  fs.unlinkSync(tmpFileOut); //? Hapus file output sementara
  fs.unlinkSync(tmpFileIn); //? Hapus file input sementara
  return buff;
}

//! ===================================================================
//! FUNCTION: videoToWebp() - Konversi Video ke Format WebP (Stiker Animasi)
//! ===================================================================
async function videoToWebp(media) {
  const tmpFileOut = path.join(tmpdir(), `${Crypto.randomBytes(6).readUIntLE(0,6).toString(36)}.webp`);
  const tmpFileIn = path.join(tmpdir(), `${Crypto.randomBytes(6).readUIntLE(0,6).toString(36)}.mp4`);
  fs.writeFileSync(tmpFileIn, media); // * Tulis video ke file input
  await new Promise((resolve, reject) => {
    ffmpeg(tmpFileIn)
      .on("error", reject)
      .on("end", () => resolve(true))
      .addOutputOptions([
        "-vcodec", "libwebp",
        "-vf", "scale='min(320,iw)':min'(320,ih)':force_original_aspect_ratio=decrease,fps=15,pad=320:320:-1:-1:color=white@0.0,split[a][b];[a]palettegen=reserve_transparent=on:transparency_color=ffffff[p];[b][p]paletteuse",
        "-loop", "0",
        "-ss", "00:00:00",
        "-t", "00:00:05",
        "-preset", "default",
        "-an",
        "-vsync", "0"
      ])
      .toFormat("webp")
      .save(tmpFileOut);
  });
  const buff = fs.readFileSync(tmpFileOut);
  fs.unlinkSync(tmpFileOut);
  fs.unlinkSync(tmpFileIn);
  return buff;
}

//! ===================================================================
//! FUNCTION: writeExifImg() - Menambahkan Metadata EXIF ke Gambar (Stiker)
//! ===================================================================
async function writeExifImg(media, metadata) {
  let wMedia = await imageToWebp(media);
  const tmpFileIn = path.join(tmpdir(), `${Crypto.randomBytes(6).readUIntLE(0,6).toString(36)}.webp`);
  const tmpFileOut = path.join(tmpdir(), `${Crypto.randomBytes(6).readUIntLE(0,6).toString(36)}.webp`);
  fs.writeFileSync(tmpFileIn, wMedia);
  if (metadata.packname || metadata.author) {
    const img = new webp.Image();
    //? Menyusun JSON metadata untuk stiker
    const json = { 
      "sticker-pack-id": `https://github.com/KirBotz`, 
      "sticker-pack-name": metadata.packname, 
      "sticker-pack-publisher": metadata.author, 
      "emojis": metadata.categories ? metadata.categories : [""]
    };
    const exifAttr = Buffer.from([
      0x49,0x49,0x2A,0x00,0x08,0x00,0x00,0x00,
      0x01,0x00,0x41,0x57,0x07,0x00,0x00,0x00,
      0x00,0x00,0x16,0x00,0x00,0x00
    ]);
    const jsonBuff = Buffer.from(JSON.stringify(json), "utf-8");
    const exif = Buffer.concat([exifAttr, jsonBuff]);
    exif.writeUIntLE(jsonBuff.length, 14, 4);
    await img.load(tmpFileIn);
    fs.unlinkSync(tmpFileIn);
    img.exif = exif;
    await img.save(tmpFileOut);
    const result = fs.readFileSync(tmpFileOut);
    fs.unlinkSync(tmpFileOut);
    return result;
  }
}

//! ===================================================================
//! FUNCTION: writeExifVid() - Menambahkan Metadata EXIF ke Video (Stiker Animasi)
//! ===================================================================
async function writeExifVid(media, metadata) {
  let wMedia = await videoToWebp(media);
  const tmpFileIn = path.join(tmpdir(), `${Crypto.randomBytes(6).readUIntLE(0,6).toString(36)}.webp`);
  const tmpFileOut = path.join(tmpdir(), `${Crypto.randomBytes(6).readUIntLE(0,6).toString(36)}.webp`);
  fs.writeFileSync(tmpFileIn, wMedia);
  if (metadata.packname || metadata.author) {
    const img = new webp.Image();
    const json = { 
      "sticker-pack-id": `https://github.com/KirBotz`, 
      "sticker-pack-name": metadata.packname, 
      "sticker-pack-publisher": metadata.author, 
      "emojis": metadata.categories ? metadata.categories : [""]
    };
    const exifAttr = Buffer.from([
      0x49,0x49,0x2A,0x00,0x08,0x00,0x00,0x00,
      0x01,0x00,0x41,0x57,0x07,0x00,0x00,0x00,
      0x00,0x00,0x16,0x00,0x00,0x00
    ]);
    const jsonBuff = Buffer.from(JSON.stringify(json), "utf-8");
    const exif = Buffer.concat([exifAttr, jsonBuff]);
    exif.writeUIntLE(jsonBuff.length, 14, 4);
    await img.load(tmpFileIn);
    fs.unlinkSync(tmpFileIn);
    img.exif = exif;
    await img.save(tmpFileOut);
    const result = fs.readFileSync(tmpFileOut);
    fs.unlinkSync(tmpFileOut);
    return result;
  }
}

//! ===================================================================
//! FUNCTION: writeExif() - Menambahkan Metadata EXIF ke Media (Gambar/Video)
//! ===================================================================
async function writeExif(media, metadata) {
  let wMedia = /webp/.test(media.mimetype)
    ? media.data
    : /image/.test(media.mimetype)
      ? await imageToWebp(media.data)
      : /video/.test(media.mimetype)
        ? await videoToWebp(media.data)
        : "";
  const tmpFileIn = path.join(tmpdir(), `${Crypto.randomBytes(6).readUIntLE(0,6).toString(36)}.webp`);
  const tmpFileOut = path.join(tmpdir(), `${Crypto.randomBytes(6).readUIntLE(0,6).toString(36)}.webp`);
  fs.writeFileSync(tmpFileIn, wMedia);
  if (metadata.packname || metadata.author) {
    const img = new webp.Image();
    const json = { 
      "sticker-pack-id": `https://github.com/KirBotz`, 
      "sticker-pack-name": metadata.packname, 
      "sticker-pack-publisher": metadata.author, 
      "emojis": metadata.categories ? metadata.categories : [""]
    };
    const exifAttr = Buffer.from([
      0x49,0x49,0x2A,0x00,0x08,0x00,0x00,0x00,
      0x01,0x00,0x41,0x57,0x07,0x00,0x00,0x00,
      0x00,0x00,0x16,0x00,0x00,0x00
    ]);
    const jsonBuff = Buffer.from(JSON.stringify(json), "utf-8");
    const exif = Buffer.concat([exifAttr, jsonBuff]);
    exif.writeUIntLE(jsonBuff.length, 14, 4);
    await img.load(tmpFileIn);
    fs.unlinkSync(tmpFileIn);
    img.exif = exif;
    await img.save(tmpFileOut);
    const result = fs.readFileSync(tmpFileOut);
    fs.unlinkSync(tmpFileOut);
    return result;
  }
}

//! ===================================================================
//! FUNCTION: watsappp() - Mengkonversi Media menggunakan ffmpeg
//! ===================================================================
function watsappp(buffer, args = [], ext = "", ext2 = "") {
  return new Promise(async (resolve, reject) => {
    try {
      let tmp = path.join(__dirname, "../tmp", new Date() * 1 + "." + ext);
      let out = tmp + "." + ext2;
      await fs.promises.writeFile(tmp, buffer);
      spawn("ffmpeg", ["-y", "-i", tmp, ...args, out])
        .on("error", reject)
        .on("close", async (code) => {
          try {
            await fs.promises.unlink(tmp);
            if (code !== 0) return reject(code);
            resolve({
              data: await fs.promises.readFile(out),
              filename: out,
              delete() {
                return fs.promises.unlink(out);
              },
            });
          } catch (e) {
            reject(e);
          }
        });
    } catch (e) {
      reject(e);
    }
  });
}

//! ===================================================================
//! FUNCTION: toPTT() - Konversi Media menjadi PTT (Push-to-Talk)
//! ===================================================================
function toPTT(buffer, ext) {
  return watsappp(buffer, ["-vn", "-c:a", "libopus", "-b:a", "128k", "-vbr", "on"], ext, "ogg");
}

//! ===================================================================
//! FUNCTION: toAudio() - Konversi Media menjadi Audio (Opus)
//! ===================================================================
function toAudio(buffer, ext) {
  return watsappp(buffer, ["-vn", "-c:a", "libopus", "-b:a", "128k", "-vbr", "on", "-compression_level", "10"], ext, "opus");
}

//! ===================================================================
//! FUNCTION: toVideo() - Konversi Media menjadi Video (MP4)
//! ===================================================================
function toVideo(buffer, ext) {
  return watsappp(buffer, ["-c:v", "libx264", "-c:a", "aac", "-ab", "128k", "-ar", "44100", "-crf", "32", "-preset", "slow"], ext, "mp4");
}

//! ===================================================================
//! FUNCTION: getGroupAdmins() - Mengembalikan daftar admin dari grup
//! ===================================================================
function getGroupAdmins(participants) {
  let admins = [];
  for (let i of participants) {
    if (i.admin === "superadmin" || i.admin === "admin") {
      admins.push(i.id);
    }
  }
  return admins;
}

//! ===================================================================
//! FUNCTION: jsonformat() - Memformat JSON dengan indentasi
//! ===================================================================
const jsonformat = (string) => {
  return JSON.stringify(string, null, 2);
};

//! ===================================================================
//! FUNCTION: generateProfilePicture() - Menghasilkan Profile Picture dari Buffer
//! ===================================================================
const generateProfilePicture = async (buffer) => {
  const jimp = await Jimp.read(buffer);
  const min = jimp.getWidth();
  const max = jimp.getHeight();
  const cropped = jimp.crop(0, 0, min, max);
  return {
    img: await cropped.scaleToFit(720, 720).getBufferAsync(Jimp.MIME_JPEG),
    preview: await cropped.scaleToFit(720, 720).getBufferAsync(Jimp.MIME_JPEG),
  };
};

//! ===================================================================
//! FUNCTION: getBuffer() - Mendapatkan Buffer dari URL
//! ===================================================================
const getBuffer = async (url, options) => {
  try {
    options = options || {};
    const res = await axios({
      method: "GET",
      url,
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, seperti Gecko) Chrome/78.0.3904.70 Safari/537.36",
        DNT: 1,
        "Upgrade-Insecure-Request": 1,
      },
      ...options,
      responseType: "arraybuffer",
    });
    return res.data;
  } catch (err) {
    return err;
  }
};

//! ===================================================================
//! EXPORTS: Menyediakan fungsi-fungsi helper untuk digunakan di file lain
//! ===================================================================
module.exports = {
  smsg,
  imageToWebp,
  videoToWebp,
  writeExifImg,
  writeExifVid,
  writeExif,
  toPTT,
  toAudio,
  toVideo,
  getGroupAdmins,
  jsonformat,
  generateProfilePicture,
  getBuffer,
};

//! ===================================================================
//! WATCH FILE: Auto-reload library.js jika terjadi perubahan
//! ===================================================================
let file = require.resolve(__filename);
fs.watchFile(file, () => {
  fs.unwatchFile(file);
  console.log(`Update ${__filename}`);
  delete require.cache[file];
  require(file);
});
