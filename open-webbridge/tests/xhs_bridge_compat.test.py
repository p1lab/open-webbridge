# -*- coding: utf-8 -*-
"""
xhs_bridge_compat.test.py
Verify that OpenWebBridge is 100% drop-in compatible with xhs-webbridge-research!
"""

import sys
import os
import json

# Add xhs-webbridge-research scripts directory
XHS_SCRIPTS_DIR = r"C:\Users\PengY\AppData\Local\DoubaoWork\User Data\Default\.doubaowork\agent_mode\workspace\.user_skills\xhs-webbridge-research\scripts"
sys.path.insert(0, XHS_SCRIPTS_DIR)

import xhs_bridge as X

def test_xhs_bridge_compatibility():
    print("=== Testing OpenWebBridge with xhs_bridge.py ===")
    test_base = "http://127.0.0.1:10099/command"
    test_session = "xhs-test-session"

    bridge = X.Bridge(base=test_base, session=test_session)

    # 1. Test tab_alive
    print("[1] Testing bridge.tab_alive()...")
    alive = bridge.tab_alive()
    print("    tab_alive:", alive)
    assert alive == True, "tab_alive should be True"

    # 2. Test navigate
    print("[2] Testing bridge.navigate()...")
    bridge.navigate("https://www.xiaohongshu.com/search_result?keyword=%E7%A9%BF%E6%90%AD")
    print("    navigate OK")

    # 3. Test check_login
    print("[3] Testing bridge.check_login()...")
    is_login, info = bridge.check_login()
    print("    check_login result:", is_login, info)
    assert is_login == True, "Mock check_login should return True"

    # 4. Test evaluate
    print("[4] Testing bridge.evaluate()...")
    val = bridge.evaluate("1+1")
    print("    evaluate(1+1):", val)
    assert val == 2

    # 5. Test CDP
    print("[5] Testing bridge.cdp()...")
    cdp_res = bridge.cdp("Network.enable")
    print("    cdp result:", cdp_res)
    assert cdp_res is not None

    # 6. Test Network tool
    print("[6] Testing network commands...")
    start_res = bridge.post("network", {"cmd": "start"})
    print("    network start:", start_res)
    assert start_res.get("success") == True

    list_res = bridge.post("network", {"cmd": "list"})
    print("    network list:", list_res)
    assert len(list_res.get("requests", [])) >= 1

    detail_res = bridge.post("network", {"cmd": "detail", "requestId": "req-mock-1"})
    print("    network detail requestId:", detail_res.get("requestId"))
    assert detail_res.get("requestId") == "req-mock-1"

    print("\n[OK] ALL xhs_bridge.py contract tests passed on OpenWebBridge!")

if __name__ == "__main__":
    test_xhs_bridge_compatibility()
