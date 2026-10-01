import sys
import os
import time

# Add sdk/python to path
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'sdk', 'python'))
from open_webbridge import OpenWebBridge, OpenWebBridgeError

def test_python_sdk():
    print("=== Testing OpenWebBridge Python SDK ===")
    client = OpenWebBridge(port=10099, session="python-test")

    # Status check
    st = client.status()
    print("Status:", st)
    assert st.get("running") == True, "Daemon should be running"
    assert st.get("extension_connected") == True, "Extension should be connected"

    # Navigate
    nav = client.navigate("https://python.org", new_tab=True, group_title="Python Research")
    print("Navigate result:", nav)
    assert nav.get("success") == True

    # Snapshot
    snap = client.snapshot()
    print("Snapshot elements count:", snap.get("totalElements"))
    assert snap.get("totalElements") == 3

    # Screenshot
    shot = client.screenshot()
    print("Screenshot saved to:", shot.get("path"))
    assert os.path.exists(shot.get("path"))

    print("[OK] Python SDK Test Passed Successfully!")

if __name__ == "__main__":
    test_python_sdk()
