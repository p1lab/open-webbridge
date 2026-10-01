#!/usr/bin/env node

/**
 * OpenWebBridge Unified CLI Tool
 * Compatible with Agent command lines & terminal scripting
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT_FILE = path.join(os.homedir(), '.open-webbridge', 'daemon.port');

function getDaemonPort() {
  if (fs.existsSync(PORT_FILE)) {
    try {
      return parseInt(fs.readFileSync(PORT_FILE, 'utf8').trim(), 10);
    } catch (e) {}
  }
  return 10087;
}

async function sendCommand(action, args = {}, session = 'default') {
  const port = getDaemonPort();
  const url = `http://127.0.0.1:${port}/command`;

  const payload = {
    action,
    args,
    session,
  };

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
        message: `Cannot reach daemon at http://127.0.0.1:${port}: ${err.message}`,
      },
    };
  }
}

async function getStatus() {
  const port = getDaemonPort();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/status`);
    return await res.json();
  } catch (err) {
    return {
      running: false,
      port,
      error: err.message,
    };
  }
}

function parseCliArgs(argv) {
  const raw = argv.slice(2);
  const command = raw[0];
  const positional = [];
  const options = {};

  for (let i = 1; i < raw.length; i++) {
    const arg = raw[i];
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (i + 1 < raw.length && !raw[i + 1].startsWith('--')) {
        options[key] = raw[i + 1];
        i++;
      } else {
        options[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  return { command, positional, options };
}

async function main() {
  const { command, positional, options } = parseCliArgs(process.argv);
  const session = options.session || 'default';

  if (!command || command === 'help' || command === '--help') {
    console.log(`
OpenWebBridge CLI - AI Agent Browser Companion

Usage:
  open-webbridge <command> [arguments] [options]

Commands:
  status                                     Check bridge & extension connection status
  navigate <url>                             Navigate to URL
    [--new-tab]                              Open in a new tab
    [--group-title <title>]                  Set Chrome tab group title
  snapshot                                   Extract accessibility tree & @e element refs
  click <selector|@eRef>                     Click element by CSS selector or @e ref
  fill <selector|@eRef> <value>              Input text into native inputs or rich editors
  evaluate <code>                            Execute JavaScript on current page
  screenshot [path] [--selector <sel>]       Capture screenshot and save to disk
  scroll [--direction up|down] [--amount N]  Scroll page
  list-tabs                                  List all tabs in current session
  close-tab                                  Close active tab
  close-session                              Close all tabs & clean up tab group

Options:
  --session <name>                           Session identifier (default: "default")
    `);
    process.exit(0);
  }

  if (command === 'status') {
    const status = await getStatus();
    console.log(JSON.stringify(status, null, 2));
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
      result = await sendCommand('navigate', {
        url,
        newTab: Boolean(options['new-tab']),
        group_title: options['group-title'],
      }, session);
      break;
    }

    case 'find-tab': {
      result = await sendCommand('find_tab', {
        url: positional[0],
        active: Boolean(options.active),
      }, session);
      break;
    }

    case 'snapshot': {
      result = await sendCommand('snapshot', {}, session);
      break;
    }

    case 'click': {
      const selector = positional[0];
      if (!selector) {
        console.error('Error: selector is required. Example: open-webbridge click "@e1"');
        process.exit(1);
      }
      result = await sendCommand('click', { selector }, session);
      break;
    }

    case 'fill': {
      const selector = positional[0];
      const value = positional[1];
      if (!selector || value === undefined) {
        console.error('Error: selector and value are required. Example: open-webbridge fill "#search" "query"');
        process.exit(1);
      }
      result = await sendCommand('fill', { selector, value }, session);
      break;
    }

    case 'evaluate': {
      const code = positional.join(' ');
      if (!code) {
        console.error('Error: code is required');
        process.exit(1);
      }
      result = await sendCommand('evaluate', { code }, session);
      break;
    }

    case 'screenshot': {
      const outPath = positional[0];
      result = await sendCommand('screenshot', {
        path: outPath,
        selector: options.selector,
      }, session);
      break;
    }

    case 'scroll': {
      result = await sendCommand('scroll', {
        direction: options.direction || 'down',
        amount: parseInt(options.amount || '500', 10),
      }, session);
      break;
    }

    case 'list-tabs': {
      result = await sendCommand('list_tabs', {}, session);
      break;
    }

    case 'close-tab': {
      result = await sendCommand('close_tab', {}, session);
      break;
    }

    case 'close-session': {
      result = await sendCommand('close_session', {}, session);
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
