"""Keyframe R6 clips on the Blender control rig and read them back (Blender 5.x slotted actions).

    apply_clip         Clip -> new action (bones solved analytically, weapon "Handle" on the weapon object)
    set_keys           key joints at scene frames on an action, keeping the other joints where they are
    read_pose          evaluated rig -> friendly joint values
    read_clip          action -> clip dict (Clip.to_dict format)
    mirror_action / retime_action   read_clip -> Clip transform -> apply_clip
    list_actions / set_active_action

Keys are written straight into the action's channelbag (one F-curve group per bone, like
keyframe_insert(group=bone)), so the result never depends on the user's keying preferences.
Bone bases come from Bone.convert_local_to_pose with the parent's new (or evaluated) pose, which is
the exact inverse of Blender's bone evaluation, including Inherit Rotation / Inherit Scale / Local
Location options (the fixture's legs have use_local_location=False).
"""

import copy
import json
import math
from collections import Counter

import bpy
from bpy_extras import anim_utils
from mathutils import Euler, Matrix, Quaternion, Vector

from . import cframe as cfm
from .clip import PRIORITIES, Clip

ROOT_MOTIONS = ("full", "in_place", "ignore_root")
_WEAPON_GROUP = "Object Transforms"
_HANDLE = cfm.WEAPON_JOINT


# ---------------------------------------------------------------------------
# small helpers
# ---------------------------------------------------------------------------

def _scene():
    return bpy.context.scene


def _scene_fps(scene):
    return scene.render.fps / (scene.render.fps_base or 1.0)


def _round(v, digits):
    r = round(float(v), digits)
    return 0.0 if r == 0 else r


def _bone_prefix(bone_name):
    return 'pose.bones["%s"].' % bpy.utils.escape_identifier(bone_name)


def _rot_prop(mode):
    if mode == "QUATERNION":
        return "rotation_quaternion"
    if mode == "AXIS_ANGLE":
        return "rotation_axis_angle"
    return "rotation_euler"


def _rot_size(mode):
    return 4 if mode in ("QUATERNION", "AXIS_ANGLE") else 3


def _rot_values(mode, quat, prev=None):
    """Rotation channel values for `mode`, continuous with `prev` (the neighbouring key's values)."""
    q = quat.normalized()
    if mode == "QUATERNION":
        ref = Quaternion(prev) if prev is not None else Quaternion()
        if ref.dot(q) < 0.0:
            q.negate()
        return list(q)
    if mode == "AXIS_ANGLE":
        ref = Quaternion()
        if prev is not None and Vector(prev[1:]).length > 1e-9:
            ref = Quaternion(Vector(prev[1:]), prev[0])
        if ref.dot(q) < 0.0:
            q.negate()
        axis, angle = q.to_axis_angle()
        return [angle, axis.x, axis.y, axis.z]
    if prev is not None:
        return list(q.to_euler(mode, Euler(prev, mode)))
    return list(q.to_euler(mode))


def _action_fcurves(action):
    for layer in action.layers:
        for strip in layer.strips:
            for cb in getattr(strip, "channelbags", ()):
                yield from cb.fcurves


def _action_range(action):
    a, b = action.frame_range
    return int(round(a)), int(round(b))


def _set_action_range(action, start, end, loop=None):
    action.use_frame_range = True
    for _ in range(2):  # setters clamp against each other: apply twice
        action.frame_start = start
        action.frame_end = end
    if loop is not None:
        action.use_cyclic = bool(loop)


def _set_scene_range(scene, start, end):
    for _ in range(2):
        scene.frame_start = start
        scene.frame_end = end
    if scene.use_preview_range:
        for _ in range(2):
            scene.frame_preview_start = start
            scene.frame_preview_end = end


def _add_cycles(action):
    for fc in _action_fcurves(action):
        if not any(m.type == "CYCLES" for m in fc.modifiers):
            fc.modifiers.new("CYCLES")
        fc.update()


def _json_prop(idblock, key, default):
    try:
        return json.loads(idblock[key])
    except Exception:
        return default


def _plain(value):
    if hasattr(value, "to_list"):
        return value.to_list()
    if hasattr(value, "to_dict"):
        return value.to_dict()
    return value


def _get_action(rig, action):
    """None -> the armature's active action; name or Action -> that action."""
    if isinstance(action, bpy.types.Action):
        return action
    if action is None:
        ad = rig.armature.animation_data
        if ad is None or ad.action is None:
            raise RuntimeError("Armature '%s' has no active action" % rig.armature.name)
        return ad.action
    act = bpy.data.actions.get(action)
    if act is None:
        raise RuntimeError("Action '%s' not found. Actions: %s" % (action, [a.name for a in bpy.data.actions]))
    return act


def _clear_action(action):
    for layer in list(action.layers):
        action.layers.remove(layer)
    for slot in list(action.slots):
        action.slots.remove(slot)
    for marker in list(action.pose_markers):
        action.pose_markers.remove(marker)
    for key in [k for k in action.keys() if k.startswith("r6_")]:
        del action[key]


def _fresh_action(name, overwrite):
    """(action, created). Reuses (and empties) an existing action only when overwrite is True."""
    act = bpy.data.actions.get(name)
    if act is not None and overwrite and act.library is None:
        _clear_action(act)
        created = False
    else:
        act = bpy.data.actions.new(name)  # Blender makes the name unique ("Name.001")
        created = True
    act.use_fake_user = True
    return act, created


def _slot_for(action, obj):
    """Slot of `action` for `obj`: the assigned one, one named after obj, one with channels, else a new one."""
    ad = obj.animation_data
    if ad is not None and ad.action == action and ad.action_slot is not None:
        return ad.action_slot
    slots = [s for s in action.slots if s.target_id_type in ("OBJECT", "UNSPECIFIED")]
    wanted = ["OB" + obj.name, ad.last_slot_identifier if ad else None]
    for ident in wanted:
        for s in slots:
            if ident and s.identifier == ident:
                return s
    for s in slots:
        cb = anim_utils.action_get_channelbag_for_slot(action, s)
        if cb is not None and len(cb.fcurves):
            return s
    if slots:
        return slots[0]
    return action.slots.new(id_type="OBJECT", name=obj.name)


def _assign(obj, action, slot):
    ad = obj.animation_data or obj.animation_data_create()
    if ad.use_tweak_mode:
        raise RuntimeError("'%s' is in NLA tweak mode; exit it before changing actions" % obj.name)
    if ad.action != action:
        ad.action = action
    if action is not None and slot is not None and ad.action_slot != slot:
        ad.action_slot = slot


def _protect(action, warnings):
    """An action about to lose its last user gets a fake user so saving the file does not drop it."""
    if action is not None and not action.use_fake_user and action.users <= 1:
        action.use_fake_user = True
        warnings.append("Previous action '%s' got a fake user so it is kept when the file is saved." % action.name)


class _Assignments:
    """Temporarily assign actions to objects; restore() puts the previous action and slot back."""

    def __init__(self):
        self.saved = []

    def use(self, obj, action):
        ad = obj.animation_data or obj.animation_data_create()
        self.saved.append((obj, ad.action, ad.action_slot))
        slot = _slot_for(action, obj)
        _assign(obj, action, slot)
        return slot

    def restore(self):
        for obj, action, slot in reversed(self.saved):
            _assign(obj, action, slot)
        self.saved = []


class _Keyer:
    """Writes loc/rot keys into one channelbag, keeping rotations continuous between successive keys."""

    def __init__(self, channelbag):
        self.cb = channelbag
        self.prev = {}

    def key(self, path, values, frame, group, interp, easing):
        for i, v in enumerate(values):
            fc = self.cb.fcurves.ensure(path, index=i, group_name=group)
            kp = fc.keyframe_points.insert(frame, float(v), options={"FAST"})
            kp.interpolation = interp
            kp.easing = easing

    def current(self, path, size, frame):
        """Values of existing F-curves at `frame` (None when a channel is missing)."""
        vals = []
        for i in range(size):
            fc = self.cb.fcurves.find(path, index=i)
            if fc is None:
                return None
            vals.append(fc.evaluate(frame))
        return vals

    def key_basis(self, prefix, group, mode, basis, frame, interp="BEZIER", easing="AUTO", ref=None):
        """Key location + rotation (in `mode`) of a local basis matrix."""
        loc, quat, _scale = basis.decompose()
        rpath = prefix + _rot_prop(mode)
        rot = _rot_values(mode, quat, ref if ref is not None else self.prev.get(rpath))
        self.prev[rpath] = rot
        self.key(prefix + "location", loc, frame, group, interp, easing)
        self.key(rpath, rot, frame, group, interp, easing)

    def finish(self):
        for fc in self.cb.fcurves:
            fc.update()


# ---------------------------------------------------------------------------
# rig math
# ---------------------------------------------------------------------------

def _transforms(rig, joints):
    """Friendly joint values -> {part: Motor6D.Transform} for the six R6 parts present in `joints`."""
    return {p: cfm.friendly_to_transform(v["rot"], v["pos"], rig.table[p][2])
            for p, v in joints.items() if p in rig.table}


def _handle_cf(parts, value):
    t = cfm.friendly_to_transform(value["rot"], value["pos"], cfm.WEAPON_C0)
    return parts[cfm.WEAPON_PARENT] @ cfm.WEAPON_C0 @ t @ cfm.WEAPON_C1.inverted()


def _solve(rig, transforms, eval_obj, root_delta):
    """Motor6D transforms -> (parts, pose_of, {bone: matrix_basis}) for the mapped bones.

    pose_of(bone_name) is the armature-space pose each bone will have: the target for mapped bones,
    the evaluated pose for unmapped bones above them (root controller), or for unmapped bones below a
    mapped one, their evaluated basis on top of the parent's new pose.
    """
    parts = cfm.fk(transforms, rig.table)
    targets = rig.bone_targets_from_parts(parts, root_delta)
    bones = rig.armature.data.bones
    poses = {rig.bones[p]: m for p, m in targets.items()}
    cache = {}

    def pose_of(name):
        if name in poses:
            return poses[name]
        if name not in cache:
            bone = bones[name]
            pb = eval_obj.pose.bones[name]
            if bone.parent is not None and any(a.name in poses for a in bone.parent_recursive):
                cache[name] = bone.convert_local_to_pose(
                    pb.matrix_basis, bone.matrix_local, parent_matrix=pose_of(bone.parent.name),
                    parent_matrix_local=bone.parent.matrix_local)
            else:
                cache[name] = pb.matrix.copy()
        return cache[name]

    bases = {}
    for name, target in poses.items():
        bone = bones[name]
        if bone.parent is None:
            bases[name] = bone.convert_local_to_pose(target, bone.matrix_local, invert=True)
        else:
            bases[name] = bone.convert_local_to_pose(
                target, bone.matrix_local, parent_matrix=pose_of(bone.parent.name),
                parent_matrix_local=bone.parent.matrix_local, invert=True)
    return parts, pose_of, bases


def _weapon_object(rig):
    """The right-hand weapon object (custom prop claude_weapon) parented to the rig, or None."""
    for ob in sorted(bpy.data.objects, key=lambda o: o.name):
        if ob.get("claude_weapon") and ob.parent == rig.armature \
                and not str(ob.get("claude_hand", "Right")).lower().startswith("l"):
            return ob
    return None


def _weapon_basis(rig, wob, handle_cf, pose_of, root_delta):
    """Local matrix_basis of the weapon object that puts its grip at `handle_cf` (character space)."""
    target = rig.object_matrix_from_handle(handle_cf, root_delta)
    parent = Matrix.Identity(4)
    if wob.parent_type == "BONE" and wob.parent_bone in rig.armature.data.bones:
        bone = rig.armature.data.bones[wob.parent_bone]
        parent = pose_of(bone.name).copy()
        parent.translation = parent.translation + parent.col[1].xyz * bone.length  # bone parent = tail
    return (parent @ wob.matrix_parent_inverse).inverted() @ target


def _reset_weapon(rig, wob):
    """Put a bone-parented weapon back at the plain Roblox grip (Handle transform = identity)."""
    if wob.parent_type != "BONE" or wob.parent_bone != rig.bones.get(cfm.WEAPON_PARENT):
        return
    rest = cfm.rest_parts(rig.table)
    handle = rest[cfm.WEAPON_PARENT] @ cfm.WEAPON_C0 @ cfm.WEAPON_C1.inverted()
    bones = rig.armature.data.bones
    basis = _weapon_basis(rig, wob, handle, lambda n: bones[n].matrix_local, Matrix.Identity(4))
    loc, quat, _s = basis.decompose()
    wob.matrix_basis = Matrix.LocRotScale(loc, quat, wob.scale)


def _weapon_action(action, fresh):
    """The "<action>_Weapon" action linked to `action` (created, or emptied when fresh=True)."""
    wact = bpy.data.actions.get(action.get("r6_weapon_action", "")) or bpy.data.actions.get(action.name + "_Weapon")
    if wact is not None and wact.get("r6_weapon_of") == action.name:
        if fresh:
            _clear_action(wact)
    else:
        wact = bpy.data.actions.new(action.name + "_Weapon")
    wact.use_fake_user = True
    wact["r6_weapon_of"] = action.name
    action["r6_weapon_action"] = wact.name
    return wact


def _sync_weapon(rig, action):
    """Give the weapon object the weapon action linked to `action`, or detach a stale one of ours."""
    wob = _weapon_object(rig)
    if wob is None:
        return None
    wact = bpy.data.actions.get(action.get("r6_weapon_action", "")) if action is not None else None
    if wact is not None:
        _assign(wob, wact, _slot_for(wact, wob))
        return wact.name
    ad = wob.animation_data
    if ad is not None and ad.action is not None and ad.action.get("r6_weapon_of"):
        _assign(wob, None, None)
        _reset_weapon(rig, wob)
    return None


def _rig_warnings(rig):
    if rig.armature.mode == "EDIT":
        raise RuntimeError("Armature '%s' is in Edit Mode: switch to Object or Pose mode first" % rig.armature.name)
    out = []
    for part in cfm.R6_PARTS:
        name = rig.bones[part]
        if any(not c.mute and c.influence > 0 for c in rig.armature.pose.bones[name].constraints):
            out.append("Bone '%s' has constraints: its evaluated pose may differ from the keyed values." % name)
    return out


def _joint_values(rig, pose, root_motion, digits, weapon_eval=None, arm_world=None):
    """Evaluated pose matrices -> {joint: {"rot", "pos"}} (+ Handle when weapon_eval is given)."""
    if root_motion not in ROOT_MOTIONS:
        raise ValueError("root_motion must be one of %s" % (ROOT_MOTIONS,))
    parts = rig.parts_from_pose(pose, root_motion)
    tr = cfm.ik_transforms(parts, rig.table)
    out = {}

    def friendly(t, c0):
        rot, pos = cfm.transform_to_friendly(t, c0)
        return {"rot": [_round(v, digits) for v in rot], "pos": [_round(v, digits) for v in pos]}

    for part in cfm.R6_PARTS:
        out[part] = friendly(tr[part], rig.table[part][2])
    if weapon_eval is not None:
        comp = rig._root_compensation(pose, root_motion)
        world = arm_world if arm_world is not None else Matrix.Identity(4)
        obj_m = world.inverted() @ weapon_eval.matrix_world
        handle = rig.handle_from_object_matrix(obj_m, comp)
        t = cfm.WEAPON_C0.inverted() @ parts[cfm.WEAPON_PARENT].inverted() @ handle @ cfm.WEAPON_C1
        out[_HANDLE] = friendly(t, cfm.WEAPON_C0)
    return out


def _seam_deg(rig, a, b):
    worst = 0.0
    for part in cfm.R6_PARTS:
        c0 = rig.table[part][2]
        ta = cfm.friendly_to_transform(a[part]["rot"], a[part]["pos"], c0)
        tb = cfm.friendly_to_transform(b[part]["rot"], b[part]["pos"], c0)
        worst = max(worst, math.degrees(cfm.angle_between(ta, tb)))
    return worst


def _checked_clip(rig, clip, scene, warnings):
    fps = _scene_fps(scene)
    if abs(fps - clip.fps) > 0.01:
        warnings.append("Clip '%s' is authored at %d fps but the scene runs at %g fps: frames are used as-is "
                        "(retime the clip or change the scene fps)." % (clip.name, clip.fps, fps))
    if clip.loop and clip.length > 0 and 0 in clip.keys:
        if clip.length not in clip.keys:
            clip = copy.deepcopy(clip).close_loop()
            warnings.append("Loop clip had no key at its last frame %d: added one equal to frame 0." % clip.length)
        else:
            seam = _seam_deg(rig, clip.resolve(0), clip.resolve(clip.length))
            if seam > 0.5:
                warnings.append("Loop seam: frame %d differs from frame 0 by %.1f deg (use close_loop())."
                                % (clip.length, seam))
    for ev in clip.events:
        if not 0 <= ev["frame"] <= clip.length:
            warnings.append("Event '%s' at frame %d is outside the clip (0..%d)." % (ev["name"], ev["frame"],
                                                                                    clip.length))
    return clip


def _rows(clip, bake_step):
    """[(clip_frame, full_joints, interp, easing)]: the clip keys, or a bake every bake_step frames."""
    if bake_step and int(bake_step) > 0:
        frames = set(range(0, clip.length + 1, int(bake_step))) | {clip.length} | set(clip.frames())
        return [(f, clip.resolve(f), "LINEAR", "AUTO") for f in sorted(frames)]
    return clip.resolved_keys()


# ---------------------------------------------------------------------------
# public API
# ---------------------------------------------------------------------------

def apply_clip(rig, clip, action_name=None, start_frame=1, overwrite=False, set_active=True,
               set_scene_range=True, bake_step=0):
    """Keyframe a Clip (or clip dict) on the rig as a new action starting at scene frame `start_frame`.

    The action (default "R6_<clip name>", made unique unless overwrite=True) gets a fake user, an OBJECT
    slot, every mapped bone keyed at every clip key (or every `bake_step` frames, LINEAR), the root
    controller keyed at identity, pose markers for events, r6_* props and CYCLES modifiers for loops.
    "Handle" keys go to "<action>_Weapon" on the right-hand weapon object.
    Returns {"action", "frame_start", "frame_end", "keys", "bones_keyed", "warnings", ...}.
    """
    if isinstance(clip, dict):
        clip = Clip.from_dict(clip)
    if not clip.keys:
        raise ValueError("Clip '%s' has no keys" % clip.name)
    scene = _scene()
    arm = rig.armature
    warnings = _rig_warnings(rig)
    clip = _checked_clip(rig, clip, scene, warnings)
    rows = _rows(clip, bake_step)
    start = int(start_frame)
    end = start + clip.length

    ad = arm.animation_data or arm.animation_data_create()
    if ad.use_tweak_mode:
        raise RuntimeError("'%s' is in NLA tweak mode; exit it before applying a clip" % arm.name)
    previous = (ad.action, ad.action_slot)
    orig_frame = scene.frame_current

    use_weapon = clip.uses_weapon_joint()
    wob = _weapon_object(rig) if use_weapon else None
    if use_weapon and wob is None:
        warnings.append("Clip has Handle (weapon) keys but no right-hand weapon object is attached: skipped.")

    act, created = _fresh_action(action_name or "R6_" + clip.name, overwrite)
    if set_active and previous[0] is not None and previous[0] != act:
        _protect(previous[0], warnings)
    wact = None
    try:
        slot = act.slots.new(id_type="OBJECT", name=arm.name)
        if previous[0] == act:  # overwrite of the active action: its old slot was just removed
            previous = (act, slot)
        if set_active:  # channels the new action does not key must not keep stale values
            for pb in arm.pose.bones:
                pb.matrix_basis = Matrix.Identity(4)
        _assign(arm, act, slot)
        keyer = _Keyer(anim_utils.action_ensure_channelbag_for_slot(act, slot))
        keyed = [rig.bones[p] for p in cfm.R6_PARTS]
        if rig.root_bone:
            keyer.key_basis(_bone_prefix(rig.root_bone), rig.root_bone, arm.pose.bones[rig.root_bone].rotation_mode,
                            Matrix.Identity(4), start, rows[0][2], rows[0][3])
            keyed.append(rig.root_bone)
        wkeyer = None
        if wob is not None:
            if wob.parent_type == "BONE" and arm.data.bones.get(wob.parent_bone) is not None \
                    and arm.data.bones[wob.parent_bone].use_relative_parent:
                warnings.append("Weapon parent bone uses Relative Parenting: Handle keys may be offset.")
            wact = _weapon_action(act, fresh=True)
            wslot = wact.slots.new(id_type="OBJECT", name=wob.name)
            wkeyer = _Keyer(anim_utils.action_ensure_channelbag_for_slot(wact, wslot))

        for f, joints, interp, easing in rows:
            frame = start + f
            scene.frame_set(frame)  # evaluated root controller (and other unmapped parents) at this frame
            eval_obj = arm.evaluated_get(bpy.context.evaluated_depsgraph_get())
            w = rig.root_delta(rig.pose_matrices())
            parts, pose_of, bases = _solve(rig, _transforms(rig, joints), eval_obj, w)
            for part in cfm.R6_PARTS:
                name = rig.bones[part]
                keyer.key_basis(_bone_prefix(name), name, arm.pose.bones[name].rotation_mode, bases[name],
                                frame, interp, easing)
            if wkeyer is not None:
                basis = _weapon_basis(rig, wob, _handle_cf(parts, joints[_HANDLE]), pose_of, w)
                wkeyer.key_basis("", _WEAPON_GROUP, wob.rotation_mode, basis, frame, interp, easing)
        keyer.finish()
        if wkeyer is not None:
            wkeyer.finish()
    except Exception:
        _assign(arm, *previous)
        if created:
            bpy.data.actions.remove(act)
        scene.frame_set(orig_frame)
        raise

    if clip.loop:
        _add_cycles(act)
        if wact is not None:
            _add_cycles(wact)
    for ev in clip.events:
        marker = act.pose_markers.new(ev["name"])
        marker.frame = start + ev["frame"]
    act["r6_loop"] = bool(clip.loop)
    act["r6_priority"] = clip.priority
    act["r6_fps"] = int(clip.fps)
    act["r6_start_frame"] = start
    act["r6_clip"] = json.dumps(clip.to_dict())
    act["r6_events"] = json.dumps([{"frame": e["frame"], "scene_frame": start + e["frame"], "name": e["name"],
                                    "value": e["value"]} for e in clip.events])
    _set_action_range(act, start, end, clip.loop)
    if wact is not None:
        _set_action_range(wact, start, end, clip.loop)

    if set_active:
        _sync_weapon(rig, act)
    else:
        _assign(arm, *previous)
    if set_scene_range:
        _set_scene_range(scene, start, end)
        scene.frame_set(start)
    else:
        scene.frame_set(orig_frame)
    return {
        "action": act.name,
        "frame_start": start,
        "frame_end": end,
        "keys": len(rows),
        "bones_keyed": keyed,
        "slot": slot.identifier,
        "weapon_action": wact.name if wact is not None else None,
        "events": len(clip.events),
        "loop": clip.loop,
        "warnings": warnings,
    }


def set_keys(rig, keys, action=None):
    """Key joints at SCENE frames: keys = [{"frame", "joints", "interp", "easing"}].

    Works on `action` (name; default the active action, a new "R6_Pose" when there is none) and makes it
    active. Joints not given keep their evaluated value at that frame (relative to the root controller);
    all six bones are keyed at each frame. A "Handle" joint keys the right-hand weapon object.
    """
    scene = _scene()
    arm = rig.armature
    warnings = _rig_warnings(rig)
    ad = arm.animation_data or arm.animation_data_create()
    if action is None and ad.action is not None:
        act = ad.action
    elif action is None:
        act = _fresh_action("R6_Pose", False)[0]
    else:
        act = _get_action(rig, action)
    if ad.action != act:
        _protect(ad.action, warnings)
    _assign(arm, act, _slot_for(act, arm))
    keyer = _Keyer(anim_utils.action_ensure_channelbag_for_slot(act, ad.action_slot))

    merged = {}
    for k in keys:
        tmp = Clip("keys", 0).key(0, k.get("joints", {}), k.get("interp", "BEZIER"), k.get("easing", "AUTO"))
        row = merged.setdefault(int(round(k["frame"])), {"joints": {}})
        row["joints"].update(tmp.keys[0]["joints"])
        row["interp"], row["easing"] = tmp.keys[0]["interp"], tmp.keys[0]["easing"]
    if not merged:
        raise ValueError("set_keys needs at least one key")

    wob = _weapon_object(rig)
    wact = wkeyer = None
    orig_frame = scene.frame_current
    try:
        for frame in sorted(merged):
            row = merged[frame]
            scene.frame_set(frame)
            pose = rig.pose_matrices()
            w = rig.root_delta(pose)
            transforms = rig.transforms_from_pose(pose, "ignore_root")
            transforms.update(_transforms(rig, row["joints"]))
            eval_obj = arm.evaluated_get(bpy.context.evaluated_depsgraph_get())
            parts, pose_of, bases = _solve(rig, transforms, eval_obj, w)
            for part in cfm.R6_PARTS:
                name = rig.bones[part]
                mode = arm.pose.bones[name].rotation_mode
                prefix = _bone_prefix(name)
                ref = keyer.current(prefix + _rot_prop(mode), _rot_size(mode), frame)
                keyer.key_basis(prefix, name, mode, bases[name], frame, row["interp"], row["easing"], ref)
            if _HANDLE in row["joints"]:
                if wob is None:
                    if not any("weapon" in m for m in warnings):
                        warnings.append("Handle keys skipped: no right-hand weapon object is attached.")
                else:
                    if wkeyer is None:
                        wact = _weapon_action(act, fresh=False)
                        wslot = _slot_for(wact, wob)
                        _assign(wob, wact, wslot)
                        wkeyer = _Keyer(anim_utils.action_ensure_channelbag_for_slot(wact, wslot))
                    basis = _weapon_basis(rig, wob, _handle_cf(parts, row["joints"][_HANDLE]), pose_of, w)
                    ref = wkeyer.current(_rot_prop(wob.rotation_mode), _rot_size(wob.rotation_mode), frame)
                    wkeyer.key_basis("", _WEAPON_GROUP, wob.rotation_mode, basis, frame, row["interp"],
                                     row["easing"], ref)
                    wkeyer.finish()
            keyer.finish()  # later frames evaluate the updated curves
    finally:
        scene.frame_set(orig_frame)

    frames = sorted(merged)
    if act.use_frame_range:
        start, end = _action_range(act)
        if frames[0] < start or frames[-1] > end:
            _set_action_range(act, min(start, frames[0]), max(end, frames[-1]))
            warnings.append("Action frame range extended to %d..%d." % _action_range(act))
    if act.get("r6_loop"):
        _add_cycles(act)
        if wact is not None:
            _add_cycles(wact)
    return {"action": act.name, "frames": frames, "bones_keyed": [rig.bones[p] for p in cfm.R6_PARTS],
            "weapon_action": wact.name if wact is not None else None, "warnings": warnings}


def read_pose(rig, frame=None, root_motion="ignore_root"):
    """Friendly joint values of the evaluated rig at `frame` (default current; the frame is restored).

    Returns {"frame", "joints": {part: {"rot", "pos"}}} rounded to 3 decimals, plus "Handle" when a
    right-hand weapon object is attached.
    """
    scene = _scene()
    orig = scene.frame_current
    target = orig if frame is None else int(round(frame))
    if target != orig:
        scene.frame_set(target)
    try:
        dg = bpy.context.evaluated_depsgraph_get()
        wob = _weapon_object(rig)
        joints = _joint_values(rig, rig.pose_matrices(), root_motion, 3,
                               wob.evaluated_get(dg) if wob is not None else None,
                               rig.armature.evaluated_get(dg).matrix_world)
    finally:
        if target != orig:
            scene.frame_set(orig)
    return {"frame": target, "joints": joints}


def read_clip(rig, action=None, frames="keys"):
    """Read an action back as a clip dict (Clip.to_dict format, frames relative to the action start).

    frames: "keys" (union of keyframes of the mapped + root bones, plus the range ends), "all", or an int
    step. Values include root controller motion ("full"). interp/easing come from the F-curves (majority
    at that frame, LINEAR for sampled frames); loop/priority/events from action props and pose markers.
    """
    act = _get_action(rig, action)
    scene = _scene()
    arm = rig.armature
    start, end = _action_range(act)
    wob = _weapon_object(rig)
    wact = bpy.data.actions.get(act.get("r6_weapon_action", "")) if wob is not None else None
    temp = _Assignments()
    orig = scene.frame_current
    rows = []
    try:
        slot = temp.use(arm, act)
        names = [rig.bones[p] for p in cfm.R6_PARTS] + ([rig.root_bone] if rig.root_bone else [])
        info = _key_info(anim_utils.action_get_channelbag_for_slot(act, slot),
                         tuple(_bone_prefix(n) for n in names))
        if wact is not None:
            wslot = temp.use(wob, wact)
            for f, c in _key_info(anim_utils.action_get_channelbag_for_slot(wact, wslot), ("",)).items():
                info.setdefault(f, Counter()).update(c)
        if frames == "keys":
            flist = sorted({f for f in info if start <= f <= end} | {start, end})
        elif frames == "all":
            flist = list(range(start, end + 1))
        else:
            step = int(frames)
            if step < 1:
                raise ValueError("frames must be 'keys', 'all' or an int step >= 1")
            flist = sorted(set(range(start, end + 1, step)) | {end})
        for f in flist:
            scene.frame_set(f)
            dg = bpy.context.evaluated_depsgraph_get()
            joints = _joint_values(rig, rig.pose_matrices(), "full", 4,
                                   wob.evaluated_get(dg) if wact is not None else None,
                                   arm.evaluated_get(dg).matrix_world)
            interp, easing = info[f].most_common(1)[0][0] if f in info else ("LINEAR", "AUTO")
            rows.append((f, joints, interp, easing))
    finally:
        temp.restore()
        scene.frame_set(orig)

    meta = _json_prop(act, "r6_clip", {})
    if "r6_loop" in act:
        loop = bool(act["r6_loop"])
    else:
        loop = bool(act.use_cyclic) or any(m.type == "CYCLES" for fc in _action_fcurves(act) for m in fc.modifiers)
    priority = act.get("r6_priority", "Action")
    priority = priority if priority in PRIORITIES else "Action"
    name = act.name[3:] if act.name.startswith("R6_") else act.name
    clip = Clip(name, end - start, int(round(_scene_fps(scene))), loop, priority, meta.get("description", ""),
                meta.get("weapon"))
    for f, joints, interp, easing in rows:
        clip.key(f - start, joints, interp, easing)
    stored = _json_prop(act, "r6_events", [])
    for m in sorted(act.pose_markers, key=lambda m: m.frame):
        if not start <= m.frame <= end:
            continue
        value = next((e.get("value", "") for e in stored if e.get("name") == m.name
                      and e.get("scene_frame", start + e.get("frame", 0)) == m.frame),
                     next((e.get("value", "") for e in stored if e.get("name") == m.name), ""))
        clip.event(m.frame - start, m.name, value)
    out = clip.to_dict()
    out["action"] = act.name
    out["start_frame"] = start
    return out


def _key_info(channelbag, prefixes):
    """{frame: Counter((interp, easing))} over the keyframes of F-curves whose path starts with a prefix."""
    info = {}
    if channelbag is None:
        return info
    for fc in channelbag.fcurves:
        if not fc.data_path.startswith(prefixes):
            continue
        for kp in fc.keyframe_points:
            info.setdefault(int(round(kp.co[0])), Counter())[(kp.interpolation, kp.easing)] += 1
    return info


def mirror_action(rig, action=None, new_name=None):
    """Mirror an action left <-> right into a new action (default "<action>_Mirror"), made active."""
    act = _get_action(rig, action)
    data = read_clip(rig, act)
    clip = Clip.from_dict(data).mirrored()
    return apply_clip(rig, clip, action_name=new_name or act.name + "_Mirror", start_frame=data["start_frame"])


def retime_action(rig, action=None, speed=1.0, new_name=None):
    """Play an action `speed` times faster (keys and events rescaled) into a new action, made active."""
    if speed <= 0:
        raise ValueError("speed must be > 0")
    act = _get_action(rig, action)
    data = read_clip(rig, act)
    clip = Clip.from_dict(data).retimed(speed=speed)
    name = new_name or "%s_x%s" % (act.name, ("%g" % speed).replace(".", "_"))
    return apply_clip(rig, clip, action_name=name, start_frame=data["start_frame"])


def list_actions(rig):
    """Actions that animate this rig's bones: [{"name", "frame_range", "props", "is_active", ...}]."""
    names = [rig.bones[p] for p in cfm.R6_PARTS] + ([rig.root_bone] if rig.root_bone else [])
    prefixes = tuple(_bone_prefix(n) for n in names)
    ad = rig.armature.animation_data
    active = ad.action if ad is not None else None
    out = []
    for act in bpy.data.actions:
        count = sum(1 for fc in _action_fcurves(act) if fc.data_path.startswith(prefixes))
        if not count:
            continue
        out.append({
            "name": act.name,
            "frame_range": list(_action_range(act)),
            "use_frame_range": act.use_frame_range,
            "is_active": act == active,
            "fake_user": act.use_fake_user,
            "users": act.users,
            "fcurves": count,
            "loop": bool(act.get("r6_loop", False)),
            "priority": act.get("r6_priority"),
            "markers": [{"name": m.name, "frame": m.frame} for m in act.pose_markers],
            "weapon_action": act.get("r6_weapon_action"),
            "props": {k: _plain(act[k]) for k in act.keys() if k.startswith("r6_") and k not in ("r6_clip",
                                                                                               "r6_events")},
        })
    return out


def set_active_action(rig, name, set_scene_range=True):
    """Make action `name` the rig's active action (with its slot and weapon action) and frame its range."""
    act = _get_action(rig, name)
    arm = rig.armature
    warnings = []
    ad = arm.animation_data or arm.animation_data_create()
    if ad.action is not None and ad.action != act:
        _protect(ad.action, warnings)
    for pb in arm.pose.bones:  # channels the new action does not key must not keep stale values
        pb.matrix_basis = Matrix.Identity(4)
    slot = _slot_for(act, arm)
    _assign(arm, act, slot)
    weapon = _sync_weapon(rig, act)
    scene = _scene()
    start, end = _action_range(act)
    if set_scene_range:
        _set_scene_range(scene, start, end)
        scene.frame_set(start)
    else:
        scene.frame_set(scene.frame_current)
    return {"action": act.name, "slot": slot.identifier, "frame_start": start, "frame_end": end,
            "weapon_action": weapon, "warnings": warnings}
