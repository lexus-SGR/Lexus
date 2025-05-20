import pkg from '@whiskeysockets/baileys';
const {
  default: makeWASocket,
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore
} = pkg;

import fs from 'fs'
import P from 'pino'
import dotenv from 'dotenv'
import { Boom } from '@hapi/boom'
dotenv.config()

const PREFIX = process.env.PREFIX || 'apo@'
const OWNER = process.env.OWNER_NUMBER + '255760317060@s.whatsapp.net'

const startSock = async () => {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info')
  const { version } = await fetchLatestBaileysVersion()

  const sock = makeWASocket({
    version,
    printQRInTerminal: true,
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, P({ level: 'silent' })),
    },
    logger: P({ level: 'silent' }),
    browser: ['Ben Whittaker Tech', 'Chrome', '1.0'],
    syncFullHistory: false,
  })

  sock.ev.on('creds.update', saveCreds)

  // Status auto view
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message) return
    if (msg.key.remoteJid === 'status@broadcast') {
      await sock.readMessages([msg.key])
    }
  })

  // Auto open view-once in groups if you are admin
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message || !msg.message?.viewOnceMessageV2) return
    const sender = msg.key.remoteJid
    if (!sender.endsWith('@g.us')) return

    try {
      const metadata = await sock.groupMetadata(sender)
      const groupAdmins = metadata.participants.filter(p => p.admin !== null).map(p => p.id)
      const isUserAdmin = groupAdmins.includes(OWNER)
      if (!isUserAdmin) return

      const originalMsg = msg.message.viewOnceMessageV2.message
      await sock.sendMessage(sender, {
        text: `🕵️ View-Once message opened by bot:\n\n${JSON.stringify(originalMsg, null, 2)}`
      })
    } catch (e) {
      console.error('View-once error:', e)
    }
  })

  // Command handler + link detection
  sock.ev.on('messages.upsert', async ({ messages }) => {
    const msg = messages[0]
    if (!msg.message || msg.key.fromMe || msg.key.remoteJid === 'status@broadcast') return

    const sender = msg.key.remoteJid
    const type = Object.keys(msg.message)[0]
    const body = msg.message?.conversation || msg.message[type]?.text || ''
    const isGroup = sender.endsWith('@g.us')
    const fromOwner = msg.key.participant === OWNER || sender === OWNER

    // Prefix command handling
    if (body.startsWith(PREFIX)) {
      const command = body.slice(PREFIX.length).trim().toLowerCase()

      if (command === 'ping') {
        await sock.sendMessage(sender, { text: '🥊 Pong! Bot iko kazini.' }, { quoted: msg })
      }

      if (command === 'menu') {
        await sock.sendMessage(sender, {
          text: `Ben Whittaker Bot Commands:\n\n${PREFIX}ping\n${PREFIX}menu`
        }, { quoted: msg })
      }
    }

    // Link detection
    if (isGroup && /https?:\/\//i.test(body)) {
      try {
        const metadata = await sock.groupMetadata(sender)
        const groupAdmins = metadata.participants.filter(p => p.admin !== null).map(p => p.id)
        const isBotAdmin = groupAdmins.includes(sock.user.id)
        const isUserAdmin = groupAdmins.includes(msg.key.participant)

        if (isBotAdmin && !isUserAdmin) {
          await sock.sendMessage(sender, {
            text: `⛔ Link detected from @${msg.key.participant.split('@')[0]} — removing...`,
            mentions: [msg.key.participant]
          })
          await sock.groupParticipantsUpdate(sender, [msg.key.participant], 'remove')
        } else if (!isBotAdmin) {
          await sock.sendMessage(sender, { text: '🚫 Siwezi kutoa mtu, mimi sio admin.' }, { quoted: msg })
        } else if (isUserAdmin) {
          await sock.sendMessage(sender, {
            text: `⚠️ Huyu ni admin @${msg.key.participant.split('@')[0]} — siwezi kumtoa.`,
            mentions: [msg.key.participant]
          }, { quoted: msg })
        }
      } catch (err) {
        console.error('Group error:', err)
      }
    }
  })

  // Connection update
  sock.ev.on('connection.update', async (update) => {
    const { connection, lastDisconnect } = update
    if (connection === 'close') {
      const reason = new Boom(lastDisconnect?.error)?.output.statusCode
      if (reason !== DisconnectReason.loggedOut) startSock()
    } else if (connection === 'open') {
      console.log('✅ Bot Connected!')
      // Notify owner
      await sock.sendMessage(OWNER, {
        text: '✅ Ben Whittaker Bot is now connected and running!'
      })
    }
  })
}

startSock()
