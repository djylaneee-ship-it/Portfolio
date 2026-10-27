"""Weapons held by an R6 rig, the way a Roblox Tool is held.

A weapon is an object parented (parent_type BONE) to an arm bone of the control armature. Its local
frame is the Roblox "Handle" frame converted to Blender with rig.char_rot_scale: grip at the origin,
blade/tip along handle +Y, handle +Z toward the shoulder. With the arm hanging, the blade points
forward, exactly like a Roblox Tool held with the default RightGrip (cframe.WEAPON_C0).
For a rig whose armature is Z-up, that means a weapon modeled standing up (blade along local +Z,
origin at the grip) is held correctly.

Placeholders are low-poly meshes built here in handle space (studs). Custom props on the object:
claude_weapon=<kind>, claude_hand=Right|Left, claude_placeholder (bool), claude_rig=<armature name>.
"""

import math

import bmesh
import bpy
from mathutils import Matrix, Vector

from . import cframe as cfm
from . import rig as rigm

COLLECTION = "Claude_Weapons"
KINDS = ("sword", "greatsword", "katana", "dagger", "axe", "spear", "mace", "staff", "shield", "bow")
DEFAULT_HAND = {"shield": "Left", "bow": "Left"}
_ALIASES = {"longsword": "greatsword", "claymore": "greatsword", "zweihander": "greatsword",
            "knife": "dagger", "hatchet": "axe", "lance": "spear", "pike": "spear", "club": "mace",
            "hammer": "mace", "rod": "staff", "buckler": "shield", "longbow": "bow"}
_MAT_PREFIX = "Claude_Weapon_"
# name -> (viewport/base color (linear RGBA), metallic, roughness)
_PALETTE = {
    "steel": ((0.62, 0.65, 0.70, 1.0), 0.9, 0.3),
    "dark": ((0.06, 0.06, 0.07, 1.0), 0.7, 0.5),
    "gold": ((0.80, 0.50, 0.10, 1.0), 1.0, 0.35),
    "grip": ((0.20, 0.06, 0.02, 1.0), 0.0, 0.8),
    "wood": ((0.36, 0.17, 0.06, 1.0), 0.0, 0.7),
    "wrap": ((0.03, 0.04, 0.12, 1.0), 0.0, 0.9),
    "gem": ((0.05, 0.45, 1.00, 1.0), 0.0, 0.1),
    "paint": ((0.50, 0.04, 0.03, 1.0), 0.0, 0.6),
    "string": ((0.90, 0.88, 0.78, 1.0), 0.0, 0.8),
}


# ---------------------------------------------------------------------------
# Low-poly modeling in handle space (studs): X right, Y blade, Z toward the shoulder
# ---------------------------------------------------------------------------

class _Builder:
    """Accumulates closed low-poly parts (lofted rings) with one material per part."""

    def __init__(self):
        self.verts, self.faces, self.face_mats, self.mats = [], [], [], []

    def loft(self, rings, mat, cap_start=True, cap_end=True):
        """Connect rings of 3D points in order; a 1-point ring is an apex (cone/tip)."""
        if mat not in self.mats:
            self.mats.append(mat)
        mi = self.mats.index(mat)
        idx = []
        for ring in rings:
            base = len(self.verts)
            self.verts.extend(Vector(p) for p in ring)
            idx.append(list(range(base, base + len(ring))))
        for a, b in zip(idx, idx[1:]):
            if len(a) == len(b):
                n = len(a)
                faces = [(a[i], a[(i + 1) % n], b[(i + 1) % n], b[i]) for i in range(n)]
            elif len(b) == 1:
                faces = [(a[i], a[(i + 1) % len(a)], b[0]) for i in range(len(a))]
            elif len(a) == 1:
                faces = [(a[0], b[(i + 1) % len(b)], b[i]) for i in range(len(b))]
            else:
                raise ValueError("Rings must have the same size (or be a single apex point)")
            self.faces.extend(faces)
            self.face_mats.extend([mi] * len(faces))
        for ring, cap in ((idx[0], cap_start), (idx[-1], cap_end)):
            if cap and len(ring) > 2:
                self.faces.append(tuple(ring))
                self.face_mats.append(mi)

    def box(self, lo, hi, mat):
        (x0, y0, z0), (x1, y1, z1) = lo, hi
        self.loft([[(x0, y0, z0), (x1, y0, z0), (x1, y0, z1), (x0, y0, z1)],
                   [(x0, y1, z0), (x1, y1, z0), (x1, y1, z1), (x0, y1, z1)]], mat)

    def rod(self, y0, y1, radius, mat, sides=8):
        """Cylinder along Y."""
        self.loft([_ry(y0, _ngon(radius, sides)), _ry(y1, _ngon(radius, sides))], mat)

    def spike(self, center, direction, base_r, tip_r, half, mat):
        """Square pyramid pointing along `direction` from `center`."""
        d = Vector(direction).normalized()
        u = d.orthogonal().normalized()
        v = d.cross(u)
        c = Vector(center)
        base = [c + d * base_r + (u * su + v * sv) * half for su, sv in ((1, 1), (-1, 1), (-1, -1), (1, -1))]
        self.loft([base, [c + d * tip_r]], mat)


def _ngon(r, n, phase=0.0):
    """Regular polygon in the XZ plane as (x, z) pairs."""
    return [(r * math.cos(phase + 2 * math.pi * i / n), r * math.sin(phase + 2 * math.pi * i / n)) for i in range(n)]


def _diamond(w, t):
    """Blade cross-section: edges along Z (half width w), flats facing X (half thickness t)."""
    return [(t, 0.0), (0.0, w), (-t, 0.0), (0.0, -w)]


def _ry(y, pts, cx=0.0, cz=0.0):
    return [(cx + px, y, cz + pz) for px, pz in pts]


def _sword(b):
    b.loft([_ry(-0.74, _ngon(0.12, 8)), _ry(-0.62, _ngon(0.19, 8)), _ry(-0.5, _ngon(0.12, 8))], "gold")
    b.rod(-0.5, 0.5, 0.12, "grip")
    b.box((-0.11, 0.5, -0.62), (0.11, 0.66, 0.62), "gold")
    b.loft([_ry(0.66, _diamond(0.2, 0.05)), _ry(3.25, _diamond(0.18, 0.045)), [(0, 3.86, 0)]], "steel")


def _greatsword(b):
    b.loft([_ry(-1.3, _ngon(0.14, 8)), _ry(-1.16, _ngon(0.22, 8)), _ry(-1.05, _ngon(0.14, 8))], "dark")
    b.rod(-1.05, 0.5, 0.14, "grip")
    b.box((-0.14, 0.5, -0.95), (0.14, 0.74, 0.95), "dark")
    b.loft([_ry(0.74, _diamond(0.3, 0.075)), _ry(4.6, _diamond(0.27, 0.065)), [(0, 5.4, 0)]], "steel")


def _katana(b):
    b.rod(-1.08, -0.98, 0.14, "dark")
    b.rod(-0.98, 0.45, 0.12, "wrap")
    b.loft([_ry(0.45, _ngon(0.3, 12)), _ry(0.53, _ngon(0.3, 12))], "dark")
    b.box((-0.07, 0.53, -0.14), (0.07, 0.63, 0.14), "gold")
    y0, length, sori, n = 0.63, 3.5, 0.22, 8
    w, t = 0.13, 0.045
    profile = [(0.0, -w), (t, 0.1 * w), (0.6 * t, w), (-0.6 * t, w), (-t, 0.1 * w)]  # edge at -Z
    rings = []
    for i in range(n):
        s = i / float(n)
        taper = 1.0 - 0.25 * s
        rings.append(_ry(y0 + length * s, [(px * taper, pz * taper) for px, pz in profile], cz=sori * s * s))
    rings.append([(0.0, y0 + length, sori + 0.6 * w)])  # kissaki on the spine side
    b.loft(rings, "steel")


def _dagger(b):
    b.loft([_ry(-0.52, _ngon(0.09, 8)), _ry(-0.46, _ngon(0.14, 8)), _ry(-0.4, _ngon(0.09, 8))], "gold")
    b.rod(-0.4, 0.35, 0.1, "grip")
    b.box((-0.08, 0.35, -0.34), (0.08, 0.46, 0.34), "gold")
    b.loft([_ry(0.46, _diamond(0.14, 0.04)), _ry(1.4, _diamond(0.12, 0.035)), [(0, 1.86, 0)]], "steel")


def _axe(b):
    b.rod(-0.8, -0.7, 0.13, "dark")
    b.rod(-0.7, 3.1, 0.1, "wood")
    b.rod(-0.5, 0.5, 0.115, "grip")

    def rect(z, hx, y0, y1):
        return [(-hx, y0, z), (hx, y0, z), (hx, y1, z), (-hx, y1, z)]

    # head: socket around the haft, bearded blade toward -Z (the striking side of an overhead chop)
    b.loft([rect(0.15, 0.15, 2.35, 2.95), rect(-0.15, 0.15, 2.35, 2.95), rect(-0.6, 0.07, 2.2, 3.05),
            rect(-1.05, 0.02, 1.95, 3.25)], "steel")
    b.box((-0.1, 2.5, 0.15), (0.1, 2.8, 0.38), "dark")


def _spear(b):
    # 7 studs from butt (-2.8) to tip (4.2): the grip (origin) sits at 2/5 of the length
    b.rod(-2.8, -2.66, 0.11, "dark")
    b.rod(-2.66, 3.32, 0.08, "wood", 6)
    b.rod(-0.45, 0.45, 0.095, "grip", 6)
    b.rod(3.32, 3.5, 0.12, "dark")
    b.loft([_ry(3.5, _diamond(0.07, 0.04)), _ry(3.72, _diamond(0.22, 0.05)), _ry(3.98, _diamond(0.15, 0.04)),
            [(0, 4.2, 0)]], "steel")


def _mace(b):
    b.rod(-0.7, -0.6, 0.13, "dark")
    b.rod(-0.6, 2.2, 0.1, "wood")
    b.rod(-0.5, 0.5, 0.12, "grip")
    c = Vector((0.0, 2.5, 0.0))
    r = 0.36
    rings = [[tuple(c + Vector((0, -r, 0)))]]
    for lat in (-45, 0, 45):
        la = math.radians(lat)
        rings.append(_ry(c.y + r * math.sin(la), _ngon(r * math.cos(la), 8, math.pi / 8)))
    rings.append([tuple(c + Vector((0, r, 0)))])
    b.loft(rings, "dark")
    for ang in range(0, 360, 45):
        a = math.radians(ang)
        b.spike(c, (math.cos(a), 0.0, math.sin(a)), 0.28, 0.66, 0.08, "steel")
    b.spike(c, (0, 1, 0), 0.28, 0.7, 0.08, "steel")


def _staff(b):
    b.rod(-1.95, -1.82, 0.12, "dark")
    b.rod(-1.82, 3.45, 0.09, "wood")
    b.rod(-0.5, 0.5, 0.105, "grip")
    b.loft([_ry(3.35, _ngon(0.12, 8)), _ry(3.5, _ngon(0.17, 8)), _ry(3.58, _ngon(0.1, 8))], "gold")
    for ang in (0, 90, 180, 270):
        a = math.radians(ang)
        x, z = 0.22 * math.cos(a), 0.22 * math.sin(a)
        b.box((x - 0.035, 3.5, z - 0.035), (x + 0.035, 4.0, z + 0.035), "gold")
    b.loft([[(0, 3.5, 0)], _ry(3.82, _ngon(0.2, 4)), [(0, 4.25, 0)]], "gem")


def _shield(b):
    # round shield on the outer side of the forearm (outward = -X for the left arm), face normal -X
    cy, cz = 0.0, 0.85

    def ring_x(x, r, n=16):
        return [(x, cy + r * math.cos(2 * math.pi * i / n), cz + r * math.sin(2 * math.pi * i / n))
                for i in range(n)]

    b.loft([ring_x(-0.55, 1.2), ring_x(-0.78, 1.2)], "steel")
    b.loft([ring_x(-0.58, 1.1), ring_x(-0.83, 1.1)], "paint")
    b.loft([ring_x(-0.83, 0.32, 8), ring_x(-0.96, 0.24, 8), [(-1.01, cy, cz)]], "steel")


def _bow(b):
    # limbs along handle Y (vertical when the arm aims forward), tips curving toward +Z (the archer)
    half, draw = 2.2, 0.55
    rings = []
    for y in (-2.2, -1.8, -1.25, -0.5, 0.5, 1.25, 1.8, 2.2):
        s = abs(y) / half
        thick = 1.0 if abs(y) <= 0.5 else 1.0 - 0.55 * (abs(y) - 0.5) / (half - 0.5)
        hx, hz, cz = 0.08 * thick, 0.09 * thick, draw * s * s
        rings.append([(-hx, y, cz - hz), (hx, y, cz - hz), (hx, y, cz + hz), (-hx, y, cz + hz)])
    b.loft(rings, "wood")
    b.box((-0.1, -0.35, -0.11), (0.1, 0.35, 0.11), "grip")
    s = 0.02
    b.loft([[(-s, -2.12, draw - s), (s, -2.12, draw - s), (s, -2.12, draw + s), (-s, -2.12, draw + s)],
            [(-s, 2.12, draw - s), (s, 2.12, draw - s), (s, 2.12, draw + s), (-s, 2.12, draw + s)]], "string")


_MODELS = {"sword": _sword, "greatsword": _greatsword, "katana": _katana, "dagger": _dagger, "axe": _axe,
           "spear": _spear, "mace": _mace, "staff": _staff, "shield": _shield, "bow": _bow}


# ---------------------------------------------------------------------------
# Blender data helpers
# ---------------------------------------------------------------------------

def normalize_kind(kind):
    """'Sword' / 'claymore' -> canonical kind name; raises ValueError listing the valid kinds."""
    k = str(kind or "").strip().lower()
    k = _ALIASES.get(k, k)
    if k not in KINDS:
        raise ValueError("Unknown weapon kind '%s'. Use one of %s" % (kind, list(KINDS)))
    return k


def normalize_hand(hand, kind=None):
    """'right'/'R'/None -> 'Right' or 'Left' (None = the kind's usual hand)."""
    if hand is None or hand == "":
        return DEFAULT_HAND.get(kind, "Right")
    h = str(hand).strip().lower()
    if h in ("right", "r", "right arm"):
        return "Right"
    if h in ("left", "l", "left arm"):
        return "Left"
    raise ValueError("hand must be 'Right' or 'Left', got %r" % (hand,))


def _material(key):
    name = _MAT_PREFIX + key.capitalize()
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    color, metallic, roughness = _PALETTE[key]
    mat = bpy.data.materials.new(name)
    mat.diffuse_color = color          # Workbench / viewport "Material" color
    mat.metallic = min(metallic, 0.3)  # viewport only: a high value reads as near-black under studio light
    mat.roughness = max(roughness, 0.4)
    if mat.node_tree:
        for node in mat.node_tree.nodes:
            if node.type == "BSDF_PRINCIPLED":
                node.inputs["Base Color"].default_value = color
                node.inputs["Metallic"].default_value = metallic
                node.inputs["Roughness"].default_value = roughness
    return mat


def _weapon_collection(scene):
    coll = bpy.data.collections.get(COLLECTION)
    if coll is None:
        coll = bpy.data.collections.new(COLLECTION)
    if not _collection_in_scene(coll, scene):
        scene.collection.children.link(coll)
    return coll


def _collection_in_scene(coll, scene):
    stack = [scene.collection]
    while stack:
        c = stack.pop()
        if c == coll:
            return True
        stack.extend(c.children)
    return False


def build_placeholder_mesh(kind, rig, hand="Right", name=None):
    """Create the low-poly mesh datablock for a kind, in the object space of a weapon held by `rig`."""
    kind = normalize_kind(kind)
    builder = _Builder()
    _MODELS[kind](builder)
    to_obj = rig.char_rot_scale.inverted().to_3x3()   # handle (studs, Roblox axes) -> Blender object space
    mirror = kind == "shield" and hand == "Right"     # shields face outward, away from the body
    verts = [to_obj @ Vector((-v.x if mirror else v.x, v.y, v.z)) for v in builder.verts]
    me = bpy.data.meshes.new(name or ("Claude_%s_Mesh" % kind.capitalize()))
    me.from_pydata(verts, [], builder.faces)
    me.polygons.foreach_set("material_index", builder.face_mats)
    bm = bmesh.new()
    bm.from_mesh(me)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces[:])
    bm.to_mesh(me)
    bm.free()
    for key in builder.mats:
        me.materials.append(_material(key))
    me.update()
    return me


def _arm_part(hand):
    return hand + " Arm"


def grip_handle_rest(rig, hand="Right"):
    """Character-space CFrame of the grip on that arm with the rig at rest (cframe.WEAPON_C0, C1 = identity)."""
    return rig.rest_parts[_arm_part(hand)] @ cfm.WEAPON_C0 @ cfm.WEAPON_C1.inverted()


def grip_basis(rig, ob, hand=None):
    """matrix_basis that puts a bone-parented weapon's origin on the hand grip with handle axes (keeps its scale).

    Pose independent: computed from rest matrices (parent = bone tail at rest).
    """
    hand = normalize_hand(hand or ob.get("claude_hand"), str(ob.get("claude_weapon", "")))
    bone = rig.armature.data.bones[rig.bones[_arm_part(hand)]]
    obj_rest = rig.object_matrix_from_handle(grip_handle_rest(rig, hand))
    obj_rest = obj_rest @ Matrix.Diagonal(ob.matrix_basis.to_scale()).to_4x4()
    parent_rest = bone.matrix_local @ Matrix.Translation((0.0, bone.length, 0.0))
    return (parent_rest @ ob.matrix_parent_inverse).inverted() @ obj_rest


def _parent_matrix(rig, bone_name):
    """Armature-space matrix a BONE-parented child is attached to (bone tail, current evaluated pose)."""
    dg = bpy.context.evaluated_depsgraph_get()
    pb = rig.armature.evaluated_get(dg).pose.bones[bone_name]
    bone = rig.armature.data.bones[bone_name]
    if bone.use_relative_parent:
        return pb.matrix_channel.copy()
    return pb.matrix @ Matrix.Translation((0.0, bone.length, 0.0))


def _is_weapon_of(ob, rig):
    return bool(ob.get("claude_weapon")) and (rig is None or ob.parent == rig.armature)


def list_weapons(rig=None):
    """All objects tagged claude_weapon (only those parented to rig.armature when a rig is given)."""
    out = []
    for ob in bpy.data.objects:
        if not _is_weapon_of(ob, rig):
            continue
        out.append({
            "name": ob.name,
            "kind": str(ob.get("claude_weapon")),
            "hand": str(ob.get("claude_hand", "Right")),
            "placeholder": bool(ob.get("claude_placeholder", False)),
            "armature": ob.parent.name if ob.parent else None,
            "bone": ob.parent_bone if ob.parent_type == "BONE" else None,
            "animated": bool(ob.animation_data and ob.animation_data.action),
        })
    return out


def handle_object(rig):
    """Name of the rig's right-hand weapon (the Roblox 'Handle' joint), or None."""
    for ob in bpy.data.objects:
        if _is_weapon_of(ob, rig) and str(ob.get("claude_hand", "Right")) == "Right":
            return ob.name
    return None


def attach_weapon(rig, kind="sword", hand=None, object_name=None, replace=True, keep_transform=False):
    """Hold a weapon in a hand of the rig.

    kind: one of KINDS. hand: 'Right'/'Left' (None = Left for shield/bow, else Right).
    object_name: use an existing object instead of a placeholder. It is snapped so its origin sits on the
    grip with its local axes = handle axes (blade along local +Z for a Z-up rig), keeping its own scale,
    unless keep_transform=True (then it is only parented, keeping its world placement).
    replace: remove (placeholders) / release (user objects) the weapons already in that hand.
    Returns {"object", "kind", "hand", "armature", "bone", "placeholder", "replaced", "grip"}.
    """
    kind = normalize_kind(kind)
    hand = normalize_hand(hand, kind)
    part = _arm_part(hand)
    bone_name = rig.bones[part]
    scene = bpy.context.scene

    user_ob = None
    if object_name:
        user_ob = bpy.data.objects.get(object_name)
        if user_ob is None:
            raise ValueError("Object '%s' not found" % object_name)
        if user_ob.type in ("ARMATURE", "CAMERA", "LIGHT", "LIGHT_PROBE", "SPEAKER"):
            raise ValueError("Object '%s' is a %s, not a weapon model" % (object_name, user_ob.type))
        body = {rigm._bound_mesh_for_bone(rig.armature, b) for b in rig.bones.values()}
        if user_ob in body:
            raise ValueError("Object '%s' is a body part of the rig, not a weapon" % object_name)

    replaced = []
    if replace:
        for w in list_weapons(rig):
            if w["hand"] == hand and w["name"] != object_name:
                replaced.extend(detach_weapon(w["name"], rig=rig)["detached"])

    world_before = user_ob.matrix_world.copy() if user_ob is not None else None
    if user_ob is None:
        prefix = "Claude_Handle_" if hand == "Right" else "Claude_OffHand_"  # right hand sorts first
        me = build_placeholder_mesh(kind, rig, hand, prefix + kind.capitalize() + "_Mesh")
        ob = bpy.data.objects.new(prefix + kind.capitalize(), me)
        _weapon_collection(scene).objects.link(ob)
        ob["claude_placeholder"] = True
    else:
        ob = user_ob
        ob["claude_placeholder"] = False
    ob["claude_weapon"] = kind
    ob["claude_hand"] = hand
    ob["claude_rig"] = rig.armature.name

    arm_world = rig.armature.matrix_world
    ob.parent = rig.armature
    ob.parent_type = "BONE"
    ob.parent_bone = bone_name
    ob.matrix_parent_inverse = Matrix.Identity(4)
    if user_ob is not None and keep_transform:
        obj_arm = arm_world.inverted() @ world_before
        ob.matrix_basis = _parent_matrix(rig, bone_name).inverted() @ obj_arm
    else:
        scale = (arm_world.inverted() @ world_before).to_scale() if user_ob is not None else Vector((1, 1, 1))
        ob.matrix_basis = Matrix.Diagonal(scale).to_4x4()  # grip_basis keeps the object's scale
        ob.matrix_basis = grip_basis(rig, ob, hand)
    bpy.context.view_layer.update()

    if hand == "Right":
        rig.weapon_object = ob.name
    return {"object": ob.name, "kind": kind, "hand": hand, "armature": rig.armature.name, "bone": bone_name,
            "placeholder": user_ob is None, "replaced": replaced,
            "grip": [round(c, 5) for c in ob.matrix_world.translation]}


def detach_weapon(name=None, rig=None, hand=None):
    """Remove weapons: placeholders are deleted, user objects are unparented in place and untagged.

    name: a weapon object; else every weapon of `rig` (optionally only that `hand`).
    Returns {"detached": [names], "deleted": [names]}.
    """
    if name:
        ob = bpy.data.objects.get(name)
        if ob is None:
            raise ValueError("Object '%s' not found" % name)
        if not ob.get("claude_weapon"):
            raise ValueError("Object '%s' is not a Claude weapon (no claude_weapon property)" % name)
        targets = [ob]
    else:
        h = normalize_hand(hand) if hand else None
        targets = [bpy.data.objects[w["name"]] for w in list_weapons(rig) if h is None or w["hand"] == h]
    detached, deleted = [], []
    for ob in targets:
        obname = ob.name
        detached.append(obname)
        if ob.get("claude_placeholder"):
            me = ob.data if ob.type == "MESH" else None
            mats = [m for m in (me.materials if me else []) if m]
            bpy.data.objects.remove(ob)
            if me is not None and me.users == 0:
                bpy.data.meshes.remove(me)
            for m in mats:
                if m.users == 0 and m.name.startswith(_MAT_PREFIX):
                    bpy.data.materials.remove(m)
            deleted.append(obname)
        else:
            ad = ob.animation_data
            if ad is not None and ad.action is not None and ad.action.get("r6_weapon_of"):
                ad.action = None  # Handle keys only make sense while held
            mw = ob.matrix_world.copy()
            ob.parent = None
            ob.parent_type = "OBJECT"
            ob.parent_bone = ""
            ob.matrix_world = mw
            for key in ("claude_weapon", "claude_hand", "claude_placeholder", "claude_rig"):
                if key in ob.keys():
                    del ob[key]
        if rig is not None and rig.weapon_object == obname:
            rig.weapon_object = None
    coll = bpy.data.collections.get(COLLECTION)
    if coll is not None and not coll.objects and not coll.children:
        bpy.data.collections.remove(coll)
    if rig is not None and rig.weapon_object is None:
        rig.weapon_object = handle_object(rig)
    return {"detached": detached, "deleted": deleted}
