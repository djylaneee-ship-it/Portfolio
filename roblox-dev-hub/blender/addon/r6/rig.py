"""R6 rig detection and the Blender <-> Roblox character-space bridge.

Everything Blender-side is in ARMATURE space (pose_bone.matrix / bone.matrix_local), so the
armature object's own transform never matters.

Core identities (SPEC.md section 3):
    to_char  : armature space -> Roblox character space (HumanoidRootPart rest = identity)
    from_char: inverse of to_char
    D_char   = parts[i] @ rest_parts[i]^-1                    (world delta of part i, Roblox space)
    bone[i]  = W @ from_char @ D_char @ to_char @ rest_bone[i]  (armature space pose matrix)
    W        = root controller delta (pose(root) @ rest(root)^-1), identity when there is no root bone
"""

import json
import math
import re

import bpy
from mathutils import Matrix, Vector

from . import cframe as cfm

_ALIASES = {
    "Torso": ["torso", "chest", "body", "uppertorso"],
    "Head": ["head"],
    "Right Arm": ["rightarm", "armr", "rightshoulder", "rarm"],
    "Left Arm": ["leftarm", "arml", "leftshoulder", "larm"],
    "Right Leg": ["rightleg", "legr", "righthip", "rleg"],
    "Left Leg": ["leftleg", "legl", "lefthip", "lleg"],
}
_HRP_ALIASES = ["humanoidrootpart", "rootpart", "hrp"]


def _norm(name):
    return re.sub(r"[^a-z0-9]", "", name.lower())


def _snap_axis(v, tol_deg=3.0):
    """Snap a unit vector to the closest principal axis if it is within tol_deg."""
    best = None
    for axis in (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1))):
        for sign in (1.0, -1.0):
            cand = axis * sign
            ang = math.degrees(v.angle(cand, math.pi))
            if best is None or ang < best[0]:
                best = (ang, cand)
    return best[1].copy() if best[0] <= tol_deg else v.normalized()


def _map_bones(arm_obj):
    """part -> bone name for one armature (exact aliases first)."""
    by_norm = {}
    for b in arm_obj.data.bones:
        by_norm.setdefault(_norm(b.name), b.name)
    mapping = {}
    for part, aliases in _ALIASES.items():
        for alias in aliases:
            if alias in by_norm:
                mapping[part] = by_norm[alias]
                break
    return mapping


def _follower_constraints(arm_obj, mapping):
    """Count constraints that make mapped bones copy another armature (follower / export rig)."""
    n = 0
    for bone_name in mapping.values():
        pb = arm_obj.pose.bones.get(bone_name)
        if not pb:
            continue
        for c in pb.constraints:
            tgt = getattr(c, "target", None)
            if tgt is not None and tgt != arm_obj and c.influence > 0 and not c.mute:
                n += 1
    return n


def find_rig_meta():
    """Return (meta_dict, object_name) for a den_S style __RigMeta empty, or (None, None)."""
    for ob in bpy.data.objects:
        if "RigMeta" in ob.keys():
            try:
                return json.loads(ob["RigMeta"]), ob.name
            except Exception:
                continue
    return None, None


def _meta_joint_overrides(meta):
    c0s, c1s = {}, {}

    def walk(node):
        for child in node.get("children", []):
            pname = child.get("pname")
            if pname in cfm.R6_JOINTS:
                if "jointtransform0" in child:
                    c0s[pname] = cfm.cf_from_list(child["jointtransform0"])
                if "jointtransform1" in child:
                    c1s[pname] = cfm.cf_from_list(child["jointtransform1"])
            walk(child)

    if meta and "rig" in meta:
        walk(meta["rig"])
    return c0s, c1s


def _bound_mesh_for_bone(arm_obj, bone_name):
    """Find a mesh object driven by this bone (bone parent, Child Of constraint, or vertex group)."""
    for ob in bpy.data.objects:
        if ob.type != "MESH":
            continue
        if ob.parent == arm_obj and ob.parent_type == "BONE" and ob.parent_bone == bone_name:
            return ob
        for c in ob.constraints:
            if c.type == "CHILD_OF" and getattr(c, "target", None) == arm_obj and c.subtarget == bone_name:
                return ob
    for ob in bpy.data.objects:
        if ob.type != "MESH":
            continue
        has_mod = any(m.type == "ARMATURE" and m.object == arm_obj for m in ob.modifiers)
        if has_mod and ob.vertex_groups.get(bone_name) and len(ob.vertex_groups) == 1:
            return ob
    return None


def rig_meshes(arm_obj):
    """All mesh objects that follow this armature (directly or via a follower armature)."""
    followers = {arm_obj}
    for ob in bpy.data.objects:
        if ob.type == "ARMATURE" and ob != arm_obj:
            for pb in ob.pose.bones:
                if any(getattr(c, "target", None) == arm_obj for c in pb.constraints):
                    followers.add(ob)
                    break
    out = []
    for ob in bpy.data.objects:
        if ob.type != "MESH":
            continue
        linked = False
        p = ob
        while p is not None and not linked:
            if p in followers:
                linked = True
            if p.type == "MESH" and any(getattr(c, "target", None) in followers for c in p.constraints):
                linked = True
            if p.type == "MESH" and any(m.type == "ARMATURE" and m.object in followers for m in p.modifiers):
                linked = True
            p = p.parent
        if linked:
            out.append(ob)
    return out


class R6Rig:
    """Detected R6 rig. Build with find_rig()."""

    def __init__(self, arm_obj, mapping, warnings, alternatives):
        self.armature = arm_obj
        self.bones = dict(mapping)
        self.warnings = list(warnings)
        self.alternatives = alternatives
        self.meta, self.meta_object = find_rig_meta()
        c0s, c1s = _meta_joint_overrides(self.meta)
        self.table = cfm.joint_table(c0s, c1s)
        self.meta_joint_count = len(c0s)
        self.rig_name = (self.meta or {}).get("rigName") or arm_obj.name
        self.rest_parts = cfm.rest_parts(self.table)
        self.rest_bone = {part: arm_obj.data.bones[name].matrix_local.copy() for part, name in self.bones.items()}
        self._detect_root()
        self._detect_frame()
        self.weapon_object = self._detect_weapon()

    # -- detection -----------------------------------------------------------------
    def _detect_root(self):
        bones = self.armature.data.bones
        self.hrp_bone = None
        for b in bones:
            if _norm(b.name) in _HRP_ALIASES:
                self.hrp_bone = b.name
                break
        mapped = set(self.bones.values())
        root = None
        b = bones[self.bones["Torso"]].parent
        while b is not None:
            if b.name not in mapped:
                root = b.name
            b = b.parent
        self.root_bone = root

    def _den_style(self):
        if self.meta is not None:
            return True
        b = self.armature.data.bones[self.bones["Torso"]]
        return "transform" in b.keys() or "nicetransform" in b.keys()

    def _detect_frame(self):
        bones = self.armature.data.bones
        h = {part: bones[name].head_local.copy() for part, name in self.bones.items()}
        right = (h["Right Arm"] - h["Left Arm"]) + (h["Right Leg"] - h["Left Leg"])
        if right.length < 1e-6:
            raise RuntimeError("Cannot find the character's right side: Left/Right bones overlap")
        right.normalize()
        up = h["Head"] - (h["Right Leg"] + h["Left Leg"]) * 0.5
        up = up - right * up.dot(right)
        if up.length < 1e-6:
            raise RuntimeError("Cannot find the character's up axis from Head vs legs")
        up.normalize()
        right = _snap_axis(right)
        up = _snap_axis(up)
        if abs(right.dot(up)) > 1e-4:  # snapping broke orthogonality: re-orthogonalize
            up = (up - right * up.dot(right)).normalized()
        back = right.cross(up).normalized()
        self.axes = {"right": right, "up": up, "back": back}

        torso_mesh = _bound_mesh_for_bone(self.armature, self.bones["Torso"])
        self.torso_mesh = torso_mesh.name if torso_mesh else None
        shoulder_dist = (h["Right Arm"] - h["Left Arm"]).length
        if self._den_style():
            self.scale = shoulder_dist / 2.0
            self.scale_source = "shoulder joints (den_S style rig, bones at joints)"
        elif torso_mesh is not None:
            corners = [torso_mesh.matrix_world @ Vector(c) for c in torso_mesh.bound_box]
            inv = self.armature.matrix_world.inverted()
            corners = [inv @ c for c in corners]
            xs = [c.dot(right) for c in corners]
            self.scale = (max(xs) - min(xs)) / cfm.R6_SIZES["Torso"][0]
            self.scale_source = "Torso mesh width"
        else:
            self.scale = shoulder_dist / 2.0
            self.scale_source = "shoulder bone distance (assumes bones at joints)"
            self.warnings.append("Scale guessed from shoulder bone distance; check with r6_inspect_rig.")
        if self.scale <= 1e-6:
            raise RuntimeError("Invalid rig scale")

        if self.hrp_bone:
            origin = bones[self.hrp_bone].head_local.copy()
            self.origin_source = "HumanoidRootPart bone"
        elif self._den_style():
            origin = h["Torso"]
            self.origin_source = "Torso bone head (RootJoint)"
        elif torso_mesh is not None:
            corners = [self.armature.matrix_world.inverted() @ (torso_mesh.matrix_world @ Vector(c))
                       for c in torso_mesh.bound_box]
            origin = sum(corners, Vector()) / 8.0
            self.origin_source = "Torso mesh center"
        else:
            origin = (h["Right Arm"] + h["Left Arm"]) * 0.5 - up * (0.5 * self.scale)
            self.origin_source = "estimated from shoulders"
            self.warnings.append("Character origin estimated from shoulders; translations may be offset.")
        self.origin = origin

        rot = Matrix((right, up, back))  # rows: armature vector -> character vector
        m = (rot * (1.0 / self.scale)).to_4x4()
        m.translation = -(rot @ origin) / self.scale
        self.to_char = m
        self.from_char = m.inverted()
        self.char_rot_scale = (rot * (1.0 / self.scale)).to_4x4()  # to_char without translation

    def _detect_weapon(self):
        """Right-hand weapon (the one the Handle joint drives); left-hand items are never returned."""
        for ob in sorted(bpy.data.objects, key=lambda o: o.name):
            if ob.get("claude_weapon") and ob.parent == self.armature and ob.get("claude_hand", "Right") == "Right":
                return ob.name
        return None

    # -- pose access ------------------------------------------------------------------
    def pose_matrices(self, evaluated=True):
        """{part: armature-space pose matrix} for the current frame (+ '__root__' if a root bone exists)."""
        obj = self.armature
        if evaluated:
            depsgraph = bpy.context.evaluated_depsgraph_get()
            obj = obj.evaluated_get(depsgraph)
        out = {part: obj.pose.bones[name].matrix.copy() for part, name in self.bones.items()}
        if self.root_bone:
            out["__root__"] = obj.pose.bones[self.root_bone].matrix.copy()
        return out

    def root_delta(self, pose=None):
        if not self.root_bone:
            return Matrix.Identity(4)
        if pose is None:
            pose = self.pose_matrices()
        rest = self.armature.data.bones[self.root_bone].matrix_local
        return pose["__root__"] @ rest.inverted()

    def _root_compensation(self, pose, root_motion):
        w = self.root_delta(pose)
        if root_motion == "full":
            return Matrix.Identity(4)
        if root_motion == "ignore_root":
            return w
        if root_motion == "in_place":
            t = w.translation.copy()
            up = self.axes["up"]
            return Matrix.Translation(t - up * t.dot(up))
        raise ValueError("root_motion must be 'full', 'in_place' or 'ignore_root'")

    def parts_from_pose(self, pose=None, root_motion="full"):
        """Armature pose -> {part: CFrame} in character space (HumanoidRootPart = identity)."""
        if pose is None:
            pose = self.pose_matrices()
        w_inv = self._root_compensation(pose, root_motion).inverted()
        parts = {cfm.R6_ROOT: Matrix.Identity(4)}
        for part in cfm.R6_PARTS:
            d_arm = w_inv @ pose[part] @ self.rest_bone[part].inverted()
            d_char = self.to_char @ d_arm @ self.from_char
            parts[part] = cfm.orthonormalize(d_char @ self.rest_parts[part])
        return parts

    def transforms_from_pose(self, pose=None, root_motion="full"):
        return cfm.ik_transforms(self.parts_from_pose(pose, root_motion), self.table)

    def bone_targets_from_parts(self, parts, root_delta=None):
        """{part: CFrame char space} -> {part: armature-space pose matrix} for the mapped bones."""
        w = root_delta if root_delta is not None else Matrix.Identity(4)
        out = {}
        for part in cfm.R6_PARTS:
            d_char = parts[part] @ self.rest_parts[part].inverted()
            out[part] = w @ self.from_char @ d_char @ self.to_char @ self.rest_bone[part]
        return out

    # weapon object <-> Handle part (object matrices in armature space)
    def object_matrix_from_handle(self, handle_cf, root_delta=None):
        w = root_delta if root_delta is not None else Matrix.Identity(4)
        return w @ self.from_char @ handle_cf @ self.char_rot_scale

    def handle_from_object_matrix(self, obj_arm_matrix, root_delta=None):
        w = root_delta if root_delta is not None else Matrix.Identity(4)
        return cfm.orthonormalize(self.to_char @ w.inverted() @ obj_arm_matrix @ self.char_rot_scale.inverted())

    # -- reporting -------------------------------------------------------------------
    def describe(self):
        def vec(v):
            return [round(c, 4) for c in v]

        bones = self.armature.data.bones
        joint_alignment = {}
        for part in cfm.R6_PARTS:
            _j, parent, c0, _c1 = self.table[part]
            pivot_char = self.rest_parts[parent] @ c0.translation
            pivot_arm = self.from_char @ pivot_char
            joint_alignment[part] = round((bones[self.bones[part]].head_local - pivot_arm).length / self.scale, 4)
        constrained = {}
        for part, name in self.bones.items():
            cons = [c.type for c in self.armature.pose.bones[name].constraints if not c.mute and c.influence > 0]
            if cons:
                constrained[part] = cons
        ad = self.armature.animation_data
        return {
            "armature": self.armature.name,
            "rig_name": self.rig_name,
            "bones": self.bones,
            "root_bone": self.root_bone,
            "hrp_bone": self.hrp_bone,
            "rig_meta": self.meta_object,
            "rig_meta_joints": self.meta_joint_count,
            "scale_blender_units_per_stud": round(self.scale, 5),
            "scale_source": self.scale_source,
            "origin_armature_space": vec(self.origin),
            "origin_source": self.origin_source,
            "axes_armature_space": {k: vec(v) for k, v in self.axes.items()},
            "character_faces_armature_axis": vec(-self.axes["back"]),
            "bone_head_to_joint_distance_studs": joint_alignment,
            "constrained_bones": constrained,
            "weapon_object": self.weapon_object,
            "torso_mesh": self.torso_mesh,
            "meshes": [ob.name for ob in rig_meshes(self.armature)],
            "active_action": ad.action.name if ad and ad.action else None,
            "alternatives": self.alternatives,
            "warnings": self.warnings,
        }


def find_rig(armature_name=None):
    """Detect the R6 control rig. Raises RuntimeError with a readable message when none is found."""
    if armature_name:
        ob = bpy.data.objects.get(armature_name)
        if ob is None or ob.type != "ARMATURE":
            raise RuntimeError("Armature '%s' not found" % armature_name)
        candidates = [ob]
    else:
        candidates = [ob for ob in bpy.data.objects if ob.type == "ARMATURE"]
    scored = []
    for ob in candidates:
        mapping = _map_bones(ob)
        if len(mapping) < 6:
            continue
        followers = _follower_constraints(ob, mapping)
        score = 100 - 10 * followers
        if ob.animation_data and ob.animation_data.action:
            score += 5
        if bpy.context.view_layer.objects.active == ob:
            score += 3
        if ob.hide_get() if ob.name in bpy.context.view_layer.objects else True:
            score -= 2
        scored.append((score, ob, mapping, followers))
    if not scored:
        names = [ob.name for ob in candidates]
        raise RuntimeError("No R6 armature found (need bones Torso, Head, Left/Right Arm, Left/Right Leg). "
                           "Armatures seen: %s" % names)
    scored.sort(key=lambda s: -s[0])
    _score, ob, mapping, followers = scored[0]
    warnings = []
    if followers:
        warnings.append("Mapped bones of '%s' copy another armature (%d constraints)." % (ob.name, followers))
    alternatives = [{"armature": s[1].name, "follower_constraints": s[3]} for s in scored[1:]]
    return R6Rig(ob, mapping, warnings, alternatives)
