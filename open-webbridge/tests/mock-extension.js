const WebSocket = require('ws');

class MockExtension {
  constructor(wsUrl = 'ws://127.0.0.1:10099/ws') {
    this.wsUrl = wsUrl;
    this.ws = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on('open', () => {
        // Send hello
        this.ws.send(JSON.stringify({
          type: 'hello',
          payload: { extensionVersion: '1.0.0-mock', name: 'MockExtension' },
        }));
        resolve();
      });

      this.ws.on('message', (data) => {
        const msg = JSON.parse(data.toString());
        this.handleMessage(msg);
      });

      this.ws.on('error', reject);
    });
  }

  handleMessage(msg) {
    if (msg.type === 'ping') {
      this.ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }

    if (msg.type === 'tool_call') {
      const { requestId, payload, session } = msg;
      const { name, args } = payload;
      let mockData = {};

      switch (name) {
        case 'navigate':
          mockData = { success: true, url: args.url, tabId: 101, session };
          break;
        case 'find_tab':
          mockData = { success: true, url: args.url || 'https://example.com', tabId: 101, borrowed: Boolean(args.active) };
          break;
        case 'snapshot':
          mockData = {
            url: 'https://example.com',
            title: 'Example Domain',
            tree: '[@e1] <textbox> "Search" value=""\n[@e2] <button> "Submit"\n[@e3] <link> "More information..."',
            totalElements: 3,
          };
          break;
        case 'click':
          mockData = { success: true, tag: 'BUTTON', text: 'Submit' };
          break;
        case 'fill':
          mockData = { success: true, tag: 'INPUT', mode: 'value' };
          break;
        case 'evaluate':
          if (args.code?.includes('hasWall')) {
            mockData = {
              type: 'string',
              value: JSON.stringify({ len: 1500, hasWall: false, hasMine: true, notes: 10 })
            };
          } else if (args.code?.includes('1+1')) {
            mockData = { type: 'number', value: 2 };
          } else if (args.code?.includes('querySelector')) {
            mockData = { type: 'number', value: 1 };
          } else {
            mockData = { type: 'string', value: 'ok' };
          }
          break;
        case 'cdp':
          mockData = { success: true };
          break;
        case 'network':
          if (args.cmd === 'start') {
            mockData = { success: true, message: 'network capture started' };
          } else if (args.cmd === 'stop') {
            mockData = { success: true, message: 'network capture stopped' };
          } else if (args.cmd === 'list') {
            mockData = {
              count: 1,
              requests: [{
                requestId: 'req-mock-1',
                url: 'https://sns-img-qc.xhscdn.com/mock.webp',
                method: 'GET',
                status: 200,
                mimeType: 'image/webp',
                completed: true
              }]
            };
          } else if (args.cmd === 'detail') {
            mockData = {
              requestId: args.requestId,
              url: 'https://sns-img-qc.xhscdn.com/mock.webp',
              status: 200,
              mimeType: 'image/webp',
              completed: true,
              body: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkWPjfDwAEeQHzH44rPQAAAABJRU5ErkJggg==',
              base64Encoded: true
            };
          }
          break;
        case 'screenshot':
          // 1x1 blue PNG in base64
          mockData = {
            format: 'png',
            mimeType: 'image/png',
            data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkWPjfDwAEeQHzH44rPQAAAABJRU5ErkJggg==',
            path: args.path,
          };
          break;
        default:
          mockData = { success: true };
      }

      this.ws.send(JSON.stringify({
        type: 'tool_result',
        responseToRequestId: requestId,
        payload: { data: mockData },
      }));
    }
  }

  close() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}

module.exports = { MockExtension };
