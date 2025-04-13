//! ===================================================================
//! MAIN.JS - Bot WhatsApp dengan @fizzxydev/baileys-pro dan Command Menarik
//! ===================================================================
require("./config.js"); // ! Mengimpor konfigurasi global

// ! Modul Utama yang digunakan
const { 
  default: makeWASocket, 
  useMultiFileAuthState, 
  DisconnectReason, 
  makeInMemoryStore, 
  jidDecode, 
  downloadContentFromMessage 
} = require("@fizzxydev/baileys-pro"); // ? Gunakan @fizzxydev/baileys-pro sesuai yang digunakan
const pino = require("pino");
const fs = require("fs");
const path = require("path");
const { Boom } = require("@hapi/boom");
const PhoneNumber = require("awesome-phonenumber");
const fetch = require("node-fetch");
const FileType = require("file-type");
const readline = require("readline");
const chalk = require("chalk");

// ! Mengimpor helper functions dari library.js
const { 
  smsg, 
  imageToWebp, 
  videoToWebp, 
  writeExifImg, 
  writeExifVid, 
  writeExif, 
  toPTT, 
  toAudio, 
  toVideo 
} = require("./lib/library.js");

//? Membuat in-memory store untuk penyimpanan sementara
const store = makeInMemoryStore({ logger: pino().child({ level: "silent", stream: "store" }) });

//todo: Fungsi untuk mengambil input dari terminal (misal untuk nomor pendaftaran)
const question = (text) => {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(text, answer => { 
      rl.close(); 
      resolve(answer);
    });
  });
};

//! ===================================================================
//! FUNCTION: start() - Memulai Koneksi Bot WhatsApp
//! ===================================================================
async function start() {
  //todo: Inisialisasi state autentikasi dari session
  const { state, saveCreds } = await useMultiFileAuthState("session");

  //* Membuat koneksi menggunakan makeWASocket dari @fizzxydev/baileys-pro
  const fell = makeWASocket({
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    auth: state,
    browser: ['Mac OS', 'Safari', '10.15.7']
  });

  //? Jika bot belum terdaftar, minta input nomor dan request pairing code
  if (!fell.authState.creds.registered) {
    console.log(chalk.bold.yellow('Tidak ada nomor yang terdaftar, daftarin nomor kamu dulu yuk'));
    const phoneNumber = await question(chalk.bold.green('Input Number 62xxx : '));
    const custom = "JULIANCF"; //ini custom pairing code, maksimal 8 digit kalo mau ganti
    let code = await fell.requestPairingCode(phoneNumber, custom);
    code = code?.match(/.{1,4}/g)?.join("-") || code;
    console.log(chalk.magenta(`YOUR PAIRING CODE: ${code}`));
  }

  // * Mengikat (bind) store ke event socket
  store.bind(fell.ev);

  //! EVENT: Pesan Masuk (messages.upsert)
  fell.ev.on("messages.upsert", async (chatUpdate) => {
    try {
      const mek = chatUpdate.messages[0];
      if (!mek.message) return; //todo: Abaikan pesan kosong
      //? Jika pesan merupakan ephemeral, ambil pesan aslinya
      mek.message = Object.keys(mek.message)[0] === "ephemeralMessage" 
        ? mek.message.ephemeralMessage.message 
        : mek.message;
      // * Abaikan pesan status broadcast
      if (mek.key && mek.key.remoteJid === "status@broadcast") return;
      // * Jika bot tidak publik dan pesan bukan dari bot sendiri, abaikan pesan notify
      if (!fell.public && !mek.key.fromMe && chatUpdate.type === "notify") return;
      // * Abaikan pesan forward dari Baileys
      if (mek.key.id.startsWith("BAE5") && mek.key.id.length === 16) return;
      //? Serialisasi pesan menggunakan helper smsg dari library.js
      const m = smsg(fell, mek, store);
      //todo: Panggil file command.js untuk memproses command
      require("./command.js")(fell, m, chatUpdate, store);
    } catch (err) {
      console.log(chalk.red("Error:"), err);
    }
  });

  //! FUNCTION: fell.decodeJid - Mengonversi JID ke format standar
  fell.decodeJid = (jid) => {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
      const decode = jidDecode(jid) || {};
      return (decode.user && decode.server && decode.user + "@" + decode.server) || jid;
    } else return jid;
  };

  //! FUNCTION: fell.getName - Mengambil nama kontak atau grup
  fell.getName = (jid, withoutContact = false) => {
    const id = fell.decodeJid(jid);
    withoutContact = fell.withoutContact || withoutContact;
    let v;
    if (id.endsWith("@g.us"))
      return new Promise(async (resolve) => {
        v = store.contacts[id] || {};
        if (!(v.name || v.subject)) 
          v = (await fell.groupMetadata(id).catch(() => ({}))) || {};
        resolve(v.name || v.subject || PhoneNumber("+" + id.replace("@s.whatsapp.net", "")).getNumber("international"));
      });
    else
      v = id === "0@s.whatsapp.net"
        ? { id, name: "WhatsApp" }
        : id === fell.decodeJid(fell.user.id)
          ? fell.user
          : store.contacts[id] || {};
    return (withoutContact ? "" : v.name) || v.subject || v.verifiedName || PhoneNumber("+" + jid.replace("@s.whatsapp.net", "")).getNumber("international");
  };

  //! Set bot ke mode publik
  fell.public = true;
  fell.serializeM = (m) => smsg(fell, m, store);

  //! EVENT: Connection Update
  fell.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output.statusCode;
      //? Restart jika terjadi disconnect karena alasan tertentu
      if ([DisconnectReason.badSession, DisconnectReason.connectionClosed, DisconnectReason.connectionLost, DisconnectReason.connectionReplaced, DisconnectReason.restartRequired, DisconnectReason.timedOut].includes(reason)) {
        console.log(chalk.yellow(`Koneksi terputus (reason: ${reason}). Mengulang koneksi...`));
        start();
      } else if (reason === DisconnectReason.loggedOut) {
        console.log(chalk.red("Terlogout, silakan scan ulang QR Code untuk masuk kembali."));
      } else {
        fell.end(chalk.red(`Unknown DisconnectReason: ${reason}|${connection}`));
      }
    } else if (connection === 'open') {
      console.log(chalk.green('[Connected] '), chalk.blue(JSON.stringify(fell.user.id, null, 2)));
    }
  });

  //! EVENT: Update kredensial (auto-save)
  fell.ev.on("creds.update", saveCreds);

  //! FUNCTION: fell.sendText - Mengirim pesan teks dengan opsi quoted
  fell.sendText = (jid, text, quoted = "", options) => {
    console.log(chalk.cyan(`Mengirim pesan ke ${jid}: ${text}`));
    return fell.sendMessage(jid, { text: text, ...options }, { quoted });
  };

  //! FUNCTION: fell.downloadMediaMessage - Mendownload media dari pesan
  fell.downloadMediaMessage = async (message) => {
    const mime = (message.msg || message).mimetype || "";
    const messageType = message.mtype ? message.mtype.replace(/Message/gi, "") : mime.split("/")[0];
    const stream = await downloadContentFromMessage(message, messageType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }
    return buffer;
  };

  //! FUNCTION: fell.sendImageAsSticker - Mengirim gambar sebagai stiker
  fell.sendImageAsSticker = async (jid, input, quoted, options = {}) => {
    let buff;
    if (Buffer.isBuffer(input)) {
      buff = input;
    } else if (typeof input === "string") {
      if (/^https?:\/\//.test(input)) {
        const res = await fetch(input);
        buff = await res.buffer();
      } else if (fs.existsSync(input)) {
        buff = fs.readFileSync(input);
      }
    }
    let buffer;
    if (options && (options.packname || options.author)) {
      buffer = await writeExifImg(buff, options);
    } else {
      buffer = await imageToWebp(buff);
    }
    await fell.sendMessage(jid, { sticker: buffer, ...options }, { quoted });
    return buffer;
  };

  //! FUNCTION: fell.sendVideoAsSticker - Mengirim video sebagai stiker
  fell.sendVideoAsSticker = async (jid, input, quoted, options = {}) => {
    let buff;
    if (Buffer.isBuffer(input)) {
      buff = input;
    } else if (typeof input === "string") {
      if (/^https?:\/\//.test(input)) {
        const res = await fetch(input);
        buff = await res.buffer();
      } else if (fs.existsSync(input)) {
        buff = fs.readFileSync(input);
      }
    }
    let buffer;
    if (options && (options.packname || options.author)) {
      buffer = await writeExifVid(buff, options);
    } else {
      buffer = await videoToWebp(buff);
    }
    await fell.sendMessage(jid, { sticker: buffer, ...options }, { quoted });
    return buffer;
  };

  //! FUNCTION: fell.getFile - Mendapatkan file dari path/URL/buffer
  fell.getFile = async (PATH, returnAsFilename) => {
    let res, filename;
    const data = Buffer.isBuffer(PATH)
      ? PATH
      : /^data:.*?\/.*?;base64,/i.test(PATH)
        ? Buffer.from(PATH.split(`,`)[1], "base64")
        : /^https?:\/\//.test(PATH)
          ? await (res = await fetch(PATH)).buffer()
          : fs.existsSync(PATH)
            ? (filename = PATH, fs.readFileSync(PATH))
            : typeof PATH === "string"
              ? PATH
              : Buffer.alloc(0);
    if (!Buffer.isBuffer(data)) throw new TypeError("Result is not a buffer");
    const type = await FileType.fromBuffer(data) || {
      mime: "application/octet-stream",
      ext: ".bin"
    };
    if (data && returnAsFilename && !filename) {
      filename = path.join(__dirname, "./tmp/" + new Date() * 1 + "." + type.ext);
      await fs.promises.writeFile(filename, data);
    }
    return {
      res,
      filename,
      ...type,
      data,
      deleteFile() {
        return filename && fs.promises.unlink(filename);
      }
    };
  };

  //! FUNCTION: fell.sendFile - Mengirim file dengan caption, dokumen, atau ptt
  fell.sendFile = async (jid, path, filename = "", caption = "", quoted, ptt = false, options = {}) => {
    let type = await fell.getFile(path, true);
    let { res, data: file, filename: pathFile } = type;
    if (res && res.status !== 200 || file.length <= 65536) {
      try { throw { json: JSON.parse(file.toString()) }; }
      catch (e) { if (e.json) throw e.json; }
    }
    let opt = { filename };
    if (quoted) opt.quoted = quoted;
    if (!type) options.asDocument = true;
    let mtype = "", mimetype = type.mime, convert;
    if (/webp/.test(type.mime) || (/image/.test(type.mime) && options.asSticker)) mtype = "sticker";
    else if (/image/.test(type.mime) || (/webp/.test(type.mime) && options.asImage)) mtype = "image";
    else if (/video/.test(type.mime)) mtype = "video";
    else if (/audio/.test(type.mime)) {
      convert = await (ptt ? toPTT : toAudio)(file, type.ext);
      file = convert.data;
      pathFile = convert.filename;
      mtype = "audio";
      mimetype = "audio/ogg; codecs=opus";
    } else mtype = "document";
    if (options.asDocument) mtype = "document";

    let message = {
      ...options,
      caption,
      ptt,
      [mtype]: { url: pathFile },
      mimetype
    };
    let m;
    try {
      m = await fell.sendMessage(jid, message, { ...opt, ...options });
    } catch (e) {
      console.error(e);
      m = null;
    } finally {
      if (!m) m = await fell.sendMessage(jid, { ...message, [mtype]: file }, { ...opt, ...options });
      return m;
    }
  };

  //! FUNCTION: fell.downloadAndSaveMediaMessage - Mendownload media dan menyimpannya ke file
  fell.downloadAndSaveMediaMessage = async (message, filename, attachExtension = true) => {
    const quoted = message.m ? message.m : message;
    const mime = (message.m || message).mimetype || "";
    const messageType = message.mtype ? message.mtype.replace(/Message/gi, "") : mime.split("/")[0];
    const stream = await downloadContentFromMessage(quoted, messageType);
    let buffer = Buffer.from([]);
    for await (const chunk of stream) {
      buffer = Buffer.concat([buffer, chunk]);
    }
    const type = await FileType.fromBuffer(buffer);
    const trueFileName = attachExtension ? filename + "." + type.ext : filename;
    await fs.writeFileSync(trueFileName, buffer);
    return trueFileName;
  };

  //todo: Mengembalikan objek fell agar command.js dapat menggunakannya
  return fell;
}

//! MULAI BOT: Panggil fungsi start()
start();

//! WATCH FILE: Auto-reload jika file main.js berubah
let file = require.resolve(__filename);
fs.watchFile(file, () => {
  fs.unwatchFile(file);
  console.log(chalk.bgBlue(`Update ${__filename}`));
  delete require.cache[file];
  require(file);
});
