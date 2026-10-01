import sys
import os
import time

# Add sdk/python to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'sdk', 'python'))
from open_webbridge import OpenWebBridge, OpenWebBridgeError

def test_python_sdk():
    print("=== Testing OpenWebBridge Python SDK v2.0 ===")
    client = OpenWebBridge(port=10099, session="python-test")

    # 1. Status check
    st = client.status()
    print("Status:", st)
    assert st.get("running") == True, "Daemon should be running"
    assert st.get("extension_connected") == True, "Extension should be connected"

    # 2. Navigate
    nav = client.navigate("https://python.org", new_tab=True, group_title="Python Research")
    print("Navigate result:", nav)
    assert nav.get("success") == True

    # 3. Default snapshot
    snap = client.snapshot()
    print("Snapshot elements count (default):", snap.get("totalElements"))
    assert snap.get("totalElements") == 3

    # 4. Viewport pruned snapshot (v2)
    snap_pruned = client.snapshot(in_viewport_only=True)
    print("Snapshot elements count (in_viewport_only):", snap_pruned.get("totalElements"))
    assert snap_pruned.get("totalElements") == 62
    assert snap_pruned.get("inViewportOnly") == True

    # 5. Scoped selector snapshot (v2)
    snap_scoped = client.snapshot(selector="#detail-desc")
    print("Snapshot elements count (scoped):", snap_scoped.get("totalElements"))
    assert snap_scoped.get("totalElements") == 2

    # 6. Handoff human breakpoint (v2)
    handoff_res = client.handoff(reason="CAPTCHA Verification", timeout=60)
    print("Handoff result:", handoff_res)
    assert handoff_res.get("resolved") == True
    assert handoff_res.get("reason") == "CAPTCHA Verification"

    # 7. Browser-bound client routing (v2)
    chrome_client = OpenWebBridge(port=10099, browser="chrome")
    chrome_nav = chrome_client.navigate("https://python.org")
    assert chrome_nav.get("success") == True

    # 8. Screenshot
    shot = client.screenshot()
    print("Screenshot saved to:", shot.get("path"))
    assert os.path.exists(shot.get("path"))

    # 9. CDP raw protocol execution (v2)
    cdp_res = client.cdp("Page.enable")
    print("CDP result:", cdp_res)
    assert cdp_res.get("success") == True

    print("[OK] Python SDK v2.0 Tests Passed Successfully!")

if __name__ == "__main__":
    test_python_sdk()
