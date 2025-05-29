const express = require("express");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const fs = require("fs");
const pino = require("pino");
const path = require("path");

const app = express();
app.use(express.static(__dirname));
app.use(express.json()); // ili kusoma body za JSON

const PORT = process.env.PORT || 3000;

let pairCode = '';
let qrCode = '';
let sock = null;

async function startBot() {
  try {
    const { state, saveCreds } = await useMultiFileAuthState("auth");

    const { version } = await fetchLatestBaileysVersion();

    sock = makeWASocket({
      version,
      auth: state,
      logger: pino({ level: "silent" }),
      printQRInTerminal: true,
      browser: ["Ben Whittaker Bot", "Chrome", "1.0.0"],
    });

    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", async (update) => {
      const { connection, lastDisconnect, qr, pairingCode } = update;

      if (qr) {
        qrCode = qr;
        console.log("🖼️ QR code updated.");
      }

      if (pairingCode) {
        pairCode = pairingCode;
        // Andika pairing code kwenye file kwa persistence
        fs.writeFileSync(path.join(__dirname, "paircode.txt"), pairCode);
        console.log("📲 Pairing Code: ", pairCode);
      }

      if (connection === "close") {
        const statusCode = new Boom(lastDisconnect?.error)?.output?.statusCode;
        if (statusCode !== DisconnectReason.loggedOut) {
          console.log("🔄 Reconnecting...");
          await startBot();
        } else {
          console.log("❌ Logged out from WhatsApp.");
          sock = null; // Clear socket on logout
          pairCode = '';
          qrCode = '';
          // Optionally, delete auth folder if you want to force re-auth
        }
      }

      if (connection === "open") {
        console.log("✅ Bot Connected to WhatsApp!");
      }
    });

  } catch (err) {
    console.error("Error in startBot:", err);
  }
}

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Return raw QR code string
app.get("/qr", (req, res) => {
  if (qrCode) {
    res.send(qrCode);
  } else {
    res.status(404).send("QR code not yet generated.");
  }
});

// Return current pairing code string
app.get("/pair", (req, res) => {
  if (pairCode) {
    res.send(pairCode);
  } else {
    res.status(404).send("Pairing code not yet generated.");
  }
});

// POST endpoint to request pairing code for a phone number
app.post("/request-pairing", async (req, res) => {
  try {
    const phoneNumber = req.body.phoneNumber;
    if (!phoneNumber) {
      return res.status(400).json({ message: "Phone number is required" });
    }
    const jid = `${phoneNumber}@s.whatsapp.net`;

    if (!sock) {
      return res.status(500).json({ message: "WhatsApp socket not initialized yet" });
    }

    // NOTE: bailey sio na method requestPairingCode rasmi, badilisha kwa logic yako
    // Kama unataka kuanzisha pairing, basi anza session mpya au tumia njia ya kuanzisha QR
    // Hii hapa ni mfano tu, unaweza kuondoa kama haifanyi kazi
    if (sock.ev) {
      // Hii sio API rasmi, inawezekana haifanyi kazi
      try {
        await sock.requestPairingCode(jid);
        return res.json({ message: `Pairing code requested for ${phoneNumber}` });
      } catch (e) {
        return res.status(500).json({ message: "Failed to request pairing code", error: e.message });
      }
    } else {
      return res.status(500).json({ message: "Sock.ev not available" });
    }
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: "Failed to request pairing code", error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  startBot();
});
