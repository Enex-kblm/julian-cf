/*  
  Fitur Hidetag untuk mengirim pesan ke semua anggota grup tanpa tag
*/

const { delay } = require("@fizzxydev/baileys-pro");

async function Hidetag(fell, m, textMsg) {
    try {
        // Dapatkan metadata grup
        const groupMetadata = await fell.groupMetadata(m.chat);
        const participants = groupMetadata.participants;
        
        // Simpan semua nomor anggota grup
        const memberNumbers = participants.map(p => p.id.replace(/@s\.whatsapp\.net/g, ''));
        
        // Buat pesan dengan format khusus
        const hiddenMsg = {
            text: textMsg,
            mentions: memberNumbers, // Masukkan mentions tapi dalam mode hidden
            contextInfo: {
                mentionedJid: memberNumbers,
                forwardingScore: 9999,
                isForwarded: true
            }
        };

        // Kirim sebagai broadcast dengan context khusus
        await fell.sendMessage(m.chat, hiddenMsg, {
            ephemeralExpiration: 86400, // 24 jam
            quoted: m
        });

        return { status: true, msg: "Pesan terkirim ke semua anggota tanpa tag" };
    } catch (error) {
        console.error("Hidetag error:", error);
        return { status: false, msg: error.message };
    }
}

module.exports = Hidetag;