const assert = require('assert');
const path = require('path');
const { execFile } = require('child_process');
const { OpenWebBridgeServer } = require('../daemon/src/server');
const { MockExtension } = require('./mock-extension');

const CLI_PATH = path.join(__dirname, '..', 'cli', 'open-webbridge.js');

function runCli(args) {
  return new Promise((resolve, reject) => {
    execFile('node', [CLI_PATH, ...args], (err, stdout, stderr) => {
      resolve({
        code: err ? err.code || 1 : 0,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
      });
    });
  });
}

async function testCli() {
  console.log('=== [Test Suite: CLI Tool & Argument Parsing] ===\n');
  const TEST_PORT = 10095;
  const server = new OpenWebBridgeServer({ port: TEST_PORT });
  await server.start();

  const mockExt = new MockExtension({
    wsUrl: `ws://127.0.0.1:${TEST_PORT}/ws`,
    browserType: 'chrome',
  });
  await mockExt.connect();
  await new Promise((r) => setTimeout(r, 150));

  try {
    // 1. Test CLI help
    console.log('[Test 1] Testing "open-webbridge --help"...');
    const helpRes = await runCli(['--help']);
    assert.strictEqual(helpRes.code, 0);
    assert(helpRes.stdout.includes('OpenWebBridge CLI v2.0'));
    assert(helpRes.stdout.includes('--in-viewport'));
    assert(helpRes.stdout.includes('handoff'));
    console.log('  ✓ CLI help output verified.');

    // 2. Test status with --port parameter placed BEFORE command
    console.log('\n[Test 2] Testing "open-webbridge --port 10095 status" (options before command)...');
    const statusRes = await runCli(['--port', String(TEST_PORT), 'status']);
    assert.strictEqual(statusRes.code, 0);
    const statusData = JSON.parse(statusRes.stdout);
    assert.strictEqual(statusData.running, true);
    assert.strictEqual(statusData.port, TEST_PORT);
    assert.strictEqual(statusData.extension_connected, true);
    console.log('  ✓ Option placed before command parsed correctly.');

    // 3. Test navigate with --browser and --port
    console.log('\n[Test 3] Testing "open-webbridge --browser chrome --port 10095 navigate https://example.com"...');
    const navRes = await runCli(['--browser', 'chrome', '--port', String(TEST_PORT), 'navigate', 'https://example.com']);
    assert.strictEqual(navRes.code, 0);
    const navData = JSON.parse(navRes.stdout);
    assert.strictEqual(navData.ok, true);
    assert.strictEqual(navData.data.url, 'https://example.com');
    console.log('  ✓ Navigate command executed via CLI.');

    // 4. Test snapshot with --in-viewport flag
    console.log('\n[Test 4] Testing "open-webbridge snapshot --in-viewport --port 10095"...');
    const snapRes = await runCli(['snapshot', '--in-viewport', '--port', String(TEST_PORT)]);
    assert.strictEqual(snapRes.code, 0);
    const snapData = JSON.parse(snapRes.stdout);
    assert.strictEqual(snapData.ok, true);
    assert.strictEqual(snapData.data.inViewportOnly, true);
    assert.strictEqual(snapData.data.totalElements, 62);
    console.log('  ✓ Snapshot --in-viewport executed via CLI.');

    // 5. Test snapshot with --selector flag
    console.log('\n[Test 5] Testing "open-webbridge snapshot --selector #detail-desc --port 10095"...');
    const scopeRes = await runCli(['snapshot', '--selector', '#detail-desc', '--port', String(TEST_PORT)]);
    assert.strictEqual(scopeRes.code, 0);
    const scopeData = JSON.parse(scopeRes.stdout);
    assert.strictEqual(scopeData.ok, true);
    assert.strictEqual(scopeData.data.scoped, true);
    assert.strictEqual(scopeData.data.totalElements, 2);
    console.log('  ✓ Snapshot --selector executed via CLI.');

    // 6. Test handoff command
    console.log('\n[Test 6] Testing "open-webbridge handoff slider --port 10095"...');
    const handoffRes = await runCli(['handoff', 'slider', '--timeout', '10', '--port', String(TEST_PORT)]);
    assert.strictEqual(handoffRes.code, 0);
    const handoffData = JSON.parse(handoffRes.stdout);
    assert.strictEqual(handoffData.ok, true);
    assert.strictEqual(handoffData.data.resolved, true);
    console.log('  ✓ Handoff command executed via CLI.');

    console.log('\n🎉 CLI Tool Tests Passed Perfectly!\n');
  } finally {
    mockExt.close();
    await server.stop();
  }
}

if (require.main === module) {
  testCli().catch((err) => {
    console.error('CLI test failed:', err);
    process.exit(1);
  });
}

module.exports = { testCli };
