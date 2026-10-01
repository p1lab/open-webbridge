const crypto = require('crypto');
const { FileWriter } = require('./file-writer');

class SessionManager {
  constructor() {
    this.extensionSocket = null;
    this.extensionInfo = null;
    this.pendingRequests = new Map();
    this.fileWriter = new FileWriter();
  }

  setExtensionSocket(ws, info = {}) {
    this.extensionSocket = ws;
    this.extensionInfo = {
      connectedAt: Date.now(),
      ...info,
    };
  }

  removeExtensionSocket(ws) {
    if (this.extensionSocket === ws) {
      this.extensionSocket = null;
      this.extensionInfo = null;

      // Reject all pending requests
      for (const [reqId, pending] of this.pendingRequests.entries()) {
        clearTimeout(pending.timer);
        pending.reject(new Error('Extension disconnected while executing command'));
      }
      this.pendingRequests.clear();
    }
  }

  isExtensionConnected() {
    return this.extensionSocket !== null && this.extensionSocket.readyState === 1; // 1 = OPEN
  }

  handleExtensionMessage(msg) {
    if (msg.type === 'tool_result') {
      const { responseToRequestId, payload } = msg;
      const pending = this.pendingRequests.get(responseToRequestId);
      if (!pending) return;

      clearTimeout(pending.timer);
      this.pendingRequests.delete(responseToRequestId);

      if (payload.error) {
        pending.reject(new Error(payload.error));
        return;
      }

      let data = payload.data;

      // Intercept base64 payloads (screenshot or save_as_pdf) and write to disk
      if (data && data.data && (data.format === 'png' || data.format === 'jpeg' || data.format === 'pdf')) {
        try {
          const fileInfo = this.fileWriter.saveBase64(
            data.data,
            data.format,
            data.path,
            data.mimeType
          );
          data = fileInfo;
        } catch (err) {
          pending.reject(new Error(`Failed to write artifact to disk: ${err.message}`));
          return;
        }
      }

      pending.resolve(data);
    }
  }

  async executeCommand(action, args = {}, session = 'default', timeoutMs = 60000) {
    if (!this.isExtensionConnected()) {
      throw new Error('extension_not_connected: No browser extension is currently connected to OpenWebBridge daemon.');
    }

    const requestId = `req-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Command "${action}" timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.pendingRequests.set(requestId, { resolve, reject, timer });

      const payload = {
        type: 'tool_call',
        requestId,
        session,
        payload: {
          name: action,
          args,
        },
      };

      try {
        this.extensionSocket.send(JSON.stringify(payload));
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        reject(new Error(`Failed to send command to extension: ${err.message}`));
      }
    });
  }
}

module.exports = { SessionManager };
