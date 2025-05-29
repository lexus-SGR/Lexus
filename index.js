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

  const session = { sock, qrCode: null, saveCreds, linkCode: null };
  sessions.set(pairingCode, session);

  sock.ev.on("connection.update", async (update) => {
    const { qr, connection, lastDisconnect } = update;

    if (qr) {
      try {
        const qrBase64 = await QRCode.toDataURL(qr);
        session.qrCode = qrBase64;
        sessions.set(pairingCode, session);
        console.log(`🖼️ QR code generated for ${pairingCode}`);
      } catch (err) {
        console.error("Error generating QR code:", err);
      }
    }

    if (connection === "close") {
      const code = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (code !== DisconnectReason.loggedOut) {
        console.log(`🔄 Reconnecting session ${pairingCode}...`);
        try {
          await startWhatsAppSession(pairingCode, phoneNumber);
        } catch (e) {
          console.error("Error reconnecting:", e);
        }
      } else {
        console.log(`❌ Session ${pairingCode} logged out.`);
        sessions.delete(pairingCode);
        const authPath = path.join(__dirname, `auth_${pairingCode}`);
        if (fs.existsSync(authPath)) fs.rmSync(authPath, { recursive: true, force: true });
      }
    }

    if (connection === "open") {
      console.log(`✅ WhatsApp connected for session ${pairingCode}`);
    }
  });

  sock.ev.on("creds.update", saveCreds);

  try {
    const code = await sock.requestPairingCode(phoneNumber);
    session.linkCode = code;
    console.log(`🔐 Pairing code sent to WhatsApp: ${code}`);
  } catch (err) {
    console.warn("⚠️ Pairing code not supported or failed:", err.message);
  }
}

// Endpoint: create session and send QR/pairing code
app.post("/pairing", async (req, res) => {
  const { phoneNumber } = req.body;

  if (!phoneNumber || !phoneNumber.startsWith("+")) {
    return res.status(400).json({ message: "Phone number must start with + (e.g. +255...)" });
  }

  const pairingCode = generatePairCode();
  try {
    await startWhatsAppSession(pairingCode, phoneNumber);
    const session = sessions.get(pairingCode);
    res.json({
      success: true,
      pairingCode,
      phoneNumber,
      linkCode: session.linkCode || null,
      message: "Session created. Use QR or pairing code to link your device.",
    });
  } catch (error) {
    console.error("Error starting session:", error);
    res.status(500).json({ message: "Failed to start WhatsApp session" });
  }
});

// Endpoint: fetch QR image in base64
app.get("/qr", (req, res) => {
  const pairingCode = req.query.pairingCode;
  if (!pairingCode) return res.status(400).json({ message: "pairingCode required" });

  const session = sessions.get(pairingCode);
  if (!session || !session.qrCode) {
    return res.status(404).json({ message: "QR not available yet" });
  }
  res.json({ qr: session.qrCode });
});

// Endpoint: list all active sessions
app.get("/sessions", (req, res) => {
  const list = [];
  sessions.forEach((s, code) => {
    list.push({
      pairingCode: code,
      connected: s.sock?.ws?.readyState === 1,
    });
  });
  res.json(list);
});

// Serve index.html page if exists
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

app.listen(PORT, () => {
  console.log(`🚀 Server running: http://localhost:${PORT}`);
});
