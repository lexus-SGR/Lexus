const express = require("express");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const QRCode = require("qrcode");
const pino = require("pino");
const fs = require("fs");
const path = require("path");

const app = express();
app.use(express.static(__dirname));
app.use(express.json());

const PORT = process.env.PORT || 3000;

const sessions = new Map();

function generatePairCode() {
  return Math.random().toString(36).substring(2, 8).toUpperCase();
}

async function startWhatsAppSession(pairingCode, phoneNumber) {
  const { state, saveCreds } = await useMultiFileAuthState(`auth_${pairingCode}`);

  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["Ben Whittaker Bot", "Chrome", "1.0.0"],
  });

  sessions.set(pairingCode, { sock, qrCode: null, saveCreds });

  sock.ev.on("connection.update", async (update) => {
    const { qr, connection, lastDisconnect } = update;

    if (qr) {
      try {
        const qrBase64 = await QRCode.toDataURL(qr);
        const session = sessions.get(pairingCode);
        if (session) {
          session.qrCode = qrBase64;
          sessions.set(pairingCode, session);
          console.log(`🖼️ QR code updated for ${pairingCode}`);
        }
      } catch (err) {
        console.error("Error generating QR code image:", err);
      }
    }

    if (connection === "close") {
      const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (statusCode !== DisconnectReason.loggedOut) {
        console.log(`🔄 Reconnecting session ${pairingCode}...`);
        try {
          await startWhatsAppSession(pairingCode, phoneNumber);
        } catch (e) {
          console.error("Error reconnecting:", e);
        }
      } else {
        console.log(`❌ Session ${pairingCode} logged out and removed.`);
        sessions.delete(pairingCode);
        try {
          const authPath = path.join(__dirname, `auth_${pairingCode}`);
          if (fs.existsSync(authPath)) {
            fs.rmSync(authPath, { recursive: true, force: true });
            console.log(`🗑️ Deleted auth folder for ${pairingCode}`);
          }
        } catch (e) {
          console.error("Error deleting auth folder:", e);
        }
      }
    }

    if (connection === "open") {
      console.log(`✅ WhatsApp connected for session ${pairingCode}`);
    }
  });

  sock.ev.on("creds.update", saveCreds);
}

app.post("/pairing", async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    if (!phoneNumber) {
      return res.status(400).json({ message: "Phone number required" });
    }
    if (!phoneNumber.startsWith("+")) {
      return res.status(400).json({ message: "Phone number must start with country code and + sign" });
    }

    const pairingCode = generatePairCode();

    await startWhatsAppSession(pairingCode, phoneNumber);

    res.json({ success: true, pairingCode, message: `Session started. Use pairingCode to fetch QR.` });
  } catch (error) {
    console.error("Failed to start session:", error);
    res.status(500).json({ success: false, message: "Failed to start session" });
  }
});

app.get("/qr", (req, res) => {
  const pairingCode = req.query.pairingCode;
  if (!pairingCode) {
    return res.status(400).json({ message: "pairingCode query param required" });
  }
  const session = sessions.get(pairingCode);
  if (!session) {
    return res.status(404).json({ message: "Pairing code not found" });
  }
  if (!session.qrCode) {
    return res.status(404).json({ message: "QR code not generated yet" });
  }
  res.json({ qr: session.qrCode });
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
});
