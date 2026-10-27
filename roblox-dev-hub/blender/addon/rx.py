"""rx: modeling, sculpt, rig and animation toolkit for execute_python (global `rx`).

Everything works the same with or without the Blender UI: mesh edits go through bmesh, sculpt brushes through
numpy, modifiers are applied from the evaluated mesh, and the few operators that are needed run through op(),
which builds a correct context (3D view, active object, selection, mode) and explains poll failures.
Call rx.help() for the list of functions, rx.help("sculpt") for one of them.
"""

import contextlib
import inspect
import math
import os
import tempfile

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix, Quaternion, Vector

EXPORT_DIR = os.path.join(tempfile.gettempdir(), "claude_blender", "exports")   # replaced by Rovex at each call

_AXES = {"x": (1, 0, 0), "+x": (1, 0, 0), "-x": (-1, 0, 0), "y": (0, 1, 0), "+y": (0, 1, 0), "-y": (0, -1, 0),
         "z": (0, 0, 1), "+z": (0, 0, 1), "-z": (0, 0, -1), "up": (0, 0, 1), "down": (0, 0, -1),
         "front": (0, -1, 0), "back": (0, 1, 0), "right": (1, 0, 0), "left": (-1, 0, 0)}


# ---------------------------------------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------------------------------------

def _v(x):
    """Vector from a tuple, a Vector or an axis name ('up', '-x', 'front'...)."""
    if isinstance(x, str):
        key = x.lower().strip()
        if key not in _AXES:
            raise ValueError("Unknown direction %r (use x, -x, y, -y, z, -z, up, down, front, back, left, right)" % x)
        return Vector(_AXES[key])
    return Vector(tuple(x))


def _sync():
    """Recompute matrix_world of objects changed in this call (new objects start with an identity matrix)."""
    bpy.context.view_layer.update()


def obj(name_or_obj):
    """Object by name (or the object itself). Raises a clear error with close names."""
    if isinstance(name_or_obj, bpy.types.Object):
        return name_or_obj
    ob = bpy.data.objects.get(str(name_or_obj))
    if ob is None:
        import difflib
        close = difflib.get_close_matches(str(name_or_obj), bpy.data.objects.keys(), n=5, cutoff=0.4)
        raise KeyError("Object %r not found.%s" % (name_or_obj, (" Close: %s" % ", ".join(close)) if close else ""))
    return ob


def _objs(x):
    if x is None:
        return []
    if isinstance(x, (str, bpy.types.Object)):
        return [obj(x)]
    return [obj(o) for o in x]


def color(c):
    """(r, g, b, a) in 0-1 linear from '#ff8800', (255, 136, 0), (1, .5, 0) or (1, .5, 0, 1)."""
    if isinstance(c, str):
        h = c.lstrip("#")
        if len(h) == 3:
            h = "".join(ch * 2 for ch in h)
        vals = [int(h[i:i + 2], 16) / 255.0 for i in range(0, len(h), 2)]
    else:
        vals = [float(x) for x in c]
        if any(x > 1.0 for x in vals[:3]):
            vals = [x / 255.0 for x in vals[:3]] + vals[3:]
    if len(vals) == 3:
        vals.append(1.0)
    # sRGB -> linear (what Blender stores in colors)
    lin = [((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in vals[:3]]
    return tuple(lin) + (vals[3],)


# ---------------------------------------------------------------------------------------------------------
# context, modes, operators
# ---------------------------------------------------------------------------------------------------------

def _view3d():
    """(window, area, region) of the biggest 3D view, or None (background / no 3D view)."""
    if bpy.app.background:
        return None
    wm = bpy.context.window_manager
    best = None
    for win in wm.windows:
        for area in win.screen.areas:
            if area.type == "VIEW_3D":
                region = next((r for r in area.regions if r.type == "WINDOW"), None)
                if region and (best is None or area.width * area.height > best[0]):
                    best = (area.width * area.height, win, area, region)
    return best[1:] if best else None


def ctx(ob=None, selected=None, **extra):
    """temp_override with the 3D view, ob as active object and `selected` (default [ob]) as selection."""
    kw = {}
    v = _view3d()
    if v:
        win, area, region = v
        kw.update(window=win, screen=win.screen, area=area, region=region)
    elif not bpy.app.background and bpy.context.window_manager.windows:
        win = bpy.context.window_manager.windows[0]
        kw.update(window=win, screen=win.screen)
    if ob is not None:
        sel = [ob] if selected is None else list(selected)
        kw.update(object=ob, active_object=ob, selected_objects=sel, selected_editable_objects=sel)
        if ob.type == "MESH" and ob.mode == "EDIT":
            kw["edit_object"] = ob
    kw.update(extra)
    return bpy.context.temp_override(**kw)


def _ensure_in_view_layer(ob):
    vl = bpy.context.view_layer
    if vl.objects.get(ob.name) is None:
        bpy.context.scene.collection.objects.link(ob)
    if ob.hide_get():
        ob.hide_set(False)
    ob.hide_viewport = False


def select(objs, active=None, only=True):
    """Select objects (deselect the rest when only=True) and make `active` (default: first) active."""
    obs = _objs(objs)
    vl = bpy.context.view_layer
    if only:
        for o in vl.objects:
            if o is not None and o.select_get():   # None: base of an object deleted in this call
                o.select_set(False)
    for o in obs:
        _ensure_in_view_layer(o)
        o.select_set(True)
    act = obj(active) if active is not None else (obs[0] if obs else None)
    if act is not None:
        vl.objects.active = act
    return act


def mode(ob, m="OBJECT"):
    """Put ob in mode m: OBJECT, EDIT, SCULPT, POSE, WEIGHT_PAINT, VERTEX_PAINT, TEXTURE_PAINT."""
    ob = obj(ob)
    m = m.upper()
    if ob.mode == m:
        return ob
    current = bpy.context.view_layer.objects.active
    if current is not None and current is not ob and current.mode != "OBJECT":
        with ctx(current):
            bpy.ops.object.mode_set(mode="OBJECT")
    select(ob)
    with ctx(ob):
        if ob.mode != "OBJECT" and m != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        bpy.ops.object.mode_set(mode=m)
    return ob


def op(idname, ob=None, mode_=None, selected=None, **props):
    """Run any operator with a correct context: rx.op("mesh.bevel", cube, mode_="EDIT", offset=0.1).

    ob becomes active (and selected), mode_ switches mode first (restored after), selected = extra selection.
    Raises a readable error when the operator cannot run (poll failed) instead of a context error.
    """
    mod_name, _, fn_name = idname.partition(".")
    fn = getattr(getattr(bpy.ops, mod_name), fn_name)
    ob = obj(ob) if ob is not None else None
    restore = None
    if ob is not None:
        select([ob] + [o for o in _objs(selected) if o is not ob], active=ob)
        if mode_ and ob.mode != mode_.upper():
            restore = ob.mode
            mode(ob, mode_)
    sel = None if ob is None else [ob] + [o for o in _objs(selected) if o is not ob]
    try:
        with ctx(ob, sel):
            if not fn.poll():
                act = bpy.context.view_layer.objects.active
                raise RuntimeError("%s cannot run here (poll failed). Active: %s, mode: %s, UI: %s" % (
                    idname, act.name if act else None, act.mode if act else None,
                    "no (background)" if bpy.app.background else "yes"))
            res = fn(**props)
    finally:
        if restore:
            mode(ob, restore)
    return res


# ---------------------------------------------------------------------------------------------------------
# objects
# ---------------------------------------------------------------------------------------------------------

def collection(name, parent=None):
    """Get or create a collection (linked under parent, default the scene collection)."""
    coll = bpy.data.collections.get(name)
    if coll is None:
        coll = bpy.data.collections.new(name)
    par = bpy.data.collections.get(parent) if isinstance(parent, str) else parent
    par = par or bpy.context.scene.collection
    if coll.name not in par.children:
        try:
            par.children.link(coll)
        except RuntimeError:
            pass
    return coll


def _place(ob, location=None, rotation=None, scale=None, coll=None):
    target = collection(coll) if isinstance(coll, str) else (coll or bpy.context.collection or bpy.context.scene.collection)
    target.objects.link(ob)
    if location is not None:
        ob.location = _v(location)
    if rotation is not None:
        ob.rotation_euler = Euler([math.radians(a) for a in rotation])
    if scale is not None:
        ob.scale = (scale,) * 3 if isinstance(scale, (int, float)) else tuple(scale)
    return ob


def new_mesh(name, verts, faces, edges=(), location=None, rotation=None, scale=None, coll=None):
    """Object from raw data: verts [(x,y,z)...], faces [(i,j,k,l)...]. rotation in degrees."""
    me = bpy.data.meshes.new(name)
    me.from_pydata([tuple(v) for v in verts], list(edges), [tuple(f) for f in faces])
    me.validate()
    me.update()
    return _place(bpy.data.objects.new(name, me), location, rotation, scale, coll)


def prim(kind, name=None, size=1.0, location=None, rotation=None, scale=None, segments=16, rings=8,
         subdiv=2, depth=None, radius2=None, minor=0.25, coll=None):
    """Primitive mesh object (no operator): cube, plane, grid, circle, cylinder, cone, sphere, icosphere, torus.

    size = cube edge / plane side / diameter. depth = cylinder/cone height (default size). radius2 = cone top
    radius (default 0). minor = torus tube radius ratio. rotation in degrees.
    """
    kind = kind.lower()
    bm = bmesh.new()
    r = size / 2.0
    h = size if depth is None else depth
    if kind == "cube":
        bmesh.ops.create_cube(bm, size=size)
    elif kind == "plane":
        bmesh.ops.create_grid(bm, x_segments=1, y_segments=1, size=r)
    elif kind == "grid":
        bmesh.ops.create_grid(bm, x_segments=segments, y_segments=segments, size=r)
    elif kind == "circle":
        bmesh.ops.create_circle(bm, cap_ends=True, segments=segments, radius=r)
    elif kind in ("cylinder", "cone"):
        top = r if kind == "cylinder" else (radius2 or 0.0)
        bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments, radius1=r, radius2=top, depth=h)
    elif kind in ("sphere", "uvsphere"):
        bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=r)
    elif kind == "icosphere":
        bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    elif kind == "torus":
        bm.free()
        R, tube = r * (1 - minor), r * minor
        verts, faces = [], []
        n1, n2 = segments * 2, max(6, segments // 2)
        for i in range(n1):
            a = 2 * math.pi * i / n1
            for j in range(n2):
                b = 2 * math.pi * j / n2
                verts.append(((R + tube * math.cos(b)) * math.cos(a), (R + tube * math.cos(b)) * math.sin(a),
                              tube * math.sin(b)))
        for i in range(n1):
            for j in range(n2):
                a, b = i * n2 + j, i * n2 + (j + 1) % n2
                c, d = ((i + 1) % n1) * n2 + (j + 1) % n2, ((i + 1) % n1) * n2 + j
                faces.append((a, d, c, b))
        return new_mesh(name or "Torus", verts, faces, location=location, rotation=rotation, scale=scale, coll=coll)
    else:
        bm.free()
        raise ValueError("Unknown primitive %r" % kind)
    me = bpy.data.meshes.new(name or kind.capitalize())
    bm.to_mesh(me)
    bm.free()
    return _place(bpy.data.objects.new(me.name, me), location, rotation, scale, coll)


def duplicate(ob, name=None, linked=False, location=None):
    """Copy of an object (new mesh data unless linked)."""
    ob = obj(ob)
    new = ob.copy()
    if ob.data is not None and not linked:
        new.data = ob.data.copy()
    if name:
        new.name = name
        if new.data is not None and not linked:
            new.data.name = name
    for c in ob.users_collection:
        c.objects.link(new)
    if location is not None:
        new.location = _v(location)
    return new


def delete(objs):
    """Delete objects (and their mesh data when nothing else uses it)."""
    for o in _objs(objs):
        data = o.data
        bpy.data.objects.remove(o, do_unlink=True)
        if isinstance(data, bpy.types.Mesh) and data.users == 0:
            bpy.data.meshes.remove(data)
    _sync()


def clear_scene(keep=("CAMERA", "LIGHT")):
    """Delete every object except the types in keep (default keeps cameras and lights)."""
    if bpy.context.object and bpy.context.object.mode != "OBJECT":
        mode(bpy.context.object, "OBJECT")
    delete([o for o in bpy.context.scene.objects if o.type not in keep])


def join(objs, name=None):
    """Join objects into the first one (materials kept). Returns the joined object."""
    obs = _objs(objs)
    if len(obs) < 2:
        return obs[0] if obs else None
    for o in obs:
        if o.mode != "OBJECT":
            mode(o, "OBJECT")
    op("object.join", obs[0], selected=obs[1:])
    if name:
        obs[0].name = name
        obs[0].data.name = name
    return obs[0]


def apply_transform(ob, location=False, rotation=True, scale=True):
    """Bake rotation/scale (and location) into the mesh, like Ctrl+A (no operator)."""
    ob = obj(ob)
    loc, rot, sca = ob.matrix_basis.decompose()
    m = Matrix.Identity(4)
    if location:
        m = Matrix.Translation(loc) @ m
    if rotation:
        m = m @ rot.to_matrix().to_4x4()
    if scale:
        m = m @ Matrix.Diagonal(sca).to_4x4()
    if ob.data is not None and hasattr(ob.data, "transform"):
        ob.data.transform(m)
    keep_loc = Vector() if location else loc
    keep_rot = Quaternion() if rotation else rot
    keep_sca = Vector((1, 1, 1)) if scale else sca
    ob.matrix_basis = Matrix.LocRotScale(keep_loc, keep_rot, keep_sca)
    return ob


def origin(ob, where="CENTER"):
    """Move the origin without moving the mesh: CENTER (bounds), BOTTOM (bounds bottom center), or a world point."""
    ob = obj(ob)
    me = ob.data
    co = _co(me)
    if len(co) == 0:
        return ob
    lo, hi = co.min(0), co.max(0)
    if isinstance(where, str):
        c = (lo + hi) / 2
        if where.upper() == "BOTTOM":
            c[2] = lo[2]
        local = Vector(c.tolist())
    else:
        _sync()
        local = ob.matrix_world.inverted() @ _v(where)
    me.transform(Matrix.Translation(-local))
    ob.matrix_basis = ob.matrix_basis @ Matrix.Translation(local)
    return ob


def shade(ob, mode_="flat", angle=30.0):
    """flat, smooth, or auto (smooth with sharp edges above `angle` degrees)."""
    ob = obj(ob)
    me = ob.data
    if mode_ == "flat":
        me.shade_flat()
    else:
        me.shade_smooth()
        if mode_ == "auto":
            me.set_sharp_from_angle(angle=math.radians(angle))
    return ob


# ---------------------------------------------------------------------------------------------------------
# edit mode (bmesh)
# ---------------------------------------------------------------------------------------------------------

@contextlib.contextmanager
def edit(ob):
    """with rx.edit(ob) as bm: ...  -> bmesh of the mesh, written back at the end (works in any mode).

    In Edit Mode it edits the live edit mesh (the user sees it), otherwise the mesh data directly.
    """
    ob = obj(ob)
    if ob.type != "MESH":
        raise TypeError("rx.edit needs a mesh object, %s is %s" % (ob.name, ob.type))
    if ob.mode not in ("OBJECT", "EDIT"):
        mode(ob, "OBJECT")
    me = ob.data
    if ob.mode == "EDIT":
        bm = bmesh.from_edit_mesh(me)
        yield bm
        bm.normal_update()
        bmesh.update_edit_mesh(me, loop_triangles=True, destructive=True)
        return
    bm = bmesh.new()
    bm.from_mesh(me)
    try:
        yield bm
        bm.normal_update()
        bm.to_mesh(me)
        me.update()
    finally:
        bm.free()


def _where(items, where):
    items = [x for x in items if x.is_valid]
    if where is None:
        return items
    return [x for x in items if where(x)]


def faces(bm, where=None, facing=None, angle=30.0, selected=None):
    """Faces of bm. where(face) -> bool (face.calc_center_median(), face.normal...), facing = direction
    ('up', '-x', (0,1,0)) within `angle` degrees, selected = True/False filter."""
    bm.faces.ensure_lookup_table()
    out = _where(bm.faces, where)
    if facing is not None:
        d = _v(facing).normalized()
        lim = math.cos(math.radians(angle))
        out = [f for f in out if f.normal.dot(d) >= lim]
    if selected is not None:
        out = [f for f in out if f.select == selected]
    return out


def verts(bm, where=None, selected=None):
    """Vertices of bm, where(v) -> bool (v.co...)."""
    bm.verts.ensure_lookup_table()
    out = _where(bm.verts, where)
    return out if selected is None else [v for v in out if v.select == selected]


def edges(bm, where=None, selected=None):
    """Edges of bm, where(e) -> bool (e.verts, e.calc_length(), e.is_boundary...)."""
    bm.edges.ensure_lookup_table()
    out = _where(bm.edges, where)
    return out if selected is None else [e for e in out if e.select == selected]


def center(items):
    """Average position of verts / edges / faces."""
    pts = []
    for x in items:
        if isinstance(x, bmesh.types.BMVert):
            pts.append(x.co)
        else:
            pts.extend(v.co for v in x.verts)
    return sum(pts, Vector()) / max(1, len(pts))


def _verts_of(items):
    seen = {}
    for x in items:
        for v in ([x] if isinstance(x, bmesh.types.BMVert) else x.verts):
            seen[v.index if v.index >= 0 else id(v)] = v
    return list(seen.values())


def move(bm, items, offset):
    """Translate verts / edges / faces by offset (local space)."""
    bmesh.ops.translate(bm, verts=_verts_of(items), vec=_v(offset))


def scale(bm, items, factor, pivot=None):
    """Scale verts / edges / faces around pivot (default their center). factor = number or (x, y, z)."""
    vs = _verts_of(items)
    f = (factor,) * 3 if isinstance(factor, (int, float)) else tuple(factor)
    p = _v(pivot) if pivot is not None else center(vs)
    bmesh.ops.scale(bm, verts=vs, vec=Vector(f), space=Matrix.Translation(-p))


def rotate(bm, items, degrees, axis="z", pivot=None):
    """Rotate verts / edges / faces around axis through pivot (default their center)."""
    vs = _verts_of(items)
    p = _v(pivot) if pivot is not None else center(vs)
    bmesh.ops.rotate(bm, verts=vs, cent=p, matrix=Matrix.Rotation(math.radians(degrees), 3, _v(axis)))


def extrude(bm, fs, distance=None, offset=None, individual=False, scale_=None):
    """Extrude faces like E: along their normal by `distance`, or by an `offset` vector. Returns the cap faces.
    individual=True extrudes each face on its own normal. scale_ scales the cap (taper)."""
    fs = [f for f in fs if f.is_valid]
    if not fs:
        return []
    if individual:
        ret = bmesh.ops.extrude_discrete_faces(bm, faces=fs)
        caps = ret["faces"]
        for f in caps:
            vec = _v(offset) if offset is not None else f.normal * (distance or 0.0)
            bmesh.ops.translate(bm, verts=list(f.verts), vec=vec)
            if scale_:
                scale(bm, [f], scale_)
        return caps
    normal = sum((f.normal * f.calc_area() for f in fs), Vector())
    normal = normal.normalized() if normal.length > 1e-9 else Vector((0, 0, 1))
    ret = bmesh.ops.extrude_face_region(bm, geom=fs)
    bmesh.ops.delete(bm, geom=fs, context="FACES")
    new_verts = [g for g in ret["geom"] if isinstance(g, bmesh.types.BMVert)]
    caps = [g for g in ret["geom"] if isinstance(g, bmesh.types.BMFace)]
    vec = _v(offset) if offset is not None else normal * (distance or 0.0)
    bmesh.ops.translate(bm, verts=new_verts, vec=vec)
    if scale_:
        scale(bm, caps, scale_)
    bm.normal_update()
    return caps


def inset(bm, fs, thickness=0.1, depth=0.0, individual=False):
    """Inset faces like I. Returns the inner faces (still the given faces)."""
    fs = [f for f in fs if f.is_valid]
    if individual:
        bmesh.ops.inset_individual(bm, faces=fs, thickness=thickness, depth=depth, use_even_offset=True)
    else:
        bmesh.ops.inset_region(bm, faces=fs, thickness=thickness, depth=depth, use_even_offset=True)
    return [f for f in fs if f.is_valid]


def bevel(bm, items, offset=0.05, segments=1, profile=0.5, vertices=False):
    """Bevel edges (or vertices=True). items can be faces/edges/verts. Returns the new faces."""
    if vertices:
        geom = _verts_of(items)
    else:
        geom = []
        for x in items:
            if isinstance(x, bmesh.types.BMEdge):
                geom.append(x)
            elif isinstance(x, bmesh.types.BMFace):
                geom.extend(x.edges)
        geom = list({e.index if e.index >= 0 else id(e): e for e in geom}.values())
    kw = dict(geom=geom, offset=offset, segments=segments, profile=profile, offset_type="OFFSET",
              clamp_overlap=True)
    try:
        ret = bmesh.ops.bevel(bm, affect="VERTICES" if vertices else "EDGES", **kw)
    except TypeError:
        ret = bmesh.ops.bevel(bm, vertex_only=vertices, **kw)
    return ret.get("faces", [])


def ring(bm, edge):
    """Edge ring through `edge` across quads (what a loop cut cuts)."""
    out, todo, seen = [], [edge], set()
    while todo:
        e = todo.pop()
        if e in seen:
            continue
        seen.add(e)
        out.append(e)
        for loop in e.link_loops:
            if len(loop.face.verts) == 4:
                todo.append(loop.link_loop_next.link_loop_next.edge)
    return out


def loop_cut(bm, edge, cuts=1):
    """Loop cut across the ring of `edge` (Ctrl+R). Returns the new edges."""
    ret = bmesh.ops.subdivide_edges(bm, edges=ring(bm, edge), cuts=cuts, use_grid_fill=True)
    return [g for g in ret["geom_inner"] if isinstance(g, bmesh.types.BMEdge)]


def subdivide(bm, items=None, cuts=1, smooth=0.0):
    """Subdivide edges (of the given faces/edges, default all)."""
    es = list(bm.edges) if items is None else list({e for x in items for e in (
        [x] if isinstance(x, bmesh.types.BMEdge) else x.edges)})
    bmesh.ops.subdivide_edges(bm, edges=es, cuts=cuts, smooth=smooth, use_grid_fill=True)


def merge(bm, distance=0.0001):
    """Merge by distance (M > By Distance)."""
    bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=distance)


def recalc_normals(bm, inside=False):
    """Make normals consistent (outside, or inside=True)."""
    bmesh.ops.recalc_face_normals(bm, faces=list(bm.faces))
    if inside:
        bmesh.ops.reverse_faces(bm, faces=list(bm.faces))


def delete_geom(bm, items, what="FACES"):
    """Delete faces / edges / verts (what = FACES, EDGES, VERTS, FACES_ONLY...)."""
    bmesh.ops.delete(bm, geom=list(items), context=what)


def bridge(bm, edge_loops):
    """Bridge two edge loops (list of edges)."""
    return bmesh.ops.bridge_loops(bm, edges=list(edge_loops))


def fill(bm, edge_list=None):
    """Fill holes (or the given boundary edges) with faces."""
    es = list(edge_list) if edge_list is not None else [e for e in bm.edges if e.is_boundary]
    return bmesh.ops.holes_fill(bm, edges=es, sides=0)


def select_in_edit(ob, items_fn):
    """In Edit Mode, select what items_fn(bm) returns (to show the user or before an operator)."""
    ob = obj(ob)
    if ob.mode != "EDIT":
        mode(ob, "EDIT")
    me = ob.data
    bm = bmesh.from_edit_mesh(me)
    for seq in (bm.verts, bm.edges, bm.faces):
        for x in seq:
            x.select = False
    for x in items_fn(bm):
        x.select = True
    bm.select_flush_mode()
    bmesh.update_edit_mesh(me)


# ---------------------------------------------------------------------------------------------------------
# modifiers
# ---------------------------------------------------------------------------------------------------------

_MOD_TYPES = {"mirror": "MIRROR", "subsurf": "SUBSURF", "subdivision": "SUBSURF", "bevel": "BEVEL",
              "solidify": "SOLIDIFY", "array": "ARRAY", "boolean": "BOOLEAN", "decimate": "DECIMATE",
              "remesh": "REMESH", "weighted_normal": "WEIGHTED_NORMAL", "triangulate": "TRIANGULATE",
              "smooth": "SMOOTH", "displace": "DISPLACE", "screw": "SCREW", "skin": "SKIN", "wireframe": "WIREFRAME",
              "armature": "ARMATURE", "multires": "MULTIRES", "shrinkwrap": "SHRINKWRAP", "lattice": "LATTICE",
              "simple_deform": "SIMPLE_DEFORM", "weld": "WELD", "edge_split": "EDGE_SPLIT"}


def modifier(ob, kind, name=None, apply=False, **props):
    """Add a modifier: rx.modifier(ob, "mirror", use_axis=(True, False, False), use_clip=True).
    Boolean: rx.modifier(ob, "boolean", operation="DIFFERENCE", object=cutter, apply=True)."""
    ob = obj(ob)
    t = _MOD_TYPES.get(kind.lower(), kind.upper())
    m = ob.modifiers.new(name or t.title(), t)
    for k, val in props.items():
        if isinstance(val, str) and k in ("object", "target", "offset_object", "mirror_object"):
            val = obj(val)
        setattr(m, k, val)
    if apply:
        apply_modifiers(ob, only=[m.name])
        return ob
    return m


def apply_modifiers(ob, only=None):
    """Apply modifiers (all, or only the given names) into the mesh, without the operator."""
    ob = obj(ob)
    if ob.mode != "OBJECT":
        mode(ob, "OBJECT")
    names = [m.name for m in ob.modifiers] if only is None else list(only)
    later = [m for m in ob.modifiers if m.name not in names]
    hidden = []
    for m in later:                       # keep the ones we don't apply out of the evaluation
        if m.show_viewport:
            m.show_viewport = False
            hidden.append(m)
    try:
        dg = bpy.context.evaluated_depsgraph_get()
        dg.update()
        ev = ob.evaluated_get(dg)
        me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    finally:
        for m in hidden:
            m.show_viewport = True
    old = ob.data
    me.name = old.name
    ob.data = me
    for n in names:
        m = ob.modifiers.get(n)
        if m is not None:
            ob.modifiers.remove(m)
    if old.users == 0:
        bpy.data.meshes.remove(old)
    return ob


def remesh(ob, voxel=0.05, adaptivity=0.0):
    """Voxel remesh (dense even topology, good before sculpting)."""
    modifier(ob, "remesh", mode="VOXEL", voxel_size=voxel, adaptivity=adaptivity, use_smooth_shade=True, apply=True)
    return obj(ob)


def subdivide_smooth(ob, levels=1, simple=False):
    """Subdivision surface applied (simple=True keeps the shape)."""
    modifier(ob, "subsurf", levels=levels, render_levels=levels,
             subdivision_type="SIMPLE" if simple else "CATMULL_CLARK", apply=True)
    return obj(ob)


def decimate(ob, ratio=0.5, planar_angle=None):
    """Reduce polygons (ratio) or dissolve flat areas (planar_angle in degrees) for low poly."""
    if planar_angle is not None:
        modifier(ob, "decimate", decimate_type="DISSOLVE", angle_limit=math.radians(planar_angle), apply=True)
    else:
        modifier(ob, "decimate", ratio=ratio, apply=True)
    return obj(ob)


# ---------------------------------------------------------------------------------------------------------
# materials, UV
# ---------------------------------------------------------------------------------------------------------

def material(name, col="#cccccc", rough=0.6, metal=0.0, emit=None, emit_strength=1.0, alpha=1.0):
    """Get or update a Principled material. col / emit: '#hex' or tuples."""
    m = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    rgba = color(col)
    m.diffuse_color = rgba[:3] + (alpha,)          # viewport / Workbench color
    m.roughness = rough
    m.metallic = metal
    if not m.use_nodes:
        m.use_nodes = True
    bsdf = next((n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED"), None)
    if bsdf is None:
        bsdf = m.node_tree.nodes.new("ShaderNodeBsdfPrincipled")
        out = next((n for n in m.node_tree.nodes if n.type == "OUTPUT_MATERIAL"), None) or \
            m.node_tree.nodes.new("ShaderNodeOutputMaterial")
        m.node_tree.links.new(bsdf.outputs[0], out.inputs[0])
    inp = bsdf.inputs
    inp["Base Color"].default_value = rgba
    inp["Roughness"].default_value = rough
    inp["Metallic"].default_value = metal
    if "Alpha" in inp:
        inp["Alpha"].default_value = alpha
    if emit is not None:
        key = "Emission Color" if "Emission Color" in inp else "Emission"
        inp[key].default_value = color(emit)
        if "Emission Strength" in inp:
            inp["Emission Strength"].default_value = emit_strength
    if alpha < 1.0:
        for attr, val in (("blend_method", "BLEND"), ("surface_render_method", "BLENDED")):
            if hasattr(m, attr):
                try:
                    setattr(m, attr, val)
                except Exception:
                    pass
    return m


def paint(ob, col, where=None, facing=None, angle=30.0, rough=0.6, metal=0.0, emit=None, name=None):
    """Color faces with a flat material (low poly style). where(poly) -> bool with poly.center / poly.normal
    (local space), facing = direction. No filter = whole object. Reuses one material per color."""
    ob = obj(ob)
    m = material(name or ("RX_" + (col if isinstance(col, str) else "_".join("%.3g" % c for c in col))),
                 col, rough, metal, emit)
    me = ob.data
    if m.name not in [s.name for s in me.materials if s]:
        me.materials.append(m)
    idx = [i for i, s in enumerate(me.materials) if s and s.name == m.name][0]
    d = _v(facing).normalized() if facing is not None else None
    lim = math.cos(math.radians(angle))
    for p in me.polygons:
        if where is not None and not where(p):
            continue
        if d is not None and p.normal.dot(d) < lim:
            continue
        p.material_index = idx
    me.update()
    return m


def uv_unwrap(ob, method="smart", angle=66.0, margin=0.02):
    """UV unwrap the whole mesh: smart (Smart UV Project), cube, or unwrap (seams)."""
    ob = obj(ob)
    prev = ob.mode
    mode(ob, "EDIT")
    try:
        op("mesh.select_all", ob, action="SELECT")
        if method == "smart":
            op("uv.smart_project", ob, angle_limit=math.radians(angle), island_margin=margin)
        elif method == "cube":
            op("uv.cube_project", ob)
        else:
            op("uv.unwrap", ob, margin=margin)
    finally:
        mode(ob, prev)
    return ob


# ---------------------------------------------------------------------------------------------------------
# sculpt (numpy brushes on the mesh, symmetric, any mode)
# ---------------------------------------------------------------------------------------------------------

def _co(me):
    a = np.empty(len(me.vertices) * 3, np.float64)
    me.vertices.foreach_get("co", a)
    return a.reshape(-1, 3)


def _normals(me):
    a = np.empty(len(me.vertices) * 3, np.float64)
    try:
        me.vertex_normals.foreach_get("vector", a)
    except AttributeError:
        me.vertices.foreach_get("normal", a)
    return a.reshape(-1, 3)


def _edge_pairs(me):
    e = np.empty(len(me.edges) * 2, np.int64)
    me.edges.foreach_get("vertices", e)
    return e.reshape(-1, 2)


def _falloff(d, radius, kind):
    t = np.clip(1.0 - d / radius, 0.0, 1.0)
    if kind == "smooth":
        return t * t * (3 - 2 * t)
    if kind == "sharp":
        return t * t
    if kind == "sphere":
        return np.sqrt(np.clip(1 - (d / radius) ** 2, 0, 1))
    if kind == "constant":
        return (d < radius).astype(np.float64)
    return t


_BRUSHES = ("draw", "clay", "inflate", "grab", "smooth", "flatten", "pinch", "crease", "layer", "blob", "noise",
            "scrape")


def _dab(co, nrm, adj, center, radius, strength, brush, direction, falloff, rng):
    d = np.linalg.norm(co - center, axis=1)
    hit = d < radius
    if not hit.any():
        return co
    f = np.zeros(len(co))
    f[hit] = _falloff(d[hit], radius, falloff)
    w = f[:, None]
    area_n = (nrm[hit] * f[hit, None]).sum(0)
    area_n = area_n / (np.linalg.norm(area_n) or 1.0)
    if direction is not None:
        area_n = direction / (np.linalg.norm(direction) or 1.0)
    area_c = (co[hit] * f[hit, None]).sum(0) / max(f[hit].sum(), 1e-9)
    s = strength * radius
    if brush == "draw":
        co = co + area_n * w * s * 0.5
    elif brush == "blob":
        co = co + (area_n * 0.5 + nrm * 0.5) * w * s * 0.5
    elif brush == "inflate":
        co = co + nrm * w * s * 0.35
    elif brush == "layer":
        co = co + area_n * np.minimum(w * 2, 1.0) * s * 0.3
    elif brush == "grab":
        vec = direction if direction is not None else area_n * radius * 0.5
        co = co + w * vec * strength
    elif brush in ("flatten", "scrape"):
        dist = (co - area_c) @ area_n
        if brush == "scrape":
            dist = np.maximum(dist, 0)
        co = co - area_n * (dist[:, None] * w * min(strength, 1.0))
    elif brush == "clay":
        plane = area_c + area_n * s * 0.25
        dist = (co - plane) @ area_n
        push = np.where(dist < 0, -dist, 0.0)[:, None]
        co = co + area_n * push * w * min(strength, 1.0) * 0.6
    elif brush in ("pinch", "crease"):
        to_c = area_c - co
        to_c = to_c - np.outer(to_c @ area_n, area_n)
        co = co + to_c * w * min(strength, 1.0) * 0.5
        if brush == "crease":
            co = co - area_n * w * s * 0.25
    elif brush == "smooth":
        n = len(co)
        acc = np.zeros_like(co)
        cnt = np.zeros(n)
        np.add.at(acc, adj[:, 0], co[adj[:, 1]])
        np.add.at(acc, adj[:, 1], co[adj[:, 0]])
        np.add.at(cnt, adj[:, 0], 1)
        np.add.at(cnt, adj[:, 1], 1)
        avg = acc / np.maximum(cnt, 1)[:, None]
        co = co + (avg - co) * w * min(strength, 1.0)
    elif brush == "noise":
        co = co + nrm * (rng.standard_normal(len(co))[:, None] * w * s * 0.15)
    else:
        raise ValueError("Unknown brush %r. Brushes: %s" % (brush, ", ".join(_BRUSHES)))
    return co


def sculpt(ob, brush, at=None, radius=0.3, strength=0.5, direction=None, falloff="smooth", symmetry="x",
           points=None, spacing=0.35, iterations=1, seed=0):
    """Sculpt brush on a mesh (world-space units): rx.sculpt(ob, "draw", at=(0, -1, 0.5), radius=0.3).

    brush: draw, clay, inflate (negative strength = deflate), grab (direction = move vector), smooth, flatten,
    scrape, pinch, crease, layer, blob, noise. Negative strength digs in. points = stroke path (list of world
    points, dabs every radius*spacing). symmetry: "x", "y", "z", "xy", "" (mirrored across the object's local
    axes). falloff: smooth, sharp, linear, sphere, constant. Dense meshes sculpt better: rx.remesh /
    rx.subdivide_smooth first. Works in any mode; the object comes back to its mode.
    """
    ob = obj(ob)
    brush = brush.lower()
    prev = ob.mode
    if prev not in ("OBJECT",):
        mode(ob, "OBJECT")
    me = ob.data
    _sync()
    inv = ob.matrix_world.inverted()
    sc = sum(ob.matrix_world.to_scale()) / 3.0 or 1.0
    r_local = radius / sc
    pts = [_v(p) for p in (points if points else [at])]
    if points and len(pts) > 1:            # resample the path every radius*spacing
        res = [pts[0]]
        step = max(radius * spacing, 1e-6)
        for a, b in zip(pts, pts[1:]):
            n = max(1, int((b - a).length / step))
            res.extend(a.lerp(b, (i + 1) / n) for i in range(n))
        pts = res
        strength = strength * min(1.0, spacing * 1.5)
    dvec = None
    if direction is not None:
        dvec = np.array(inv.to_3x3() @ _v(direction))
    co = _co(me)
    adj = _edge_pairs(me) if brush == "smooth" else None
    rng = np.random.default_rng(seed)
    axes = [i for i, a in enumerate("xyz") if a in (symmetry or "").lower()]
    for p in pts:
        lp = np.array(inv @ p)
        mirrors = [(lp, dvec)]
        for ax in axes:
            for c, dv in list(mirrors):
                mc = c.copy()
                mc[ax] = -mc[ax]
                md = None
                if dv is not None:
                    md = dv.copy()
                    md[ax] = -md[ax]
                if abs(c[ax]) > r_local * 0.05:
                    mirrors.append((mc, md))
        for c, dv in mirrors:
            for _ in range(max(1, iterations)):
                me.vertices.foreach_set("co", co.ravel())
                me.update()
                nrm = _normals(me)
                co = _dab(co, nrm, adj, c, r_local, strength, brush, dv, falloff, rng)
    me.vertices.foreach_set("co", co.ravel())
    me.update()
    if prev != "OBJECT":
        mode(ob, prev)
    return ob


# ---------------------------------------------------------------------------------------------------------
# rig
# ---------------------------------------------------------------------------------------------------------

def armature(name, bones, location=None, coll=None, show_in_front=True):
    """Armature from a bone list: [dict(name="Spine", head=(0,0,1), tail=(0,0,1.5), parent="Root",
    connect=False, roll=0, deform=True), ...] (tuples (name, head, tail, parent) also work). World units."""
    data = bpy.data.armatures.new(name)
    ob = _place(bpy.data.objects.new(name, data), location, None, None, coll)
    ob.show_in_front = show_in_front
    mode(ob, "EDIT")
    try:
        made = {}
        for b in bones:
            if not isinstance(b, dict):
                b = dict(zip(("name", "head", "tail", "parent"), b))
            eb = data.edit_bones.new(b["name"])
            eb.head, eb.tail = _v(b["head"]), _v(b["tail"])
            eb.roll = math.radians(b.get("roll", 0.0))
            eb.use_deform = b.get("deform", True)
            made[b["name"]] = (eb, b)
        for eb, b in made.values():
            par = b.get("parent")
            if par:
                eb.parent = made[par][0] if par in made else data.edit_bones[par]
                eb.use_connect = bool(b.get("connect", False))
    finally:
        mode(ob, "OBJECT")
    return ob


def _segment_dist(p, a, b):
    ab = b - a
    t = np.clip(((p - a) @ ab) / max(ab @ ab, 1e-12), 0, 1)
    return np.linalg.norm(p - (a + t[:, None] * ab), axis=1)


def skin(mesh, arm, method="auto", falloff=2.0):
    """Bind a mesh to an armature: auto (Blender automatic weights, falls back to nearest), nearest (smooth
    distance weights), rigid (each vertex 100% on its closest bone: best for segmented Roblox-style models),
    envelope, empty. Adds the Armature modifier and parents the mesh. Returns the method used."""
    me_ob, arm_ob = obj(mesh), obj(arm)
    for o in (me_ob, arm_ob):
        if o.mode != "OBJECT":
            mode(o, "OBJECT")
    used = method
    if method in ("auto", "envelope", "empty"):
        t = {"auto": "ARMATURE_AUTO", "envelope": "ARMATURE_ENVELOPE", "empty": "ARMATURE_NAME"}[method]
        before = len(me_ob.vertex_groups)
        try:
            op("object.parent_set", arm_ob, selected=[me_ob], type=t)
        except Exception:
            used = "nearest"
        if method == "auto" and used == "auto":
            # bone heat can fail silently (empty groups): check
            me = me_ob.data
            weighted = sum(1 for v in me.vertices if any(g.weight > 0 for g in v.groups))
            if weighted < len(me.vertices) * 0.9 or len(me_ob.vertex_groups) <= before:
                used = "nearest"
        if used == method:
            return used
    _sync()
    deform = [b for b in arm_ob.data.bones if b.use_deform]
    co = np.array([tuple(me_ob.matrix_world @ v.co) for v in me_ob.data.vertices])
    dists = []
    for b in deform:
        a = np.array(arm_ob.matrix_world @ b.head_local)
        c = np.array(arm_ob.matrix_world @ b.tail_local)
        dists.append(_segment_dist(co, a, c))
    D = np.stack(dists, 1) if dists else np.zeros((len(co), 0))
    for g in list(me_ob.vertex_groups):
        if g.name in [b.name for b in deform]:
            me_ob.vertex_groups.remove(g)
    groups = [me_ob.vertex_groups.new(name=b.name) for b in deform]
    if used == "rigid":
        best = D.argmin(1)
        for gi, g in enumerate(groups):
            idx = np.nonzero(best == gi)[0].tolist()
            if idx:
                g.add(idx, 1.0, "REPLACE")
    else:
        W = 1.0 / np.maximum(D, 1e-4) ** (falloff * 2)
        top = np.argsort(-W, 1)[:, :3]
        mask = np.zeros_like(W, bool)
        np.put_along_axis(mask, top, True, 1)
        W = np.where(mask, W, 0)
        W = W / W.sum(1, keepdims=True)
        for gi, g in enumerate(groups):
            for vi in np.nonzero(W[:, gi] > 0.01)[0]:
                g.add([int(vi)], float(W[vi, gi]), "REPLACE")
    if not any(m.type == "ARMATURE" for m in me_ob.modifiers):
        m = me_ob.modifiers.new("Armature", "ARMATURE")
        m.object = arm_ob
    mw = me_ob.matrix_world.copy()
    me_ob.parent = arm_ob
    me_ob.matrix_parent_inverse = arm_ob.matrix_world.inverted()
    me_ob.matrix_world = mw
    return used


def ik(arm, bone, target, chain=2, pole=None, pole_angle=-90.0, target_bone=None, pole_bone=None):
    """IK constraint on a pose bone. target = object (or the armature itself with target_bone)."""
    arm = obj(arm)
    pb = arm.pose.bones[bone]
    c = pb.constraints.new("IK")
    c.target = obj(target)
    if target_bone:
        c.subtarget = target_bone
    c.chain_count = chain
    if pole is not None:
        c.pole_target = obj(pole)
        if pole_bone:
            c.pole_subtarget = pole_bone
        c.pole_angle = math.radians(pole_angle)
    return c


# ---------------------------------------------------------------------------------------------------------
# animation
# ---------------------------------------------------------------------------------------------------------

def _target(t):
    """Object, pose bone, "Armature:Bone" or (armature, "Bone")."""
    if isinstance(t, (bpy.types.Object, bpy.types.PoseBone)):
        return t
    if isinstance(t, tuple):
        return obj(t[0]).pose.bones[t[1]]
    if isinstance(t, str) and ":" in t:
        a, b = t.split(":", 1)
        return obj(a).pose.bones[b]
    return obj(t)


def _owner(t):
    return t.id_data if isinstance(t, bpy.types.PoseBone) else t


def action(target, name, fps=None):
    """New empty action made active on target (object or armature). Keys added after go in it."""
    ob = _owner(_target(target))
    act = bpy.data.actions.new(name)
    act.use_fake_user = True
    ad = ob.animation_data or ob.animation_data_create()
    ad.action = act
    if fps:
        bpy.context.scene.render.fps = int(fps)
    return act


def key(target, frame, loc=None, rot=None, scale=None, quat=None, interp=None, **paths):
    """Keyframe target at frame: loc (x,y,z), rot (degrees XYZ), scale, quat, or any property=value.
    target: object, pose bone, "Armature:Bone" or (armature, "Bone"). interp: BEZIER, LINEAR, CONSTANT."""
    t = _target(target)
    done = []
    if loc is not None:
        t.location = _v(loc)
        done.append("location")
    if rot is not None:
        e = Euler([math.radians(a) for a in rot])
        if t.rotation_mode == "QUATERNION":
            t.rotation_quaternion = e.to_quaternion()
            done.append("rotation_quaternion")
        elif t.rotation_mode == "AXIS_ANGLE":
            t.rotation_mode = "XYZ"
            t.rotation_euler = e
            done.append("rotation_euler")
        else:
            t.rotation_euler = e
            done.append("rotation_euler")
    if quat is not None:
        t.rotation_quaternion = Quaternion(quat)
        done.append("rotation_quaternion")
    if scale is not None:
        t.scale = (scale,) * 3 if isinstance(scale, (int, float)) else tuple(scale)
        done.append("scale")
    for p, val in paths.items():
        setattr(t, p, val)
        done.append(p)
    for p in done:
        t.keyframe_insert(p, frame=frame)
    if interp:
        ad = _owner(t).animation_data
        if ad and ad.action:
            for fc in fcurves(ad.action):
                for kp in fc.keyframe_points:
                    if abs(kp.co[0] - frame) < 1e-4:
                        kp.interpolation = interp.upper()
    return done


def pose(arm, frame, bones, interp=None):
    """Key several bones at once: rx.pose(rig, 10, {"Arm.L": dict(rot=(0, 0, 45)), "Root": dict(loc=(0, 0, .2))})."""
    arm = obj(arm)
    for name, vals in bones.items():
        key((arm, name), frame, interp=interp, **vals)


def fcurves(act):
    """All F-curves of an action (Blender 4.4+ layered actions and older ones)."""
    out = []
    layers = getattr(act, "layers", None)
    if layers:
        for layer in layers:
            for strip in layer.strips:
                for bag in getattr(strip, "channelbags", []):
                    out.extend(bag.fcurves)
    if not out and hasattr(act, "fcurves"):
        try:
            out = list(act.fcurves)
        except Exception:
            pass
    return out


def interpolation(act, kind="BEZIER", easing=None):
    """Set interpolation (BEZIER, LINEAR, CONSTANT, SINE, BACK, BOUNCE, ELASTIC...) on every key."""
    act = bpy.data.actions[act] if isinstance(act, str) else act
    for fc in fcurves(act):
        for kp in fc.keyframe_points:
            kp.interpolation = kind.upper()
            if easing:
                kp.easing = easing.upper()
    return act


def loop(act, cyclic=True):
    """Make an action loop seamlessly (Cycles modifier on each curve)."""
    act = bpy.data.actions[act] if isinstance(act, str) else act
    for fc in fcurves(act):
        if cyclic and not any(m.type == "CYCLES" for m in fc.modifiers):
            fc.modifiers.new("CYCLES")
        elif not cyclic:
            for m in [m for m in fc.modifiers if m.type == "CYCLES"]:
                fc.modifiers.remove(m)
    act.use_cyclic = cyclic
    return act


def frames(start, end, fps=None, current=None):
    """Scene frame range (and fps)."""
    s = bpy.context.scene
    s.frame_start, s.frame_end = int(start), int(end)
    if fps:
        s.render.fps = int(fps)
    s.frame_set(int(current if current is not None else start))


# ---------------------------------------------------------------------------------------------------------
# checks, export
# ---------------------------------------------------------------------------------------------------------

def stats(ob=None):
    """Polycount and health of a mesh (or all scene meshes): verts, faces, tris, ngons, non-manifold edges,
    loose verts, size (world), materials."""
    if ob is None:
        return {o.name: stats(o) for o in bpy.context.scene.objects if o.type == "MESH"}
    ob = obj(ob)
    me = ob.data
    bm = bmesh.new()
    bm.from_mesh(me)
    try:
        info = {
            "verts": len(bm.verts), "faces": len(bm.faces),
            "tris": sum(len(f.verts) - 2 for f in bm.faces),
            "ngons": sum(1 for f in bm.faces if len(f.verts) > 4),
            "non_manifold_edges": sum(1 for e in bm.edges if not e.is_manifold and not e.is_boundary),
            "boundary_edges": sum(1 for e in bm.edges if e.is_boundary),
            "loose_verts": sum(1 for v in bm.verts if not v.link_edges),
            "size": [round(x, 4) for x in ob.dimensions],
            "materials": [m.name for m in me.materials if m],
            "modifiers": [m.type for m in ob.modifiers],
            "mode": ob.mode,
        }
    finally:
        bm.free()
    return info


def export_fbx(objs=None, name=None, folder=None, anim=False):
    """Export to FBX for Roblox (Forward -Z, Up Y, scale applied, no leaf bones). objs default: selection or all
    meshes/armatures. Returns the file path (default folder: Rovex exports)."""
    obs = _objs(objs) or [o for o in bpy.context.selected_objects] or \
        [o for o in bpy.context.scene.objects if o.type in ("MESH", "ARMATURE")]
    for o in obs:
        if o.mode != "OBJECT":
            mode(o, "OBJECT")
    folder = folder or EXPORT_DIR
    os.makedirs(folder, exist_ok=True)
    base = name or (obs[0].name if obs else "export")
    path = os.path.join(folder, "".join(c if c.isalnum() or c in "-_ " else "_" for c in base).strip() + ".fbx")
    select(obs)
    with ctx(obs[0], obs):
        bpy.ops.export_scene.fbx(filepath=path, use_selection=True, apply_scale_options="FBX_SCALE_ALL",
                                 axis_forward="-Z", axis_up="Y", add_leaf_bones=False, bake_anim=anim,
                                 mesh_smooth_type="FACE", object_types={"MESH", "ARMATURE", "EMPTY"},
                                 use_mesh_modifiers=True)
    return path


# ---------------------------------------------------------------------------------------------------------
# help
# ---------------------------------------------------------------------------------------------------------

_SECTIONS = (
    ("Objects", ("obj", "prim", "new_mesh", "duplicate", "delete", "clear_scene", "join", "collection",
                 "apply_transform", "origin", "shade", "select", "mode", "op", "ctx")),
    ("Edit Mode (bmesh)", ("edit", "faces", "verts", "edges", "center", "move", "scale", "rotate", "extrude",
                           "inset", "bevel", "loop_cut", "ring", "subdivide", "merge", "recalc_normals",
                           "delete_geom", "bridge", "fill", "select_in_edit")),
    ("Modifiers", ("modifier", "apply_modifiers", "remesh", "subdivide_smooth", "decimate")),
    ("Sculpt", ("sculpt",)),
    ("Materials / UV", ("material", "paint", "color", "uv_unwrap")),
    ("Rig", ("armature", "skin", "ik")),
    ("Animation", ("action", "key", "pose", "fcurves", "interpolation", "loop", "frames")),
    ("Check / export", ("stats", "export_fbx")),
)


def help(name=None):
    """rx.help() lists everything, rx.help("extrude") prints one function's documentation."""
    g = globals()
    if name:
        fn = g.get(name)
        if not callable(fn):
            return "No rx.%s" % name
        return "rx.%s%s\n%s" % (name, inspect.signature(fn), inspect.getdoc(fn) or "")
    lines = []
    for title, names in _SECTIONS:
        lines.append("## " + title)
        for n in names:
            fn = g[n]
            doc = (inspect.getdoc(fn) or "").split("\n")[0]
            lines.append("rx.%s%s  # %s" % (n, inspect.signature(fn), doc))
    return "\n".join(lines)

