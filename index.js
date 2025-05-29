import express from 'express';
import { makeWASocket, useSingleFileAuthState, DisconnectReason } from '@whiskeysockets/baileys';
import { existsSync, mkdirSync } from 'fs';
import cors from 'cors';
import { v4 as uuidv4 } from 'uuid';

const app = express();
app.use(cors());
app.use(express.json());
app.use(express.static('public')); // Serve static files like index.html

const SESSIONS_DIR = './sessions';
if(!existsSync(SESSIONS_DIR)) mkdirSync(SESSIONS_DIR);

const pairingMap = new Map(); // pairingCode => { phone, socket, qr }

app.post('/pairing', (req, res) => {
  const { phone } = req.body;
  if(!phone) return res.json({ success: false, message: 'Please provide your WhatsApp number.' });

  const pairingCode = uuidv4().slice(0, 8);
  pairingMap.set(pairingCode, { phone, socket: null, qr: null });

  res.json({ success: true, pairingCode });
});

app.get('/qr', async (req, res) => {
  const pairingCode = req.query.pairingCode;
  if(!pairingCode || !pairingMap.has(pairingCode)) {
    return res.json({ success: false, message: 'Invalid or missing pairing code.' });
  }

  let sessionData = pairingMap.get(pairingCode);

  if(sessionData.socket) {
    if(sessionData.qr) {
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

      if(qr){
        // Convert QR string to data URI image for frontend
        const qrDataUri = `data:image/png;base64,${Buffer.from(qr).toString('base64')}`;
        sessionData.qr = qrDataUri;
        pairingMap.set(pairingCode, sessionData);
      }

      if(connection === 'open') {
        console.log(`Session created for pairingCode ${pairingCode}, phone: ${sessionData.phone}`);
        sessionData.socket = sock;
        sessionData.qr = null;
        pairingMap.set(pairingCode, sessionData);
      }

      if(connection === 'close') {
        const status = (lastDisconnect?.error)?.output?.statusCode;
        if(status === DisconnectReason.loggedOut){
          console.log(`Session logged out for pairingCode ${pairingCode}`);
          pairingMap.delete(pairingCode);
        }
      }
    });

    sock.ev.on('creds.update', saveState);

    sessionData.socket = sock;
    pairingMap.set(pairingCode, sessionData);
  }

  if(sessionData.qr){
    res.json({ success: true, qr: sessionData.qr });
  } else {
    res.json({ success: false, message: 'QR code is not available at the moment, please try again shortly.' });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
