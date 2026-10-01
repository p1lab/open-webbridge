const fs = require('fs');
const path = require('path');
const os = require('os');
const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const { ListToolsRequestSchema, CallToolRequestSchema } = require('@modelcontextprotocol/sdk/types.js');
const { OpenWebBridgeServer } = require('./server');

const CONFIG_DIR = path.join(os.homedir(), '.open-webbridge');
const PORT_FILE = path.join(CONFIG_DIR, 'daemon.port');

function getDaemonPort(defaultPort = 10087) {
  if (fs.existsSync(PORT_FILE)) {
    try {
      return parseInt(fs.readFileSync(PORT_FILE, 'utf8').trim(), 10);
    } catch (e) {}
  }
  return defaultPort;
}

const MCP_TOOLS = [
  {
    name: 'navigate',
    description: 'Navigate the browser to a URL, optionally opening in a new tab or tab group.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Target URL to visit' },
        newTab: { type: 'boolean', description: 'Whether to open in a new tab (default: false)' },
        group_title: { type: 'string', description: 'Optional tab group name' },
        browser: { type: 'string', description: 'Target browser identifier ("chrome", "edge", or specific browserId)' },
        session: { type: 'string', description: 'Session identifier (default: "default")' },
      },
      required: ['url'],
    },
  },
  {
    name: 'snapshot',
    description:
      'Extract accessibility tree with interactive element references ([@e1], [@e2]...). Supports inViewportOnly pruning and selector scope filtering.',
    inputSchema: {
      type: 'object',
      properties: {
        interactiveOnly: { type: 'boolean', description: 'Only include interactive elements (buttons, inputs, links)' },
        inViewportOnly: {
          type: 'boolean',
          description: 'Filter out elements outside the visible viewport to save tokens (recommended for heavy pages)',
        },
        selector: { type: 'string', description: 'CSS selector to limit snapshot to a specific container DOM tree' },
        browser: { type: 'string', description: 'Target browser identifier ("chrome", "edge")' },
        session: { type: 'string', description: 'Session identifier (default: "default")' },
      },
    },
  },
  {
    name: 'click',
    description: 'Click an element identified by CSS selector or @e element reference (e.g. "@e1").',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector or [@eN] ref from snapshot' },
        browser: { type: 'string', description: 'Target browser identifier' },
        session: { type: 'string', description: 'Session identifier' },
      },
      required: ['selector'],
    },
  },
  {
    name: 'fill',
    description: 'Type text into an input, textarea, or contenteditable rich text editor.',
    inputSchema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector or [@eN] ref from snapshot' },
        value: { type: 'string', description: 'Text value to input' },
        browser: { type: 'string', description: 'Target browser identifier' },
        session: { type: 'string', description: 'Session identifier' },
      },
      required: ['selector', 'value'],
    },
  },
  {
    name: 'evaluate',
    description: 'Execute a JavaScript expression in the active page and return the evaluated result.',
    inputSchema: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript code to execute' },
        browser: { type: 'string', description: 'Target browser identifier' },
        session: { type: 'string', description: 'Session identifier' },
      },
      required: ['code'],
    },
  },
  {
    name: 'screenshot',
    description: 'Capture screenshot of active tab or specific element and save directly to disk.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Output image file path (PNG or JPEG)' },
        selector: { type: 'string', description: 'CSS selector to clip screenshot to a specific element' },
        format: { type: 'string', enum: ['png', 'jpeg'], description: 'Image format (default: png)' },
        browser: { type: 'string', description: 'Target browser identifier' },
        session: { type: 'string', description: 'Session identifier' },
      },
    },
  },
  {
    name: 'scroll',
    description: 'Scroll the active page up or down.',
    inputSchema: {
      type: 'object',
      properties: {
        direction: { type: 'string', enum: ['up', 'down'], description: 'Scroll direction (default: down)' },
        amount: { type: 'number', description: 'Scroll pixel distance (default: 500)' },
        browser: { type: 'string', description: 'Target browser identifier' },
        session: { type: 'string', description: 'Session identifier' },
      },
    },
  },
  {
    name: 'find_tab',
    description: 'Find an existing tab by URL keyword or borrow user active browser tab.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL keyword to match' },
        active: { type: 'boolean', description: 'Set to true to borrow user active tab' },
        browser: { type: 'string', description: 'Target browser identifier' },
        session: { type: 'string', description: 'Session identifier' },
      },
    },
  },
  {
    name: 'list_tabs',
    description: 'List all open tabs belonging to the current session.',
    inputSchema: {
      type: 'object',
      properties: {
        browser: { type: 'string', description: 'Target browser identifier' },
        session: { type: 'string', description: 'Session identifier' },
      },
    },
  },
  {
    name: 'close_tab',
    description: 'Close currently active tab or specified tabId in current session.',
    inputSchema: {
      type: 'object',
      properties: {
        tabId: { type: 'number', description: 'Optional tab ID to close' },
        browser: { type: 'string', description: 'Target browser identifier' },
        session: { type: 'string', description: 'Session identifier' },
      },
    },
  },
  {
    name: 'close_session',
    description: 'Close all tabs and cleanup tab group for this session.',
    inputSchema: {
      type: 'object',
      properties: {
        browser: { type: 'string', description: 'Target browser identifier' },
        session: { type: 'string', description: 'Session identifier' },
      },
    },
  },
  {
    name: 'handoff',
    description:
      'Pause automation and show floating banner for human verification (e.g. CAPTCHA, slider). Resumes when resolved.',
    inputSchema: {
      type: 'object',
      properties: {
        reason: { type: 'string', description: 'Reason for handoff (e.g. "captcha", "slider", "login")' },
        timeout: { type: 'number', description: 'Max wait time in seconds (default: 120)' },
        selector: { type: 'string', description: 'Optional CSS selector of the slider/captcha element to watch for removal' },
        browser: { type: 'string', description: 'Target browser identifier' },
        session: { type: 'string', description: 'Session identifier' },
      },
    },
  },
];

class OpenWebBridgeMCPServer {
  constructor(options = {}) {
    this.port = options.port || getDaemonPort();
    this.internalServer = null;
    this.mcpServer = new Server(
      {
        name: 'open-webbridge',
        version: '2.0.0',
      },
      {
        capabilities: {
          tools: {},
        },
      }
    );

    this.setupHandlers();
  }

  setupHandlers() {
    this.mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
      return { tools: MCP_TOOLS };
    });

    this.mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args = {} } = request.params;
      const { session = 'default', browser, ...toolArgs } = args;

      const isKnown = MCP_TOOLS.some((t) => t.name === name);
      if (!isKnown) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `OpenWebBridge Error: Unknown tool "${name}". Available tools: ${MCP_TOOLS.map((t) => t.name).join(', ')}`,
            },
          ],
        };
      }

      try {
        const result = await this.dispatchCommand(name, toolArgs, session, browser);
        return {
          content: [
            {
              type: 'text',
              text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: `OpenWebBridge Error: ${err.message}`,
            },
          ],
        };
      }
    });
  }

  async isDaemonRunning() {
    try {
      const res = await fetch(`http://127.0.0.1:${this.port}/status`, { signal: AbortSignal.timeout(1000) });
      return res.ok;
    } catch (e) {
      return false;
    }
  }

  async ensureBridgeAvailable() {
    const running = await this.isDaemonRunning();
    if (!running && !this.internalServer) {
      // Start in-process bridge server on port
      try {
        this.internalServer = new OpenWebBridgeServer({ port: this.port });
        await this.internalServer.start();
        console.error(`[MCP] Embedded OpenWebBridge server running on port ${this.port}`);
      } catch (e) {
        console.error(`[MCP] Could not start embedded bridge server: ${e.message}`);
      }
    }
  }

  async dispatchCommand(action, args = {}, session = 'default', browser = null) {
    const targetBrowser = browser || args.browser;
    const timeoutMs = args.timeout
      ? Math.max(60000, parseInt(args.timeout, 10) * 1000 + 5000)
      : 60000;

    if (this.internalServer) {
      return await this.internalServer.sessionManager.executeCommand(action, args, session, timeoutMs, targetBrowser);
    }

    // Try HTTP request to daemon
    const res = await fetch(`http://127.0.0.1:${this.port}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        args,
        session,
        browser: targetBrowser,
      }),
    });

    const data = await res.json();
    if (!data.ok) {
      const err = data.error || {};
      throw new Error(`[${err.code || 'execution_failed'}] ${err.message || 'Bridge command failed'}`);
    }
    return data.data;
  }

  async startStdio() {
    await this.ensureBridgeAvailable();
    const transport = new StdioServerTransport();
    await this.mcpServer.connect(transport);
    console.error('[MCP] OpenWebBridge MCP Server listening on stdio.');
  }

  async stop() {
    if (this.internalServer) {
      await this.internalServer.stop();
      this.internalServer = null;
    }
    if (this.mcpServer) {
      await this.mcpServer.close();
    }
  }
}

async function startMcpServer(options = {}) {
  const mcp = new OpenWebBridgeMCPServer(options);
  await mcp.startStdio();
  return mcp;
}

module.exports = {
  OpenWebBridgeMCPServer,
  startMcpServer,
  MCP_TOOLS,
};
