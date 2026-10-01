const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { OpenWebBridgeServer } = require('../daemon/src/server');
const { MockExtension } = require('./mock-extension');

async function runTests() {
  console.log('=== Starting OpenWebBridge Automated Test Suite ===\n');
  const TEST_PORT = 10099;
  const server = new OpenWebBridgeServer({ port: TEST_PORT });

  try {
    // 1. Start Server
    console.log('[Test 1] Starting daemon server on port', TEST_PORT);
    await server.start();
    console.log('  ✓ Daemon server started successfully.');

    // 2. Query /status before extension connects
    console.log('\n[Test 2] Testing /status (disconnected state)');
    const res1 = await fetch(`http://127.0.0.1:${TEST_PORT}/status`);
    const status1 = await res1.json();
    assert.strictEqual(status1.running, true);
    assert.strictEqual(status1.extension_connected, false);
    console.log('  ✓ /status verified (extension_connected = false).');

    // 3. Test /command rejection when no extension is connected
    console.log('\n[Test 3] Testing /command rejection when disconnected');
    const resCmdBefore = await fetch(`http://127.0.0.1:${TEST_PORT}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'navigate', args: { url: 'https://example.com' } }),
    });
    const cmdBeforeData = await resCmdBefore.json();
    assert.strictEqual(cmdBeforeData.ok, false);
    assert.strictEqual(cmdBeforeData.error.code, 'extension_not_connected');
    console.log('  ✓ Disconnected command properly rejected with code "extension_not_connected".');

    // 4. Connect Mock Extension
    console.log('\n[Test 4] Connecting Mock Extension via WebSocket');
    const mockExt = new MockExtension(`ws://127.0.0.1:${TEST_PORT}/ws`);
    await mockExt.connect();
    // Allow brief handshake
    await new Promise((r) => setTimeout(r, 200));

    const res2 = await fetch(`http://127.0.0.1:${TEST_PORT}/status`);
    const status2 = await res2.json();
    assert.strictEqual(status2.extension_connected, true);
    assert.strictEqual(status2.extension_version, '1.0.0-mock');
    console.log('  ✓ Extension handshake succeeded! (extension_connected = true).');

    // 5. Execute "navigate" command
    console.log('\n[Test 5] Executing "navigate" command via HTTP /command');
    const navRes = await fetch(`http://127.0.0.1:${TEST_PORT}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'navigate',
        args: { url: 'https://example.com', newTab: true, group_title: 'Research' },
        session: 'test-session-1',
      }),
    });
    const navData = await navRes.json();
    assert.strictEqual(navData.ok, true);
    assert.strictEqual(navData.data.tabId, 101);
    console.log('  ✓ "navigate" returned:', navData.data);

    // 6. Execute "snapshot" command (Accessibility tree + @e refs)
    console.log('\n[Test 6] Executing "snapshot" command');
    const snapRes = await fetch(`http://127.0.0.1:${TEST_PORT}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'snapshot',
        args: {},
        session: 'test-session-1',
      }),
    });
    const snapData = await snapRes.json();
    assert.strictEqual(snapData.ok, true);
    assert.strictEqual(snapData.data.totalElements, 3);
    assert(snapData.data.tree.includes('[@e1]'));
    console.log('  ✓ "snapshot" accessibility tree returned:\n' + snapData.data.tree.replace(/^/gm, '    '));

    // 7. Execute "click" and "fill"
    console.log('\n[Test 7] Executing "fill" and "click"');
    const fillRes = await fetch(`http://127.0.0.1:${TEST_PORT}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'fill',
        args: { selector: '@e1', value: 'OpenWebBridge test' },
        session: 'test-session-1',
      }),
    });
    const fillData = await fillRes.json();
    assert.strictEqual(fillData.ok, true);
    assert.strictEqual(fillData.data.tag, 'INPUT');
    console.log('  ✓ "fill" succeeded.');

    const clickRes = await fetch(`http://127.0.0.1:${TEST_PORT}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'click',
        args: { selector: '@e2' },
        session: 'test-session-1',
      }),
    });
    const clickData = await clickRes.json();
    assert.strictEqual(clickData.ok, true);
    assert.strictEqual(clickData.data.tag, 'BUTTON');
    console.log('  ✓ "click" succeeded.');

    // 8. Execute "screenshot" and test Disk-First auto-saving
    console.log('\n[Test 8] Executing "screenshot" with automatic disk persistence');
    const customShotPath = path.join(__dirname, 'test_output_shot.png');
    if (fs.existsSync(customShotPath)) fs.unlinkSync(customShotPath);

    const shotRes = await fetch(`http://127.0.0.1:${TEST_PORT}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'screenshot',
        args: { path: customShotPath },
        session: 'test-session-1',
      }),
    });
    const shotData = await shotRes.json();
    assert.strictEqual(shotData.ok, true);
    assert.strictEqual(shotData.data.format, 'png');
    assert.strictEqual(shotData.data.path, path.resolve(customShotPath));
    assert(fs.existsSync(customShotPath), 'Screenshot file must exist on disk');
    assert(shotData.data.sizeBytes > 0, 'Screenshot file size must be > 0');
    // Crucial check: verify that raw base64 was stripped from output to protect LLM context!
    assert.strictEqual(shotData.data.data, undefined, 'Raw base64 data must be stripped from response');
    console.log('  ✓ Screenshot persisted to disk:', shotData.data.path);
    console.log('  ✓ Verified: Context-polluting base64 payload successfully converted to disk metadata!');

    // Cleanup test screenshot
    if (fs.existsSync(customShotPath)) fs.unlinkSync(customShotPath);

    // 9. Teardown
    console.log('\n[Test 9] Disconnecting mock extension and stopping daemon');
    mockExt.close();
    await new Promise((r) => setTimeout(r, 100));
    await server.stop();
    console.log('  ✓ Clean teardown complete.');

    console.log('\n🎉 ALL 9 TEST SUITES PASSED PERFECTLY!\n');
    process.exit(0);
  } catch (err) {
    console.error('\n❌ Test failed with error:', err);
    try { await server.stop(); } catch (e) {}
    process.exit(1);
  }
}

runTests();
