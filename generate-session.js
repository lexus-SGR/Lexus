import fs from 'fs'
import zlib from 'zlib'
import path from 'path'

const printSessionID = () => {
  try {
    const credsPath = path.join('./auth_info_ben/creds.json')
    if (fs.existsSync(credsPath)) {
      const creds = JSON.parse(fs.readFileSync(credsPath, 'utf8'))
      const zipped = zlib.gzipSync(Buffer.from(JSON.stringify(creds)))
      const session = `BWM-XMD;;;${Buffer.from(zipped).toString('base64')}`
      console.log('\n✅ SESSION ID (copy this to use on server or deployment):\n')
      console.log(session + '\n')
    } else {
      console.log('❌ Hakuna creds.json imepatikana. Tafadhali scan QR code kwanza kwa kutumia:\n\n   node index.js')
    }
  } catch (err) {
    console.error('❌ Error generating session ID:', err)
  }
}

printSessionID()
