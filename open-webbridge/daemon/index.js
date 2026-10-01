const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { OpenWebBridgeServer } = require('./src/server');

const CONFIG_DIR = path.join(os.homedir(), '.open-webbridge');
const PID_FILE = path.join(CONFIG_DIR, 'daemon.pid');
const PORT_FILE = path.join(CONFIG_DIR, 'daemon.port');

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

async function runForeground(port = 10087) {
  ensureConfigDir();
  const server = new OpenWebBridgeServer({ port });
  try {
    await server.start();
    fs.writeFileSync(PID_FILE, String(process.pid));
    fs.writeFileSync(PORT_FILE, String(port));

    const cleanup = async () => {
      console.log('\n[Daemon] Shutting down OpenWebBridge...');
      try {
        if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
        if (fs.existsSync(PORT_FILE)) fs.unlinkSync(PORT_FILE);
      } catch (e) {}
      await server.stop();
      process.exit(0);
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);
  } catch (err) {
    console.error(`[Daemon] Failed to start server on port ${port}:`, err.message);
    process.exit(1);
  }
}

async function checkStatus() {
  let port = 10087;
  if (fs.existsSync(PORT_FILE)) {
    try {
      port = parseInt(fs.readFileSync(PORT_FILE, 'utf8').trim(), 10);
    } catch (e) {}
  }

  try {
    const res = await fetch(`http://127.0.0.1:${port}/status`);
    if (res.ok) {
      const data = await res.json();
      console.log(JSON.stringify(data, null, 2));
      return;
    }
  } catch (e) {}

  console.log(JSON.stringify({ running: false, port, addr: `127.0.0.1:${port}` }, null, 2));
}

function stopDaemon() {
  if (!fs.existsSync(PID_FILE)) {
    console.log('[Daemon] No running daemon PID file found.');
    return;
  }

  try {
    const pid = parseInt(fs.readFileSync(PID_FILE, 'utf8').trim(), 10);
    process.kill(pid, 'SIGTERM');
    console.log(`[Daemon] Stopped daemon process (PID: ${pid}).`);
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
    if (fs.existsSync(PORT_FILE)) fs.unlinkSync(PORT_FILE);
  } catch (err) {
    console.warn(`[Daemon] Process kill warning: ${err.message}`);
    if (fs.existsSync(PID_FILE)) fs.unlinkSync(PID_FILE);
  }
}

// Simple CLI arg parser
const args = process.argv.slice(2);
const command = args[0] || 'start';

let portArg = 10087;
const portIdx = args.indexOf('--port');
if (portIdx !== -1 && args[portIdx + 1]) {
  portArg = parseInt(args[portIdx + 1], 10);
}

if (command === 'status') {
  checkStatus();
} else if (command === 'stop') {
  stopDaemon();
} else if (command === 'start') {
  runForeground(portArg);
} else {
  console.log(`
OpenWebBridge Daemon CLI

Usage:
  node index.js [command] [options]

Commands:
  start       Start daemon server (default foreground)
  status      Query daemon status
  stop        Stop running background daemon

Options:
  --port <N>  Specify listening port (default: 10087)
  `);
}
