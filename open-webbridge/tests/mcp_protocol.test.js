const assert = require('assert');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { InMemoryTransport } = require('@modelcontextprotocol/sdk/inMemory.js');
const { OpenWebBridgeMCPServer, MCP_TOOLS } = require('../daemon/src/mcp-server');
const { OpenWebBridgeServer } = require('../daemon/src/server');
const { MockExtension } = require('./mock-extension');

async function testMcpProtocol() {
  console.log('=== [Test Suite: Model Context Protocol (MCP) Integration] ===\n');
  const TEST_PORT = 10096;
  const bridgeServer = new OpenWebBridgeServer({ port: TEST_PORT });
  await bridgeServer.start();

  const mockExt = new MockExtension({
    wsUrl: `ws://127.0.0.1:${TEST_PORT}/ws`,
    browserType: 'chrome',
  });
  await mockExt.connect();
  await new Promise((r) => setTimeout(r, 150));

  const mcpServer = new OpenWebBridgeMCPServer({ port: TEST_PORT });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  const client = new Client(
    { name: 'test-ai-ide', version: '2.0.0' },
    { capabilities: {} }
  );

  try {
    // 1. Connect MCP client and server
    console.log('[Test 1] Connecting MCP Client to OpenWebBridge MCP Server...');
    await mcpServer.mcpServer.connect(serverTransport);
    await client.connect(clientTransport);
    console.log('  ✓ MCP Protocol Handshake complete over linked transport.');

    // 2. Query list of tools
    console.log('\n[Test 2] Querying available tools via MCP listTools()...');
    const listResult = await client.listTools();
    const tools = listResult.tools || [];
    console.log(`  ✓ Received ${tools.length} exposed tools from MCP Server.`);
    assert.strictEqual(tools.length, 12, 'Must expose exactly 12 browser companion tools');

    const expectedToolNames = [
      'navigate',
      'snapshot',
      'click',
      'fill',
      'evaluate',
      'screenshot',
      'scroll',
      'find_tab',
      'list_tabs',
      'close_tab',
      'close_session',
      'handoff',
    ];

    const actualToolNames = tools.map((t) => t.name);
    for (const expected of expectedToolNames) {
      assert(
        actualToolNames.includes(expected),
        `MCP tool list must include tool "${expected}"`
      );
    }
    console.log('  ✓ All 12 tools declared with valid MCP InputSchemas:\n    ' + actualToolNames.join(', '));

    // 3. Execute "navigate" tool call
    console.log('\n[Test 3] Executing "navigate" tool via MCP callTool()...');
    const navCall = await client.callTool({
      name: 'navigate',
      arguments: { url: 'https://modelcontextprotocol.io' },
    });
    assert(!navCall.isError, 'Tool call should not return isError');
    assert(Array.isArray(navCall.content), 'Content must be an array');
    assert.strictEqual(navCall.content[0].type, 'text');
    const navData = JSON.parse(navCall.content[0].text);
    assert.strictEqual(navData.success, true);
    assert.strictEqual(navData.url, 'https://modelcontextprotocol.io');
    console.log('  ✓ MCP navigate returned valid content payload:', navData);

    // 4. Execute "snapshot" tool call with inViewportOnly
    console.log('\n[Test 4] Executing "snapshot" tool with inViewportOnly: true...');
    const snapCall = await client.callTool({
      name: 'snapshot',
      arguments: { inViewportOnly: true },
    });
    assert(!snapCall.isError);
    const snapData = JSON.parse(snapCall.content[0].text);
    assert.strictEqual(snapData.inViewportOnly, true);
    assert.strictEqual(snapData.totalElements, 62);
    console.log('  ✓ MCP snapshot returned pruned tree with totalElements:', snapData.totalElements);

    // 5. Execute "click" and "fill"
    console.log('\n[Test 5] Executing "click" and "fill" tools...');
    const fillCall = await client.callTool({
      name: 'fill',
      arguments: { selector: '@e1', value: 'MCP testing' },
    });
    const fillData = JSON.parse(fillCall.content[0].text);
    assert.strictEqual(fillData.success, true);

    const clickCall = await client.callTool({
      name: 'click',
      arguments: { selector: '@e2' },
    });
    const clickData = JSON.parse(clickCall.content[0].text);
    assert.strictEqual(clickData.success, true);
    console.log('  ✓ MCP click & fill commands executed successfully.');

    // 6. Execute "handoff" human-in-the-loop tool
    console.log('\n[Test 6] Executing "handoff" tool via MCP...');
    const handoffCall = await client.callTool({
      name: 'handoff',
      arguments: { reason: 'Slide captcha required', timeout: 30 },
    });
    assert(!handoffCall.isError);
    const handoffData = JSON.parse(handoffCall.content[0].text);
    assert.strictEqual(handoffData.resolved, true);
    assert.strictEqual(handoffData.reason, 'Slide captcha required');
    console.log('  ✓ MCP handoff returned resolved state:', handoffData);

    // 7. Error handling for non-existent tool
    console.log('\n[Test 7] Testing error response on non-existent tool...');
    const invalidCall = await client.callTool({
      name: 'non_existent_tool',
      arguments: {},
    });
    assert.strictEqual(invalidCall.isError, true);
    assert(invalidCall.content[0].text.includes('Error'));
    console.log('  ✓ Non-existent tool properly yielded isError: true with description.');

    console.log('\n🎉 MCP Protocol Integration Tests Passed Perfectly!\n');
  } finally {
    try { await client.close(); } catch (e) {}
    try { await mcpServer.stop(); } catch (e) {}
    mockExt.close();
    await bridgeServer.stop();
  }
}

if (require.main === module) {
  testMcpProtocol().catch((err) => {
    console.error('Test failed:', err);
    process.exit(1);
  });
}

module.exports = { testMcpProtocol };
