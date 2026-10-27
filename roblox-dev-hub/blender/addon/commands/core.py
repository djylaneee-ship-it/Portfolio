"""Core Blender commands (SPEC.md section 5): inspection, Python execution, screenshots, frame/scene settings, saving.

Every command is fn(params: dict) -> JSON-serializable result and runs on Blender's main thread.
"""

import builtins
import contextlib
import difflib
import io
import itertools
import linecache
import math
import os
import tempfile
import time
import traceback

import bpy
import mathutils
from mathutils import Euler, Matrix, Quaternion, Vector

from . import COMMANDS, command, load_errors
from ..server import ADDON_VERSION, CommandError, json_safe

_MAX_OUTPUT = 1_000_000      # characters of captured stdout/stderr returned by execute_python
_KEEP_SOURCES = 50           # executed snippets kept in linecache for readable tracebacks


# ---------------------------------------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------------------------------------

def _num(x, nd=4):
    return round(float(x), nd) + 0.0  # + 0.0 turns -0.0 into 0.0


def _vec(v, nd=4):
    return [_num(x, nd) for x in v]


def _mat(m, nd=5):
    return [[_num(x, nd) for x in row] for row in m]


def _int_param(params, key, default=None, minimum=None):
    value = params.get(key, default)
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value != int(value):
        raise CommandError("'%s' must be an integer, got %r" % (key, value))
    value = int(value)
    if minimum is not None and value < minimum:
        raise CommandError("'%s' must be >= %d, got %d" % (key, minimum, value))
    return value


def _get_object(name):
    if not isinstance(name, str) or not name:
        raise CommandError("Give the object 'name'")
    ob = bpy.data.objects.get(name)
    if ob is None:
        close = difflib.get_close_matches(name, bpy.data.objects.keys(), n=5, cutoff=0.5)
        hint = (" Did you mean: %s?" % ", ".join(close)) if close else ""
        raise CommandError("Object '%s' not found.%s" % (name, hint))
    return ob


def _visible(ob, view_layer):
    try:
        return ob.visible_get(view_layer=view_layer)
    except Exception:
        return not ob.hide_viewport


def _ui_override():
    """Context override with a real window when the UI exists (operators called from timers have none)."""
    wm = bpy.context.window_manager
    if bpy.app.background or not wm or not wm.windows:
        return contextlib.nullcontext()
    win = wm.windows[0]
    return bpy.context.temp_override(window=win, screen=win.screen)


def _largest_view3d():
    """(window, area, region) of the biggest 3D viewport, or (first window, None, None)."""
    best = None
    wm = bpy.context.window_manager
    for win in wm.windows:
        for area in win.screen.areas:
            if area.type == "VIEW_3D":
                size = area.width * area.height
                if best is None or size > best[0]:
                    best = (size, win, area)
    if best is None:
        return (wm.windows[0] if wm.windows else None), None, None
    _size, win, area = best
    region = next((r for r in area.regions if r.type == "WINDOW"), None)
    return win, area, region


def view3d_context():
    """Context manager for running view3d operators from execute_python (GUI only)."""
    if bpy.app.background:
        raise RuntimeError("No 3D viewport in background mode")
    win, area, region = _largest_view3d()
    if area is None:
        raise RuntimeError("No 3D viewport is open")
    return bpy.context.temp_override(window=win, screen=win.screen, area=area, region=region)


def temp_dir():
    """%TEMP%/claude_blender, created on demand (images and other large outputs go here)."""
    path = os.path.join(tempfile.gettempdir(), "claude_blender")
    os.makedirs(path, exist_ok=True)
    return path


def downscale_png(path, max_size):
    """Shrink a PNG in place so its longest side is <= max_size. Returns (width, height, orig_w, orig_h)."""
    img = bpy.data.images.load(path, check_existing=False)
    try:
        w, h = img.size
        if max_size and max(w, h) > max_size:
            s = float(max_size) / max(w, h)
            nw, nh = max(1, int(round(w * s))), max(1, int(round(h * s)))
            img.scale(nw, nh)
            img.filepath_raw = path
            img.file_format = "PNG"
            img.save()
            return nw, nh, w, h
        return w, h, w, h
    finally:
        bpy.data.images.remove(img)


def _short(text, limit):
    return text if len(text) <= limit else text[:limit] + "\n...(truncated, %d chars total)" % len(text)


# ---------------------------------------------------------------------------------------------------------
# commands
# ---------------------------------------------------------------------------------------------------------

@command("ping")
def ping(params):
    """Blender version, current file, add-on version, registered commands and command-module load errors."""
    return {
        "blender": bpy.app.version_string,
        "file": bpy.data.filepath,
        "addon_version": ADDON_VERSION,
        "background": bool(bpy.app.background),
        "commands": sorted(COMMANDS),
        "load_errors": load_errors(),
    }


def _collections(view_layer, limit=500):
    out = []

    def walk(lc, parent):
        if len(out) >= limit:
            return
        coll = lc.collection
        out.append({"name": coll.name, "parent": parent, "objects": len(coll.objects),
                    "children": [c.name for c in coll.children],
                    "excluded": bool(lc.exclude), "hidden": bool(lc.hide_viewport or coll.hide_viewport)})
        for child in lc.children:
            walk(child, coll.name)

    walk(view_layer.layer_collection, None)
    return out


def _action_summary(act):
    d = {"name": act.name, "frame_range": _vec(act.frame_range, 3), "users": act.users,
         "fake_user": act.use_fake_user}
    slots = getattr(act, "slots", None)
    if slots is not None:
        d["slots"] = [s.identifier for s in slots]
    props = {k: json_safe(act[k]) for k in act.keys() if k.startswith("r6_") and k != "r6_clip"}
    if props:
        d["props"] = props
    return d


@command("scene_info")
def scene_info(params):
    """File, fps, frame range, active/selected objects, objects (capped at `limit`, default 300), collections,
    actions."""
    limit = _int_param(params, "limit", 300, minimum=0)
    scene = bpy.context.scene
    view_layer = bpy.context.view_layer
    objs = list(scene.objects)
    objects = [{"name": ob.name, "type": ob.type, "parent": ob.parent.name if ob.parent else None,
                "visible": _visible(ob, view_layer), "location": _vec(ob.location), "dimensions": _vec(ob.dimensions)}
               for ob in objs[:limit]]
    active = view_layer.objects.active
    return {
        "file": bpy.data.filepath,
        "dirty": bool(bpy.data.is_dirty),
        "scene": scene.name,
        "scenes": [s.name for s in bpy.data.scenes],
        "fps": scene.render.fps,
        "fps_base": _num(scene.render.fps_base, 6),
        "frame_start": scene.frame_start,
        "frame_end": scene.frame_end,
        "frame_current": scene.frame_current,
        "unit_scale": _num(scene.unit_settings.scale_length, 6),
        "active_object": active.name if active else None,
        "selected": [ob.name for ob in view_layer.objects if ob.select_get(view_layer=view_layer)],
        "object_count": len(objs),
        "objects": objects,
        "truncated": len(objs) > limit,
        "collections": _collections(view_layer),
        "actions": [_action_summary(a) for a in list(bpy.data.actions)[:500]],
    }


def _rotation(ob_or_pb):
    mode = ob_or_pb.rotation_mode
    if mode == "QUATERNION":
        return _vec(ob_or_pb.rotation_quaternion, 6)
    if mode == "AXIS_ANGLE":
        a = ob_or_pb.rotation_axis_angle
        return [_num(math.degrees(a[0]))] + _vec(a[1:], 6)
    return [_num(math.degrees(x)) for x in ob_or_pb.rotation_euler]


def _custom_props(idblock, limit=500):
    out = {}
    for k in idblock.keys():
        if k.startswith("_"):
            continue
        v = json_safe(idblock[k])
        if isinstance(v, str):
            v = _short(v, limit)
        out[k] = v
    return out


def _armature_info(ob, limit):
    arm = ob.data
    bones = []
    for b in list(arm.bones)[:limit]:
        pb = ob.pose.bones.get(b.name)
        bones.append({
            "name": b.name,
            "parent": b.parent.name if b.parent else None,
            "head": _vec(b.head_local), "tail": _vec(b.tail_local), "length": _num(b.length),
            "deform": b.use_deform, "hidden": b.hide,
            "collections": [c.name for c in b.collections],
            "rotation_mode": pb.rotation_mode if pb else None,
            "constraints": [{"name": c.name, "type": c.type, "target": getattr(getattr(c, "target", None), "name", None),
                             "subtarget": getattr(c, "subtarget", "") or None, "influence": _num(c.influence, 3),
                             "mute": c.mute} for c in pb.constraints] if pb else [],
        })
    colls = getattr(arm, "collections_all", arm.collections)
    return {
        "bone_count": len(arm.bones),
        "bones": bones,
        "truncated": len(arm.bones) > limit,
        "pose_position": arm.pose_position,
        "display_type": arm.display_type,
        "bone_collections": [{"name": c.name, "visible": c.is_visible} for c in colls],
    }


def _mesh_info(ob):
    me = ob.data
    return {
        "vertices": len(me.vertices), "edges": len(me.edges), "faces": len(me.polygons), "loops": len(me.loops),
        "uv_layers": [uv.name for uv in me.uv_layers],
        "vertex_groups": [g.name for g in ob.vertex_groups][:200],
        "shape_keys": [k.name for k in me.shape_keys.key_blocks] if me.shape_keys else [],
    }


@command("object_info")
def object_info(params):
    """Detailed info for object `name`: transforms, dimensions, materials, modifiers, constraints, parent,
    custom props, animation, armature bones (capped at `bone_limit`, default 200) or mesh stats."""
    ob = _get_object(params.get("name"))
    bone_limit = _int_param(params, "bone_limit", 200, minimum=0)
    view_layer = bpy.context.view_layer
    loc_w, rot_w, scale_w = ob.matrix_world.decompose()
    ad = ob.animation_data
    anim = None
    if ad:
        slot = getattr(ad, "action_slot", None)
        anim = {"action": ad.action.name if ad.action else None,
                "slot": slot.identifier if slot else None,
                "nla_tracks": [t.name for t in ad.nla_tracks],
                "drivers": len(ad.drivers)}
    info = {
        "name": ob.name,
        "type": ob.type,
        "data": ob.data.name if ob.data else None,
        "parent": ({"name": ob.parent.name, "type": ob.parent_type, "bone": ob.parent_bone or None}
                   if ob.parent else None),
        "children": [c.name for c in ob.children][:200],
        "collections": [c.name for c in ob.users_collection],
        "visible": _visible(ob, view_layer),
        "hide_viewport": ob.hide_viewport,
        "hide_render": ob.hide_render,
        "location": _vec(ob.location),
        "rotation_mode": ob.rotation_mode,
        "rotation": _rotation(ob),
        "scale": _vec(ob.scale),
        "dimensions": _vec(ob.dimensions),
        "world": {"location": _vec(loc_w), "rotation_euler_deg": [_num(math.degrees(a)) for a in rot_w.to_euler()],
                  "rotation_quaternion": _vec(rot_w, 6), "scale": _vec(scale_w)},
        "matrix_world": _mat(ob.matrix_world),
        "materials": [{"slot": i, "material": s.material.name if s.material else None, "link": s.link}
                      for i, s in enumerate(ob.material_slots)],
        "modifiers": [{"name": m.name, "type": m.type, "show_viewport": m.show_viewport, "show_render": m.show_render,
                       "object": getattr(getattr(m, "object", None), "name", None)} for m in ob.modifiers],
        "constraints": [{"name": c.name, "type": c.type, "target": getattr(getattr(c, "target", None), "name", None),
                         "subtarget": getattr(c, "subtarget", "") or None, "influence": _num(c.influence, 3),
                         "mute": c.mute} for c in ob.constraints],
        "custom_props": _custom_props(ob),
        "animation": anim,
    }
    if ob.type == "ARMATURE":
        info["armature"] = _armature_info(ob, bone_limit)
    elif ob.type == "MESH":
        info["mesh"] = _mesh_info(ob)
    return info


_exec_ids = itertools.count(1)


_session = {}                # globals kept between execute_python calls (fresh=true clears them)
_FILE_SWITCH = ("open_mainfile", "read_homefile", "read_factory_settings", "revert_mainfile", "recover_")


def _digest():
    """Short state after a call: active object, its mode, selection, object count."""
    vl = bpy.context.view_layer
    act = vl.objects.active
    return {"active": act.name if act else None, "mode": act.mode if act else "OBJECT",
            "selected": [o.name for o in vl.objects if o is not None and o.select_get()][:20],
            "objects": len(bpy.context.scene.objects), "frame": bpy.context.scene.frame_current}


@command("execute_python", mutates=True)
def execute_python(params):
    """Run Python `code` in Blender. Globals: bpy, bmesh, mathutils, Vector, Matrix, Euler, Quaternion, np,
    C (bpy.context), D (bpy.data), rx (modeling / sculpt / rig / animation toolkit, rx.help()),
    view3d_context() and result=None. Assign `result` to return a value. Variables and functions you define
    stay available in the next calls (fresh=true starts clean). With the UI, the code runs with the biggest 3D
    view as context, so bpy.ops work (edit mode, sculpt, transform...). Returns {"stdout", "stderr", "result",
    "state"}."""
    code = params.get("code")
    if not isinstance(code, str) or not code.strip():
        raise CommandError("execute_python needs a non-empty 'code' string")
    from .. import rx
    if params.get("export_dir"):
        rx.EXPORT_DIR = str(params["export_dir"])
    if params.get("fresh"):
        _session.clear()
    n = next(_exec_ids)
    filename = "<claude-exec-%d>" % n
    linecache.cache[filename] = (len(code), None, code.splitlines(True), filename)
    linecache.cache.pop("<claude-exec-%d>" % (n - _KEEP_SOURCES), None)
    import bmesh
    import numpy as np
    env = _session
    env.update({"__name__": "__claude__", "__builtins__": builtins, "bpy": bpy, "bmesh": bmesh, "np": np,
                "mathutils": mathutils, "Vector": Vector, "Matrix": Matrix, "Euler": Euler, "Quaternion": Quaternion,
                "C": bpy.context, "D": bpy.data, "rx": rx, "view3d_context": view3d_context, "result": None})
    use_ctx = not bpy.app.background and not any(k in code for k in _FILE_SWITCH)
    out, err = io.StringIO(), io.StringIO()
    try:
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err), \
                (rx.ctx() if use_ctx else contextlib.nullcontext()):
            exec(compile(code, filename, "exec"), env)
    except (Exception, SystemExit) as exc:
        # Drop this function's own frame so the traceback starts in the user's code.
        tb = "".join(traceback.format_exception(type(exc), exc, exc.__traceback__.tb_next))
        msg = "%s: %s" % (type(exc).__name__, exc)
        if out.getvalue():
            msg += "\n--- stdout before the error ---\n" + _short(out.getvalue()[-4000:], 4000)
        if err.getvalue():
            msg += "\n--- stderr ---\n" + _short(err.getvalue()[-4000:], 4000)
        try:
            msg += "\n--- state ---\n%s" % _digest()
        except Exception:
            pass
        raise CommandError(msg, traceback_text=tb) from None
    finally:
        if not bpy.app.background:
            for win in bpy.context.window_manager.windows:
                for area in win.screen.areas:
                    area.tag_redraw()
    res = env.get("result")
    env["result"] = None
    return {"stdout": _short(out.getvalue(), _MAX_OUTPUT), "stderr": _short(err.getvalue(), _MAX_OUTPUT),
            "result": json_safe(res), "state": _digest()}


@command("viewport_screenshot")
def viewport_screenshot(params):
    """PNG of the largest 3D viewport (falls back to the whole window), longest side <= `max_size` (1200).
    Returns {"path", "width", "height", "original_size", "source"}. Needs the Blender UI."""
    max_size = _int_param(params, "max_size", 1200, minimum=16)
    if bpy.app.background:
        raise CommandError("viewport_screenshot: no UI in background mode (start Blender with its interface)")
    win, area, region = _largest_view3d()
    if win is None:
        raise CommandError("viewport_screenshot: Blender has no open window")
    path = os.path.join(temp_dir(), "viewport_%s_%03d.png" % (time.strftime("%Y%m%d_%H%M%S"), int(time.time() * 1000) % 1000))
    source = "VIEW_3D"
    area_error = None
    if area is not None:
        try:
            with bpy.context.temp_override(window=win, screen=win.screen, area=area, region=region):
                bpy.ops.screen.screenshot_area(filepath=path)
        except Exception as exc:
            area_error = str(exc)
    if area is None or area_error or not os.path.isfile(path):
        source = "WINDOW"
        with bpy.context.temp_override(window=win, screen=win.screen):
            bpy.ops.screen.screenshot(filepath=path)
    if not os.path.isfile(path) and os.path.isfile(path + ".png"):
        path += ".png"
    if not os.path.isfile(path):
        raise CommandError("viewport_screenshot: Blender did not write the image (%s)" % (area_error or "unknown"))
    w, h, ow, oh = downscale_png(path, max_size)
    return {"path": path, "width": w, "height": h, "original_size": [ow, oh], "source": source}


@command("set_frame")
def set_frame(params):
    """Set the scene's current frame (`frame`, a float sets a subframe). Returns {"frame", "subframe"}."""
    frame = params.get("frame")
    if isinstance(frame, bool) or not isinstance(frame, (int, float)) or not math.isfinite(frame):
        raise CommandError("set_frame needs a numeric 'frame'")
    scene = bpy.context.scene
    whole = math.floor(frame)
    scene.frame_set(int(whole), subframe=float(frame - whole))
    return {"frame": scene.frame_current, "subframe": _num(scene.frame_subframe)}


@command("set_scene_settings", mutates=True)
def set_scene_settings(params):
    """Change any of `fps`, `frame_start`, `frame_end` (others unchanged). Returns the resulting settings."""
    scene = bpy.context.scene
    fps = params.get("fps")
    start = _int_param(params, "frame_start")
    end = _int_param(params, "frame_end")
    start = scene.frame_start if start is None else start
    end = scene.frame_end if end is None else end
    if end < start:
        raise CommandError("frame_end (%d) must be >= frame_start (%d)" % (end, start))
    if fps is not None:
        if isinstance(fps, bool) or not isinstance(fps, (int, float)) or not 0 < fps <= 1000:
            raise CommandError("fps must be a number in (0, 1000], got %r" % (fps,))
        if abs(fps - round(fps)) < 1e-6:
            scene.render.fps, scene.render.fps_base = int(round(fps)), 1.0
        else:  # e.g. 29.97 -> fps 30, base 1.001
            n = int(math.ceil(fps))
            scene.render.fps, scene.render.fps_base = n, n / float(fps)
    # Blender clamps start/end against each other: set them in an order that never crosses.
    if start > scene.frame_end:
        scene.frame_end, scene.frame_start = end, start
    else:
        scene.frame_start, scene.frame_end = start, end
    return {"fps": scene.render.fps, "fps_base": _num(scene.render.fps_base, 6),
            "frame_start": scene.frame_start, "frame_end": scene.frame_end, "frame_current": scene.frame_current}


@command("save_file")
def save_file(params):
    """Save the .blend. No `path`: save in place. With `path`: save as (switches the session to it, or with
    `copy`=true writes a copy); an existing different file is only replaced with `overwrite`=true."""
    path = params.get("path")
    overwrite = bool(params.get("overwrite", False))
    copy = bool(params.get("copy", False))
    current = bpy.data.filepath
    if not path:
        if not current:
            raise CommandError("This file was never saved: give a 'path'")
        with _ui_override():
            res = bpy.ops.wm.save_mainfile()
        if "FINISHED" not in res:
            raise CommandError("Save failed (%s)" % ", ".join(res))
        return {"path": current, "saved_as": False, "copy": False, "size_bytes": os.path.getsize(current),
                "file": bpy.data.filepath}
    if not isinstance(path, str):
        raise CommandError("'path' must be a string")
    path = os.path.abspath(bpy.path.abspath(os.path.expanduser(path)))
    if not path.lower().endswith(".blend"):
        path += ".blend"
    same = bool(current) and os.path.normcase(os.path.abspath(current)) == os.path.normcase(path)
    if same:
        copy = False
        with _ui_override():
            res = bpy.ops.wm.save_mainfile()
    else:
        if os.path.exists(path) and not overwrite:
            raise CommandError("'%s' already exists; pass overwrite=true to replace it" % path)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with _ui_override():
            res = bpy.ops.wm.save_as_mainfile(filepath=path, copy=copy)
    if "FINISHED" not in res:
        raise CommandError("Save failed (%s)" % ", ".join(res))
    return {"path": path, "saved_as": not same, "copy": copy, "size_bytes": os.path.getsize(path),
            "file": bpy.data.filepath}
