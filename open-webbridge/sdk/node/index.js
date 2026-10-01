/**
 * OpenWebBridge Node.js SDK
 */

class OpenWebBridge {
  constructor(options = {}) {
    this.host = options.host || '127.0.0.1';
    this.port = options.port || 10087;
    this.session = options.session || 'default';
    this.baseUrl = `http://${this.host}:${this.port}`;
  }

  async command(action, args = {}) {
    const url = `${this.baseUrl}/command`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action,
        args,
        session: this.session,
      }),
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
    return await this.command('navigate', {
      url,
      newTab: options.newTab,
      group_title: options.groupTitle,
    });
  }

  async findTab(options = {}) {
    return await this.command('find_tab', options);
  }

  async snapshot(interactiveOnly = false) {
    return await this.command('snapshot', { interactive: interactiveOnly });
  }

  async click(selector) {
    return await this.command('click', { selector });
  }

  async fill(selector, value) {
    return await this.command('fill', { selector, value });
  }

  async evaluate(code) {
    return await this.command('evaluate', { code });
  }

  async screenshot(options = {}) {
    return await this.command('screenshot', options);
  }

  async listTabs() {
    const res = await this.command('list_tabs');
    return res.tabs || [];
  }

  async closeTab() {
    return await this.command('close_tab');
  }

  async closeSession() {
    return await this.command('close_session');
  }
}

module.exports = { OpenWebBridge };
