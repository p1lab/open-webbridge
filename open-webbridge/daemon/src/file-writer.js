const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

class FileWriter {
  constructor(tempDir) {
    this.tempDir = tempDir || path.join(os.tmpdir(), 'open-webbridge');
    if (!fs.existsSync(this.tempDir)) {
      fs.mkdirSync(this.tempDir, { recursive: true });
    }
  }

  saveBase64(base64Data, format = 'png', userPath = null, mimeType = 'image/png') {
    const buffer = Buffer.from(base64Data, 'base64');
    let targetPath = userPath;

    if (!targetPath) {
      const ext = format === 'jpeg' ? 'jpg' : format;
      const filename = `owb-${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
      targetPath = path.join(this.tempDir, filename);
    } else {
      const dir = path.dirname(targetPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    fs.writeFileSync(targetPath, buffer);
    const stats = fs.statSync(targetPath);

    return {
      format,
      path: path.resolve(targetPath),
      sizeBytes: stats.size,
      mimeType,
    };
  }
}

module.exports = { FileWriter };
