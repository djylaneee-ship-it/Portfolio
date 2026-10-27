"""Modeling commands: multi-angle view of the model (Workbench, works with or without the UI) and mesh stats."""

import math
import os
import shutil
import tempfile
import time

import bpy
import numpy as np
from mathutils import Matrix, Vector

from . import command
from .. import rx
from ..server import CommandError
from ..r6 import preview as pv

_DIRS = {
    "front": Vector((0, -1, 0)), "back": Vector((0, 1, 0)), "right": Vector((1, 0, 0)), "left": Vector((-1, 0, 0)),
    "top": Vector((0, 0, 1)), "bottom": Vector((0, 0, -1)),
    "persp": Vector((1, -1, 0.75)).normalized(), "persp_back": Vector((-1, 1, 0.75)).normalized(),
}
_RENDERABLE = {"MESH", "CURVE", "SURFACE", "META", "FONT", "CURVES", "POINTCLOUD", "VOLUME", "GREASEPENCIL"}


def _targets(params):
    names = params.get("objects")
    if names:
        return [rx.obj(n) for n in names]
    coll = params.get("collection")
    if coll:
        c = bpy.data.collections.get(coll)
        if c is None:
            raise CommandError("Collection '%s' not found" % coll)
        return [o for o in c.all_objects if o.type in _RENDERABLE]
    return [o for o in bpy.context.scene.objects if o.type in _RENDERABLE and o.visible_get() and not o.hide_render]


def _persp_matrix(direction, pts, cam):
    cam.lens = 50
    fov = 2 * math.atan(cam.sensor_width / (2 * cam.lens))
    center = sum(pts, Vector()) / len(pts)
    radius = max(max((p - center).length for p in pts), 1e-3)
    dist = radius / math.sin(fov / 2) * 1.02
    z = direction.normalized()
    x = Vector((0, 0, 1)).cross(z).normalized()
    y = z.cross(x).normalized()
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = center + z * dist
    cam.clip_start = max(0.001, (dist - radius * 2) * 0.1)
    cam.clip_end = dist + radius * 4
    return m


def _camera_matrix(direction, pts, cam):
    z = direction.normalized()
    hint = Vector((0, 1, 0)) if abs(z.z) > 0.99 else Vector((0, 0, 1))
    x = hint.cross(z).normalized()
    y = z.cross(x).normalized()
    px = [p.dot(x) for p in pts]
    py = [p.dot(y) for p in pts]
    pz = [p.dot(z) for p in pts]
    w, h = max(px) - min(px), max(py) - min(py)
    size = max(w, h, 1e-3) * 1.12 + 0.02
    cam.ortho_scale = size
    cx, cy = (max(px) + min(px)) / 2, (max(py) + min(py)) / 2
    span = max(pz) - min(pz)
    dist = span + size * 4 + 1
    cam.clip_start = 0.001 * size
    cam.clip_end = dist + span + size * 10
    m = Matrix((x, y, z)).transposed().to_4x4()
    m.translation = x * cx + y * cy + z * (max(pz) + dist)
    return m


def _wire_overlay(obs, pts, scene, temp):
    """Workbench renders have no overlays: draw the edges with thin Wireframe copies of the meshes."""
    size = max((max(p[i] for p in pts) - min(p[i] for p in pts)) for i in range(3)) or 1.0
    black = bpy.data.materials.new("Claude_ViewWire")
    temp["materials"].append(black)
    black.diffuse_color = (0.02, 0.02, 0.03, 1.0)
    for o in obs:
        if o.type != "MESH":
            continue
        me = o.data.copy()
        temp["meshes"].append(me)
        me.materials.clear()
        me.materials.append(black)
        dup = bpy.data.objects.new("Claude_ViewWire", me)
        temp["objects"].append(dup)
        scene.collection.objects.link(dup)
        dup.matrix_world = o.matrix_world
        mod = dup.modifiers.new("Wire", "WIREFRAME")
        mod.thickness = size * 0.0025 / (sum(o.matrix_world.to_scale()) / 3.0 or 1.0)
        mod.use_replace = True
        mod.use_even_offset = True


@command("view")
def view(params):
    """Render the model from several angles in one PNG (Workbench): views = front, back, left, right, top,
    bottom, persp, persp_back (default front, right, top, persp). objects / collection restrict what is shown
    (default: visible objects). shading: solid (material colors), clay (gray), wireframe (solid + edges), xray (see-through + edges),
    texture.
    tile = pixels per view (default 448). frame = scene frame. Returns {"path", "views", "size"}."""
    views = params.get("views") or ["front", "right", "top", "persp"]
    bad = [v for v in views if v not in _DIRS]
    if bad:
        raise CommandError("Unknown view %s. Views: %s" % (bad, ", ".join(_DIRS)))
    tile = int(params.get("tile") or 448)
    if not 96 <= tile <= 1600:
        raise CommandError("tile must be between 96 and 1600")
    shading_mode = (params.get("shading") or "solid").lower()
    obs = _targets(params)
    if not obs:
        raise CommandError("Nothing to show: no visible mesh in the scene")
    scene = bpy.context.scene
    for o in obs:
        if o.mode == "EDIT":
            o.update_from_editmode()
    state = pv._State()
    temp = {"objects": [], "meshes": [], "cameras": [], "materials": [], "images": []}
    frame_before = (scene.frame_current, scene.frame_subframe)
    tmpdir = tempfile.mkdtemp(prefix="claude_view_")
    try:
        if params.get("frame") is not None:
            scene.frame_set(int(params["frame"]))
        keep = set(obs)
        for o in scene.objects:
            if o not in keep and o.type in _RENDERABLE and not o.hide_render:
                state.set(o, "hide_render", True)
        for o in obs:
            if o.hide_render:
                state.set(o, "hide_render", False)
        dg = bpy.context.evaluated_depsgraph_get()
        pts = []
        for o in obs:
            ev = o.evaluated_get(dg)
            pts.extend(ev.matrix_world @ Vector(c) for c in ev.bound_box)
        cam_data = bpy.data.cameras.new("Claude_ViewCam")
        temp["cameras"].append(cam_data)
        cam_data.type = "ORTHO"
        cam_ob = bpy.data.objects.new("Claude_ViewCam", cam_data)
        temp["objects"].append(cam_ob)
        scene.collection.objects.link(cam_ob)

        render, shading, vs = scene.render, scene.display.shading, scene.view_settings
        state.set(scene, "camera", cam_ob)
        state.set(render, "engine", "BLENDER_WORKBENCH")
        state.set(render, "resolution_x", tile)
        state.set(render, "resolution_y", tile)
        state.set(render, "resolution_percentage", 100)
        state.set(render, "film_transparent", True)
        state.set(render, "use_border", False)
        state.set(render, "use_compositing", False)
        state.set(render, "use_sequencer", False)
        state.set(render, "use_stamp", False)
        state.set(render, "filepath", render.filepath)
        ims = render.image_settings
        if hasattr(ims, "media_type"):
            state.try_set(ims, "media_type", "IMAGE")
        state.set(ims, "file_format", "PNG")
        state.set(ims, "color_mode", "RGBA")
        state.try_set(vs, "view_transform", "Standard")
        state.try_set(vs, "look", "None")
        state.set(scene.display, "render_aa", "8")
        state.set(shading, "light", "STUDIO")
        state.try_set(shading, "studio_light", "Default")
        state.set(shading, "color_type", {"clay": "SINGLE", "texture": "TEXTURE"}.get(shading_mode, "MATERIAL"))
        if shading_mode == "clay":
            state.set(shading, "single_color", (0.8, 0.8, 0.8))
        state.set(shading, "show_object_outline", True)
        state.set(shading, "object_outline_color", (0.05, 0.05, 0.06))
        state.set(shading, "show_cavity", shading_mode in ("solid", "clay", "texture"))
        state.try_set(shading, "cavity_type", "WORLD")
        state.set(shading, "show_shadows", False)
        state.set(shading, "show_xray", shading_mode == "xray")
        if shading_mode == "xray":
            state.set(shading, "xray_alpha", 0.4)
        state.set(shading, "show_backface_culling", False)
        state.set(shading, "use_dof", False)
        if shading_mode in ("wireframe", "xray"):
            _wire_overlay(obs, pts, scene, temp)

        renders = []
        for i, name in enumerate(views):
            d = _DIRS[name]
            cam_data.type = "PERSP" if name.startswith("persp") else "ORTHO"
            cam_ob.matrix_world = (_persp_matrix(d, pts, cam_data) if cam_data.type == "PERSP"
                                   else _camera_matrix(d, pts, cam_data))
            renders.append(pv._render(scene, tmpdir, "v%02d" % i, temp))
        cols = 2 if len(renders) in (2, 4) else min(3, len(renders))
        rows = int(math.ceil(len(renders) / float(cols)))
        canvas = np.empty((rows * tile, cols * tile, 3), np.float32)
        canvas[:] = np.array([0.80, 0.81, 0.83], np.float32)
        for i, rgba in enumerate(renders):
            r, c = divmod(i, cols)
            cell = canvas[r * tile:(r + 1) * tile, c * tile:(c + 1) * tile]
            cell[:] = pv._over(cell, rgba)
        for r in range(1, rows):
            canvas[r * tile - 1:r * tile + 1, :] = 0.45
        for c in range(1, cols):
            canvas[:, c * tile - 1:c * tile + 1] = 0.45
        folder = os.path.join(tempfile.gettempdir(), "claude_blender")
        os.makedirs(folder, exist_ok=True)
        path = os.path.join(folder, "view_%s.png" % time.strftime("%Y%m%d_%H%M%S"))
        pv.write_png(path, canvas)
    finally:
        state.restore()
        for ob in temp["objects"]:
            try:
                bpy.data.objects.remove(ob)
            except Exception:
                pass
        for cam in temp["cameras"]:
            try:
                bpy.data.cameras.remove(cam)
            except Exception:
                pass
        for me in temp["meshes"]:
            try:
                bpy.data.meshes.remove(me)
            except Exception:
                pass
        for mat in temp["materials"]:
            try:
                bpy.data.materials.remove(mat)
            except Exception:
                pass
        try:
            scene.frame_set(frame_before[0], subframe=frame_before[1])
        except Exception:
            pass
        shutil.rmtree(tmpdir, ignore_errors=True)
    layout = [views[i:i + cols] for i in range(0, len(views), cols)]
    return {"path": path, "views": views, "layout": layout, "size": [int(canvas.shape[1]), int(canvas.shape[0])],
            "objects": [o.name for o in obs][:50], "shading": shading_mode, "warnings": state.errors}


@command("mesh_stats")
def mesh_stats(params):
    """Polycount and health (non-manifold, ngons, loose verts, size) of `name`, or every scene mesh."""
    name = params.get("name")
    return rx.stats(name) if name else rx.stats()
