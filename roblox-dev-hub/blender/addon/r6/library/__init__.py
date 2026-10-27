"""R6 animation preset library. Each module registers presets with clip.preset()."""

import importlib

from ..clip import PRESETS, Clip

_MODULES = ("locomotion", "combat", "skills", "reactions")
_loaded = False
_errors = {}


def _load():
    global _loaded
    if _loaded:
        return
    for mod in _MODULES:
        try:
            importlib.import_module("." + mod, __name__)
        except Exception as exc:  # a broken module must not hide the others
            _errors[mod] = repr(exc)
    _loaded = True


def list_presets():
    _load()
    out = []
    for name, p in sorted(PRESETS.items(), key=lambda kv: (kv[1]["category"], kv[0])):
        out.append({"name": name, "category": p["category"], "description": p["description"],
                    "params": p["params"], "weapon": p["weapon"], "loop": p["loop"]})
    return {"presets": out, "load_errors": dict(_errors)}


def build_preset(name, fps=60, speed=1.0, intensity=1.0, **params):
    """Build a preset clip. Unknown params raise so typos are visible."""
    _load()
    if name not in PRESETS:
        raise ValueError("Unknown preset '%s'. Available: %s" % (name, sorted(PRESETS)))
    p = PRESETS[name]
    unknown = set(params) - set(p["params"])
    if unknown:
        raise ValueError("Unknown params for '%s': %s. Allowed: %s" % (name, sorted(unknown), sorted(p["params"])))
    clip = p["fn"](fps=fps, speed=speed, intensity=intensity, **params)
    if not isinstance(clip, Clip):
        raise TypeError("Preset '%s' did not return a Clip" % name)
    if clip.weapon is None and p["weapon"]:
        clip.weapon = dict(p["weapon"])
    return clip
