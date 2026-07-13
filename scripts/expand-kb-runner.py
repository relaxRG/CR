#!/usr/bin/env python3
"""合并新条目到现有知识库，去重后写回"""
import json, os, sys

KB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "../lib/bottles/offline-kb.json")

def load_existing():
    with open(KB_PATH, encoding="utf-8") as f:
        return json.load(f)

def merge_and_write(new_entries):
    existing = load_existing()
    existing_names = {e.get("nameEn","").lower() for e in existing} | {e.get("nameZh","") for e in existing}
    added = 0
    for e in new_entries:
        key_en = e.get("nameEn","").lower()
        key_zh = e.get("nameZh","")
        if key_en not in existing_names and key_zh not in existing_names:
            existing.append(e)
            existing_names.add(key_en)
            existing_names.add(key_zh)
            added += 1
    with open(KB_PATH, "w", encoding="utf-8") as f:
        json.dump(existing, f, ensure_ascii=False, indent=2)
    print(f"Added {added} entries. Total: {len(existing)}")
    return len(existing)

# Load new entries from the expand-kb.py script
exec_globals = {}
with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "expand-kb.py"), encoding="utf-8") as f:
    src = f.read()

# Extract NEW_ENTRIES list safely
import ast, re
match = re.search(r'NEW_ENTRIES\s*=\s*(\[.*?\n\])', src, re.DOTALL)
if match:
    new_entries = ast.literal_eval(match.group(1))
    total = merge_and_write(new_entries)
    sys.exit(0 if total >= 800 else 1)
else:
    print("ERROR: Could not find NEW_ENTRIES in expand-kb.py")
    sys.exit(2)
