"""
OpenWebBridge Python SDK
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
    def __init__(self, host: str = "127.0.0.1", port: int = 10087, session: str = "default"):
        self.base_url = f"http://{host}:{port}"
        self.session = session

    def _post(self, action: str, args: Optional[Dict[str, Any]] = None) -> Any:
        url = f"{self.base_url}/command"
        payload = {
            "action": action,
            "args": args or {},
            "session": self.session,
        }
        data = json.dumps(payload).encode("utf-8")
        req = urllib.request.Request(
            url,
            data=data,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urllib.request.urlopen(req) as resp:
                result = json.loads(resp.read().decode("utf-8"))
                if not result.get("ok"):
                    err = result.get("error", {})
                    raise OpenWebBridgeError(err.get("code", "unknown"), err.get("message", "Action failed"))
                return result.get("data")
        except urllib.error.HTTPError as e:
            try:
                err_body = json.loads(e.read().decode("utf-8"))
                err = err_body.get("error", {})
                raise OpenWebBridgeError(err.get("code", str(e.code)), err.get("message", str(e)))
            except Exception:
                raise OpenWebBridgeError(str(e.code), str(e))
        except urllib.error.URLError as e:
            raise OpenWebBridgeError("connection_failed", f"Failed to connect to daemon at {self.base_url}: {e}")

    def status(self) -> Dict[str, Any]:
        """Check status of daemon and extension connection."""
        url = f"{self.base_url}/status"
        try:
            with urllib.request.urlopen(url) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            return {"running": False, "error": str(e)}

    def navigate(self, url: str, new_tab: bool = False, group_title: Optional[str] = None) -> Dict[str, Any]:
        """Open or navigate to a URL."""
        return self._post("navigate", {"url": url, "newTab": new_tab, "group_title": group_title})

    def find_tab(self, url: Optional[str] = None, active: bool = False) -> Dict[str, Any]:
        """Find an existing tab in this session, or borrow user's active tab (active=True)."""
        return self._post("find_tab", {"url": url, "active": active})

    def snapshot(self, interactive_only: bool = False) -> Dict[str, Any]:
        """Get accessibility tree text and @e element reference IDs."""
        return self._post("snapshot", {"interactive": interactive_only})

    def click(self, selector: str) -> Dict[str, Any]:
        """Click an element using CSS selector or @e reference."""
        return self._post("click", {"selector": selector})

    def fill(self, selector: str, value: str) -> Dict[str, Any]:
        """Fill input field or rich text editor."""
        return self._post("fill", {"selector": selector, "value": value})

    def evaluate(self, code: str) -> Any:
        """Execute JavaScript expression in current page."""
        return self._post("evaluate", {"code": code})

    def screenshot(self, path: Optional[str] = None, selector: Optional[str] = None) -> Dict[str, Any]:
        """Capture screenshot and write directly to disk, returning path."""
        args: Dict[str, Any] = {}
        if path:
            args["path"] = path
        if selector:
            args["selector"] = selector
        return self._post("screenshot", args)

    def scroll(self, direction: str = "down", amount: int = 500) -> Dict[str, Any]:
        """Scroll page up or down."""
        return self._post("scroll", {"direction": direction, "amount": amount})

    def list_tabs(self) -> List[Dict[str, Any]]:
        """List tabs in current session."""
        res = self._post("list_tabs")
        return res.get("tabs", [])

    def close_tab(self) -> Dict[str, Any]:
        """Close current tab."""
        return self._post("close_tab")

    def close_session(self) -> Dict[str, Any]:
        """Close all tabs and cleanup tab group for this session."""
        return self._post("close_session")
