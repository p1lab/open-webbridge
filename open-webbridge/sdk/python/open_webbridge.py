"""
OpenWebBridge Python SDK v2.0
Client library for interacting with OpenWebBridge Daemon
"""

import json
import urllib.request
import urllib.error
from typing import Any, Dict, Optional, List


class OpenWebBridgeError(Exception):
    def __init__(self, code: str, message: str):
        self.code = code
        self.message = message
        super().__init__(f"[{code}] {message}")


class OpenWebBridge:
    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 10087,
        session: str = "default",
        browser: Optional[str] = None,
    ):
        self.base_url = f"http://{host}:{port}"
        self.session = session
        self.browser = browser

    def _post(
        self,
        action: str,
        args: Optional[Dict[str, Any]] = None,
        browser: Optional[str] = None,
    ) -> Any:
        url = f"{self.base_url}/command"
        target_browser = browser or self.browser
        payload: Dict[str, Any] = {
            "action": action,
            "args": args or {},
            "session": self.session,
        }
        if target_browser:
            payload["browser"] = target_browser

        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        timeout_val = 60
        if args and "timeout" in args:
            try:
                timeout_val = max(60, int(args["timeout"]) + 15)
            except (ValueError, TypeError):
                pass

        try:
            with urllib.request.urlopen(req, timeout=timeout_val) as resp:
                result = json.loads(resp.read().decode("utf-8"))
                if not result.get("ok"):
                    err = result.get("error", {})
                    raise OpenWebBridgeError(
                        err.get("code", "unknown"),
                        err.get("message", "Action failed"),
                    )
                return result.get("data")
        except urllib.error.HTTPError as e:
            try:
                err_body = json.loads(e.read().decode("utf-8"))
                err = err_body.get("error", {})
                raise OpenWebBridgeError(
                    err.get("code", str(e.code)),
                    err.get("message", str(e)),
                )
            except Exception:
                raise OpenWebBridgeError(str(e.code), str(e))
        except urllib.error.URLError as e:
            raise OpenWebBridgeError(
                "connection_failed",
                f"Failed to connect to daemon at {self.base_url}: {e}",
            )

    def status(self) -> Dict[str, Any]:
        """Check status of daemon and extension connection."""
        url = f"{self.base_url}/status"
        try:
            with urllib.request.urlopen(url) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            return {"running": False, "error": str(e)}

    def navigate(
        self,
        url: str,
        new_tab: bool = False,
        group_title: Optional[str] = None,
        browser: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Open or navigate to a URL."""
        return self._post(
            "navigate",
            {"url": url, "newTab": new_tab, "group_title": group_title},
            browser=browser,
        )

    def find_tab(
        self,
        url: Optional[str] = None,
        active: bool = False,
        browser: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Find an existing tab in this session, or borrow user's active tab (active=True)."""
        return self._post("find_tab", {"url": url, "active": active}, browser=browser)

    def snapshot(
        self,
        interactive_only: bool = False,
        in_viewport_only: bool = False,
        selector: Optional[str] = None,
        browser: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get accessibility tree text and @e element reference IDs with optional viewport pruning and selector scope."""
        args: Dict[str, Any] = {
            "interactive": interactive_only,
            "interactiveOnly": interactive_only,
            "inViewportOnly": in_viewport_only,
        }
        if selector:
            args["selector"] = selector
        return self._post("snapshot", args, browser=browser)

    def click(self, selector: str, browser: Optional[str] = None) -> Dict[str, Any]:
        """Click an element using CSS selector or @e reference."""
        return self._post("click", {"selector": selector}, browser=browser)

    def fill(
        self,
        selector: str,
        value: str,
        browser: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Fill input field or rich text editor."""
        return self._post("fill", {"selector": selector, "value": value}, browser=browser)

    def evaluate(self, code: str, browser: Optional[str] = None) -> Any:
        """Execute JavaScript expression in current page."""
        return self._post("evaluate", {"code": code}, browser=browser)

    def screenshot(
        self,
        path: Optional[str] = None,
        selector: Optional[str] = None,
        format: Optional[str] = None,
        browser: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Capture screenshot and write directly to disk, returning path."""
        args: Dict[str, Any] = {}
        if path:
            args["path"] = path
        if selector:
            args["selector"] = selector
        if format:
            args["format"] = format
        return self._post("screenshot", args, browser=browser)

    def scroll(
        self,
        direction: str = "down",
        amount: int = 500,
        browser: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Scroll page up or down."""
        return self._post("scroll", {"direction": direction, "amount": amount}, browser=browser)

    def list_tabs(self, browser: Optional[str] = None) -> List[Dict[str, Any]]:
        """List tabs in current session."""
        res = self._post("list_tabs", browser=browser)
        return res.get("tabs", [])

    def close_tab(
        self,
        tab_id: Optional[int] = None,
        browser: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Close current tab or specified tab_id."""
        args: Dict[str, Any] = {}
        if tab_id is not None:
            args["tabId"] = tab_id
        return self._post("close_tab", args, browser=browser)

    def close_session(self, browser: Optional[str] = None) -> Dict[str, Any]:
        """Close all tabs and cleanup tab group for this session."""
        return self._post("close_session", browser=browser)

    def handoff(
        self,
        reason: str = "captcha",
        timeout: int = 120,
        selector: Optional[str] = None,
        browser: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Human-in-the-loop breakpoint. Pauses automation with banner until human resolves verification."""
        args: Dict[str, Any] = {
            "reason": reason,
            "timeout": timeout,
        }
        if selector:
            args["selector"] = selector
        return self._post("handoff", args, browser=browser)

    def cdp(
        self,
        method: str,
        params: Optional[Dict[str, Any]] = None,
        browser: Optional[str] = None,
    ) -> Any:
        """Execute raw Chrome DevTools Protocol (CDP) method."""
        return self._post("cdp", {"method": method, "params": params or {}}, browser=browser)

