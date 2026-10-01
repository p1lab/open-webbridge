const crypto = require('crypto');
const { FileWriter } = require('./file-writer');

class SessionManager {
  constructor() {
    // browserConnections: Map<browserId, { ws, browserType, profileName, browserId, connectedAt, lastActiveAt, version, name, tabs: [] }>
    this.browserConnections = new Map();
    this.lastActiveBrowserId = null;
    this.pendingRequests = new Map();
    this.fileWriter = new FileWriter();
    this.eventListeners = new Map();
  }

  on(event, callback) {
    if (!this.eventListeners.has(event)) {
      this.eventListeners.set(event, new Set());
    }
    this.eventListeners.get(event).add(callback);
  }

  off(event, callback) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  emit(event, ...args) {
    const listeners = this.eventListeners.get(event);
    if (listeners) {
      for (const cb of listeners) {
        try {
          cb(...args);
        } catch (err) {
          console.error(`[SessionManager] Event listener error (${event}):`, err);
        }
      }
    }
  }

  // Backward compatibility getter
  get extensionSocket() {
    const conn = this.getDefaultBrowserConnection();
    return conn ? conn.ws : null;
  }

  // Backward compatibility getter
  get extensionInfo() {
    const conn = this.getDefaultBrowserConnection();
    if (!conn) return null;
    return {
      connectedAt: conn.connectedAt,
      version: conn.version,
      name: conn.name,
      browserType: conn.browserType,
      profileName: conn.profileName,
      browserId: conn.browserId,
    };
  }

  // Backward compatibility helper
  setExtensionSocket(ws, info = {}) {
    return this.registerBrowserConnection(ws, info);
  }

  // Backward compatibility helper
  removeExtensionSocket(ws) {
    return this.removeBrowserConnection(ws);
  }

  registerBrowserConnection(ws, info = {}) {
    const browserType = (
      info.browserType ||
      info.browser ||
      (info.name && info.name.toLowerCase().includes('edge') ? 'edge' : 'chrome')
    ).toLowerCase();

    const profileName = info.profileName || info.profile || 'Default';
    let baseBrowserId = info.browserId || (info.name && info.name.includes('MockExtension') && info.browserId ? info.browserId : browserType);

    // Disambiguate if this browserId is already occupied by a different active WebSocket
    let browserId = baseBrowserId;
    let counter = 2;
    while (
      this.browserConnections.has(browserId) &&
      this.browserConnections.get(browserId).ws !== ws &&
      this.browserConnections.get(browserId).ws?.readyState === 1
    ) {
      browserId = `${baseBrowserId}-${counter++}`;
    }

    const conn = {
      browserId,
      browserType,
      profileName,
      ws,
      version: info.extensionVersion || info.version || '1.0.0',
      name: info.name || `OpenWebBridge (${browserType})`,
      connectedAt: Date.now(),
      lastActiveAt: Date.now(),
      tabs: [],
    };

    this.browserConnections.set(browserId, conn);
    this.lastActiveBrowserId = browserId;
    console.log(`[SessionManager] Registered browser connection: ${browserId} (${browserType}, profile: ${profileName})`);
    return conn;
  }

  removeBrowserConnection(ws) {
    let removedId = null;
    for (const [id, conn] of this.browserConnections.entries()) {
      if (conn.ws === ws) {
        removedId = id;
        this.browserConnections.delete(id);
        console.log(`[SessionManager] Browser connection disconnected: ${id}`);
        break;
      }
    }

    if (removedId) {
      if (this.lastActiveBrowserId === removedId) {
        const remainingKeys = Array.from(this.browserConnections.keys());
        this.lastActiveBrowserId = remainingKeys.length > 0 ? remainingKeys[remainingKeys.length - 1] : null;
      }

      // Reject all pending requests belonging to this ws
      for (const [reqId, pending] of this.pendingRequests.entries()) {
        if (pending.ws === ws) {
          clearTimeout(pending.timer);
          pending.reject(new Error(`Extension "${removedId}" disconnected while executing command`));
          this.pendingRequests.delete(reqId);
        }
      }
    }
  }

  getDefaultBrowserConnection() {
    if (this.lastActiveBrowserId && this.browserConnections.has(this.lastActiveBrowserId)) {
      const activeConn = this.browserConnections.get(this.lastActiveBrowserId);
      if (activeConn && activeConn.ws && activeConn.ws.readyState === 1) {
        return activeConn;
      }
    }
    // Fall back to any open connection
    for (const conn of this.browserConnections.values()) {
      if (conn.ws && conn.ws.readyState === 1) {
        return conn;
      }
    }
    if (this.browserConnections.size > 0) {
      return this.browserConnections.values().next().value;
    }
    return null;
  }

  resolveBrowserConnection(targetBrowser = null) {
    if (this.browserConnections.size === 0) {
      throw new Error('extension_not_connected: No browser extension is currently connected to OpenWebBridge daemon.');
    }

    if (!targetBrowser) {
      const defaultConn = this.getDefaultBrowserConnection();
      if (defaultConn) {
        defaultConn.lastActiveAt = Date.now();
        this.lastActiveBrowserId = defaultConn.browserId;
        return defaultConn;
      }
      throw new Error('extension_not_connected: No browser extension is currently connected.');
    }

    const query = String(targetBrowser).trim().toLowerCase();

    // 1. Exact match on browserId
    for (const [id, conn] of this.browserConnections.entries()) {
      if (id.toLowerCase() === query) {
        conn.lastActiveAt = Date.now();
        this.lastActiveBrowserId = conn.browserId;
        return conn;
      }
    }

    // 2. Exact match on browserType (e.g. "edge" or "chrome")
    for (const conn of this.browserConnections.values()) {
      if (conn.browserType.toLowerCase() === query) {
        conn.lastActiveAt = Date.now();
        this.lastActiveBrowserId = conn.browserId;
        return conn;
      }
    }

    // 3. Partial/substring match
    for (const [id, conn] of this.browserConnections.entries()) {
      if (id.toLowerCase().includes(query) || (conn.name && conn.name.toLowerCase().includes(query))) {
        conn.lastActiveAt = Date.now();
        this.lastActiveBrowserId = conn.browserId;
        return conn;
      }
    }

    const available = Array.from(this.browserConnections.keys()).join(', ');
    throw new Error(
      `extension_not_connected: No browser extension matching "${targetBrowser}" is connected. Available: [${available}]`
    );
  }

  isExtensionConnected(browserFilter = null) {
    if (this.browserConnections.size === 0) return false;
    if (!browserFilter) {
      const defaultConn = this.getDefaultBrowserConnection();
      return defaultConn !== null && defaultConn.ws && defaultConn.ws.readyState === 1;
    }
    try {
      const conn = this.resolveBrowserConnection(browserFilter);
      return conn !== null && conn.ws && conn.ws.readyState === 1;
    } catch (e) {
      return false;
    }
  }

  getStatusInfo() {
    const isConnected = this.browserConnections.size > 0;
    const defaultConn = this.getDefaultBrowserConnection();
    const browsers = Array.from(this.browserConnections.values()).map((c) => ({
      browserId: c.browserId,
      browserType: c.browserType,
      profileName: c.profileName,
      version: c.version,
      connectedAt: c.connectedAt,
      lastActiveAt: c.lastActiveAt,
      connected: c.ws && c.ws.readyState === 1,
    }));

    return {
      extension_connected: isConnected,
      extension_version: defaultConn ? defaultConn.version : '',
      browser_count: this.browserConnections.size,
      active_browser: this.lastActiveBrowserId,
      browsers,
    };
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

  async executeCommand(action, args = {}, session = 'default', timeoutMs = 60000, targetBrowser = null) {
    const browserTarget = targetBrowser || args.browser;
    const conn = this.resolveBrowserConnection(browserTarget);

    if (!conn.ws || conn.ws.readyState !== 1) {
      throw new Error(`extension_not_connected: Browser "${conn.browserId}" connection is not open.`);
    }

    const effectiveTimeoutMs = args.timeout
      ? Math.max(timeoutMs, parseInt(args.timeout, 10) * 1000 + 5000)
      : timeoutMs;

    const requestId = `req-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(requestId);
        reject(new Error(`Command "${action}" timed out after ${effectiveTimeoutMs}ms`));
      }, effectiveTimeoutMs);

      this.pendingRequests.set(requestId, {
        resolve,
        reject,
        timer,
        ws: conn.ws,
        browserId: conn.browserId,
      });

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
        conn.ws.send(JSON.stringify(payload));
      } catch (err) {
        clearTimeout(timer);
        this.pendingRequests.delete(requestId);
        reject(new Error(`Failed to send command to extension (${conn.browserId}): ${err.message}`));
      }
    });
  }
}

module.exports = { SessionManager };
