import express from 'express';
import { makeWASocket, useSingleFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { existsSync, mkdirSync } from 'fs';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';
import dotenv from 'dotenv';
import axios from 'axios';
import chalk from 'chalk';
import Boom from '@hapi/boom';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve index.html, style.css, etc.

const SESSIONS_DIR = './sessions';
if (!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR);

const pairingMap = new Map(); // pairingCode => { phone, socket, qr }

app.post('/pairing', (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.json(Boom.badRequest('Please provide your WhatsApp number.'));

  const pairingCode = uuidv4().slice(0, 8);
  pairingMap.set(pairingCode, { phone, socket: null, qr: null });

  console.log(chalk.green(`[PAIR] New pairingCode created: ${pairingCode} for phone: ${phone}`));
  res.json({ success: true, pairingCode });
});

app.get('/qr', async (req, res) => {
  const pairingCode = req.query.pairingCode;
  if (!pairingCode || !pairingMap.has(pairingCode)) {
    return res.json(Boom.badRequest('Invalid or missing pairing code.'));
  }

  let sessionData = pairingMap.get(pairingCode);

  if (sessionData.socket) {
    if (sessionData.qr) {
      return res.json({ success: true, qr: sessionData.qr });
    }
  } else {
    const { state, saveState } = useSingleFileAuthState(`${SESSIONS_DIR}/${pairingCode}.json`);
    const sock = makeWASocket({
      printQRInTerminal: false,
      auth: state,
    });

    sock.ev.on('connection.update', (update) => {
      const { qr, connection, lastDisconnect } = update;

      if (qr) {
        const qrDataUri = `data:image/png;base64,${Buffer.from(qr).toString('base64')}`;
        sessionData.qr = qrDataUri;
        pairingMap.set(pairingCode, sessionData);
        console.log(chalk.yellow(`[QR] QR generated for code: ${pairingCode}`));
      }

      if (connection === 'open') {
        console.log(chalk.blue(`[LOGIN] WhatsApp connected for: ${sessionData.phone}`));
        sessionData.socket = sock;
        sessionData.qr = null;
        pairingMap.set(pairingCode, sessionData);
      }

      if (connection === 'close') {
        const status = (lastDisconnect?.error)?.output?.statusCode;
        if (status === DisconnectReason.loggedOut) {
          console.log(chalk.red(`[LOGOUT] Session closed for: ${pairingCode}`));
          pairingMap.delete(pairingCode);
        }
      }
    });

    sock.ev.on('creds.update', saveState);
    sessionData.socket = sock;
    pairingMap.set(pairingCode, sessionData);
  }

  if (sessionData.qr) {
    res.json({ success: true, qr: sessionData.qr });
  } else {
    res.json({ success: false, message: 'QR code not ready yet. Try again shortly.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(chalk.cyan(`✅ Server running on http://localhost:${PORT}`));
});
