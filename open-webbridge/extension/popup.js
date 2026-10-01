document.addEventListener('DOMContentLoaded', async () => {
  const wsUrlInput = document.getElementById('ws-url');
  const saveBtn = document.getElementById('save-btn');
  const statusBadge = document.getElementById('status-badge');
  const statusText = document.getElementById('status-text');
  const sessionCount = document.getElementById('session-count');

  // Load configuration
  const config = await chrome.storage.local.get(['wsUrl']);
  if (config.wsUrl) {
    wsUrlInput.value = config.wsUrl;
  }

  // Query background service worker for status
  chrome.runtime.sendMessage({ type: 'GET_STATUS' }, (response) => {
    if (chrome.runtime.lastError || !response) {
      statusText.textContent = 'Service Worker 未响应';
      return;
    }
    updateUI(response.connected, response.sessionsCount);
  });

  saveBtn.addEventListener('click', async () => {
    const newUrl = wsUrlInput.value.trim();
    await chrome.storage.local.set({ wsUrl: newUrl });
    chrome.runtime.sendMessage({ type: 'RECONNECT', url: newUrl }, (res) => {
      updateUI(res?.connected ?? false, res?.sessionsCount ?? 0);
    });
  });

  function updateUI(connected, sessions = 0) {
    if (connected) {
      statusBadge.classList.add('connected');
      statusText.textContent = '已连接到 Daemon';
      statusText.style.color = '#10b981';
    } else {
      statusBadge.classList.remove('connected');
      statusText.textContent = '未连接';
      statusText.style.color = '#ef4444';
    }
    sessionCount.textContent = sessions;
  }
});
