const { spawn } = require('child_process');
const path = require('path');
const { OpenWebBridgeServer } = require('../daemon/src/server');
const { MockExtension } = require('./mock-extension');

async function main() {
  const TEST_PORT = 10099;
  const server = new OpenWebBridgeServer({ port: TEST_PORT });
  await server.start();

  const mockExt = new MockExtension(`ws://127.0.0.1:${TEST_PORT}/ws`);
  await mockExt.connect();
  await new Promise(r => setTimeout(r, 200));

  console.log('[Runner] Daemon and Mock Extension online.');

  // Run Python test
  await new Promise((resolve, reject) => {
    console.log('[Runner] Running Python SDK test...');
    const py = spawn('python', [path.join(__dirname, 'sdk.test.py')], { stdio: 'inherit' });
    py.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`Python test failed with code ${code}`));
    });
  });

  // Run XHS Bridge Compatibility test
  await new Promise((resolve, reject) => {
    console.log('\n[Runner] Running xhs_bridge_compat.test.py (XHS Skill Compatibility)...');
    const pyXhs = spawn('python', [path.join(__dirname, 'xhs_bridge_compat.test.py')], { stdio: 'inherit' });
    pyXhs.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`XHS Bridge compatibility test failed with code ${code}`));
    });
  });

  mockExt.close();
  await server.stop();
  console.log('[Runner] All integration tests passed cleanly!');
}

main().catch(err => {
  console.error('[Runner] Error:', err);
  process.exit(1);
});
