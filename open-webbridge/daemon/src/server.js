const http = require('http');
const { WebSocketServer } = require('ws');
const { SessionManager } = require('./session-manager');

class OpenWebBridgeServer {
  constructor(options = {}) {
    this.port = options.port || 10087;
    this.host = options.host || '127.0.0.1';
    this.version = options.version || '2.0.0';
    this.startTime = Date.now();

    this.sessionManager = new SessionManager();
    this.httpServer = null;
    this.wss = null;
  }

  start() {
    return new Promise((resolve, reject) => {
      this.httpServer = http.createServer((req, res) => this.handleHttpRequest(req, res));

      this.wss = new WebSocketServer({ noServer: true });

      // Handle HTTP Upgrade to WebSocket
      this.httpServer.on('upgrade', (request, socket, head) => {
        const url = new URL(request.url, `http://${request.headers.host}`);
        if (url.pathname === '/ws') {
          this.wss.handleUpgrade(request, socket, head, (ws) => {
            this.wss.emit('connection', ws, request);
          });
        } else {
          socket.destroy();
        }
      });

      this.wss.on('connection', (ws) => {
        console.log('[Daemon] Extension WebSocket connected.');

        ws.on('message', (data) => {
          try {
            const msg = JSON.parse(data.toString());
            if (msg.type === 'hello') {
              const conn = this.sessionManager.registerBrowserConnection(ws, msg.payload || {});
              ws.send(
                JSON.stringify({
                  type: 'hello_ack',
                  version: this.version,
                  browserId: conn.browserId,
                  browserType: conn.browserType,
                })
              );
            } else if (msg.type === 'ping') {
              ws.send(JSON.stringify({ type: 'pong' }));
            } else if (msg.type === 'tool_result') {
              this.sessionManager.handleExtensionMessage(msg);
            } else if (msg.type === 'handoff_resolved') {
              const payload = msg.payload || {};
              if (!payload.browser) {
                for (const conn of this.sessionManager.browserConnections.values()) {
                  if (conn.ws === ws) {
                    payload.browser = conn.browserId;
                    payload.browserId = conn.browserId;
                    payload.browserType = conn.browserType;
                    break;
                  }
                }
              }
              console.log('[Daemon] Handoff resolved notification received:', payload);
              this.sessionManager.emit('handoff_resolved', payload);
            }
          } catch (e) {
            console.error('[Daemon] Error processing WS message:', e);
          }
        });

        ws.on('close', () => {
          console.log('[Daemon] Extension WebSocket disconnected.');
          this.sessionManager.removeBrowserConnection(ws);
        });

        ws.on('error', (err) => {
          console.error('[Daemon] WebSocket client error:', err);
        });
      });

      this.heartbeatTimer = setInterval(() => {
        for (const conn of this.sessionManager.browserConnections.values()) {
          if (conn.ws && conn.ws.readyState === 1) {
            try {
              conn.ws.send(JSON.stringify({ type: 'ping' }));
            } catch (e) {}
          }
        }
      }, 15000);

      this.httpServer.listen(this.port, this.host, () => {
        console.log(`[Daemon] OpenWebBridge listening on http://${this.host}:${this.port}`);
        resolve({ port: this.port, host: this.host });
      });

      this.httpServer.on('error', (err) => {
        reject(err);
      });
    });
  }

  async stop() {
    return new Promise((resolve) => {
      if (this.heartbeatTimer) {
        clearInterval(this.heartbeatTimer);
        this.heartbeatTimer = null;
      }
      if (this.wss) {
        this.wss.close();
      }
      if (this.httpServer) {
        this.httpServer.close(() => {
          resolve();
        });
      } else {
        resolve();
      }
    });
  }

  async handleHttpRequest(req, res) {
    const url = new URL(req.url, `http://${req.headers.host}`);

    // Set CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url.pathname === '/status' && req.method === 'GET') {
      const statusInfo = this.sessionManager.getStatusInfo();
      const statusData = {
        running: true,
        port: this.port,
        version: this.version,
        uptime_seconds: Math.floor((Date.now() - this.startTime) / 1000),
        extension_connected: statusInfo.extension_connected,
        extension_version: statusInfo.extension_version || '2.0.0',
        browser_count: statusInfo.browser_count,
        active_browser: statusInfo.active_browser,
        browsers: statusInfo.browsers,
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(statusData, null, 2));
      return;
    }

    if (url.pathname === '/command' && req.method === 'POST') {
      let body = '';
      req.on('data', (chunk) => {
        body += chunk;
      });

      req.on('end', async () => {
        try {
          const json = JSON.parse(body);
          const { action, args = {}, session = 'default', browser } = json;

          if (!action) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: { code: 'bad_request', message: 'Missing action field' } }));
            return;
          }

          const targetBrowser = browser || args.browser;
          const timeoutMs = args.timeout
            ? Math.max(60000, parseInt(args.timeout, 10) * 1000 + 5000)
            : 60000;
          const result = await this.sessionManager.executeCommand(action, args, session, timeoutMs, targetBrowser);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, data: result }));
        } catch (err) {
          const isNotConnected = err.message.includes('extension_not_connected');
          const statusCode = isNotConnected ? 503 : 500;
          res.writeHead(statusCode, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              ok: false,
              error: {
                code: isNotConnected ? 'extension_not_connected' : 'execution_failed',
                message: err.message,
              },
            })
          );
        }
      });
      return;
    }

    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
  }
}

module.exports = { OpenWebBridgeServer };
