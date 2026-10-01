const assert = require('assert');
const { OpenWebBridgeServer } = require('../daemon/src/server');
const { MockExtension } = require('./mock-extension');
const { OpenWebBridge } = require('../sdk/node');

// Core viewport pruning math from background.js (supports 3-arg unscrolled and 5-arg scroll-aware)
const isInsideViewport = (border, sx, sy, viewportWidth, viewportHeight) => {
  if (viewportWidth === undefined && viewportHeight === undefined) {
    viewportWidth = sx;
    viewportHeight = sy;
    sx = 0;
    sy = 0;
  }
  const xs = [border[0], border[2], border[4], border[6]];
  const ys = [border[1], border[3], border[5], border[7]];
  const minX = Math.min(...xs), maxX = Math.max(...xs);
  const minY = Math.min(...ys), maxY = Math.max(...ys);
  return (
    maxX > sx &&
    minX < sx + viewportWidth &&
    maxY > sy &&
    minY < sy + viewportHeight
  );
};

async function testViewportPruning() {
  console.log('=== [Test Suite: Viewport Pruning & Selector Scoping] ===\n');
  const TEST_PORT = 10098;
  const server = new OpenWebBridgeServer({ port: TEST_PORT });
  await server.start();

  const mockExt = new MockExtension({
    wsUrl: `ws://127.0.0.1:${TEST_PORT}/ws`,
    browserType: 'chrome',
  });
  await mockExt.connect();
  await new Promise((r) => setTimeout(r, 150));

  try {
    // 1. Math verification for isInsideViewport (both unscrolled and scrolled)
    console.log('[Test 1] Testing isInsideViewport box model intersection geometry...');
    const vw = 1920, vh = 1080;

    // Fully inside (unscrolled)
    assert.strictEqual(
      isInsideViewport([100, 100, 200, 100, 200, 200, 100, 200], vw, vh),
      true,
      'Center element must be inside viewport'
    );

    // Partially overlapping top-left
    assert.strictEqual(
      isInsideViewport([-50, -50, 50, -50, 50, 50, -50, 50], vw, vh),
      true,
      'Partially overlapping element must be considered inside'
    );

    // Completely off-screen below (e.g. scroll y=2500)
    assert.strictEqual(
      isInsideViewport([100, 2500, 200, 2500, 200, 2600, 100, 2600], vw, vh),
      false,
      'Element far below viewport must be pruned'
    );

    // Completely off-screen right (e.g. scroll x=3000)
    assert.strictEqual(
      isInsideViewport([3000, 100, 3100, 100, 3100, 200, 3000, 200], vw, vh),
      false,
      'Element far to the right must be pruned'
    );

    // Completely off-screen above (e.g. y = -500)
    assert.strictEqual(
      isInsideViewport([100, -500, 200, -500, 200, -400, 100, -400], vw, vh),
      false,
      'Element above viewport must be pruned'
    );

    // Scrolled page math verification: page scrolled down by 1000px (scrollY = 1000)
    const scrollY = 1000;
    // Element at page Y = [1100, 1200] is on screen!
    assert.strictEqual(
      isInsideViewport([100, 1100, 200, 1100, 200, 1200, 100, 1200], 0, scrollY, vw, vh),
      true,
      'Element at page Y=1100-1200 with scrollY=1000 must be inside scrolled viewport'
    );
    // Element at page Y = [100, 200] (scrolled off top) must NOT be in scrolled viewport!
    assert.strictEqual(
      isInsideViewport([100, 100, 200, 100, 200, 200, 100, 200], 0, scrollY, vw, vh),
      false,
      'Element at page Y=100-200 with scrollY=1000 must be pruned as scrolled off top'
    );

    console.log('  ✓ Box model geometric clipping calculations verified (both unscrolled & scrolled).');

    // 2. HTTP /command snapshot without pruning (full tree)
    console.log('\n[Test 2] Testing full snapshot without pruning (simulating 600+ node page)...');
    const resFull = await fetch(`http://127.0.0.1:${TEST_PORT}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'snapshot',
        args: { inViewportOnly: false, simulateHeavyPage: true },
      }),
    });
    const dataFull = await resFull.json();
    assert.strictEqual(dataFull.ok, true);
    assert.strictEqual(dataFull.data.totalElements, 649);
    assert.strictEqual(dataFull.data.inViewportOnly, false);
    console.log(`  ✓ Full tree totalElements: ${dataFull.data.totalElements} nodes`);

    // 3. HTTP /command snapshot with inViewportOnly: true
    console.log('\n[Test 3] Testing snapshot with inViewportOnly: true (viewport pruning)...');
    const resPruned = await fetch(`http://127.0.0.1:${TEST_PORT}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'snapshot',
        args: { inViewportOnly: true },
      }),
    });
    const dataPruned = await resPruned.json();
    assert.strictEqual(dataPruned.ok, true);
    assert.strictEqual(dataPruned.data.totalElements, 62);
    assert.strictEqual(dataPruned.data.inViewportOnly, true);
    const reductionPercent = Math.round(((649 - 62) / 649) * 100);
    console.log(`  ✓ Pruned tree totalElements: ${dataPruned.data.totalElements} nodes (compressed by ${reductionPercent}%)`);
    assert(reductionPercent >= 80, 'Pruning should compress nodes by at least 80%');

    // 4. HTTP /command snapshot with container selector scope
    console.log('\n[Test 4] Testing snapshot with selector scope ("#detail-desc")...');
    const resScoped = await fetch(`http://127.0.0.1:${TEST_PORT}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'snapshot',
        args: { selector: '#detail-desc' },
      }),
    });
    const dataScoped = await resScoped.json();
    assert.strictEqual(dataScoped.ok, true);
    assert.strictEqual(dataScoped.data.scoped, true);
    assert.strictEqual(dataScoped.data.totalElements, 2);
    assert(dataScoped.data.tree.includes('评论输入框'));
    console.log(`  ✓ Scoped tree isolated to container: ${dataScoped.data.totalElements} nodes`);

    // 5. HTTP /command snapshot with non-existent selector (strict error handling)
    console.log('\n[Test 5] Testing snapshot with non-existent selector scope...');
    const resMissingScope = await fetch(`http://127.0.0.1:${TEST_PORT}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'snapshot',
        args: { selector: '#does-not-exist' },
      }),
    });
    const dataMissing = await resMissingScope.json();
    assert.strictEqual(dataMissing.ok, false);
    assert(dataMissing.error.message.includes('selector'));
    console.log('  ✓ Non-existent container selector properly rejected with error.');

    // 6. Node SDK integration test
    console.log('\n[Test 6] Testing Node.js SDK snapshot and cdp methods...');
    const client = new OpenWebBridge({ port: TEST_PORT });
    const sdkPruned = await client.snapshot({ inViewportOnly: true });
    assert.strictEqual(sdkPruned.totalElements, 62);

    const sdkScoped = await client.snapshot({ selector: '#detail-desc' });
    assert.strictEqual(sdkScoped.totalElements, 2);

    const cdpRes = await client.cdp('Page.enable');
    assert.strictEqual(cdpRes.success, true);
    console.log('  ✓ Node.js SDK snapshot options and cdp method verified.');

    console.log('\n🎉 Viewport Pruning and Scope Tests Passed Perfectly!\n');
  } finally {
    mockExt.close();
    await server.stop();
  }
}

if (require.main === module) {
  testViewportPruning().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}

module.exports = { testViewportPruning };
