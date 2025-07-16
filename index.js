import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} from '@whiskeysockets/baileys';

import express from 'express';
import axios from 'axios';
import qrcode from 'qrcode';
import open from 'open';
import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';

dotenv.config();

// ✅ Agrega esta línea justo aquí:
console.log('📌 Webhook Make configurado en:', process.env.WEBHOOK_WHATSAPP_MAKE_URL);

const app = express();
app.use(express.json());

let sockGlobal;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const sock = makeWASocket({ auth: state });

  sockGlobal = sock;

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (connection === 'open') {
      const numero = sock.user.id.split(':')[0];
      console.log(`✅ ¡Conectado a WhatsApp con el número: ${numero}`);
    }

    // Solo mostrar QR si no hay conexión y no estamos en producción
    if (qr && connection !== 'open' && process.env.NODE_ENV !== 'production') {
      qrcode.toDataURL(qr, async (err, url) => {
        if (err) {
          console.error('❌ Error generando QR:', err.message);
        } else {
          const htmlQR = `
            <html>
              <body style="display:flex;flex-direction:column;justify-content:center;align-items:center;height:100vh;font-family:sans-serif;">
                <h2>Escanea este código QR con WhatsApp</h2>
                <img src="${url}" style="width:300px;height:300px;" />
              </body>
            </html>
          `;
          const filePath = path.join(path.resolve(), 'qr.html');
          fs.writeFileSync(filePath, htmlQR);
          await open(filePath);
        }
      });
    }

    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('📴 Conexión cerrada. Reintentando:', shouldReconnect);
      if (shouldReconnect) startBot();
    }
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message || msg.key.fromMe) return;

    const from = msg.key.remoteJid;
    if (from === 'status@broadcast') return;

    const text =
      msg.message.conversation ||
      msg.message.extendedTextMessage?.text ||
      '';

    console.log(`📩 Mensaje recibido de ${from}: ${text}`);

    try {
      const respuesta = await axios.post(process.env.WEBHOOK_WHATSAPP_MAKE_URL, {
        mensaje: text,
        de: from,
      });

      const textoRespuesta = respuesta.data.respuesta || '✅ Recibido, gracias.';
      await sock.sendMessage(from, { text: textoRespuesta });

      if (respuesta.data.archivo) {
        const { url, tipo, nombre } = respuesta.data.archivo;
        const archivo = await axios.get(url, { responseType: 'arraybuffer' });

        const opciones = {
          caption: nombre || '',
          fileName: nombre || 'archivo',
          mimetype: archivo.headers['content-type']
        };

        if (tipo === 'image') {
          await sock.sendMessage(from, { image: archivo.data, ...opciones });
        } else if (tipo === 'document') {
          await sock.sendMessage(from, { document: archivo.data, ...opciones });
        } else if (tipo === 'audio') {
          await sock.sendMessage(from, { audio: archivo.data, ...opciones });
        } else if (tipo === 'video') {
          await sock.sendMessage(from, { video: archivo.data, ...opciones });
        }
      }

    } catch (error) {
      console.error('❌ Error al contactar Make:', error.message);
      await sock.sendMessage(from, {
        text: 'Lo siento 😓 Hubo un error al procesar tu mensaje.',
      });
    }
  });
}

startBot();

app.post('/enviar', async (req, res) => {
  const { numero, mensaje } = req.body;

  if (!numero || !mensaje) {
    return res.status(400).json({ error: 'Faltan número o mensaje' });
  }

  try {
    const jid = numero.includes('@s.whatsapp.net')
      ? numero
      : `${numero}@s.whatsapp.net`;

    await sockGlobal.sendMessage(jid, { text: mensaje });

    res.json({ status: 'Mensaje enviado', para: numero });
  } catch (err) {
    console.error('❌ Error al enviar mensaje:', err.message);
    res.status(500).json({ error: 'Error al enviar mensaje' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 API escuchando en http://localhost:${PORT}/enviar`);
});
