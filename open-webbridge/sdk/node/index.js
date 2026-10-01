/**
 * OpenWebBridge Node.js SDK v2.0
 */

class OpenWebBridge {
  constructor(options = {}) {
    this.host = options.host || '127.0.0.1';
    this.port = options.port || 10087;
    this.session = options.session || 'default';
    this.browser = options.browser || null;
    this.baseUrl = `http://${this.host}:${this.port}`;
  }

  async command(action, args = {}, options = {}) {
    const url = `${this.baseUrl}/command`;
    const targetBrowser = options.browser || this.browser;
    const payload = {
      action,
      args,
      session: options.session || this.session,
    };
    if (targetBrowser) {
      payload.browser = targetBrowser;
    }

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const body = await res.json();
    if (!body.ok) {
      const err = body.error || {};
      throw new Error(`[${err.code || 'error'}] ${err.message || 'Command failed'}`);
    }
    return body.data;
  }

  async status() {
    const res = await fetch(`${this.baseUrl}/status`);
    return await res.json();
  }

  async navigate(url, options = {}) {
    return await this.command(
      'navigate',
      {
        url,
        newTab: options.newTab,
        group_title: options.groupTitle || options.group_title,
      },
      options
    );
  }

  async findTab(options = {}) {
    return await this.command('find_tab', options, options);
  }

  async snapshot(options = {}) {
    let opts = {};
    if (typeof options === 'boolean') {
      opts = { interactiveOnly: options };
    } else {
      opts = options || {};
    }

    return await this.command(
      'snapshot',
      {
        interactive: Boolean(opts.interactiveOnly || opts.interactive),
        interactiveOnly: Boolean(opts.interactiveOnly || opts.interactive),
        inViewportOnly: Boolean(opts.inViewportOnly || opts.in_viewport_only),
        selector: opts.selector || null,
      },
      opts
    );
  }

  async click(selector, options = {}) {
    return await this.command('click', { selector }, options);
  }

  async fill(selector, value, options = {}) {
    return await this.command('fill', { selector, value }, options);
  }

  async evaluate(code, options = {}) {
    return await this.command('evaluate', { code }, options);
  }

  async screenshot(options = {}) {
    return await this.command('screenshot', options, options);
  }

  async scroll(options = {}) {
    return await this.command(
      'scroll',
      {
        direction: options.direction || 'down',
        amount: options.amount || 500,
      },
      options
    );
  }

  async listTabs(options = {}) {
    const res = await this.command('list_tabs', {}, options);
    return res.tabs || [];
  }

  async closeTab(tabId, options = {}) {
    return await this.command('close_tab', { tabId }, options);
  }

  async closeSession(options = {}) {
    return await this.command('close_session', {}, options);
  }

  async handoff(options = {}) {
    let opts = {};
    if (typeof options === 'string') {
      opts = { reason: options };
    } else {
      opts = options || {};
    }

    return await this.command(
      'handoff',
      {
        reason: opts.reason || 'captcha',
        timeout: opts.timeout || 120,
        selector: opts.selector || null,
      },
      opts
    );
  }

  async cdp(method, params = {}, options = {}) {
    return await this.command('cdp', { method, params }, options);
  }
}

module.exports = { OpenWebBridge };
