"""Claude Blender MCP: lets Claude drive Blender through a local TCP server (see SPEC.md).

Extension entry point: add-on preferences, the "Claude" tab of the 3D view sidebar, server auto start
(timer + persistent load_post handler) and the developer "Reload commands" operator.
"""

import sys

import bpy
from bpy.app.handlers import persistent
from bpy.props import BoolProperty, IntProperty

from . import commands, server

_state = {"user_stopped": False}   # the user pressed Stop: do not auto restart on file load


def _prefs():
    try:
        return bpy.context.preferences.addons[__package__].preferences
    except (KeyError, AttributeError):
        return None


def _pref_port():
    p = _prefs()
    return p.port if p else server.DEFAULT_PORT


def _pref_auto_start():
    p = _prefs()
    return p.auto_start if p else True


def reload_commands():
    """Re-import the command modules and the r6 toolkit from disk (developer helper). Returns load errors.

    The server and the commands registry package stay loaded, so connections survive.
    """
    prefixes = (__package__ + ".commands.", __package__ + ".r6")
    for name in [m for m in sys.modules if m.startswith(prefixes)]:
        del sys.modules[name]
    commands.COMMANDS.clear()
    errors = getattr(commands, "_load_errors", None)
    if isinstance(errors, dict):
        errors.clear()  # load_all() only adds errors, so stale ones would survive a successful reload
    return commands.load_all()


# ---------------------------------------------------------------------------------------------------------
# preferences, operators, panel
# ---------------------------------------------------------------------------------------------------------

def _on_port_changed(self, _context):
    if server.is_running() and server.status["port"] != self.port:
        server.start(self.port)


class ClaudeMCPPreferences(bpy.types.AddonPreferences):
    bl_idname = __package__

    port: IntProperty(name="Port", description="TCP port on 127.0.0.1 (must match BLENDER_MCP_PORT of the MCP "
                      "server)", default=server.DEFAULT_PORT, min=1024, max=65535, update=_on_port_changed)
    auto_start: BoolProperty(name="Start automatically", description="Start the server when Blender starts and "
                             "keep it running across file loads", default=True)

    def draw(self, _context):
        col = self.layout.column()
        row = col.row()
        row.prop(self, "port")
        row.prop(self, "auto_start")
        col.label(text="Claude connects through mcp_server/server.py, which must use the same port.")


class CLAUDE_OT_server_start(bpy.types.Operator):
    """Start the Claude MCP server on 127.0.0.1"""
    bl_idname = "claude.server_start"
    bl_label = "Start Server"

    def execute(self, _context):
        port = _pref_port()
        if server.start(port):
            _state["user_stopped"] = False
            self.report({"INFO"}, "Claude MCP server listening on port %d" % port)
            return {"FINISHED"}
        self.report({"ERROR"}, server.status["last_error"] or "Could not start the server")
        return {"CANCELLED"}


class CLAUDE_OT_server_stop(bpy.types.Operator):
    """Stop the Claude MCP server and disconnect clients"""
    bl_idname = "claude.server_stop"
    bl_label = "Stop Server"

    def execute(self, _context):
        server.stop()
        _state["user_stopped"] = True
        self.report({"INFO"}, "Claude MCP server stopped")
        return {"FINISHED"}


class CLAUDE_OT_reload_commands(bpy.types.Operator):
    """Reload the command modules and the R6 toolkit from disk (developer helper)"""
    bl_idname = "claude.reload_commands"
    bl_label = "Reload Commands"

    def execute(self, _context):
        errors = reload_commands()
        n = len(commands.COMMANDS)
        if errors:
            self.report({"WARNING"}, "Reloaded %d commands; failed modules: %s" % (n, ", ".join(sorted(errors))))
        else:
            self.report({"INFO"}, "Reloaded %d commands" % n)
        return {"FINISHED"}


def _clip(text, n=48):
    text = " ".join(str(text).split())
    return text if len(text) <= n else text[:n - 3] + "..."


class CLAUDE_PT_server(bpy.types.Panel):
    bl_label = "Claude MCP"
    bl_idname = "CLAUDE_PT_server"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Claude"

    def draw(self, _context):
        layout = self.layout
        st = server.status
        box = layout.box()
        box.label(text="Claude Blender MCP v%s" % server.ADDON_VERSION)
        if st["running"]:
            box.label(text="Running on 127.0.0.1:%d" % st["port"], icon="CHECKMARK")
            box.label(text="Clients: %d   Requests: %d" % (st["clients"], st["requests"]))
        else:
            box.label(text="Stopped", icon="CANCEL")
        if st["last_command"]:
            box.label(text=_clip("Last: %s (%s ms)" % (st["last_command"], st["last_duration_ms"])))
        if st["last_error"]:
            col = box.column()
            col.alert = True
            col.label(text=_clip(st["last_error"]), icon="ERROR")

        row = layout.row(align=True)
        row.scale_y = 1.3
        if st["running"]:
            row.operator("claude.server_stop", icon="PAUSE")
        else:
            row.operator("claude.server_start", icon="PLAY")

        prefs = _prefs()
        if prefs is not None:
            col = layout.column(align=True)
            col.prop(prefs, "port")
            col.prop(prefs, "auto_start")

        layout.operator("claude.reload_commands", icon="FILE_REFRESH")
        errors = commands.load_errors()
        if errors:
            col = layout.column()
            col.alert = True
            for mod in sorted(errors):
                col.label(text="Failed to load: %s" % mod, icon="ERROR")


# ---------------------------------------------------------------------------------------------------------
# auto start
# ---------------------------------------------------------------------------------------------------------

def _auto_start():
    """One-shot timer after registration: start the server when the preference asks for it."""
    if not bpy.app.background and _pref_auto_start() and not server.is_running():
        server.start(_pref_port())
    return None


@persistent
def _claude_mcp_load_post(*_args):
    """Keep the server (and its persistent timer) alive across file loads."""
    if bpy.app.background:
        return
    if server.is_running():
        server.start(server.status["port"])  # no-op restart: re-registers the timer if it was lost
    elif _pref_auto_start() and not _state["user_stopped"]:
        server.start(_pref_port())


def _remove_load_handlers():
    # Match by name too, so a handler left by an older copy of this module is removed as well.
    for fn in list(bpy.app.handlers.load_post):
        if fn is _claude_mcp_load_post or getattr(fn, "__name__", "") == "_claude_mcp_load_post":
            bpy.app.handlers.load_post.remove(fn)


_classes = (
    ClaudeMCPPreferences,
    CLAUDE_OT_server_start,
    CLAUDE_OT_server_stop,
    CLAUDE_OT_reload_commands,
    CLAUDE_PT_server,
)


def register():
    """Extension entry point."""
    for cls in _classes:
        bpy.utils.register_class(cls)
    commands.load_all()
    _remove_load_handlers()
    bpy.app.handlers.load_post.append(_claude_mcp_load_post)
    if not bpy.app.timers.is_registered(_auto_start):
        bpy.app.timers.register(_auto_start, first_interval=1.0)


def unregister():
    """Stop the server and remove every handler, timer and class this add-on registered."""
    server.stop()
    if bpy.app.timers.is_registered(_auto_start):
        bpy.app.timers.unregister(_auto_start)
    _remove_load_handlers()
    for cls in reversed(_classes):
        try:
            bpy.utils.unregister_class(cls)
        except RuntimeError:
            pass
