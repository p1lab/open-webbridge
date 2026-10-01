/**
 * OpenWebBridge - Chrome / Edge Extension Background Service Worker
 * Native Agent-Browser In-Situ Collaboration Engine
 */

const DEFAULT_WS_URL = 'ws://127.0.0.1:10087/ws';
const RECONNECT_INTERVALS = [1000, 2000, 5000, 10000];

class OpenWebBridgeExtension {
  constructor() {
    this.ws = null;
    this.wsUrl = DEFAULT_WS_URL;
    this.reconnectAttempt = 0;
    this.reconnectTimer = null;
    this.connected = false;

    // Sessions: sessionName -> { groupId, tabIds: Set<number>, currentTabId, groupTitle }
    this.sessions = new Map();
    // Tab to session mapping: tabId -> sessionName
    this.tabSessionMap = new Map();
    // Attached debuggers: Set<tabId>
    this.attachedDebuggers = new Set();
    // Accessibility element ref store: tabId -> Map<ref, {backendDOMNodeId, role, name}>
    this.elementRefs = new Map();
    // Network captures: tabId -> { active: boolean, requests: Map<requestId, RequestObj> }
    this.networkCaptures = new Map();

    this.init();
  }

  async init() {
    console.log('[OpenWebBridge] Initializing service worker...');

    // Load saved config
    const data = await chrome.storage.local.get(['wsUrl', 'profileName', 'browserId']);
    if (data.wsUrl) {
      this.wsUrl = data.wsUrl;
    }
    if (data.profileName) {
      this.profileName = data.profileName;
    }
    if (data.browserId) {
      this.browserId = data.browserId;
    }

    // Set keep-alive alarm for Manifest V3
    chrome.alarms.create('owb_keep_alive', { periodInMinutes: 1 });
    chrome.alarms.onAlarm.addListener((alarm) => {
      if (alarm.name === 'owb_keep_alive') {
        this.keepAlive();
      }
    });

    // Listen to tab lifecycle
    chrome.tabs.onRemoved.addListener((tabId) => this.handleTabRemoved(tabId));
    chrome.debugger.onDetach.addListener((source) => {
      if (source.tabId) {
        this.attachedDebuggers.delete(source.tabId);
        this.elementRefs.delete(source.tabId);
        this.networkCaptures.delete(source.tabId);
      }
    });

    chrome.debugger.onEvent.addListener((source, method, params) => {
      this.handleCDPEvent(source, method, params);
    });

    // Listen to popup messages
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg.type === 'GET_STATUS') {
        sendResponse({
          connected: this.connected,
          wsUrl: this.wsUrl,
          sessionsCount: this.sessions.size,
        });
      } else if (msg.type === 'RECONNECT') {
        if (msg.url) this.wsUrl = msg.url;
        this.connect();
        sendResponse({ connected: this.connected, sessionsCount: this.sessions.size });
      }
      return true;
    });

    // Connect to local daemon
    this.connect();
  }

  keepAlive() {
    if (this.ws && this.connected) {
      try {
        this.ws.send(JSON.stringify({ type: 'ping' }));
      } catch (e) {
        console.warn('[OpenWebBridge] Keepalive ping failed:', e);
      }
    } else {
      this.connect();
    }
  }

  connect() {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.ws) {
      try {
        this.ws.close();
      } catch (e) {}
      this.ws = null;
    }

    console.log(`[OpenWebBridge] Connecting to daemon at ${this.wsUrl}...`);
    try {
      this.ws = new WebSocket(this.wsUrl);
    } catch (e) {
      console.error('[OpenWebBridge] WebSocket instantiation error:', e);
      this.scheduleReconnect();
      return;
    }

    this.ws.onopen = () => {
      console.log('[OpenWebBridge] WebSocket connected to daemon.');
      this.connected = true;
      this.reconnectAttempt = 0;

      const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
      const isEdge = ua.includes('Edg/');
      const browserType = isEdge ? 'edge' : 'chrome';
      const profileName = this.profileName || 'Default';
      const browserId = this.browserId || browserType;

      this.ws.send(
        JSON.stringify({
          type: 'hello',
          payload: {
            extensionVersion: chrome.runtime.getManifest().version,
            name: isEdge ? `OpenWebBridge (Edge - ${profileName})` : `OpenWebBridge (Chrome - ${profileName})`,
            browser: browserType,
            browserType,
            profile: profileName,
            profileName,
            browserId,
            userAgent: ua,
          },
        })
      );
    };

    this.ws.onmessage = async (event) => {
      try {
        const msg = JSON.parse(event.data);
        await this.handleDaemonMessage(msg);
      } catch (err) {
        console.error('[OpenWebBridge] Error handling message:', err);
      }
    };

    this.ws.onclose = () => {
      console.warn('[OpenWebBridge] WebSocket disconnected.');
      this.connected = false;
      this.ws = null;
      this.scheduleReconnect();
    };

    this.ws.onerror = (err) => {
      console.error('[OpenWebBridge] WebSocket error:', err);
    };
  }

  scheduleReconnect() {
    if (this.reconnectTimer) return;
    const delay =
      RECONNECT_INTERVALS[
        Math.min(this.reconnectAttempt, RECONNECT_INTERVALS.length - 1)
      ];
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }

  async handleDaemonMessage(msg) {
    if (msg.type === 'ping') {
      this.ws.send(JSON.stringify({ type: 'pong' }));
      return;
    }
    if (msg.type === 'pong' || msg.type === 'hello_ack') {
      return;
    }

    if (msg.type === 'tool_call') {
      const { requestId, payload } = msg;
      if (!payload || !payload.name) {
        this.sendToolResult(requestId, null, 'Invalid tool_call: missing name');
        return;
      }

      try {
        const result = await this.dispatchTool(
          payload.name,
          payload.args || {},
          msg.session
        );
        this.sendToolResult(requestId, result, null);
      } catch (error) {
        console.error(`[OpenWebBridge] Tool ${payload.name} error:`, error);
        this.sendToolResult(
          requestId,
          null,
          error?.message || String(error)
        );
      }
    }
  }

  sendToolResult(requestId, data, error) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const response = {
      type: 'tool_result',
      responseToRequestId: requestId,
      payload: error ? { error } : { data },
    };
    this.ws.send(JSON.stringify(response));
  }

  // --- Session & Tab Group Management ---

  getOrCreateSession(sessionName) {
    const sName = sessionName || 'default';
    let session = this.sessions.get(sName);
    if (!session) {
      session = {
        name: sName,
        groupId: null,
        tabIds: new Set(),
        currentTabId: null,
        groupTitle: sName,
      };
      this.sessions.set(sName, session);
    }
    return session;
  }

  handleTabRemoved(tabId) {
    const sName = this.tabSessionMap.get(tabId);
    if (sName) {
      const session = this.sessions.get(sName);
      if (session) {
        session.tabIds.delete(tabId);
        if (session.currentTabId === tabId) {
          const remaining = Array.from(session.tabIds);
          session.currentTabId = remaining.length > 0 ? remaining[remaining.length - 1] : null;
        }
      }
      this.tabSessionMap.delete(tabId);
    }
    this.attachedDebuggers.delete(tabId);
    this.elementRefs.delete(tabId);
  }

  async ensureDebugger(tabId) {
    if (this.attachedDebuggers.has(tabId)) return;
    try {
      await chrome.debugger.detach({ tabId });
    } catch (e) {}

    await chrome.debugger.attach({ tabId }, '1.3');
    this.attachedDebuggers.add(tabId);

    // Enable basic CDP domains
    await this.sendCDP(tabId, 'Page.enable');
    await this.sendCDP(tabId, 'DOM.enable');
    await this.sendCDP(tabId, 'Accessibility.enable');
    // Enable focus emulation so background tabs take input without stealing window focus!
    try {
      await this.sendCDP(tabId, 'Emulation.setFocusEmulationEnabled', { enabled: true });
    } catch (e) {}
  }

  async sendCDP(tabId, method, params = {}) {
    return new Promise((resolve, reject) => {
      chrome.debugger.sendCommand({ tabId }, method, params, (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(result);
        }
      });
    });
  }

  // --- Tool Dispatcher ---

  async dispatchTool(name, args, sessionName) {
    const session = this.getOrCreateSession(sessionName);
    let tabId = args.tabId || session.currentTabId;

    switch (name) {
      case 'navigate':
        return await this.toolNavigate(args, session);
      case 'find_tab':
        return await this.toolFindTab(args, session);
      case 'list_tabs':
        return await this.toolListTabs(session);
      case 'close_tab':
        return await this.toolCloseTab(args, session);
      case 'close_session':
        return await this.toolCloseSession(session);
      case 'snapshot':
        return await this.toolSnapshot(tabId, args);
      case 'click':
        return await this.toolClick(tabId, args);
      case 'fill':
        return await this.toolFill(tabId, args);
      case 'evaluate':
        return await this.toolEvaluate(tabId, args);
      case 'screenshot':
        return await this.toolScreenshot(tabId, args);
      case 'scroll':
        return await this.toolScroll(tabId, args);
      case 'save_as_pdf':
        return await this.toolSaveAsPdf(tabId, args);
      case 'cdp':
        return await this.toolCDP(tabId, args);
      case 'network':
        return await this.toolNetwork(tabId, args);
      case 'wait':
        return await this.toolWait(tabId, args);
      case 'handoff':
        return await this.toolHandoff(tabId, args);
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
  }

  // --- Tool Implementations ---

  async toolNavigate(args, session) {
    const { url, newTab, group_title } = args;
    if (!url) throw new Error('navigate: url is required');

    let tab;
    const shouldCreateNew = newTab || !session.currentTabId;

    if (shouldCreateNew) {
      tab = await chrome.tabs.create({ url, active: false });
      session.tabIds.add(tab.id);
      this.tabSessionMap.set(tab.id, session.name);
      session.currentTabId = tab.id;

      // Group management
      try {
        if (session.groupId) {
          await chrome.tabs.group({ groupId: session.groupId, tabIds: [tab.id] });
        } else {
          const groupId = await chrome.tabs.group({ tabIds: [tab.id] });
          session.groupId = groupId;
          const title = group_title || session.groupTitle || session.name;
          await chrome.tabGroups.update(groupId, { title, color: 'blue' });
        }
      } catch (err) {
        console.warn('[OpenWebBridge] Tab grouping error:', err);
      }
    } else {
      tab = await chrome.tabs.update(session.currentTabId, { url });
    }

    // Wait for navigation / page load
    await new Promise((resolve) => {
      const listener = (tid, info) => {
        if (tid === tab.id && info.status === 'complete') {
          chrome.tabs.onUpdated.removeListener(listener);
          resolve();
        }
      };
      chrome.tabs.onUpdated.addListener(listener);
      // Timeout fallback 15s
      setTimeout(() => {
        chrome.tabs.onUpdated.removeListener(listener);
        resolve();
      }, 15000);
    });

    await this.ensureDebugger(tab.id);
    return { success: true, url: tab.url || url, tabId: tab.id };
  }

  async toolFindTab(args, session) {
    const { url, active } = args;

    if (active) {
      // Borrow user's active tab
      const [currentActive] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      if (!currentActive) throw new Error('find_tab: no active tab found to borrow');

      session.currentTabId = currentActive.id;
      session.tabIds.add(currentActive.id);
      this.tabSessionMap.set(currentActive.id, session.name);
      await this.ensureDebugger(currentActive.id);

      return {
        success: true,
        url: currentActive.url,
        tabId: currentActive.id,
        borrowed: true,
      };
    }

    if (!url) throw new Error('find_tab: url or active:true is required');
    const targetHost = new URL(url).host.toLowerCase();

    for (const tid of session.tabIds) {
      try {
        const tab = await chrome.tabs.get(tid);
        if (tab.url) {
          const tabHost = new URL(tab.url).host.toLowerCase();
          if (tabHost === targetHost || tab.url.includes(url)) {
            session.currentTabId = tid;
            await this.ensureDebugger(tid);
            return { success: true, url: tab.url, tabId: tid, borrowed: false };
          }
        }
      } catch (e) {}
    }

    throw new Error(`find_tab: no tab matching "${url}" in this session`);
  }

  async toolListTabs(session) {
    const tabsList = [];
    for (const tid of session.tabIds) {
      try {
        const tab = await chrome.tabs.get(tid);
        tabsList.push({
          tabId: tab.id,
          url: tab.url,
          title: tab.title,
          active: tab.active,
          current: tab.id === session.currentTabId,
        });
      } catch (e) {}
    }
    return { success: true, tabs: tabsList };
  }

  async toolCloseTab(args, session) {
    const targetTabId = args.tabId || session.currentTabId;
    if (!targetTabId) return { success: true, closed: false };

    try {
      await chrome.tabs.remove(targetTabId);
      return { success: true, closed: true, tabId: targetTabId };
    } catch (e) {
      return { success: false, error: e.message };
    }
  }

  async toolCloseSession(session) {
    let closedCount = 0;
    const ids = Array.from(session.tabIds);
    for (const tid of ids) {
      try {
        await chrome.tabs.remove(tid);
        closedCount++;
      } catch (e) {}
    }
    session.tabIds.clear();
    session.currentTabId = null;
    session.groupId = null;
    this.sessions.delete(session.name);
    return { success: true, closed: closedCount };
  }

  // --- Accessibility Tree & Ref Indexing (Snapshot) ---

  async toolSnapshot(tabId, args = {}) {
    if (!tabId) throw new Error('snapshot: no active tab selected');
    await this.ensureDebugger(tabId);

    const tab = await chrome.tabs.get(tabId);
    const axData = await this.sendCDP(tabId, 'Accessibility.getFullAXTree');
    const nodes = axData.nodes || [];

    const inViewportOnly = Boolean(args.inViewportOnly || args.in_viewport_only);
    const interactiveOnly = Boolean(args.interactiveOnly || args.interactive);
    const selector = args.selector;

    // 1. Container scope filter: if selector is provided, collect DOM backendNodeIds within target container
    let scopedBackendNodeIds = null;
    if (selector) {
      try {
        const { objectId } = await this.resolveTarget(tabId, selector);
        const domTree = await this.sendCDP(tabId, 'DOM.describeNode', { objectId, depth: -1 });
        if (domTree?.node) {
          scopedBackendNodeIds = new Set();
          const collectIds = (n) => {
            if (n.backendNodeId) scopedBackendNodeIds.add(n.backendNodeId);
            if (n.children && Array.isArray(n.children)) {
              for (const c of n.children) collectIds(c);
            }
            if (n.shadowRoots && Array.isArray(n.shadowRoots)) {
              for (const s of n.shadowRoots) collectIds(s);
            }
            if (n.contentDocument) {
              collectIds(n.contentDocument);
            }
          };
          collectIds(domTree.node);
        }
      } catch (err) {
        throw new Error(`snapshot: container element not found or invalid for selector "${selector}": ${err.message}`);
      }
    }

    // 2. Viewport metrics and visibility check if inViewportOnly is requested
    let visibleBackendNodeIds = null;
    if (inViewportOnly) {
      let vw = 1920, vh = 1080;
      let scrollX = 0, scrollY = 0;
      try {
        const metrics = await this.sendCDP(tabId, 'Page.getLayoutMetrics');
        vw = metrics.visualViewport?.clientWidth || metrics.layoutViewport?.clientWidth || 1920;
        vh = metrics.visualViewport?.clientHeight || metrics.layoutViewport?.clientHeight || 1080;
        scrollX = metrics.visualViewport?.pageX ?? metrics.layoutViewport?.pageX ?? 0;
        scrollY = metrics.visualViewport?.pageY ?? metrics.layoutViewport?.pageY ?? 0;
      } catch (e) {
        try {
          const win = await this.sendCDP(tabId, 'Runtime.evaluate', {
            expression: '({ w: window.innerWidth, h: window.innerHeight, sx: window.scrollX || 0, sy: window.scrollY || 0 })',
            returnByValue: true,
          });
          if (win.result?.value) {
            vw = win.result.value.w || 1920;
            vh = win.result.value.h || 1080;
            scrollX = win.result.value.sx || 0;
            scrollY = win.result.value.sy || 0;
          }
        } catch (err) {}
      }

      const isInsideViewport = (border, sx, sy, viewportWidth, viewportHeight) => {
        // Support backwards-compatible 3-argument call: isInsideViewport(border, vw, vh)
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

      const candidateBackendIdsSet = new Set();
      for (const node of nodes) {
        if (!node.ignored && node.backendDOMNodeId) {
          if (!scopedBackendNodeIds || scopedBackendNodeIds.has(node.backendDOMNodeId)) {
            candidateBackendIdsSet.add(node.backendDOMNodeId);
          }
        }
      }
      const candidateBackendIds = Array.from(candidateBackendIdsSet);

      visibleBackendNodeIds = new Set();
      const chunkSize = 25;
      for (let i = 0; i < candidateBackendIds.length; i += chunkSize) {
        const chunk = candidateBackendIds.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map(async (backendId) => {
            try {
              const boxRes = await this.sendCDP(tabId, 'DOM.getBoxModel', { backendNodeId: backendId });
              const border = boxRes?.model?.border;
              if (border && border.length >= 8 && isInsideViewport(border, scrollX, scrollY, vw, vh)) {
                visibleBackendNodeIds.add(backendId);
              }
            } catch (e) {}
          })
        );
      }
    }

    const refMap = new Map();
    let refCounter = 1;

    // Filter and format semantic tree
    const interactiveRoles = new Set([
      'button', 'link', 'textbox', 'searchbox', 'combobox', 'checkbox',
      'radio', 'menuitem', 'tab', 'switch', 'slider', 'contenteditable'
    ]);

    const formattedLines = [];

    for (const node of nodes) {
      if (node.ignored) continue;

      // Container scope filter
      if (scopedBackendNodeIds && (!node.backendDOMNodeId || !scopedBackendNodeIds.has(node.backendDOMNodeId))) {
        continue;
      }

      // Viewport pruning filter
      if (inViewportOnly && (!node.backendDOMNodeId || !visibleBackendNodeIds.has(node.backendDOMNodeId))) {
        continue;
      }

      const role = node.role?.value || '';
      const name = node.name?.value || '';
      const value = node.value?.value || '';
      const description = node.description?.value || '';

      const isInteractive = interactiveRoles.has(role.toLowerCase()) || Boolean(node.backendDOMNodeId);

      if (interactiveOnly && !isInteractive) continue;
      if (!name && !value && !isInteractive) continue;

      let refTag = '';
      if (isInteractive && node.backendDOMNodeId) {
        const refId = `@e${refCounter++}`;
        refMap.set(refId, {
          backendDOMNodeId: node.backendDOMNodeId,
          role,
          name,
        });
        refTag = `[${refId}] `;
      }

      let line = `${refTag}${role ? `<${role}>` : ''}`;
      if (name) line += ` "${name.trim().slice(0, 80)}"`;
      if (value) line += ` value="${String(value).trim().slice(0, 50)}"`;
      if (description) line += ` desc="${description.trim().slice(0, 50)}"`;

      if (line.trim().length > 0) {
        formattedLines.push(line);
      }
    }

    this.elementRefs.set(tabId, refMap);

    return {
      url: tab.url,
      title: tab.title,
      tree: formattedLines.join('\n'),
      totalElements: refMap.size,
      inViewportOnly,
      scoped: Boolean(selector),
    };
  }

  // --- Interaction Tools: Click, Fill, Evaluate, Screenshot ---

  async resolveTarget(tabId, selector) {
    if (selector.startsWith('@e')) {
      const refs = this.elementRefs.get(tabId);
      const refData = refs?.get(selector);
      if (!refData) throw new Error(`Unknown ref "${selector}". Run snapshot first.`);
      const { object } = await this.sendCDP(tabId, 'DOM.resolveNode', {
        backendNodeId: refData.backendDOMNodeId,
      });
      if (!object?.objectId) throw new Error(`Could not resolve ref "${selector}" to DOM node`);
      return { objectId: object.objectId, ref: selector };
    } else {
      // CSS selector
      const evalRes = await this.sendCDP(tabId, 'Runtime.evaluate', {
        expression: `document.querySelector(${JSON.stringify(selector)})`,
      });
      if (!evalRes.result?.objectId) throw new Error(`Element not found: ${selector}`);
      return { objectId: evalRes.result.objectId, ref: null };
    }
  }

  async toolClick(tabId, args) {
    const { selector } = args;
    if (!selector) throw new Error('click: selector is required');
    await this.ensureDebugger(tabId);

    const { objectId } = await this.resolveTarget(tabId, selector);

    // Scroll into view & click
    const clickCode = `function() {
      this.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      this.focus();
      this.click();
      return {
        tag: this.tagName,
        text: (this.textContent || '').trim().slice(0, 50)
      };
    }`;

    const res = await this.sendCDP(tabId, 'Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: clickCode,
      returnByValue: true,
    });

    const info = res.result?.value || {};
    return { success: true, tag: info.tag || '', text: info.text || '' };
  }

  async toolFill(tabId, args) {
    const { selector, value } = args;
    if (!selector) throw new Error('fill: selector is required');
    if (value === undefined || value === null) throw new Error('fill: value is required');
    await this.ensureDebugger(tabId);

    const { objectId } = await this.resolveTarget(tabId, selector);

    // Robust fill supporting both native input/textarea AND contenteditable rich editors
    const fillFunction = `function(val) {
      this.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      this.focus();

      // 1. ContentEditable Rich Text Editors (TipTap, Lexical, ProseMirror, Slate)
      if (this.isContentEditable) {
        const sel = window.getSelection();
        if (sel) {
          const range = document.createRange();
          range.selectNodeContents(this);
          sel.removeAllRanges();
          sel.addRange(range);
        }
        let inserted = false;
        try {
          inserted = document.execCommand('insertText', false, val);
        } catch (e) {
          inserted = false;
        }
        if (!inserted) {
          this.textContent = val;
          this.dispatchEvent(new InputEvent('input', { inputType: 'insertText', data: val, bubbles: true }));
        }
        return { success: true, tag: this.tagName, mode: 'contenteditable' };
      }

      // 2. Native Inputs & Textareas (Prototype brand checking)
      const isInput = typeof HTMLInputElement !== 'undefined' && this instanceof HTMLInputElement;
      const isTextArea = typeof HTMLTextAreaElement !== 'undefined' && this instanceof HTMLTextAreaElement;

      if (isInput || isTextArea) {
        const proto = isInput ? window.HTMLInputElement.prototype : window.HTMLTextAreaElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
        if (nativeSetter) {
          nativeSetter.call(this, val);
        } else {
          this.value = val;
        }
        this.dispatchEvent(new Event('input', { bubbles: true }));
        this.dispatchEvent(new Event('change', { bubbles: true }));
        return { success: true, tag: this.tagName, mode: 'value' };
      }

      return { error: 'Target is neither contenteditable nor native input/textarea' };
    }`;

    const res = await this.sendCDP(tabId, 'Runtime.callFunctionOn', {
      objectId,
      functionDeclaration: fillFunction,
      arguments: [{ value }],
      returnByValue: true,
    });

    const val = res.result?.value;
    if (val?.error) throw new Error(`fill failed: ${val.error}`);
    return val || { success: true };
  }

  async toolEvaluate(tabId, args) {
    const { code } = args;
    if (!code) throw new Error('evaluate: code is required');
    await this.ensureDebugger(tabId);

    const res = await this.sendCDP(tabId, 'Runtime.evaluate', {
      expression: code,
      returnByValue: true,
      awaitPromise: true,
    });

    if (res.exceptionDetails) {
      throw new Error(`evaluate error: ${res.exceptionDetails.text || res.exceptionDetails.exception?.description}`);
    }
    return { type: res.result?.type, value: res.result?.value };
  }

  async toolScreenshot(tabId, args) {
    await this.ensureDebugger(tabId);
    const format = args.format === 'jpeg' ? 'jpeg' : 'png';
    const params = { format };
    if (format === 'jpeg' && args.quality) {
      params.quality = Math.max(1, Math.min(100, args.quality));
    }

    if (args.selector) {
      const { objectId } = await this.resolveTarget(tabId, args.selector);
      const boxRes = await this.sendCDP(tabId, 'DOM.getBoxModel', { objectId });
      const border = boxRes.model?.border;
      if (border && border.length >= 8) {
        const xs = [border[0], border[2], border[4], border[6]];
        const ys = [border[1], border[3], border[5], border[7]];
        const minX = Math.min(...xs), minY = Math.min(...ys);
        const width = Math.max(...xs) - minX, height = Math.max(...ys) - minY;
        if (width > 0 && height > 0) {
          params.clip = { x: minX, y: minY, width, height, scale: 1 };
        }
      }
    }

    const snap = await this.sendCDP(tabId, 'Page.captureScreenshot', params);
    // Returns base64 payload to daemon; daemon will write to disk and return path
    return {
      format,
      mimeType: format === 'jpeg' ? 'image/jpeg' : 'image/png',
      data: snap.data,
      path: args.path,
    };
  }

  async toolScroll(tabId, args) {
    const { direction, amount } = args;
    const delta = (amount || 500) * (direction === 'up' ? -1 : 1);
    await this.ensureDebugger(tabId);

    await this.sendCDP(tabId, 'Runtime.evaluate', {
      expression: `window.scrollBy({ top: ${delta}, left: 0, behavior: 'instant' })`,
    });
    return { success: true, scrolled: delta };
  }

  async toolSaveAsPdf(tabId, args) {
    await this.ensureDebugger(tabId);
    const params = {
      landscape: args.landscape || false,
      printBackground: args.print_background !== false,
      scale: args.scale || 1.0,
    };
    const pdfData = await this.sendCDP(tabId, 'Page.printToPDF', params);
    return {
      format: 'pdf',
      mimeType: 'application/pdf',
      data: pdfData.data,
      path: args.path,
    };
  }

  async toolCDP(tabId, args) {
    const { method, params } = args;
    if (!method) throw new Error('cdp: method is required');
    await this.ensureDebugger(tabId);
    return await this.sendCDP(tabId, method, params || {});
  }

  async toolWait(tabId, args) {
    const { selector, text, timeout = 10000 } = args;
    await this.ensureDebugger(tabId);
    const start = Date.now();

    while (Date.now() - start < timeout) {
      if (selector) {
        const res = await this.sendCDP(tabId, 'Runtime.evaluate', {
          expression: `Boolean(document.querySelector(${JSON.stringify(selector)}))`,
          returnByValue: true,
        });
        if (res.result?.value) return { success: true, found: selector };
      } else if (text) {
        const res = await this.sendCDP(tabId, 'Runtime.evaluate', {
          expression: `document.body && document.body.innerText.includes(${JSON.stringify(text)})`,
          returnByValue: true,
        });
        if (res.result?.value) return { success: true, found: text };
      }
      await new Promise((r) => setTimeout(r, 400));
    }

    throw new Error(`wait timed out after ${timeout}ms`);
  }

  async toolHandoff(tabId, args = {}) {
    if (!tabId) throw new Error('handoff: no active tab selected');
    await this.ensureDebugger(tabId);
    const { reason = 'captcha', timeout = 120, selector } = args;
    const timeoutMs = timeout * 1000;
    const startTime = Date.now();

    // 1. Inject visual banner and optional chime into page
    const safeReason = JSON.stringify(String(reason));
    const injectCode = `(() => {
      const existing = document.getElementById('owb-handoff-banner');
      if (existing) existing.remove();

      const banner = document.createElement('div');
      banner.id = 'owb-handoff-banner';
      banner.style.cssText = [
        'position: fixed',
        'top: 12px',
        'left: 50%',
        'transform: translateX(-50%)',
        'z-index: 2147483647',
        'background: rgba(15, 23, 42, 0.95)',
        'color: #ffffff',
        'padding: 12px 24px',
        'border-radius: 12px',
        'box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 0 0 2px #3b82f6',
        'font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
        'font-size: 14px',
        'display: flex',
        'align-items: center',
        'gap: 16px',
        'backdrop-filter: blur(8px)',
        'pointer-events: auto'
      ].join(';');

      const msg = document.createElement('div');
      const strong = document.createElement('strong');
      strong.textContent = '🛡️ [OpenWebBridge 接管中] ';
      const textSpan = document.createElement('span');
      textSpan.textContent = '遇到：' + ${safeReason} + '。请在浏览器中手动完成操作。';
      msg.appendChild(strong);
      msg.appendChild(textSpan);

      const btn = document.createElement('button');
      btn.textContent = '已完成，恢复执行';
      btn.style.cssText = [
        'background: #2563eb',
        'color: white',
        'border: none',
        'border-radius: 6px',
        'padding: 6px 14px',
        'font-size: 13px',
        'font-weight: 600',
        'cursor: pointer',
        'transition: background 0.2s'
      ].join(';');
      btn.onclick = () => {
        window.__owb_handoff_resolved = true;
        banner.remove();
      };

      banner.appendChild(msg);
      banner.appendChild(btn);
      document.body.appendChild(banner);

      window.__owb_handoff_resolved = false;

      // Attempt gentle audio chime
      try {
        const AudioCtx = window.AudioContext || window.webkitAudioContext;
        if (AudioCtx) {
          const ctx = new AudioCtx();
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.setValueAtTime(587.33, ctx.currentTime);
          osc.frequency.setValueAtTime(880, ctx.currentTime + 0.15);
          gain.gain.setValueAtTime(0.15, ctx.currentTime);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.4);
          osc.start();
          osc.stop(ctx.currentTime + 0.4);
        }
      } catch (e) {}
    })()`;

    try {
      await this.sendCDP(tabId, 'Runtime.evaluate', { expression: injectCode });
    } catch (e) {
      console.warn('[OpenWebBridge] Banner injection failed:', e.message);
    }

    const initialTab = await chrome.tabs.get(tabId).catch(() => null);
    const initialUrl = initialTab?.url || '';

    // 2. Poll until resolved, URL changed, selector disappeared/hidden, or timeout
    let resolved = false;
    let resolveMethod = null;
    let selectorSeen = false;

    while (Date.now() - startTime < timeoutMs) {
      const currentTab = await chrome.tabs.get(tabId).catch(() => null);
      if (!currentTab) {
        throw new Error('handoff: target tab was closed during handoff');
      }

      // Check if manual resolve button was clicked
      try {
        const checkRes = await this.sendCDP(tabId, 'Runtime.evaluate', {
          expression: 'Boolean(window.__owb_handoff_resolved)',
          returnByValue: true,
        });
        if (checkRes.result?.value) {
          resolved = true;
          resolveMethod = 'manual_button';
          break;
        }
      } catch (e) {}

      // Check if URL changed
      if (currentTab.url && currentTab.url !== initialUrl) {
        resolved = true;
        resolveMethod = 'url_changed';
        break;
      }

      // If specific selector was given (e.g. slider container), check if it was seen and then disappeared/hidden
      if (selector) {
        try {
          const checkSel = await this.sendCDP(tabId, 'Runtime.evaluate', {
            expression: `(() => {
              const el = document.querySelector(${JSON.stringify(selector)});
              if (!el) return false;
              const style = window.getComputedStyle(el);
              if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
              const rect = el.getBoundingClientRect();
              if (rect.width === 0 && rect.height === 0) return false;
              return true;
            })()`,
            returnByValue: true,
          });
          const isPresent = Boolean(checkSel.result?.value);
          if (isPresent) {
            selectorSeen = true;
          } else if (selectorSeen) {
            resolved = true;
            resolveMethod = 'selector_disappeared';
            break;
          }
        } catch (e) {}
      }

      await new Promise((r) => setTimeout(r, 600));
    }

    // Cleanup banner if still present
    try {
      await this.sendCDP(tabId, 'Runtime.evaluate', {
        expression: `(() => {
          const el = document.getElementById('owb-handoff-banner');
          if (el) el.remove();
        })()`,
      });
    } catch (e) {}

    if (!resolved) {
      throw new Error(`handoff: timed out after ${timeout} seconds waiting for human intervention`);
    }

    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    const isEdge = ua.includes('Edg/');
    const browserType = isEdge ? 'edge' : 'chrome';
    const browserId = this.browserId || browserType;

    // Send handoff_resolved event to daemon
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(
        JSON.stringify({
          type: 'handoff_resolved',
          payload: {
            tabId,
            reason,
            resolveMethod,
            resolved: true,
            browser: browserId,
            browserId,
            browserType,
          },
        })
      );
    }

    return {
      success: true,
      resolved: true,
      reason,
      resolveMethod,
      tabId,
      browser: browserId,
    };
  }

  handleCDPEvent(source, method, params) {
    const tabId = source.tabId;
    if (!tabId || !this.networkCaptures.has(tabId)) return;
    const cap = this.networkCaptures.get(tabId);
    if (!cap.active) return;

    if (method === 'Network.requestWillBeSent') {
      cap.requests.set(params.requestId, {
        requestId: params.requestId,
        url: params.request?.url || '',
        method: params.request?.method || 'GET',
        status: 0,
        mimeType: '',
        completed: false,
        postData: params.request?.postData,
      });
    } else if (method === 'Network.responseReceived') {
      const req = cap.requests.get(params.requestId);
      if (req) {
        req.status = params.response?.status || 0;
        req.mimeType = params.response?.mimeType || '';
      }
    } else if (method === 'Network.loadingFinished') {
      const req = cap.requests.get(params.requestId);
      if (req) {
        req.completed = true;
      }
    }
  }

  async toolNetwork(tabId, args) {
    if (!tabId) throw new Error('network: no active tab selected');
    await this.ensureDebugger(tabId);
    const cmd = args.cmd;
    if (!cmd) throw new Error('network: cmd is required (start/stop/list/detail)');

    let cap = this.networkCaptures.get(tabId);
    if (!cap) {
      cap = { active: false, requests: new Map() };
      this.networkCaptures.set(tabId, cap);
    }

    switch (cmd) {
      case 'start': {
        await this.sendCDP(tabId, 'Network.enable');
        cap.active = true;
        cap.requests.clear();
        return { success: true, message: 'network capture started' };
      }
      case 'stop': {
        cap.active = false;
        try {
          await this.sendCDP(tabId, 'Network.disable');
        } catch (e) {}
        return { success: true, message: 'network capture stopped' };
      }
      case 'list': {
        let list = Array.from(cap.requests.values());
        if (args.filter) {
          list = list.filter((r) => r.url.includes(args.filter));
        }
        return { count: list.length, requests: list };
      }
      case 'detail': {
        const reqId = args.requestId;
        if (!reqId) throw new Error('network: requestId is required for detail');
        const req = cap.requests.get(reqId);
        if (!req) throw new Error(`network: request "${reqId}" not found`);
        let bodyData = null;
        let base64 = false;
        try {
          const bodyRes = await this.sendCDP(tabId, 'Network.getResponseBody', { requestId: reqId });
          bodyData = bodyRes.body;
          base64 = Boolean(bodyRes.base64Encoded);
        } catch (e) {
          bodyData = null;
        }
        return {
          requestId: req.requestId,
          url: req.url,
          method: req.method,
          status: req.status,
          mimeType: req.mimeType,
          completed: req.completed,
          body: bodyData,
          base64Encoded: base64,
        };
      }
      default:
        throw new Error(`network: unknown cmd "${cmd}"`);
    }
  }
}

// Instantiate Service Worker
const bridge = new OpenWebBridgeExtension();
