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

const app = express();
app.use(express.static(__dirname));
const PORT = process.env.PORT || 3000;
let pairCode = '';

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");

  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    logger: pino({ level: "silent" }),
    printQRInTerminal: true,
    browser: ["Ben Whittaker Bot", "Chrome", "1.0.0"],
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("connection.update", async (update) => {
    const { connection, lastDisconnect, qr, pairingCode } = update;

    if (pairingCode) {
      pairCode = pairingCode;
      fs.writeFileSync("./paircode.txt", pairCode);
      console.log("📲 Pairing Code: ", pairCode);
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

  // Request pairing code only if creds not yet created
  if (!fs.existsSync("./auth/creds.json")) {
    // 👇 ANDIKA NAMBA YAKO HALISI HAPA
    await sock.requestPairingCode("255760317060@s.whatsapp.net");
  }
}

app.get("/", (req, res) => {
  res.send("🟢 WhatsApp Session Server - QR + Pairing Code (by Ben Whittaker Tech)");
});

app.get("/pairing", (req, res) => {
  if (fs.existsSync("./paircode.txt")) {
    const code = fs.readFileSync("./paircode.txt", "utf-8");
    res.send(`📲 Your Pairing Code: <b>${code}</b>`);
  } else {
    res.send("⏳ Pairing code not yet generated.");
  }
});

app.get("/session", (req, res) => {
  const filePath = "./auth/creds.json";
  if (fs.existsSync(filePath)) {
    res.sendFile(__dirname + "/auth/creds.json");
  } else {
    res.send("❌ Session not yet available. Scan QR or use Pairing Code.");
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Server running at http://localhost:${PORT}`);
  startBot();
});
