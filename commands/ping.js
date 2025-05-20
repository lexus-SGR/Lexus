export const name = 'ping';
export async function execute(sock, msg, text, owner) {
  await sock.sendMessage(msg.key.remoteJid, {
    text: `🥊 Pong! Niko hewani.`
  });
}
