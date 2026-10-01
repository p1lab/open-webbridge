const { spawn } = require('child_process');
const path = require('path');
const { OpenWebBridgeServer } = require('../daemon/src/server');
const { MockExtension } = require('./mock-extension');

function runCommand(command, args, description) {
  return new Promise((resolve, reject) => {
    console.log(`\n============================================================`);
    console.log(`[Runner] Starting: ${description}`);
    console.log(`============================================================`);
    const proc = spawn(command, args, { stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0) {
        console.log(`[Runner] ✓ PASSED: ${description}`);
        resolve();
      } else {
        reject(new Error(`${description} failed with exit code ${code}`));
      }
    });
    proc.on('error', reject);
  });
}

async function main() {
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║       OpenWebBridge v2.0 Complete Test Suite Runner      ║');
  console.log('╚══════════════════════════════════════════════════════════╝');

  const startTime = Date.now();

  // 1. Daemon base integration test
  await runCommand('node', [path.join(__dirname, 'daemon.test.js')], 'Daemon Base Integration Test');

  // 2. Viewport pruning and selector scoping test
  await runCommand('node', [path.join(__dirname, 'viewport_prune.test.js')], 'Viewport Pruning & Selector Scoping Test');

  // 3. Multi-browser connection pool and routing test
  await runCommand('node', [path.join(__dirname, 'multi_browser.test.js')], 'Multi-Browser Connection Pool & Routing Test');

  // 4. Model Context Protocol (MCP) server test
  await runCommand('node', [path.join(__dirname, 'mcp_protocol.test.js')], 'MCP Protocol Standard & Tools Test');

  // 5. CLI commands and argument parsing test
  await runCommand('node', [path.join(__dirname, 'cli.test.js')], 'CLI Tool & Argument Parsing Test');

  // 6. Python SDK & Compatibility tests (with shared daemon instance)
  const TEST_PORT = 10099;
  const server = new OpenWebBridgeServer({ port: TEST_PORT });
  await server.start();

  const mockExt = new MockExtension({
    wsUrl: `ws://127.0.0.1:${TEST_PORT}/ws`,
    browserType: 'chrome',
  });
  await mockExt.connect();
  await new Promise((r) => setTimeout(r, 200));

  try {
    // Run Python SDK v2.0 test
    await runCommand('python', [path.join(__dirname, 'sdk.test.py')], 'Python SDK v2.0 Client Test');

    // Run XHS Bridge Compatibility test
    await runCommand('python', [path.join(__dirname, 'xhs_bridge_compat.test.py')], 'XHS Bridge Ecosystem Compatibility Test');
  } finally {
    mockExt.close();
    await server.stop();
  }

  const durationSec = ((Date.now() - startTime) / 1000).toFixed(2);
  console.log('\n============================================================');
  console.log(`🎉 ALL 7 TEST SUITES PASSED FLAWLESSLY in ${durationSec}s!`);
  console.log('============================================================\n');
}

main().catch((err) => {
  console.error('\n❌ [Runner] Test execution failed:', err);
  process.exit(1);
});
