#!/usr/bin/env python3
"""Internal helper for capability-scan. Do not run directly."""
import json, sys, os

CAPS_FILE = os.path.expanduser("~/.config/orpheus/capabilities.json")

def ensure_file():
    os.makedirs(os.path.dirname(CAPS_FILE), exist_ok=True)
    if not os.path.exists(CAPS_FILE):
        with open(CAPS_FILE, "w") as f:
            json.dump({"tools": {}, "scanned": "never", "version": 1}, f)

def update(name, status, version):
    ensure_file()
    with open(CAPS_FILE, "r") as f:
        data = json.load(f)
    old = data["tools"].get(name, {})
    if old.get("status") != status:
        if status == "found":
            print(f"[NEW]  {name} detected: {version}")
        else:
            print(f"[GONE] {name} no longer available")
    elif old.get("version") != version and status == "found":
        print(f"[UPD]  {name} updated: {version}")
    data["tools"][name] = {
        "status": status,
        "version": version,
        "detected": sys.argv[4] if len(sys.argv) > 4 else ""
    }
    with open(CAPS_FILE, "w") as f:
        json.dump(data, f, indent=2)

def mark_missing(name):
    ensure_file()
    with open(CAPS_FILE, "r") as f:
        data = json.load(f)
    if name in data["tools"] and data["tools"][name].get("status") == "found":
        print(f"[GONE] {name} no longer available")
        data["tools"][name] = {
            "status": "missing",
            "detected": sys.argv[3] if len(sys.argv) > 3 else ""
        }
        with open(CAPS_FILE, "w") as f:
            json.dump(data, f, indent=2)

def summary():
    ensure_file()
    with open(CAPS_FILE, "r") as f:
        data = json.load(f)
    found = [k for k, v in data["tools"].items() if v.get("status") == "found"]
    data["scanned"] = sys.argv[2] if len(sys.argv) > 2 else ""
    with open(CAPS_FILE, "w") as f:
        json.dump(data, f, indent=2)
    print(f"\nTotal capabilities known: {len(found)}")
    print(f"Last scanned: {data['scanned']}")

def list_tools():
    ensure_file()
    with open(CAPS_FILE, "r") as f:
        data = json.load(f)
    found = [(k, v) for k, v in data["tools"].items() if v.get("status") == "found"]
    if not found:
        print("No capabilities discovered yet. Run: capability-scan")
    else:
        print(f"{'Tool':<15} {'Version':<30} {'Detected'}")
        print("-" * 70)
        for name, info in sorted(found, key=lambda x: x[0]):
            ver = info.get("version", "?")
            if len(ver) > 28:
                ver = ver[:25] + "..."
            det = info.get("detected", "?")
            print(f"{name:<15} {ver:<30} {det}")

if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "update":
        update(sys.argv[2], sys.argv[3], sys.argv[4])
    elif cmd == "missing":
        mark_missing(sys.argv[2])
    elif cmd == "summary":
        summary()
    elif cmd == "list":
        list_tools()
