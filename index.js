import {
  makeWASocket,
  useMultiFileAuthState,
  DisconnectReason
} from '@whiskeysockets/baileys';

// import axios from 'axios'; // Make
import qrcode from 'qrcode';
import express from 'express';
// import dotenv from 'dotenv'; // Make
import open from 'open';
import fs from 'fs';
import path from 'path';

// dotenv.config(); // Make

const app = express();
app.use(express.json());

let sockGlobal;

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('./auth');
  const sock = makeWASocket({ auth: state });

  sockGlobal = sock;

  // Eventos de conexión
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('📲 Escanea este código QR en tu navegador:\n');
      qrcode.toDataURL(qr, async (err, url) => {
        if (!err) {
          const htmlQR = `
            <html>
              <body>
                <h2>Escanea este código QR:</h2>
                <img src="${url}" />
              </body>
            </html>
          `;
          const filePath = path.join(process.cwd(), 'qr.html');
          fs.writeFileSync(filePath, htmlQR);
          await open(`file://${filePath}`);
        }
      });
    }

    if (connection === 'close') {
      const shouldReconnect =
        lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
      console.log('📴 Conexión cerrada. Reintentando:', shouldReconnect);
      if (shouldReconnect) startBot();
    }

    if (connection === 'open') {
      const numero = sock.user.id.split(':')[0];
      console.log(`✅ ¡Conectado a WhatsApp con el número: ${numero}`);
    }
  });

  sock.ev.on('creds.update', saveCreds);

  // Escuchar mensajes entrantes
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

    // Comentado: integración con Make
    /*
    try {
      const respuesta = await axios.post(process.env.WEBHOOK_WHATSAPP_MAKE_URL, {
        mensaje: text,
        de: from,
      });

      const textoRespuesta = respuesta.data.respuesta || '✅ Recibido, gracias.';
      await sock.sendMessage(from, { text: textoRespuesta });

      // Enviar archivo si viene desde Make
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
    */
  });
}

// ▶️ Iniciar bot
startBot();

// 🔹 Endpoint para enviar mensaje
app.post('/enviar', async (req, res) => {
  const { numero, mensaje } = req.body;

  if (!numero || !mensaje) {
    return res.status(400).json({ error: 'Faltan número o mensaje' });
  }

  try {
    const jid = numero.includes('@g.us') || numero.includes('@s.whatsapp.net')
      ? numero
      : numero.includes('-') // detectar si es grupo por formato
        ? `${numero}@g.us`
        : `${numero}@s.whatsapp.net`;

    await sockGlobal.sendMessage(jid, { text: mensaje });
    res.json({ status: 'Mensaje enviado', para: jid });

  } catch (err) {
    console.error('❌ Error al enviar mensaje:', err.message);
    res.status(500).json({ error: 'Error al enviar mensaje' });
  }
});

// 🔎 Endpoint para consultar metadata del grupo
app.post('/grupo', async (req, res) => {
  const { idGrupo } = req.body;

  if (!idGrupo) {
    return res.status(400).json({ error: 'Falta idGrupo' });
  }

  const jid = idGrupo.includes('@g.us') ? idGrupo : `${idGrupo}@g.us`;

  try {
    const metadata = await sockGlobal.groupMetadata(jid);
    res.json({ ok: true, nombre: metadata.subject, participantes: metadata.participants.length });
  } catch (err) {
    console.error('❌ Error obteniendo metadata del grupo:', err.message);
    res.status(500).json({ error: 'No se pudo obtener información del grupo' });
  }
});

// 🚀 Puerto
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 API escuchando en http://localhost:${PORT}`);
});
