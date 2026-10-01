#!/usr/bin/env node

/**
 * OpenWebBridge Unified CLI Tool v2.0
 * Compatible with Agent command lines & terminal scripting
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT_FILE = path.join(os.homedir(), '.open-webbridge', 'daemon.port');

function getDaemonPort(customPort = null) {
  if (customPort) {
    const p = parseInt(customPort, 10);
    if (!isNaN(p) && p > 0) return p;
  }
  if (fs.existsSync(PORT_FILE)) {
    try {
      return parseInt(fs.readFileSync(PORT_FILE, 'utf8').trim(), 10);
    } catch (e) {}
  }
  return 10087;
}

async function sendCommand(action, args = {}, session = 'default', browser = null, port = null) {
  const targetPort = getDaemonPort(port);
  const url = `http://127.0.0.1:${targetPort}/command`;

  const payload = {
    action,
    args,
    session,
  };
  if (browser) {
    payload.browser = browser;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await res.json();
    return data;
  } catch (err) {
    return {
      ok: false,
      error: {
        code: 'daemon_unreachable',
        message: `Cannot reach daemon at http://127.0.0.1:${targetPort}: ${err.message}`,
      },
    };
  }
}

async function getStatus(port = null) {
  const targetPort = getDaemonPort(port);
  try {
    const res = await fetch(`http://127.0.0.1:${targetPort}/status`);
    return await res.json();
  } catch (err) {
    return {
      running: false,
      port: targetPort,
      error: err.message,
    };
  }
}

function parseCliArgs(argv) {
  const raw = argv.slice(2);
  let command = null;
  const positional = [];
  const options = {};

  for (let i = 0; i < raw.length; i++) {
    const arg = raw[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (i + 1 < raw.length && !raw[i + 1].startsWith('--')) {
        options[key] = raw[i + 1];
        i++;
      } else {
        options[key] = true;
      }
    } else if (!command) {
      command = arg;
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, options };
}

async function main() {
  const { command, positional, options } = parseCliArgs(process.argv);
  const session = options.session || 'default';
  const browser = options.browser || null;

  if (!command || command === 'help' || command === '--help') {
    console.log(`
OpenWebBridge CLI v2.0 - AI Agent Browser Companion

Usage:
  open-webbridge <command> [arguments] [options]

Commands:
  status                                     Check bridge & connected browser instances
  navigate <url>                             Navigate to URL
    [--new-tab]                              Open in a new tab
    [--group-title <title>]                  Set Chrome / Edge tab group title
  snapshot                                   Extract accessibility tree & interactive @e refs
    [--in-viewport]                          Filter elements outside visual viewport (reduce token size)
    [--selector <css>]                       Scope snapshot to a container element
    [--interactive]                          Only include interactive nodes
  click <selector|@eRef>                     Click element by CSS selector or @e ref
  fill <selector|@eRef> <value>              Input text into native inputs or rich editors
  evaluate <code>                            Execute JavaScript on current page
  screenshot [path] [--selector <sel>]       Capture screenshot and save to disk
  scroll [--direction up|down] [--amount N]  Scroll page
  find-tab [url] [--active]                  Find existing tab or borrow user active tab
  list-tabs                                  List all tabs in current session
  close-tab [tabId]                          Close active tab or specified tabId
  close-session                              Close all tabs & clean up tab group
  handoff [reason]                           Human-in-the-loop breakpoint (for CAPTCHA/slider)
    [--timeout <sec>]                        Wait timeout in seconds (default: 120)
    [--selector <css>]                       Selector of CAPTCHA/slider to watch for disappearance
  mcp                                        Start native Model Context Protocol (MCP) server

Global Options:
  --browser <chrome|edge|browserId>          Route command to specific browser instance
  --session <name>                           Session identifier (default: "default")
    `);
    process.exit(0);
  }

  const targetPort = options.port ? parseInt(options.port, 10) : getDaemonPort();
  const send = (act, a = {}) => sendCommand(act, a, session, browser, targetPort);

  if (command === 'status') {
    const status = await getStatus(targetPort);
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  if (command === 'mcp') {
    const { startMcpServer } = require('../daemon/src/mcp-server');
    await startMcpServer({ port: targetPort });
    return;
  }

  let result;

  switch (command) {
    case 'navigate': {
      const url = positional[0];
      if (!url) {
        console.error('Error: URL is required. Example: open-webbridge navigate https://example.com');
        process.exit(1);
      }
      result = await send('navigate', {
        url,
        newTab: Boolean(options['new-tab']),
        group_title: options['group-title'],
      });
      break;
    }

    case 'find-tab': {
      result = await send('find_tab', {
        url: positional[0],
        active: Boolean(options.active),
      });
      break;
    }

    case 'snapshot': {
      result = await send('snapshot', {
        interactiveOnly: Boolean(options.interactive || options['interactive-only']),
        inViewportOnly: Boolean(
          options['in-viewport'] ||
          options['in-viewport-only'] ||
          options.inViewportOnly ||
          options.in_viewport_only
        ),
        selector: options.selector || null,
      });
      break;
    }

    case 'click': {
      const selector = positional[0];
      if (!selector) {
        console.error('Error: selector is required. Example: open-webbridge click "@e1"');
        process.exit(1);
      }
      result = await send('click', { selector });
      break;
    }

    case 'fill': {
      const selector = positional[0];
      const value = positional[1];
      if (!selector || value === undefined) {
        console.error('Error: selector and value are required. Example: open-webbridge fill "#search" "query"');
        process.exit(1);
      }
      result = await send('fill', { selector, value });
      break;
    }

    case 'evaluate': {
      const code = positional.join(' ');
      if (!code) {
        console.error('Error: code is required');
        process.exit(1);
      }
      result = await send('evaluate', { code });
      break;
    }

    case 'screenshot': {
      const outPath = positional[0];
      result = await send('screenshot', {
        path: outPath,
        selector: options.selector,
        format: options.format,
      });
      break;
    }

    case 'scroll': {
      result = await send('scroll', {
        direction: options.direction || 'down',
        amount: parseInt(options.amount || '500', 10),
      });
      break;
    }

    case 'list-tabs': {
      result = await send('list_tabs', {});
      break;
    }

    case 'close-tab': {
      const tabId = positional[0] ? parseInt(positional[0], 10) : undefined;
      result = await send('close_tab', { tabId });
      break;
    }

    case 'close-session': {
      result = await send('close_session', {});
      break;
    }

    case 'handoff': {
      const reason = positional[0] || options.reason || 'captcha';
      const timeout = parseInt(options.timeout || '120', 10);
      result = await send('handoff', {
        reason,
        timeout,
        selector: options.selector || null,
      });
      break;
    }

    default: {
      console.error(`Unknown command: ${command}. Run "open-webbridge help" for usage.`);
      process.exit(1);
    }
  }

  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error('Fatal CLI Error:', err);
  process.exit(1);
});
