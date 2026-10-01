const WebSocket = require('ws');

class MockExtension {
  constructor(options = {}) {
    if (typeof options === 'string') {
      this.wsUrl = options;
      this.browserType = 'chrome';
      this.browserId = 'chrome';
      this.profileName = 'Default';
      this.version = '1.0.0-mock';
    } else {
      this.wsUrl = options.wsUrl || 'ws://127.0.0.1:10099/ws';
      this.browserType = options.browserType || 'chrome';
      this.browserId = options.browserId || this.browserType;
      this.profileName = options.profileName || 'Default';
      this.version = options.version || '1.0.0-mock';
    }
    this.ws = null;
    this.receivedCalls = [];
  }

  connect() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.wsUrl);

      this.ws.on('open', () => {
        // Send hello with browser identity
        this.ws.send(
          JSON.stringify({
            type: 'hello',
            payload: {
              extensionVersion: this.version,
              name: `MockExtension (${this.browserType})`,
              browser: this.browserType,
              browserType: this.browserType,
              browserId: this.browserId,
              profileName: this.profileName,
            },
          })
        );
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

    if (msg.type === 'hello_ack') {
      if (msg.browserId) {
        this.browserId = msg.browserId;
      }
      return;
    }

    if (msg.type === 'tool_call') {
      const { requestId, payload, session } = msg;
      const { name, args = {} } = payload;
      this.receivedCalls.push({ name, args, session, requestId });

      let mockData = {};

      switch (name) {
        case 'navigate':
          mockData = {
            success: true,
            url: args.url,
            tabId: 101,
            session,
            browser: this.browserId,
          };
          break;

        case 'find_tab':
          mockData = {
            success: true,
            url: args.url || 'https://example.com',
            tabId: 101,
            borrowed: Boolean(args.active),
            browser: this.browserId,
          };
          break;

        case 'snapshot': {
          const inViewport = Boolean(args.inViewportOnly || args.in_viewport_only);
          const selector = args.selector;

          if (selector === '#detail-desc') {
            mockData = {
              url: 'https://www.xiaohongshu.com/explore/12345',
              title: '小红书笔记详情',
              tree: '[@e1] <textbox> "评论输入框"\n[@e2] <button> "点赞"',
              totalElements: 2,
              inViewportOnly: inViewport,
              scoped: true,
              browser: this.browserId,
            };
          } else if (selector) {
            this.ws.send(
              JSON.stringify({
                type: 'tool_result',
                responseToRequestId: requestId,
                payload: { error: `snapshot: container element not found or invalid for selector "${selector}"` },
              })
            );
            return;
          } else if (inViewport) {
            // Pruned viewport tree (simulating 649 -> 62 nodes)
            const prunedLines = [];
            for (let i = 1; i <= 62; i++) {
              prunedLines.push(`[@e${i}] <button> "视口可见元素 ${i}"`);
            }
            mockData = {
              url: 'https://www.xiaohongshu.com',
              title: '小红书 - 你的生活指南',
              tree: prunedLines.join('\n'),
              totalElements: 62,
              inViewportOnly: true,
              browser: this.browserId,
            };
          } else if (args.simulateHeavyPage) {
            // Full unpruned tree (simulating heavy 649 nodes)
            const fullLines = [];
            for (let i = 1; i <= 649; i++) {
              fullLines.push(`[@e${i}] <link> "完整页面元素 ${i}"`);
            }
            mockData = {
              url: 'https://www.xiaohongshu.com',
              title: '小红书 - 你的生活指南',
              tree: fullLines.join('\n'),
              totalElements: 649,
              inViewportOnly: false,
              browser: this.browserId,
            };
          } else {
            // Default standard test snapshot (3 elements)
            mockData = {
              url: 'https://example.com',
              title: 'Example Domain',
              tree: '[@e1] <textbox> "Search" value=""\n[@e2] <button> "Submit"\n[@e3] <link> "More information..."',
              totalElements: 3,
              inViewportOnly: false,
              browser: this.browserId,
            };
          }
          break;
        }

        case 'click':
          mockData = { success: true, tag: 'BUTTON', text: 'Submit', browser: this.browserId };
          break;

        case 'fill':
          mockData = { success: true, tag: 'INPUT', mode: 'value', browser: this.browserId };
          break;

        case 'evaluate':
          if (args.code?.includes('hasWall')) {
            mockData = {
              type: 'string',
              value: JSON.stringify({ len: 1500, hasWall: false, hasMine: true, notes: 10 }),
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
          mockData = { success: true, browser: this.browserId };
          break;

        case 'network':
          if (args.cmd === 'start') {
            mockData = { success: true, message: 'network capture started' };
          } else if (args.cmd === 'stop') {
            mockData = { success: true, message: 'network capture stopped' };
          } else if (args.cmd === 'list') {
            mockData = {
              count: 1,
              requests: [
                {
                  requestId: 'req-mock-1',
                  url: 'https://sns-img-qc.xhscdn.com/mock.webp',
                  method: 'GET',
                  status: 200,
                  mimeType: 'image/webp',
                  completed: true,
                },
              ],
            };
          } else if (args.cmd === 'detail') {
            mockData = {
              requestId: args.requestId,
              url: 'https://sns-img-qc.xhscdn.com/mock.webp',
              status: 200,
              mimeType: 'image/webp',
              completed: true,
              body: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkWPjfDwAEeQHzH44rPQAAAABJRU5ErkJggg==',
              base64Encoded: true,
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
            browser: this.browserId,
          };
          break;

        case 'scroll':
          mockData = { success: true, scrolled: args.amount || 500, browser: this.browserId };
          break;

        case 'list_tabs':
          mockData = {
            success: true,
            tabs: [{ tabId: 101, url: 'https://example.com', title: 'Example', active: true, current: true }],
            browser: this.browserId,
          };
          break;

        case 'close_tab':
          mockData = { success: true, closed: true, tabId: args.tabId || 101, browser: this.browserId };
          break;

        case 'close_session':
          mockData = { success: true, closed: 1, browser: this.browserId };
          break;

        case 'handoff': {
          mockData = {
            success: true,
            resolved: true,
            reason: args.reason || 'captcha',
            resolveMethod: 'mock_user_action',
            tabId: 101,
            browser: this.browserId,
          };

          // Send asynchronous handoff_resolved event to daemon
          setTimeout(() => {
            if (this.ws && this.ws.readyState === WebSocket.OPEN) {
              this.ws.send(
                JSON.stringify({
                  type: 'handoff_resolved',
                  payload: {
                    tabId: 101,
                    reason: args.reason || 'captcha',
                    resolveMethod: 'mock_user_action',
                    resolved: true,
                    browser: this.browserId,
                  },
                })
              );
            }
          }, 50);
          break;
        }

        default:
          mockData = { success: true, browser: this.browserId };
      }

      this.ws.send(
        JSON.stringify({
          type: 'tool_result',
          responseToRequestId: requestId,
          payload: { data: mockData },
        })
      );
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
