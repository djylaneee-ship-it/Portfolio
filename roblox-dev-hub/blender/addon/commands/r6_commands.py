"""R6 animation commands. Each one is fn(params: dict) -> JSON-safe result (see SPEC.md section 5).

Every command accepts an optional "armature" (default: r6.rig.find_rig() auto-detection).
Modules written by other agents (pose, export, analyze, library) are imported lazily inside the commands,
so a missing or broken module only disables the commands that need it.
"""

import functools
import importlib
import inspect
import json
import math
import numbers
import os
import tempfile

import bpy

from . import command

_R6 = __package__.rpartition(".")[0] + ".r6"
_MISSING = object()
_ROOT_MOTION = ("full", "in_place", "ignore_root")
_EXPORT_FORMATS = ("rbxmx", "lua", "json")
_VIEW_ALIASES = {"3/4": "three_quarter", "threequarter": "three_quarter", "three-quarter": "three_quarter",
                 "3q": "three_quarter", "side": "right", "profile": "right", "above": "top", "face": "front"}


# ---------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------

def _r6(name):
    """Import claude_blender_mcp.r6.<name> on demand with a readable error."""
    try:
        return importlib.import_module(_R6 + "." + name)
    except Exception as exc:
        raise RuntimeError("R6 module '%s' is not available (%s: %s)" % (name, type(exc).__name__, exc)) from exc


def _json_safe(v):
    if v is None or isinstance(v, (bool, str)):
        return v
    if isinstance(v, numbers.Integral):
        return int(v)
    if isinstance(v, numbers.Real):
        f = float(v)
        return f if math.isfinite(f) else None
    if isinstance(v, dict):
        return {str(k): _json_safe(x) for k, x in v.items()}
    if isinstance(v, bpy.types.ID):
        return v.name
    if isinstance(v, (list, tuple, set, frozenset)):
        return [_json_safe(x) for x in v]
    try:  # mathutils Vector / Matrix / Quaternion, numpy arrays, bpy arrays
        return [_json_safe(x) for x in v]
    except TypeError:
        return repr(v)


def r6_command(name, mutates=False):
    """Register a command whose params are validated as a dict and whose result is made JSON-safe."""
    def deco(fn):
        @functools.wraps(fn)
        def wrapper(params=None):
            if params is None:
                params = {}
            if not isinstance(params, dict):
                raise ValueError("params must be a JSON object, got %s" % type(params).__name__)
            return _json_safe(fn(params))
        command(name, mutates)(wrapper)
        return wrapper
    return deco


def _get(params, key, default=_MISSING):
    if params.get(key) is not None:
        return params[key]
    if default is _MISSING:
        raise ValueError("Missing required parameter '%s'" % key)
    return default


def _str(params, key, default=_MISSING):
    v = _get(params, key, default)
    if v is None:
        return None
    if not isinstance(v, str):
        raise ValueError("'%s' must be a string, got %r" % (key, v))
    if default is _MISSING and not v.strip():
        raise ValueError("'%s' must not be empty" % key)
    return v


def _int(params, key, default=_MISSING, lo=None, hi=None):
    v = _get(params, key, default)
    if v is None:
        return None
    if isinstance(v, bool) or not isinstance(v, numbers.Real) or float(v) != int(v):
        raise ValueError("'%s' must be an integer, got %r" % (key, v))
    v = int(v)
    if (lo is not None and v < lo) or (hi is not None and v > hi):
        raise ValueError("'%s' must be between %s and %s, got %d" % (key, lo, hi, v))
    return v


def _float(params, key, default=_MISSING, lo=None, hi=None, exclusive_lo=False):
    v = _get(params, key, default)
    if v is None:
        return None
    if isinstance(v, bool) or not isinstance(v, numbers.Real) or not math.isfinite(float(v)):
        raise ValueError("'%s' must be a number, got %r" % (key, v))
    v = float(v)
    if lo is not None and (v < lo or (exclusive_lo and v == lo)):
        raise ValueError("'%s' must be %s %s, got %g" % (key, ">" if exclusive_lo else ">=", lo, v))
    if hi is not None and v > hi:
        raise ValueError("'%s' must be <= %s, got %g" % (key, hi, v))
    return v


def _bool(params, key, default):
    v = _get(params, key, default)
    if isinstance(v, bool):
        return v
    if isinstance(v, numbers.Integral) and v in (0, 1):
        return bool(v)
    if isinstance(v, str) and v.strip().lower() in ("true", "false", "yes", "no", "1", "0"):
        return v.strip().lower() in ("true", "yes", "1")
    raise ValueError("'%s' must be true or false, got %r" % (key, v))


def _choice(params, key, default, choices, aliases=None):
    v = _get(params, key, default)
    if isinstance(v, str):
        k = v.strip().lower()
        k = (aliases or {}).get(k, k)
        if k in choices:
            return k
    raise ValueError("'%s' must be one of %s, got %r" % (key, list(choices), v))


def _dict(params, key, default=_MISSING):
    v = _get(params, key, default)
    if isinstance(v, str):
        try:
            v = json.loads(v)
        except ValueError as exc:
            raise ValueError("'%s' is not valid JSON: %s" % (key, exc))
    if v is not None and not isinstance(v, dict):
        raise ValueError("'%s' must be an object, got %s" % (key, type(v).__name__))
    return v


def _rig(params):
    rig = _r6("rig").find_rig(_str(params, "armature", None) or None)
    try:  # the Handle joint is the RIGHT-hand weapon, even when a shield is attached too
        name = _r6("weapons").handle_object(rig)
        if name:
            rig.weapon_object = name
    except RuntimeError:
        pass
    return rig


def _scene_fps(scene=None):
    scene = scene or bpy.context.scene
    return int(round(scene.render.fps / (scene.render.fps_base or 1.0)))


def _clip_summary(clip):
    return {"name": clip.name, "fps": clip.fps, "length": clip.length,
            "duration_s": round(clip.length / float(clip.fps), 4) if clip.fps else None,
            "loop": clip.loop, "priority": clip.priority, "keys": len(clip.keys), "key_frames": clip.frames(),
            "events": clip.events, "weapon": clip.weapon, "uses_handle_joint": clip.uses_weapon_joint()}


def _ensure_weapon(rig, hint, warnings):
    """Attach a placeholder for a clip's weapon hint unless that hand already holds something."""
    if not isinstance(hint, dict) or not hint.get("kind"):
        return None
    weapons = _r6("weapons")
    try:
        kind = weapons.normalize_kind(hint.get("kind"))
        hand = weapons.normalize_hand(hint.get("hand"), kind)
    except ValueError as exc:
        warnings.append("Weapon hint ignored: %s" % exc)
        return None
    if any(w["hand"] == hand for w in weapons.list_weapons(rig)):
        return None
    return weapons.attach_weapon(rig, kind, hand)


def _apply(rig, clip, params, warnings):
    """Shared tail of r6_create_animation / r6_apply_clip."""
    weapon = None
    if _bool(params, "attach_weapon", True):
        weapon = _ensure_weapon(rig, clip.weapon, warnings)
    result = _r6("pose").apply_clip(
        rig, clip,
        action_name=_str(params, "action_name", None) or None,
        start_frame=_int(params, "start_frame", 1),
        overwrite=_bool(params, "overwrite", False),
        set_active=_bool(params, "set_active", True),
        set_scene_range=_bool(params, "set_scene_range", True),
        bake_step=_int(params, "bake_step", 0, 0, 1000))
    out = dict(result) if isinstance(result, dict) else {"result": result}
    out["clip"] = _clip_summary(clip)
    out["weapon_attached"] = weapon
    if warnings:
        out["warnings"] = list(out.get("warnings") or []) + warnings
    return out


def _default_export_dir():
    if bpy.data.filepath:
        return bpy.path.abspath("//exports")
    return os.path.join(tempfile.gettempdir(), "claude_blender", "exports")


# ---------------------------------------------------------------------------
# rig & presets
# ---------------------------------------------------------------------------

@r6_command("r6_inspect_rig")
def r6_inspect_rig(params):
    """Detected R6 rig: bone mapping, scale, axes, root/HRP bones, meshes, weapons, scene fps and range."""
    rig = _rig(params)
    scene = bpy.context.scene
    info = rig.describe()
    info["scene"] = {"fps": _scene_fps(scene), "frame_start": scene.frame_start, "frame_end": scene.frame_end,
                     "frame_current": scene.frame_current}
    info["weapons"] = _r6("weapons").list_weapons(rig)
    cfm = _r6("cframe")
    info["joints"] = list(cfm.R6_PARTS) + [cfm.WEAPON_JOINT]
    return info


@r6_command("r6_list_presets")
def r6_list_presets(params):
    """Animation presets of the R6 library. Optional: category (filter), compact (names/descriptions only)."""
    data = _r6("library").list_presets()
    category = _str(params, "category", None)
    presets = data["presets"]
    if category:
        presets = [p for p in presets if p["category"].lower() == category.strip().lower()]
    if _bool(params, "compact", False):
        presets = [{k: p[k] for k in ("name", "category", "description", "loop", "weapon")} for p in presets]
    return {"presets": presets, "count": len(presets),
            "categories": sorted({p["category"] for p in data["presets"]}), "load_errors": data["load_errors"]}


# ---------------------------------------------------------------------------
# creating / editing animation
# ---------------------------------------------------------------------------

@r6_command("r6_create_animation", mutates=True)
def r6_create_animation(params):
    """Build a library preset at the scene fps and key it on the rig as a new action.

    params: preset (required), params {} (preset parameters), speed 1, intensity 1, action_name, start_frame 1,
    overwrite false, attach_weapon true (placeholder for the preset's weapon hint if that hand is empty),
    set_scene_range true, bake_step 0.
    """
    rig = _rig(params)
    preset = _str(params, "preset")
    preset_params = _dict(params, "params", {}) or {}
    speed = _float(params, "speed", 1.0, lo=0.0, hi=20.0, exclusive_lo=True)
    intensity = _float(params, "intensity", 1.0, lo=0.0, hi=5.0)
    clip = _r6("library").build_preset(preset, fps=_scene_fps(), speed=speed, intensity=intensity, **preset_params)
    return _apply(rig, clip, params, [])


@r6_command("r6_apply_clip", mutates=True)
def r6_apply_clip(params):
    """Key a clip dict (SPEC section 4 format) on the rig as a new action.

    params: clip (required), action_name, start_frame 1, overwrite false, attach_weapon true,
    match_scene_fps true (retime a clip authored at another fps), close_loop true (loops end on frame 0's pose),
    set_scene_range true, bake_step 0.
    """
    rig = _rig(params)
    data = _dict(params, "clip")
    if not data.get("keys"):
        raise ValueError("clip has no keys: give 'keys': [{'frame': 0, 'joints': {...}}, ...]")
    try:
        clip = _r6("clip").Clip.from_dict(data)
    except (KeyError, ValueError, TypeError) as exc:
        raise ValueError("Invalid clip: %s" % exc) from exc
    warnings = []
    fps = _scene_fps()
    if _bool(params, "match_scene_fps", True) and clip.fps != fps:
        warnings.append("Clip authored at %d fps retimed to the scene's %d fps" % (clip.fps, fps))
        clip = clip.retimed(fps=fps)
    if clip.loop and _bool(params, "close_loop", True):
        clip.close_loop()
    return _apply(rig, clip, params, warnings)


@r6_command("r6_set_keys", mutates=True)
def r6_set_keys(params):
    """Insert/replace keys at SCENE frames: keys [{frame, joints {joint: {rot, pos}}, interp, easing}], action."""
    rig = _rig(params)
    keys = _get(params, "keys")
    if not isinstance(keys, list) or not keys:
        raise ValueError("'keys' must be a non-empty list of {frame, joints}")
    joint_name = _r6("clip").joint_name
    clean = []
    for i, k in enumerate(keys):
        if not isinstance(k, dict) or not isinstance(k.get("frame"), numbers.Real) or isinstance(k["frame"], bool):
            raise ValueError("keys[%d] needs a numeric 'frame'" % i)
        joints = k.get("joints") or {}
        if not isinstance(joints, dict):
            raise ValueError("keys[%d].joints must be an object {joint: {rot, pos}}" % i)
        k = dict(k)
        k["joints"] = {joint_name(j): v for j, v in joints.items()}
        clean.append(k)
    return _r6("pose").set_keys(rig, clean, action=_str(params, "action", None) or None)


@r6_command("r6_get_pose")
def r6_get_pose(params):
    """Friendly joint values {rot, pos} at a frame (default current); root_motion full|in_place|ignore_root."""
    rig = _rig(params)
    return _r6("pose").read_pose(rig, frame=_int(params, "frame", None),
                                 root_motion=_choice(params, "root_motion", "ignore_root", _ROOT_MOTION))


@r6_command("r6_read_clip")
def r6_read_clip(params):
    """Read an action back as a clip dict. frames: "keys" (default), "all" or an integer step."""
    rig = _rig(params)
    frames = _get(params, "frames", "keys")
    if isinstance(frames, str):
        frames = frames.strip().lower()
        if frames not in ("keys", "all"):
            raise ValueError("'frames' must be \"keys\", \"all\" or an integer step, got %r" % frames)
    else:
        frames = _int(params, "frames", None, lo=1)
    return _r6("pose").read_clip(rig, action=_str(params, "action", None) or None, frames=frames)


@r6_command("r6_list_actions")
def r6_list_actions(params):
    """Actions that animate this rig (name, frame range, loop/priority props, which one is active)."""
    return _r6("pose").list_actions(_rig(params))


@r6_command("r6_set_action", mutates=True)
def r6_set_action(params):
    """Make an action the rig's active one. params: action (or name)."""
    name = _str(params, "action", None) or _str(params, "name")
    return _r6("pose").set_active_action(_rig(params), name)


@r6_command("r6_mirror_action", mutates=True)
def r6_mirror_action(params):
    """Left/right mirrored copy of an action (default: active). params: action, new_name."""
    return _r6("pose").mirror_action(_rig(params), action=_str(params, "action", None) or None,
                                     new_name=_str(params, "new_name", None) or None)


@r6_command("r6_retime_action", mutates=True)
def r6_retime_action(params):
    """Copy of an action played `speed` times faster (0.5 = twice as slow). params: action, speed, new_name."""
    return _r6("pose").retime_action(_rig(params), action=_str(params, "action", None) or None,
                                     speed=_float(params, "speed", 1.0, lo=0.0, hi=20.0, exclusive_lo=True),
                                     new_name=_str(params, "new_name", None) or None)


# ---------------------------------------------------------------------------
# review & export
# ---------------------------------------------------------------------------

@r6_command("r6_preview")
def r6_preview(params):
    """Render a PNG preview (Workbench). params: action, frames [..], count 8, view
    front|back|left|right|three_quarter|top, tile 384, mode grid|onion, ground true, output_path.
    Returns {path, frames, view, mode, size}."""
    preview = _r6("preview")
    rig = _rig(params)
    frames = _get(params, "frames", None)
    if frames is not None:
        if not isinstance(frames, list) or not frames or not all(
                isinstance(f, numbers.Real) and not isinstance(f, bool) for f in frames):
            raise ValueError("'frames' must be a non-empty list of frame numbers")
        if len(frames) > 24:
            raise ValueError("At most 24 frames per preview, got %d" % len(frames))
    count = _int(params, "count", 8, 1, 24)
    tile = _int(params, "tile", 384, 96, 1024)
    mode = _choice(params, "mode", "grid", preview.MODES)
    n = len(frames) if frames else count
    if mode == "grid" and max(min(4, n), math.ceil(n / 4.0)) * tile > 4096:
        raise ValueError("A grid of %d frames at tile %d px exceeds 4096 px; lower 'tile' or 'count'" % (n, tile))
    return preview.render_preview(
        rig, action=_str(params, "action", None) or None, frames=frames, count=count,
        view=_choice(params, "view", "three_quarter", preview.VIEWS, _VIEW_ALIASES),
        tile=tile, mode=mode,
        ground=_bool(params, "ground", True),
        output_path=_str(params, "output_path", None) or None)


@r6_command("r6_analyze")
def r6_analyze(params):
    """Quality metrics of an action: foot contact/sliding, ground penetration, loop seam, speed spikes, issues."""
    rig = _rig(params)
    return _r6("analyze").analyze_action(rig, action=_str(params, "action", None) or None,
                                         root_motion=_choice(params, "root_motion", "full", _ROOT_MOTION))


@r6_command("r6_export")
def r6_export(params):
    """Export an action for Roblox. params: action, output_dir (default //exports next to the .blend, else
    %TEMP%), formats ["rbxmx", "lua", "json"], plus export options (name, loop, priority, root_motion, reduce,
    joints (animate only these; ancestors become Weight 0 poses), grip "tool"|"weapongrip"...)."""
    rig = _rig(params)
    export = _r6("export")
    output_dir = _str(params, "output_dir", None) or _default_export_dir()
    output_dir = bpy.path.abspath(output_dir)
    formats = _get(params, "formats", list(_EXPORT_FORMATS))
    if isinstance(formats, str):
        formats = [formats]
    if not isinstance(formats, list) or not formats:
        raise ValueError("'formats' must be a non-empty list from %s" % list(_EXPORT_FORMATS))
    clean = []
    for f in formats:
        f = str(f).strip().lower()
        f = "lua" if f == "luau" else f
        if f not in _EXPORT_FORMATS:
            raise ValueError("Unknown export format %r. Use %s" % (f, list(_EXPORT_FORMATS)))
        if f not in clean:
            clean.append(f)
    if "root_motion" in params:
        _choice(params, "root_motion", "full", _ROOT_MOTION)
    opts = {k: v for k, v in params.items() if k not in ("armature", "action", "output_dir", "formats")}
    allowed = set(inspect.signature(export.build_export).parameters) - {"rig", "action"}
    unknown = sorted(set(opts) - allowed)
    if unknown:
        raise ValueError("Unknown export option(s) %s. Allowed: %s" % (unknown, sorted(allowed)))
    os.makedirs(output_dir, exist_ok=True)
    return export.export_action(rig, action=_str(params, "action", None) or None, output_dir=output_dir,
                                formats=tuple(clean), **opts)


# ---------------------------------------------------------------------------
# weapons
# ---------------------------------------------------------------------------

@r6_command("r6_attach_weapon", mutates=True)
def r6_attach_weapon(params):
    """Hold a weapon like a Roblox Tool (grip at the hand, blade forward with the arm down).

    params: kind sword|greatsword|katana|dagger|axe|spear|mace|staff|shield|bow (default sword),
    hand Right|Left (default Left for shield/bow), object_name (use your own model: origin = grip, blade
    along local +Z), keep_transform false, replace true (swap out what that hand holds).
    """
    weapons = _r6("weapons")
    rig = _rig(params)
    return weapons.attach_weapon(rig, kind=_str(params, "kind", "sword"), hand=_str(params, "hand", None) or None,
                                 object_name=_str(params, "object_name", None) or None,
                                 replace=_bool(params, "replace", True),
                                 keep_transform=_bool(params, "keep_transform", False))


@r6_command("r6_detach_weapon", mutates=True)
def r6_detach_weapon(params):
    """Remove a weapon by name, or every weapon of the rig (optionally only one hand). Placeholders are deleted,
    your own objects are unparented in place."""
    weapons = _r6("weapons")
    name = _str(params, "name", None) or None
    hand = _str(params, "hand", None) or None
    if name:
        return weapons.detach_weapon(name)
    return weapons.detach_weapon(None, rig=_rig(params), hand=hand)


@r6_command("r6_list_weapons")
def r6_list_weapons(params):
    """Weapons in the file (only those held by `armature` when given)."""
    weapons = _r6("weapons")
    rig = _rig(params) if params.get("armature") else None
    items = weapons.list_weapons(rig)
    return {"weapons": items, "count": len(items), "kinds": list(weapons.KINDS)}
