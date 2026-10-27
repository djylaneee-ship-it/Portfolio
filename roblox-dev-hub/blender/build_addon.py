"""Refait le zip de l'add-on Blender à partir de blender/addon (lancer : python3 blender/build_addon.py)."""
import os
import re
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "addon")
version = re.search(r'^version = "([^"]+)"', open(os.path.join(SRC, "blender_manifest.toml")).read(), re.M).group(1)
for old in os.listdir(HERE):
    if old.startswith("claude_blender_mcp-") and old.endswith(".zip"):
        os.remove(os.path.join(HERE, old))
out = os.path.join(HERE, "claude_blender_mcp-%s.zip" % version)
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk(SRC):
        dirs[:] = sorted(d for d in dirs if d != "__pycache__")
        for f in sorted(files):
            if f.endswith(".pyc"):
                continue
            full = os.path.join(root, f)
            z.write(full, os.path.relpath(full, SRC))
print(out)
