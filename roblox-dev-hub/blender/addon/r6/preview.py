"""Workbench previews of an R6 animation: contact-sheet grid or onion-skin overlay (works headless).

The scene is borrowed, never left modified: render/shading/color settings, camera, frame, the rig's active
action, object render visibility and the rig's pose are restored and every temporary datablock is removed,
even when rendering fails. Renders are composed with numpy and written with a tiny PNG writer.
"""

import math
import os
import re
import shutil
import struct
import tempfile
import zlib

import bpy
import numpy as np
from mathutils import Matrix, Vector

from . import cframe as cfm
from . import rig as rigm
from . import weapons as wpn

VIEWS = ("front", "back", "left", "right", "three_quarter", "top")
MODES = ("grid", "onion")
MAX_COLUMNS = 4

_BG = np.array([0.80, 0.81, 0.83], np.float32)            # neutral background (sRGB)
_SEPARATOR = np.array([0.45, 0.46, 0.49], np.float32)
_GHOST_TINT = np.array([0.36, 0.52, 0.78], np.float32)    # older onion frames drift toward this
_GROUND_COLORS = ((0.42, 0.43, 0.45, 1.0), (0.50, 0.51, 0.53, 1.0))  # checker, linear
_ELEVATION = {"front": 12.0, "back": 12.0, "left": 12.0, "right": 12.0, "three_quarter": 22.0}
_NOT_RENDERED = {"ARMATURE", "CAMERA", "LIGHT", "LIGHT_PROBE", "SPEAKER", "LATTICE", "EMPTY"}

# 3x5 bitmap font, rows top to bottom
_FONT = {
    "0": "111101101101111", "1": "010110010010111", "2": "111001111100111", "3": "111001111001111",
    "4": "101101111001001", "5": "111100111001111", "6": "111100111101111", "7": "111001001001001",
    "8": "111101111101111", "9": "111101111001111", "-": "000000111000000", " ": "000000000000000",
    "/": "001001010100100",
}


# ---------------------------------------------------------------------------
# Image helpers (numpy, top-down rows, float sRGB in [0, 1])
# ---------------------------------------------------------------------------

def write_png(path, rgb):
    """Write an (h, w, 3|4) float [0,1] or uint8 array as an 8-bit PNG (top row first)."""
    arr = rgb if rgb.dtype == np.uint8 else (np.clip(rgb, 0.0, 1.0) * 255.0 + 0.5).astype(np.uint8)
    h, w, c = arr.shape
    raw = np.concatenate([np.zeros((h, 1), np.uint8), arr.reshape(h, w * c)], axis=1).tobytes()

    def chunk(tag, data):
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    color_type = {3: 2, 4: 6}[c]
    png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, color_type, 0, 0, 0))
           + chunk(b"IDAT", zlib.compress(raw, 6)) + chunk(b"IEND", b""))
    with open(path, "wb") as fh:
        fh.write(png)


def _text_mask(text, scale):
    glyphs = []
    for ch in text:
        bits = _FONT.get(ch, _FONT[" "])
        glyphs.append(np.array([[b == "1" for b in bits[r * 3:r * 3 + 3]] for r in range(5)], bool))
        glyphs.append(np.zeros((5, 1), bool))
    mask = np.concatenate(glyphs[:-1], axis=1) if glyphs else np.zeros((5, 1), bool)
    return np.kron(mask, np.ones((scale, scale), bool))


def _draw_label(img, x, y, text, scale):
    """Burn white text on a dark translucent box at (x, y) = top-left corner, clipped to the image."""
    mask = _text_mask(text, scale)
    pad = scale + 1
    h, w = mask.shape[0] + 2 * pad, mask.shape[1] + 2 * pad
    y1, x1 = min(img.shape[0], y + h), min(img.shape[1], x + w)
    if y1 <= y or x1 <= x:
        return
    box = img[y:y1, x:x1]
    box[:] = box * 0.28 + np.array([0.06, 0.06, 0.08], np.float32) * 0.72
    m = mask[:max(0, y1 - y - pad), :max(0, x1 - x - pad)]
    region = img[y + pad:y + pad + m.shape[0], x + pad:x + pad + m.shape[1]]
    region[m] = 0.97


def _over(dst, rgba, fade=1.0, tint=None, tint_amount=0.0):
    """Alpha-composite a straight-alpha RGBA layer over an RGB image."""
    rgb = rgba[..., :3]
    if tint is not None and tint_amount > 0:
        rgb = rgb * (1.0 - tint_amount) + tint * tint_amount
    a = rgba[..., 3:4] * fade
    return rgb * a + dst * (1.0 - a)


# ---------------------------------------------------------------------------
# Scene state borrowing
# ---------------------------------------------------------------------------

class _State:
    """Records attribute values before changing them; restore() puts them back in reverse order."""

    def __init__(self):
        self.items = []
        self.errors = []

    def set(self, owner, attr, value):
        old = getattr(owner, attr)
        if type(old).__name__ in ("bpy_prop_array", "Vector", "Color", "Euler", "Quaternion"):
            old = tuple(old)  # copy: these are live views on the data
        self.items.append((owner, attr, old))
        setattr(owner, attr, value)

    def try_set(self, owner, attr, value):
        try:
            self.set(owner, attr, value)
        except Exception as exc:  # optional setting (e.g. a missing studio light)
            self.errors.append("could not set %s: %s" % (attr, exc))

    def restore(self):
        for owner, attr, old in reversed(self.items):
            try:
                setattr(owner, attr, old)
            except Exception as exc:
                self.errors.append("could not restore %s: %s" % (attr, exc))
        self.items = []


def _snapshot_pose(arm):
    return [(pb.name, tuple(pb.location), tuple(pb.rotation_quaternion), tuple(pb.rotation_euler),
             tuple(pb.rotation_axis_angle), tuple(pb.scale)) for pb in arm.pose.bones]


def _restore_pose(arm, snap):
    for name, loc, rq, re_, raa, sc in snap:
        pb = arm.pose.bones.get(name)
        if pb is None:
            continue
        pb.location, pb.rotation_quaternion, pb.rotation_euler = loc, rq, re_
        pb.rotation_axis_angle, pb.scale = raa, sc


def _resolve_action(rig, action):
    if action is None or action == "":
        ad = rig.armature.animation_data
        return ad.action if ad else None
    if isinstance(action, bpy.types.Action):
        return action
    act = bpy.data.actions.get(str(action))
    if act is None:
        raise ValueError("Action '%s' not found. Actions: %s" % (action, [a.name for a in bpy.data.actions]))
    return act


def _assign_action(ob, action, undo):
    """Temporarily make `action` active on ob (records how to undo it)."""
    created = ob.animation_data is None
    if created and action is None:
        return
    ad = ob.animation_data or ob.animation_data_create()
    if not created and ad.action == action:
        return
    undo.append((ob, created, ad.action, ad.action_slot))
    ad.action = action
    if action is not None and ad.action_slot is None:
        for slot in action.slots:
            if slot.target_id_type in ("OBJECT", "UNSPECIFIED"):
                ad.action_slot = slot
                break


def _restore_actions(undo):
    for ob, created, old_action, old_slot in reversed(undo):
        if created:
            ob.animation_data_clear()
            continue
        ad = ob.animation_data
        ad.action = old_action
        if old_action is not None and old_slot is not None:
            try:
                ad.action_slot = old_slot
            except Exception:
                pass


# ---------------------------------------------------------------------------
# Preview building blocks
# ---------------------------------------------------------------------------

def pick_frames(scene, action, frames=None, count=8):
    """Frames to show: explicit list, else `count` evenly spaced frames of the action (scene range if none).

    Loops (action prop r6_loop or cyclic) skip the last frame since it repeats the first.
    """
    if frames:
        return sorted({int(round(f)) for f in frames})
    loop = False
    if action is not None:
        if action.use_frame_range:
            start, end = action.frame_start, action.frame_end
        else:
            start, end = action.frame_range
        loop = bool(action.get("r6_loop", False)) or bool(action.use_cyclic)
    else:
        start, end = scene.frame_start, scene.frame_end
    start, end = int(round(start)), int(round(end))
    count = max(1, int(count))
    if end <= start:
        return [start]
    if loop:
        n = min(count, end - start)
        picked = [start + (end - start) * i / n for i in range(n)]
    else:
        n = min(count, end - start + 1)
        picked = [start + (end - start) * i / (n - 1) for i in range(n)] if n > 1 else [start]
    return sorted({int(round(f)) for f in picked})


def _visible(ob):
    try:
        return ob.visible_get() and not ob.hide_render
    except Exception:  # not in the view layer
        return False


def _view_basis(rig, view):
    """World-space camera axes (x = screen right, y = screen up, z = toward the camera)."""
    m3 = rig.armature.matrix_world.to_3x3()
    right = (m3 @ rig.axes["right"]).normalized()
    up = (m3 @ rig.axes["up"]).normalized()
    back = (m3 @ rig.axes["back"]).normalized()
    fwd = -back  # the character faces -back
    if view == "top":
        z, hint = up, fwd
    else:
        horizontal = {"front": fwd, "back": back, "left": -right, "right": right,
                      "three_quarter": (fwd + right).normalized()}[view]
        e = math.radians(_ELEVATION[view])
        z, hint = (horizontal * math.cos(e) + up * math.sin(e)).normalized(), up
    x = hint.cross(z).normalized()
    y = z.cross(x).normalized()
    return x, y, z


def _bounds_points(meshes, frames, scene):
    pts = []
    for f in frames:
        scene.frame_set(f)
        dg = bpy.context.evaluated_depsgraph_get()
        for ob in meshes:
            ev = ob.evaluated_get(dg)
            mw = ev.matrix_world
            pts.extend(mw @ Vector(c) for c in ev.bound_box)
    return pts


def _frame_camera(cam_data, basis, pts, res_x, res_y, scale):
    """Orthographic framing of pts; returns the camera world matrix."""
    x, y, z = basis
    px = [p.dot(x) for p in pts]
    py = [p.dot(y) for p in pts]
    pz = [p.dot(z) for p in pts]
    margin = 0.25 * scale
    w = (max(px) - min(px)) * 1.1 + 2 * margin
    h = (max(py) - min(py)) * 1.1 + 2 * margin
    cx, cy = (max(px) + min(px)) / 2.0, (max(py) + min(py)) / 2.0
    if res_x >= res_y:
        cam_data.ortho_scale = max(w, h * res_x / float(res_y))
    else:
        cam_data.ortho_scale = max(h, w * res_y / float(res_x))
    dist = 60.0 * scale
    depth = max(pz) - min(pz)
    cam_data.clip_start = 0.05 * scale
    cam_data.clip_end = dist + depth + 400.0 * scale
    mat = Matrix((x, y, z)).transposed().to_4x4()
    mat.translation = x * cx + y * cy + z * (max(pz) + dist)
    return mat


def projected_aspect(basis, pts):
    x, y, _z = basis
    w = max(p.dot(x) for p in pts) - min(p.dot(x) for p in pts)
    h = max(p.dot(y) for p in pts) - min(p.dot(y) for p in pts)
    return (w + 0.5) / (h + 0.5)


def rest_foot_level(rig):
    """Lowest leg corner at rest, character-space Y (studs): -3 for a standard R6."""
    lows = []
    for leg in ("Left Leg", "Right Leg"):
        sx, sy, sz = (s / 2.0 for s in cfm.R6_SIZES[leg])
        cf = rig.rest_parts[leg]
        lows.extend((cf @ Vector((a, b, c))).y for a in (-sx, sx) for b in (-sy, sy) for c in (-sz, sz))
    return min(lows)


def _build_ground(rig, pts, temp, min_half):
    """Checkerboard (1-stud squares) under the motion, at the rest foot level; world-space vertices.

    min_half (studs) keeps the near edge out of the frame in elevated views.
    """
    to_char = rig.to_char @ rig.armature.matrix_world.inverted()
    cpts = [to_char @ p for p in pts]
    xs, zs = [p.x for p in cpts], [p.z for p in cpts]
    cx, cz = (max(xs) + min(xs)) / 2.0, (max(zs) + min(zs)) / 2.0
    hx = max(min_half, (max(xs) - min(xs)) / 2.0 + 2.0)
    hz = max(min_half, (max(zs) - min(zs)) / 2.0 + 2.0)
    cell = 1.0
    while max(hx, hz) * 2.0 / cell > 48:
        cell *= 2.0
    x0, x1 = math.floor((cx - hx) / cell), math.ceil((cx + hx) / cell)
    z0, z1 = math.floor((cz - hz) / cell), math.ceil((cz + hz) / cell)
    gy = rest_foot_level(rig) - 0.01  # a hair below the soles to avoid z-fighting
    to_world = rig.armature.matrix_world @ rig.from_char
    nx, nz = x1 - x0, z1 - z0
    verts = [to_world @ Vector((i * cell, gy, k * cell)) for k in range(z0, z1 + 1) for i in range(x0, x1 + 1)]
    faces, mats = [], []
    for k in range(nz):
        for i in range(nx):
            a = k * (nx + 1) + i
            faces.append((a, a + 1, a + nx + 2, a + nx + 1))
            mats.append((i + x0 + k + z0) % 2)
    me = bpy.data.meshes.new("Claude_PreviewGround")
    temp["meshes"].append(me)
    me.from_pydata(verts, [], faces)
    me.polygons.foreach_set("material_index", mats)
    up = (rig.armature.matrix_world.to_3x3() @ rig.axes["up"]).normalized()
    if me.polygons and me.polygons[0].normal.dot(up) < 0:
        me.flip_normals()
    for n, color in enumerate(_GROUND_COLORS):
        mat = bpy.data.materials.new("Claude_PreviewGround_%d" % n)
        temp["materials"].append(mat)
        mat.diffuse_color = color
        mat.roughness = 1.0
        me.materials.append(mat)
    me.update()
    ob = bpy.data.objects.new("Claude_PreviewGround", me)
    temp["objects"].append(ob)
    return ob


def _textured(meshes):
    for ob in meshes:
        for slot in ob.material_slots:
            m = slot.material
            if m is not None and m.node_tree is not None and any(
                    n.type == "TEX_IMAGE" and n.image is not None for n in m.node_tree.nodes):
                return True
    return False


def _render(scene, tmpdir, tag, temp):
    """Render the current frame, return straight-alpha RGBA float (h, w, 4), top row first."""
    base = os.path.join(tmpdir, tag)
    scene.render.filepath = base
    bpy.ops.render.render(write_still=True, scene=scene.name)
    # a still render writes <filepath>.png; some versions append the frame number
    candidates = [base + ".png", scene.render.frame_path(frame=scene.frame_current)]
    candidates += sorted(os.path.join(tmpdir, n) for n in os.listdir(tmpdir) if n.startswith(tag))
    path = next((p for p in candidates if os.path.isfile(p)), None)
    if path is None:
        raise RuntimeError("Workbench render did not write an image to %s" % tmpdir)
    img = bpy.data.images.load(path, check_existing=False)
    temp["images"].append(img)
    try:
        w, h = img.size
        buf = np.empty(w * h * 4, np.float32)
        img.pixels.foreach_get(buf)
    finally:
        temp["images"].remove(img)
        bpy.data.images.remove(img)
    return buf.reshape(h, w, 4)[::-1].copy()


def _default_output(action, view, mode):
    name = re.sub(r"[^A-Za-z0-9_-]+", "_", action.name if action else "scene").strip("_") or "anim"
    folder = os.path.join(tempfile.gettempdir(), "claude_blender")
    return os.path.join(folder, "preview_%s_%s_%s.png" % (name, view, mode))


def _compose_grid(renders, frames, tile):
    n = len(renders)
    cols = min(MAX_COLUMNS, n)
    rows = int(math.ceil(n / float(cols)))
    canvas = np.empty((rows * tile, cols * tile, 3), np.float32)
    canvas[:] = _BG
    scale = max(2, int(round(tile / 128.0)))
    for i, (f, rgba) in enumerate(zip(frames, renders)):
        r, c = divmod(i, cols)
        cell = canvas[r * tile:(r + 1) * tile, c * tile:(c + 1) * tile]
        cell[:] = _over(cell, rgba)
        _draw_label(canvas, c * tile + 2 * scale, r * tile + 2 * scale, str(f), scale)
    for r in range(1, rows):
        canvas[r * tile - 1:r * tile + 1, :] = _SEPARATOR
    for c in range(1, cols):
        canvas[:, c * tile - 1:c * tile + 1] = _SEPARATOR
    return canvas


def _compose_onion(renders, frames, ground_layer, label_scale):
    h, w = renders[0].shape[:2]
    canvas = np.empty((h, w, 3), np.float32)
    canvas[:] = _BG
    if ground_layer is not None:
        canvas = _over(canvas, ground_layer)
    n = len(renders)
    for i, rgba in enumerate(renders):
        if i == n - 1:
            canvas = _over(canvas, rgba)
        else:
            t = i / float(n - 1)
            canvas = _over(canvas, rgba, fade=0.2 + 0.55 * t ** 1.3, tint=_GHOST_TINT, tint_amount=0.45 * (1 - t))
    text = str(frames[0]) if n == 1 else "%d-%d" % (frames[0], frames[-1])
    _draw_label(canvas, 2 * label_scale, 2 * label_scale, text, label_scale)
    return canvas


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def render_preview(rig, action=None, frames=None, count=8, view="three_quarter", tile=384, mode="grid",
                   ground=True, output_path=None, isolate=True):
    """Render a preview PNG of the rig's animation with the Workbench engine.

    action: name or Action (default: the armature's active action), frames: explicit scene frames
    (default: `count` frames spread over the action range). view: front|back|left|right|three_quarter|top
    (relative to the character, which faces -rig.axes["back"]). mode "grid": tiles of `tile` px, at most 4
    columns, frame number burned in each tile. mode "onion": one image (long side 2*tile) with every frame
    overlaid, older frames fainter and bluer, the last frame opaque. ground: checkerboard at the rest foot
    level (1-stud squares). isolate: hide every other renderable object during the render.
    Returns {"path", "frames", "view", "mode", "size": [w, h], "action", "warnings"}.
    """
    if view not in VIEWS:
        raise ValueError("view must be one of %s, got %r" % (VIEWS, view))
    if mode not in MODES:
        raise ValueError("mode must be one of %s, got %r" % (MODES, mode))
    tile = int(tile)
    if not 64 <= tile <= 2048:
        raise ValueError("tile must be between 64 and 2048 px, got %d" % tile)

    scene = bpy.context.scene
    arm = rig.armature
    act = _resolve_action(rig, action)
    state = _State()
    action_undo = []
    temp = {"objects": [], "meshes": [], "cameras": [], "materials": [], "images": []}
    images_before = set(bpy.data.images.keys())
    frame_before = (scene.frame_current, scene.frame_subframe)
    weapons = [ob for ob in bpy.data.objects if ob.get("claude_weapon") and ob.parent == arm]
    pose_before = _snapshot_pose(arm)
    weapon_before = [(ob, ob.matrix_basis.copy()) for ob in weapons]
    tmpdir = tempfile.mkdtemp(prefix="claude_preview_")
    warnings = []
    try:
        if act is not None:
            _assign_action(arm, act, action_undo)
            # the right-hand weapon plays the action's linked "Handle" action (r6.pose convention)
            weapon_act = (bpy.data.actions.get(act.get("r6_weapon_action", "")) or
                          bpy.data.actions.get(act.name + "_Weapon"))
            for ob in weapons:
                if str(ob.get("claude_hand", "Right")) != "Right":
                    continue
                current = ob.animation_data.action if ob.animation_data else None
                if weapon_act is not None:
                    _assign_action(ob, weapon_act, action_undo)
                elif current is not None and current.get("r6_weapon_of") not in (None, act.name):
                    _assign_action(ob, None, action_undo)  # another clip's Handle motion: back to the plain grip
                    ob.matrix_basis = wpn.grip_basis(rig, ob)
        frame_list = pick_frames(scene, act, frames, count)

        meshes = [ob for ob in rigm.rig_meshes(arm) if _visible(ob)]
        if not meshes:
            raise RuntimeError("No visible mesh follows armature '%s'; nothing to render" % arm.name)
        mesh_set = set(meshes)
        if isolate:
            for ob in scene.objects:
                if ob not in mesh_set and ob.type not in _NOT_RENDERED and not ob.hide_render:
                    state.set(ob, "hide_render", True)
        else:  # rig meshes the user hid in the viewport stay hidden in the render too
            for ob in rigm.rig_meshes(arm):
                if ob not in mesh_set and not ob.hide_render:
                    state.set(ob, "hide_render", True)

        pts = _bounds_points(meshes, frame_list, scene)
        basis = _view_basis(rig, view)
        if mode == "grid":
            res = (tile, tile)
        else:
            aspect = min(2.0, max(0.5, projected_aspect(basis, pts)))
            long_side = 2 * tile
            res = (long_side, int(round(long_side / aspect))) if aspect >= 1 else (int(round(long_side * aspect)),
                                                                                    long_side)

        cam_data = bpy.data.cameras.new("Claude_PreviewCam")
        temp["cameras"].append(cam_data)
        cam_data.type = "ORTHO"
        cam_data.sensor_fit = "AUTO"
        cam_ob = bpy.data.objects.new("Claude_PreviewCam", cam_data)
        temp["objects"].append(cam_ob)
        scene.collection.objects.link(cam_ob)
        cam_ob.matrix_world = _frame_camera(cam_data, basis, pts, res[0], res[1], rig.scale)

        ground_ob = None
        if ground:
            ground_ob = _build_ground(rig, pts, temp, max(3.0, cam_data.ortho_scale / rig.scale))
            scene.collection.objects.link(ground_ob)

        render, shading, view_settings = scene.render, scene.display.shading, scene.view_settings
        state.set(scene, "camera", cam_ob)
        state.set(render, "engine", "BLENDER_WORKBENCH")
        state.set(render, "resolution_x", res[0])
        state.set(render, "resolution_y", res[1])
        state.set(render, "resolution_percentage", 100)
        state.set(render, "pixel_aspect_x", 1.0)
        state.set(render, "pixel_aspect_y", 1.0)
        state.set(render, "film_transparent", True)
        state.set(render, "use_border", False)
        state.set(render, "use_compositing", False)
        state.set(render, "use_sequencer", False)
        state.set(render, "use_stamp", False)
        state.set(render, "use_multiview", False)
        state.set(render, "use_file_extension", True)
        state.set(render, "dither_intensity", 0.0)
        state.set(render, "filepath", render.filepath)
        ims = render.image_settings
        if hasattr(ims, "media_type"):
            state.try_set(ims, "media_type", "IMAGE")
        state.set(ims, "file_format", "PNG")
        state.set(ims, "color_mode", "RGBA")
        state.set(ims, "color_depth", "8")
        state.set(ims, "compression", 15)
        state.try_set(ims, "color_management", "FOLLOW_SCENE")
        state.try_set(view_settings, "view_transform", "Standard")
        state.try_set(view_settings, "look", "None")
        state.set(view_settings, "exposure", 0.0)
        state.set(view_settings, "gamma", 1.0)
        state.set(view_settings, "use_curve_mapping", False)
        state.set(scene.display, "render_aa", "8")
        state.set(shading, "light", "STUDIO")
        state.try_set(shading, "studio_light", "Default")
        state.set(shading, "color_type", "TEXTURE" if _textured(meshes) else "MATERIAL")
        state.set(shading, "show_object_outline", True)
        state.set(shading, "object_outline_color", (0.05, 0.05, 0.06))
        state.set(shading, "show_shadows", False)
        state.set(shading, "show_cavity", False)
        state.set(shading, "show_xray", False)
        state.set(shading, "show_backface_culling", False)
        state.set(shading, "show_specular_highlight", True)
        state.set(shading, "use_dof", False)

        ground_layer = None
        if ground_ob is not None and mode == "onion":
            for ob in meshes:  # ground alone, drawn once under every ghost
                state.set(ob, "hide_render", True)
            scene.frame_set(frame_list[-1])
            ground_layer = _render(scene, tmpdir, "ground", temp)
            for ob in meshes:
                ob.hide_render = False
            state.set(ground_ob, "hide_render", True)

        renders = []
        for i, f in enumerate(frame_list):
            scene.frame_set(f)
            renders.append(_render(scene, tmpdir, "f%03d" % i, temp))

        label_scale = max(2, int(round(tile / 128.0)))
        if mode == "grid":
            canvas = _compose_grid(renders, frame_list, tile)
        else:
            canvas = _compose_onion(renders, frame_list, ground_layer, label_scale)

        path = bpy.path.abspath(output_path) if output_path else _default_output(act, view, mode)
        if not path.lower().endswith(".png"):
            path += ".png"
        folder = os.path.dirname(os.path.abspath(path))
        os.makedirs(folder, exist_ok=True)
        write_png(path, canvas)
        size = [int(canvas.shape[1]), int(canvas.shape[0])]
    finally:
        errors = []

        def attempt(fn, *args):
            try:
                fn(*args)
            except Exception as exc:
                errors.append("%s: %s" % (getattr(fn, "__name__", "restore"), exc))

        attempt(_restore_actions, action_undo)
        attempt(state.restore)
        errors.extend(state.errors)
        for img in list(temp["images"]):
            attempt(bpy.data.images.remove, img)
        for ob in temp["objects"]:
            attempt(bpy.data.objects.remove, ob)
        for cam in temp["cameras"]:
            attempt(bpy.data.cameras.remove, cam)
        for me in temp["meshes"]:
            attempt(bpy.data.meshes.remove, me)
        for mat in temp["materials"]:
            attempt(bpy.data.materials.remove, mat)
        for name in set(bpy.data.images.keys()) - images_before:
            img = bpy.data.images.get(name)
            if img is not None and img.type == "RENDER_RESULT":
                attempt(bpy.data.images.remove, img)
        attempt(lambda: scene.frame_set(frame_before[0], subframe=frame_before[1]))
        attempt(_restore_pose, arm, pose_before)
        for ob, mb in weapon_before:
            attempt(setattr, ob, "matrix_basis", mb)
        attempt(bpy.context.view_layer.update)
        shutil.rmtree(tmpdir, ignore_errors=True)
        if errors:
            print("[claude_blender_mcp] preview restore problems:", errors)
        warnings.extend(errors)

    return {"path": path, "frames": frame_list, "view": view, "mode": mode, "size": size,
            "action": act.name if act else None, "warnings": warnings}
