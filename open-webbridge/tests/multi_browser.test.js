const assert = require('assert');
const { OpenWebBridgeServer } = require('../daemon/src/server');
const { MockExtension } = require('./mock-extension');
const { OpenWebBridge } = require('../sdk/node');

async function testMultiBrowser() {
  console.log('=== [Test Suite: Multi-Browser Connection Pool & Routing] ===\n');
  const TEST_PORT = 10097;
  const server = new OpenWebBridgeServer({ port: TEST_PORT });
  await server.start();

  let chromeExt = null;
  let edgeExt = null;
  let edgeExt2 = null;

  try {
    // 1. Initial status check (0 connected)
    console.log('[Test 1] Checking status before any browser connects...');
    const resInit = await fetch(`http://127.0.0.1:${TEST_PORT}/status`);
    const statusInit = await resInit.json();
    assert.strictEqual(statusInit.extension_connected, false);
    assert.strictEqual(statusInit.browser_count, 0);
    assert.deepStrictEqual(statusInit.browsers, []);
    console.log('  ✓ Verified 0 browsers connected.');

    // 2. Connect Chrome and Edge instances
    console.log('\n[Test 2] Connecting Mock Chrome & Mock Edge simultaneously...');
    chromeExt = new MockExtension({
      wsUrl: `ws://127.0.0.1:${TEST_PORT}/ws`,
      browserType: 'chrome',
      browserId: 'chrome',
      profileName: 'WorkProfile',
    });
    await chromeExt.connect();

    edgeExt = new MockExtension({
      wsUrl: `ws://127.0.0.1:${TEST_PORT}/ws`,
      browserType: 'edge',
      browserId: 'edge',
      profileName: 'PersonalProfile',
    });
    await edgeExt.connect();
    await new Promise((r) => setTimeout(r, 200));

    // 3. Status inspection
    console.log('\n[Test 3] Checking multi-browser status introspection...');
    const resPool = await fetch(`http://127.0.0.1:${TEST_PORT}/status`);
    const statusPool = await resPool.json();
    assert.strictEqual(statusPool.extension_connected, true);
    assert.strictEqual(statusPool.browser_count, 2);
    const browserIds = statusPool.browsers.map((b) => b.browserId).sort();
    assert.deepStrictEqual(browserIds, ['chrome', 'edge']);
    console.log('  ✓ Connected browsers detected:', browserIds);

    // 4. Dispatch command targeted to Chrome
    console.log('\n[Test 4] Dispatching command to Chrome (--browser chrome)...');
    const resChrome = await fetch(`http://127.0.0.1:${TEST_PORT}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'navigate',
        args: { url: 'https://github.com' },
        browser: 'chrome',
      }),
    });
    const dataChrome = await resChrome.json();
    assert.strictEqual(dataChrome.ok, true);
    assert.strictEqual(dataChrome.data.browser, 'chrome');
    assert.strictEqual(chromeExt.receivedCalls.length, 1);
    assert.strictEqual(edgeExt.receivedCalls.length, 0);
    console.log('  ✓ Chrome successfully and exclusively received the command.');

    // 5. Dispatch command targeted to Edge
    console.log('\n[Test 5] Dispatching command to Edge (--browser edge)...');
    const resEdge = await fetch(`http://127.0.0.1:${TEST_PORT}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'navigate',
        args: { url: 'https://www.xiaohongshu.com' },
        browser: 'edge',
      }),
    });
    const dataEdge = await resEdge.json();
    assert.strictEqual(dataEdge.ok, true);
    assert.strictEqual(dataEdge.data.browser, 'edge');
    assert.strictEqual(chromeExt.receivedCalls.length, 1);
    assert.strictEqual(edgeExt.receivedCalls.length, 1);
    console.log('  ✓ Edge successfully and exclusively received the command.');

    // 6. Dispatch without browser preference (default/active route)
    console.log('\n[Test 6] Dispatching command without browser preference (default active route)...');
    const resDefault = await fetch(`http://127.0.0.1:${TEST_PORT}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'evaluate',
        args: { code: '1+1' },
      }),
    });
    const dataDefault = await resDefault.json();
    assert.strictEqual(dataDefault.ok, true);
    // Edge was the most recently active, so it should receive default command
    assert.strictEqual(edgeExt.receivedCalls.length, 2);
    console.log('  ✓ Command correctly routed to recently active browser.');

    // 7. Request non-existent browser
    console.log('\n[Test 7] Requesting non-existent browser ("firefox")...');
    const resNotFound = await fetch(`http://127.0.0.1:${TEST_PORT}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'click',
        args: { selector: '@e1' },
        browser: 'firefox',
      }),
    });
    assert.strictEqual(resNotFound.status, 503);
    const dataNotFound = await resNotFound.json();
    assert.strictEqual(dataNotFound.ok, false);
    assert.strictEqual(dataNotFound.error.code, 'extension_not_connected');
    assert(dataNotFound.error.message.includes('firefox'));
    console.log('  ✓ Missing browser properly rejected with 503 and informative message.');

    // 8. Node SDK browser-bound instance
    console.log('\n[Test 8] Testing Node.js SDK browser binding...');
    const chromeSdk = new OpenWebBridge({ port: TEST_PORT, browser: 'chrome' });
    const navResult = await chromeSdk.navigate('https://google.com');
    assert.strictEqual(navResult.browser, 'chrome');
    console.log('  ✓ Node.js SDK instance routed directly to bound browser.');

    // 9. Handoff event test
    console.log('\n[Test 9] Testing Handoff human-in-the-loop breakpoint execution...');
    let handoffEventReceived = false;
    server.sessionManager.on('handoff_resolved', (payload) => {
      handoffEventReceived = true;
      assert.strictEqual(payload.resolved, true);
    });

    const handoffRes = await fetch(`http://127.0.0.1:${TEST_PORT}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'handoff',
        args: { reason: 'slider captcha verification' },
        browser: 'chrome',
      }),
    });
    const handoffData = await handoffRes.json();
    assert.strictEqual(handoffData.ok, true);
    assert.strictEqual(handoffData.data.resolved, true);
    assert.strictEqual(handoffData.data.reason, 'slider captcha verification');

    // Wait for async handoff_resolved event
    await new Promise((r) => setTimeout(r, 100));
    assert.strictEqual(handoffEventReceived, true, 'Daemon must receive handoff_resolved event');
    console.log('  ✓ Handoff resolved and daemon event emitted.');

    // 10. Disconnect one browser and verify graceful pool degradation
    console.log('\n[Test 10] Disconnecting Chrome and verifying remaining Edge...');
    chromeExt.close();
    await new Promise((r) => setTimeout(r, 100));

    const resDegraded = await fetch(`http://127.0.0.1:${TEST_PORT}/status`);
    const statusDegraded = await resDegraded.json();
    assert.strictEqual(statusDegraded.browser_count, 1);
    assert.strictEqual(statusDegraded.browsers[0].browserId, 'edge');

    // Edge still operates normally
    const edgeSdk = new OpenWebBridge({ port: TEST_PORT });
    const evalRes = await edgeSdk.evaluate('1+1');
    assert.strictEqual(evalRes.value, 2);
    console.log('  ✓ Connection pool gracefully maintained remaining active browser.');

    // 11. Connect a second Edge instance simultaneously (disambiguation test)
    console.log('\n[Test 11] Connecting second Edge instance (testing browserId collision disambiguation)...');
    edgeExt2 = new MockExtension({
      wsUrl: `ws://127.0.0.1:${TEST_PORT}/ws`,
      browserType: 'edge',
      profileName: 'SecondaryProfile',
    });
    await edgeExt2.connect();
    await new Promise((r) => setTimeout(r, 150));

    const resCollision = await fetch(`http://127.0.0.1:${TEST_PORT}/status`);
    const statusCollision = await resCollision.json();
    assert.strictEqual(statusCollision.browser_count, 2);
    const poolIds = statusCollision.browsers.map((b) => b.browserId).sort();
    assert.deepStrictEqual(poolIds, ['edge', 'edge-2'], 'Second edge connection must be disambiguated to edge-2');

    // Route command to edge-2 specifically
    const resEdge2 = await fetch(`http://127.0.0.1:${TEST_PORT}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'navigate',
        args: { url: 'https://example.org' },
        browser: 'edge-2',
      }),
    });
    const dataEdge2 = await resEdge2.json();
    assert.strictEqual(dataEdge2.ok, true);
    assert.strictEqual(dataEdge2.data.browser, 'edge-2');
    console.log('  ✓ Disambiguated browserId "edge-2" correctly created and routed.');

    edgeExt2.close();
    await new Promise((r) => setTimeout(r, 100));

    console.log('\n🎉 Multi-Browser Pool Tests Passed Perfectly!\n');
  } finally {
    if (chromeExt) chromeExt.close();
    if (edgeExt) edgeExt.close();
    if (edgeExt2) edgeExt2.close();
    await server.stop();
  }
}

if (require.main === module) {
  testMultiBrowser().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}

module.exports = { testMultiBrowser };
