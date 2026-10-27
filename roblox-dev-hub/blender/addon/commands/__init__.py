"""Command registry. A command is fn(params: dict) -> JSON-serializable result, run on Blender's main thread."""

import importlib
import traceback

COMMANDS = {}
_MODULES = ("core", "r6_commands", "modeling")
_load_errors = {}


def command(name, mutates=False):
    """Register a command. mutates=True pushes an undo step after a successful run (GUI only)."""
    def deco(fn):
        COMMANDS[name] = {"fn": fn, "mutates": mutates, "doc": (fn.__doc__ or "").strip()}
        return fn
    return deco


def load_all(reload=False):
    for mod in _MODULES:
        try:
            m = importlib.import_module("." + mod, __name__)
            if reload:
                importlib.reload(m)
            _load_errors.pop(mod, None)
        except Exception:
            _load_errors[mod] = traceback.format_exc()
    return dict(_load_errors)


def load_errors():
    return dict(_load_errors)
