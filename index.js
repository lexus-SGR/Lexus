const express = require("express");
const path = require("path");
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} = require("@whiskeysockets/baileys");
const { Boom } = require("@hapi/boom");
const fs = require("fs");
const pino = require("pino");

const app = express();
const PORT = process.env.PORT || 3000;

let pairCode = "";
let qrCode = "";

app.use(express.static(path.join(__dirname))); // serve static files like style.css and index.html

// Serve your index.html on root
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// Endpoint to get QR code string (for display or debugging)
app.get("/qr", (req, res) => {
  if (qrCode) {
    res.send(qrCode);
  } else {
    res.send("QR code not yet generated.");
  }
});

// Endpoint to get pairing code as JSON
app.get("/pair", (req, res) => {
  if (pairCode) {
    res.json({ pairingCode: pairCode });
  } else {
    res.json({ message: "Pairing code not yet generated." });
  }
});

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: false,
    browser: ["Ben Whittaker Bot", "Chrome", "1.0.0"],
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect, qr, pairingCode: pCode } = update;

    if (qr) {
      qrCode = qr;
      console.log("📷 QR Code updated");
    }

    if (pCode) {
      pairCode = pCode;
      fs.writeFileSync("./paircode.txt", pairCode);
      console.log("🔗 Pairing Code:", pairCode);
    }

    if (connection === "close") {
      const reason = new Boom(lastDisconnect?.error)?.output?.statusCode;
      if (reason !== DisconnectReason.loggedOut) {
        console.log("🔄 Reconnecting...");
        startBot();
      } else {
        console.log("❌ Logged out from WhatsApp.");
      }
    }

    if (connection === "open") {
      console.log("✅ Bot Connected to WhatsApp!");
    }
  });

  if (!fs.existsSync("./auth/creds.json")) {
    await sock.requestPairingCode("255760317060@s.whatsapp.net"); // Badilisha na namba yako halisi
  }
}

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  startBot();
});
