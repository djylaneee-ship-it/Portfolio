"""Roblox export of R6 actions.

Pipeline: sample_action (evaluate each frame through rig.py -> Motor6D transforms)
       -> reduce_keyframes (Ramer-Douglas-Peucker in time, CFrame:Lerp error model)
       -> build_export (plain JSON-able dict)
       -> write_json / write_rbxmx / write_luau.

Roblox facts used here: Pose.CFrame is the Motor6D.Transform; with EasingStyle Linear Roblox
interpolates two keyframes with CFrame:Lerp (slerp rotation, lerp position), which is exactly the
error model of reduce_keyframes; a looped sequence must end on the same pose it starts with.
"""

import contextlib
import hashlib
import json
import math
import os
import re
import tempfile
from xml.sax.saxutils import escape

import bpy
import numpy as np
from bpy_extras import anim_utils

from . import cframe as cfm
from . import weapons as wpn

ROOT_MOTION_MODES = ("full", "in_place", "ignore_root")
EXPORT_JOINTS = cfm.R6_PARTS + (cfm.WEAPON_JOINT,)
POSE_PARENTS = {part: cfm.R6_JOINTS[part][1] for part in cfm.R6_PARTS}
FORMAT_EXTENSIONS = {"rbxmx": ".rbxmx", "lua": ".lua", "luau": ".lua", "json": ".json"}
_WINDOWS_RESERVED = {"CON", "PRN", "AUX", "NUL"} | {"COM%d" % i for i in range(1, 10)} | {"LPT%d" % i for i in range(1, 10)}


# ---------------------------------------------------------------------------
# Action helpers
# ---------------------------------------------------------------------------

def resolve_action(rig, action=None):
    """Action object from None (the armature's active action), a name, or an Action."""
    if action is None:
        ad = rig.armature.animation_data
        if ad is None or ad.action is None:
            raise RuntimeError("Armature '%s' has no active action; pass an action name. Actions: %s"
                               % (rig.armature.name, [a.name for a in bpy.data.actions]))
        return ad.action
    if isinstance(action, str):
        act = bpy.data.actions.get(action)
        if act is None:
            raise RuntimeError("Action '%s' not found. Actions: %s" % (action, [a.name for a in bpy.data.actions]))
        return act
    if isinstance(action, bpy.types.Action):
        return action
    raise TypeError("action must be None, a name or a bpy.types.Action")


def action_frame_range(act):
    """(first, last) integer frames of an action (manual range when the action defines one)."""
    start, end = act.frame_range
    start, end = int(round(start)), int(round(end))
    return start, max(start, end)


def _pick_slot(act, obj):
    slots = [s for s in act.slots if s.target_id_type in ("OBJECT", "UNSPECIFIED")]
    if not slots:
        raise RuntimeError("Action '%s' has no slot usable by an object" % act.name)
    for s in slots:
        if s.identifier == "OB" + obj.name or s.name_display == obj.name:
            return s
    return slots[0]


@contextlib.contextmanager
def _action_assigned(rig, act, isolate=True):
    """Temporarily make `act` the armature's active action (and mute the NLA when isolate=True)."""
    obj = rig.armature
    ad = obj.animation_data
    created = ad is None
    if created:
        ad = obj.animation_data_create()
    prev_action, prev_slot, prev_nla = ad.action, ad.action_slot, ad.use_nla
    swap = prev_action != act
    if swap and ad.use_tweak_mode:
        raise RuntimeError("Leave NLA tweak mode before exporting another action than the tweaked one")
    slot_set = False
    try:
        if swap:
            ad.action = act
        if ad.action_slot is None:
            ad.action_slot = _pick_slot(act, obj)
            slot_set = not swap
        if isolate and ad.use_nla and not ad.use_tweak_mode:
            ad.use_nla = False
        yield
    finally:
        if ad.use_nla != prev_nla:
            ad.use_nla = prev_nla
        try:
            if swap:
                ad.action = prev_action
                if prev_action is not None and prev_slot is not None:
                    ad.action_slot = prev_slot
            elif slot_set:
                ad.action_slot = None
        except Exception:  # restoring a slot is best effort; never mask the real result/error
            pass
        if created and prev_action is None:
            obj.animation_data_clear()


def linked_weapon_action(act):
    """The "<action>_Weapon" action holding `act`'s Handle keys (r6.pose convention), or None."""
    wact = bpy.data.actions.get(str(act.get("r6_weapon_action", "") or ""))
    if wact is None:
        wact = bpy.data.actions.get(act.name + "_Weapon")
        if wact is not None and wact.get("r6_weapon_of") != act.name:
            wact = None
    if wact is not None and not any(s.target_id_type in ("OBJECT", "UNSPECIFIED") for s in wact.slots):
        return None
    return wact


@contextlib.contextmanager
def _weapon_action_assigned(rig, act, wob, isolate=True):
    """Temporarily give the weapon object the weapon action linked to `act` (like r6.pose._sync_weapon).

    Without a linked action, a weapon action of another clip is detached and the weapon put back at the
    plain grip; a weapon animated by the user's own action is left alone. Everything is restored afterwards.
    """
    ad = wob.animation_data if wob is not None else None
    current = ad.action if ad is not None else None
    wact = linked_weapon_action(act) if wob is not None else None
    stale = wact is None and current is not None and current.get("r6_weapon_of") not in (None, act.name)
    if wob is None or (wact is None and not stale):
        yield
        return
    created = ad is None
    if created:
        ad = wob.animation_data_create()
    if ad.use_tweak_mode and ad.action != wact:
        raise RuntimeError("Weapon '%s' is in NLA tweak mode; exit it before exporting" % wob.name)
    prev_action, prev_slot, prev_nla = ad.action, ad.action_slot, ad.use_nla
    prev_basis = wob.matrix_basis.copy()
    try:
        if wact is not None:
            if ad.action != wact:
                ad.action = wact
            if ad.action_slot is None:
                ad.action_slot = _pick_slot(wact, wob)
        else:
            ad.action = None
            if wob.parent_type == "BONE":
                wob.matrix_basis = wpn.grip_basis(rig, wob)
        if isolate and ad.use_nla and not ad.use_tweak_mode:
            ad.use_nla = False
        yield
    finally:
        if ad.use_nla != prev_nla:
            ad.use_nla = prev_nla
        try:
            if ad.action != prev_action:
                ad.action = prev_action
            if prev_action is not None and prev_slot is not None and ad.action_slot != prev_slot:
                ad.action_slot = prev_slot
        except Exception:  # restoring a slot is best effort; never mask the real result/error
            pass
        wob.matrix_basis = prev_basis
        if created and prev_action is None:
            wob.animation_data_clear()


def _weapon_info(rig):
    """(weapon object, arm part it hangs from) or (None, None)."""
    name = getattr(rig, "weapon_object", None)
    wob = bpy.data.objects.get(name) if name else None
    if wob is None:
        return None, None
    parent = cfm.WEAPON_PARENT
    if wob.parent == rig.armature and wob.parent_type == "BONE":
        for part in ("Right Arm", "Left Arm"):
            if wob.parent_bone == rig.bones.get(part):
                parent = part
    elif str(wob.get("claude_hand", "Right")).lower().startswith("l"):
        parent = "Left Arm"
    return wob, parent


def _handle_part(rig, pose, parts, arm_part, obj_arm_matrix):
    """Character-space CFrame of the weapon handle, consistent with parts (root compensation cancels).

    handle = parts[arm] @ rest_part^-1 @ to_char @ rest_bone @ M_arm^-1 @ O @ char_rot_scale^-1
    (O = weapon object matrix in armature space, M_arm = arm bone pose matrix).
    """
    rel = (rig.rest_parts[arm_part].inverted() @ rig.to_char @ rig.rest_bone[arm_part]
           @ pose[arm_part].inverted() @ obj_arm_matrix @ rig.char_rot_scale.inverted())
    return cfm.orthonormalize(parts[arm_part] @ rel)


# ---------------------------------------------------------------------------
# Sampling
# ---------------------------------------------------------------------------

def sample_action(rig, action=None, frame_start=None, frame_end=None, step=1, root_motion="full",
                  frames=None, isolate=True):
    """Evaluate an action frame by frame.

    Returns {"action", "frames", "fps", "root_motion", "joints",
             "transforms": [{joint: Motor6D.Transform Matrix}], "parts": [{part: CFrame}] (character space),
             "root_deltas": [root controller delta in character space], "handle": [Matrix] | None,
             "handle_parent": arm part | None}.
    "Handle" is included in transforms/parts when the rig has a weapon object. `frames` (explicit list)
    overrides the start/end/step grid. isolate=True mutes the NLA while sampling so only the action
    plays. The weapon object plays the action's linked "<action>_Weapon" action (see
    _weapon_action_assigned). The current frame and the armature's and weapon's action/slot/NLA state are
    restored afterwards.
    """
    if root_motion not in ROOT_MOTION_MODES:
        raise ValueError("root_motion must be one of %s" % (ROOT_MOTION_MODES,))
    act = resolve_action(rig, action)
    scene = bpy.context.scene
    fps = scene.render.fps / scene.render.fps_base
    if frames is None:
        a_start, a_end = action_frame_range(act)
        fs = a_start if frame_start is None else int(frame_start)
        fe = a_end if frame_end is None else int(frame_end)
        if fe < fs:
            raise ValueError("frame_end (%d) is before frame_start (%d)" % (fe, fs))
        step = max(1, int(step))
        frames = list(range(fs, fe + 1, step))
        if frames[-1] != fe:
            frames.append(fe)
    else:
        frames = sorted({int(f) for f in frames})
        if not frames:
            raise ValueError("frames is empty")
    wob, handle_parent = _weapon_info(rig)
    joints = list(cfm.R6_PARTS) + ([cfm.WEAPON_JOINT] if wob else [])
    out = {"action": act.name, "frames": frames, "fps": fps, "root_motion": root_motion, "joints": joints,
           "transforms": [], "parts": [], "root_deltas": [], "handle": [] if wob else None,
           "handle_parent": handle_parent}
    orig_frame, orig_sub = scene.frame_current, scene.frame_subframe
    try:
        with _action_assigned(rig, act, isolate), _weapon_action_assigned(rig, act, wob, isolate):
            for f in frames:
                scene.frame_set(f)
                pose = rig.pose_matrices()
                parts = rig.parts_from_pose(pose, root_motion)
                transforms = cfm.ik_transforms(parts, rig.table)
                if wob is not None:
                    dg = bpy.context.evaluated_depsgraph_get()
                    arm_world = rig.armature.evaluated_get(dg).matrix_world
                    o = arm_world.inverted() @ wob.evaluated_get(dg).matrix_world
                    handle = _handle_part(rig, pose, parts, handle_parent, o)
                    parts[cfm.WEAPON_JOINT] = handle
                    transforms[cfm.WEAPON_JOINT] = (cfm.WEAPON_C0.inverted() @ parts[handle_parent].inverted()
                                                    @ handle @ cfm.WEAPON_C1)
                    out["handle"].append(transforms[cfm.WEAPON_JOINT])
                out["transforms"].append(transforms)
                out["parts"].append(parts)
                out["root_deltas"].append(cfm.orthonormalize(rig.to_char @ rig.root_delta(pose) @ rig.from_char))
    finally:
        scene.frame_set(orig_frame, subframe=orig_sub)
    return out


# ---------------------------------------------------------------------------
# Keyframe reduction
# ---------------------------------------------------------------------------

def _pose_arrays(transforms, joints):
    """(Q[n, J, 4] unit quaternions wxyz, P[n, J, 3] translations) for a list of {joint: Matrix}."""
    n, nj = len(transforms), len(joints)
    q_arr = np.empty((n, nj, 4))
    p_arr = np.empty((n, nj, 3))
    for i, tr in enumerate(transforms):
        for j, joint in enumerate(joints):
            m = tr.get(joint, cfm.IDENTITY)
            q = m.to_quaternion().normalized()
            q_arr[i, j] = (q.w, q.x, q.y, q.z)
            p_arr[i, j] = m.translation
    return q_arr, p_arr


def _segment_errors(q_arr, p_arr, times, a, b):
    """Max-over-joints (angle radians, distance) of every sample strictly between a and b against
    CFrame:Lerp of samples a and b."""
    ks = np.arange(a + 1, b)
    t = (times[ks] - times[a]) / (times[b] - times[a])
    qa = q_arr[a]
    qb = q_arr[b].copy()
    dot = np.sum(qa * qb, axis=1)
    qb[dot < 0] *= -1.0                       # shortest path, like CFrame:Lerp
    omega = np.arccos(np.clip(np.abs(dot), 0.0, 1.0))
    so = np.sin(omega)
    small = so < 1e-9
    so_safe = np.where(small, 1.0, so)
    tt = t[:, None]
    wa = np.where(small, 1.0 - tt, np.sin((1.0 - tt) * omega) / so_safe)
    wb = np.where(small, tt, np.sin(tt * omega) / so_safe)
    qi = wa[..., None] * qa[None] + wb[..., None] * qb[None]
    qi /= np.linalg.norm(qi, axis=2, keepdims=True)
    qk = q_arr[ks]
    sign = np.where(np.sum(qi * qk, axis=2) < 0, -1.0, 1.0)[..., None]
    # numerically stable rotation angle between two unit quaternions
    ang = 4.0 * np.arctan2(np.linalg.norm(qk - sign * qi, axis=2), np.linalg.norm(qk + sign * qi, axis=2))
    pi = p_arr[a][None] + (p_arr[b] - p_arr[a])[None] * tt[..., None]
    dist = np.linalg.norm(p_arr[ks] - pi, axis=2)
    return ang.max(axis=1), dist.max(axis=1)


def _joints_of(samples):
    joints = samples.get("joints")
    if joints:
        return list(joints)
    names = set()
    for tr in samples["transforms"]:
        names.update(tr.keys())
    return [j for j in EXPORT_JOINTS if j in names]


def reduce_keyframes(samples, angle_tol_deg=0.35, pos_tol=0.005, keep=frozenset()):
    """Indices of the samples to keep as keyframes (sorted).

    Ramer-Douglas-Peucker in time over ALL joints: a sample is dropped when CFrame:Lerp between the
    surrounding kept samples reproduces every joint within angle_tol_deg and pos_tol studs.
    The first and last samples and every index in `keep` (sample indices, e.g. marker frames) are kept.
    """
    transforms = samples["transforms"]
    n = len(transforms)
    if n <= 2:
        return list(range(n))
    joints = _joints_of(samples)
    q_arr, p_arr = _pose_arrays(transforms, joints)
    times = np.asarray(samples.get("frames") or list(range(n)), dtype=float)
    atol = math.radians(max(angle_tol_deg, 1e-9))
    ptol = max(pos_tol, 1e-12)
    anchors = sorted({0, n - 1} | {int(k) for k in keep if 0 <= int(k) < n})
    kept = set(anchors)
    stack = list(zip(anchors, anchors[1:]))
    while stack:
        a, b = stack.pop()
        if b - a < 2:
            continue
        ang, dist = _segment_errors(q_arr, p_arr, times, a, b)
        score = np.maximum(ang / atol, dist / ptol)
        k = int(np.argmax(score))
        if score[k] > 1.0:
            mid = a + 1 + k
            kept.add(mid)
            stack.append((a, mid))
            stack.append((mid, b))
    return sorted(kept)


def reconstruction_error(samples, kept):
    """(max angle deg, max distance studs) when only `kept` indices are played back with CFrame:Lerp."""
    joints = _joints_of(samples)
    q_arr, p_arr = _pose_arrays(samples["transforms"], joints)
    times = np.asarray(samples.get("frames") or list(range(len(q_arr))), dtype=float)
    worst_a, worst_d = 0.0, 0.0
    for a, b in zip(kept, kept[1:]):
        if b - a < 2:
            continue
        ang, dist = _segment_errors(q_arr, p_arr, times, a, b)
        worst_a = max(worst_a, float(ang.max()))
        worst_d = max(worst_d, float(dist.max()))
    return math.degrees(worst_a), worst_d


def pose_difference(tr_a, tr_b, joints=None):
    """(max angle deg, max distance studs, worst joint) between two {joint: Matrix} poses."""
    worst_ang, worst_dist, worst_joint, worst_score = 0.0, 0.0, None, -1.0
    for j in joints or [j for j in EXPORT_JOINTS if j in tr_a and j in tr_b]:
        ang = math.degrees(cfm.angle_between(tr_a[j], tr_b[j]))
        dist = (tr_a[j].translation - tr_b[j].translation).length
        worst_ang, worst_dist = max(worst_ang, ang), max(worst_dist, dist)
        score = ang / 0.35 + dist / 0.005
        if score > worst_score:
            worst_score, worst_joint = score, j
    return worst_ang, worst_dist, worst_joint


# ---------------------------------------------------------------------------
# Export dict
# ---------------------------------------------------------------------------

def _action_events(act):
    raw = act.get("r6_events")
    if raw is None:
        return []
    try:
        events = json.loads(raw) if isinstance(raw, str) else [dict(e) for e in raw]
        return [e for e in events if isinstance(e, dict) and "name" in e]
    except Exception:
        return []


def action_markers(act):
    """Pose markers of an action as [{"frame", "name", "value"}]; values come from action["r6_events"]
    (clip-relative frames offset by r6_start_frame, or scene frames)."""
    events = _action_events(act)
    start = int(act.get("r6_start_frame", 0) or 0)
    used = set()
    out = []
    for m in sorted(act.pose_markers, key=lambda m: (m.frame, m.name)):
        value = ""
        for match in (lambda e: int(e.get("frame", -10 ** 9)) + start == m.frame,
                      lambda e: int(e.get("frame", -10 ** 9)) == m.frame):
            hit = next((i for i, e in enumerate(events) if i not in used and e["name"] == m.name and match(e)), None)
            if hit is not None:
                used.add(hit)
                value = str(events[hit].get("value", ""))
                break
        out.append({"frame": int(m.frame), "name": m.name, "value": value})
    return out


def _default_name(act):
    return act.name[3:] if act.name.startswith("R6_") and len(act.name) > 3 else act.name


def animated_bones(act):
    """Names of the pose bones an action has F-curves for (all slots)."""
    names = set()
    for slot in act.slots:
        bag = anim_utils.action_get_channelbag_for_slot(act, slot)
        if bag is None:
            continue
        for fc in bag.fcurves:
            m = re.match(r'pose\.bones\["(.+?)"\]', fc.data_path)
            if m:
                names.add(m.group(1).replace('\\"', '"'))
    return names


_JOINT_KEYS = {re.sub(r"[\s_]", "", j).lower(): j for j in EXPORT_JOINTS}
_JOINT_KEYS["weapon"] = cfm.WEAPON_JOINT


def resolve_joints(joints):
    """Joint names (case and spaces ignored, "weapon" = Handle) -> canonical names in EXPORT_JOINTS order."""
    if isinstance(joints, str):
        joints = [joints]
    picked = set()
    for j in joints:
        key = re.sub(r"[\s_]", "", str(j)).lower()
        if key not in _JOINT_KEYS:
            raise ValueError("Unknown joint %r; use %s" % (j, list(EXPORT_JOINTS)))
        picked.add(_JOINT_KEYS[key])
    if not picked:
        raise ValueError("joints is empty; omit it to export every joint")
    return [j for j in EXPORT_JOINTS if j in picked]


GRIPS = ("tool", "weapongrip")
_GRIP_ROT = cfm.WEAPON_C0.to_3x3().to_4x4()
_GRIP_ROT_INV = _GRIP_ROT.inverted()


def weapongrip_transform(t):
    """Handle Motor6D.Transform in the Tool RightGrip convention (C0 = cframe.WEAPON_C0, C1 = identity) ->
    the game's "WeaponGrip" Motor6D (C0 = CFrame.new(0, -1, 0), C1 = the Handle's Grip attachment):
    Rb @ T @ Rb^-1 with Rb the rotation of WEAPON_C0 (the position rotates by Rb too)."""
    return _GRIP_ROT @ t @ _GRIP_ROT_INV


def build_export(rig, action=None, name=None, loop=None, priority=None, root_motion="full", reduce=True,
                 frame_start=None, frame_end=None, step=1, angle_tol_deg=0.35, pos_tol=0.005,
                 include_handle=True, isolate=True, joints=None, grip="tool"):
    """Sample, (optionally) reduce and package an action as a KeyframeSequence description.

    Returns {"name", "rig_name", "action", "fps", "frame_start", "frame_end", "duration", "loop", "priority",
    "root_motion", "joints", "animated_joints", "weights", "grip", "pose_parents", "keyframes": [{"frame", "time",
    "poses": {joint: [12]}, "markers": [{"name", "value"}]}], "markers", "stats", "warnings"}.
    Defaults: loop/priority from action props r6_loop / r6_priority (else False / "Action"), name = action
    name without "R6_". Loops: the last keyframe is made identical to the first when they already match
    within tolerance (or when the frame after the range closes the cycle); otherwise a warning is added.
    joints: only these joints are animated (Weight 1; reduction and loop seam consider only them); their
    unlisted ancestors are written as identity Weight 0 poses (hierarchy only, HumanoidRootPart included) and
    every other joint is omitted, so a layered animation leaves them to lower priorities. None = every joint.
    grip: "tool" (Handle C0 = RightGrip, C1 = identity) or "weapongrip" (see weapongrip_transform).
    """
    act = resolve_action(rig, action)
    mask = None if joints is None else resolve_joints(joints)
    grip = str(grip or "tool").lower()
    if grip not in GRIPS:
        raise ValueError("grip must be one of %s, got %r" % (list(GRIPS), grip))
    warnings = []
    name = str(name or _default_name(act))
    loop = bool(act.get("r6_loop", False)) if loop is None else bool(loop)
    if priority is None:
        priority = str(act.get("r6_priority", "Action") or "Action")
        if priority not in cfm.ANIMATION_PRIORITY:
            warnings.append("Action priority '%s' is not a Roblox AnimationPriority; using Action." % priority)
            priority = "Action"
    elif priority not in cfm.ANIMATION_PRIORITY:
        raise ValueError("priority must be one of %s" % list(cfm.ANIMATION_PRIORITY))
    a_start, a_end = action_frame_range(act)
    fs = a_start if frame_start is None else int(frame_start)
    fe = a_end if frame_end is None else int(frame_end)
    if fe < fs:
        raise ValueError("frame_end (%d) is before frame_start (%d)" % (fe, fs))
    step = max(1, int(step))
    rig_bones = set(rig.bones.values()) | ({rig.root_bone} if rig.root_bone else set())
    if not animated_bones(act) & rig_bones:
        warnings.append("Action '%s' has no F-curves for the R6 bones of '%s'; the export shows the current pose."
                        % (act.name, rig.armature.name))

    markers = []
    for m in action_markers(act):
        if fs <= m["frame"] <= fe:
            markers.append(m)
        else:
            warnings.append("Marker '%s' at frame %d is outside the exported range %d-%d and was skipped."
                            % (m["name"], m["frame"], fs, fe))
    grid = list(range(fs, fe + 1, step))
    if grid[-1] != fe:
        grid.append(fe)
    frames = sorted(set(grid) | {m["frame"] for m in markers})

    def sample(at):
        s = sample_action(rig, act, root_motion=root_motion, frames=at, isolate=isolate)
        if grip == "weapongrip" and cfm.WEAPON_JOINT in s["joints"]:
            for tr in s["transforms"]:
                tr[cfm.WEAPON_JOINT] = weapongrip_transform(tr[cfm.WEAPON_JOINT])
        return s

    samples = sample(frames)
    if not include_handle and cfm.WEAPON_JOINT in samples["joints"]:
        samples["joints"].remove(cfm.WEAPON_JOINT)
        for tr in samples["transforms"]:
            tr.pop(cfm.WEAPON_JOINT, None)
    if mask is not None:
        skipped = [j for j in mask if j not in samples["joints"]]
        if skipped:
            warnings.append("Joint(s) %s not exported: the rig has no weapon object (or include_handle=False)."
                            % skipped)
        samples["joints"] = [j for j in mask if j in samples["joints"]]
        if not samples["joints"]:
            raise ValueError("None of the requested joints %s can be exported" % mask)
    joints = samples["joints"]   # animated joints: reduction and the loop seam only look at these
    fps = samples["fps"]

    seam = None
    if loop and len(frames) > 1:
        seam = pose_difference(samples["transforms"][0], samples["transforms"][-1], joints)
        closed = seam[0] <= angle_tol_deg and seam[1] <= pos_tol
        if not closed:
            nxt = sample([fe + step])
            d = pose_difference(samples["transforms"][0], nxt["transforms"][0], joints)
            if d[0] <= angle_tol_deg and d[1] <= pos_tol:
                fe += step
                frames.append(fe)
                for key in ("transforms", "parts", "root_deltas"):
                    samples[key].append(nxt[key][0])
                samples["frames"].append(fe)
                warnings.append("Loop: frame %d (one step after the action range) closes the cycle and was "
                                "added as the last keyframe." % fe)
                seam = d
                closed = True
        if closed:
            samples["transforms"][-1] = {j: m.copy() for j, m in samples["transforms"][0].items()}
        else:
            warnings.append("Loop seam: the last frame differs from the first by %.2f deg / %.4f studs (%s). "
                            "Roblox will pop when it loops; make the last frame equal the first."
                            % (seam[0], seam[1], seam[2]))

    keep = {i for i, f in enumerate(frames) if any(m["frame"] == f for m in markers)}
    kept = reduce_keyframes(samples, angle_tol_deg, pos_tol, keep) if reduce else list(range(len(frames)))
    err_deg, err_studs = reconstruction_error(samples, kept)

    pose_parents = {j: POSE_PARENTS[j] for j in cfm.R6_PARTS}
    if cfm.WEAPON_JOINT in joints:
        pose_parents[cfm.WEAPON_JOINT] = samples["handle_parent"]
    written = set(joints)
    for j in joints:
        parent = pose_parents[j]
        while parent != cfm.R6_ROOT:
            written.add(parent)
            parent = pose_parents[parent]
    pose_joints = [j for j in EXPORT_JOINTS if j in written]
    weights = {cfm.R6_ROOT: 1 if mask is None else 0}
    weights.update({j: 1 if j in joints else 0 for j in pose_joints})
    identity = cfm.cf_to_list(cfm.IDENTITY)

    keyframes = []
    for i in kept:
        f = frames[i]
        tr = samples["transforms"][i]
        keyframes.append({
            "frame": f,
            "time": round((f - fs) / fps, 6),
            "poses": {j: cfm.cf_to_list(tr[j], 6) if weights[j] else list(identity) for j in pose_joints},
            "markers": [{"name": m["name"], "value": m["value"]} for m in markers if m["frame"] == f],
        })
    for kf in keyframes:
        for j, vals in kf["poses"].items():
            if not all(math.isfinite(v) for v in vals):
                raise ValueError("Non-finite transform for %s at frame %d" % (j, kf["frame"]))

    return {
        "format": "claude_blender_mcp.r6.keyframe_sequence",
        "version": 1,
        "name": name,
        "rig_name": rig.rig_name,
        "action": act.name,
        "fps": fps,
        "frame_start": fs,
        "frame_end": fe,
        "duration": round((fe - fs) / fps, 6),
        "loop": loop,
        "priority": priority,
        "root_motion": root_motion,
        "joints": pose_joints,
        "animated_joints": list(joints),
        "weights": weights,
        "grip": grip,
        "pose_parents": pose_parents,
        "keyframes": keyframes,
        "markers": [{"frame": m["frame"], "time": round((m["frame"] - fs) / fps, 6), "name": m["name"],
                     "value": m["value"]} for m in markers],
        "stats": {
            "sampled_frames": len(frames),
            "keyframes": len(keyframes),
            "reduced": bool(reduce),
            "angle_tol_deg": angle_tol_deg,
            "pos_tol": pos_tol,
            "max_error_deg": round(err_deg, 4),
            "max_error_studs": round(err_studs, 6),
            "loop_seam_deg": round(seam[0], 4) if seam else None,
            "loop_seam_studs": round(seam[1], 6) if seam else None,
        },
        "warnings": warnings,
    }


# ---------------------------------------------------------------------------
# Writers
# ---------------------------------------------------------------------------

def fmt_num(v, digits=6):
    """Compact decimal: at most `digits` decimals, no trailing zeros, never "-0"."""
    v = float(v)
    if not math.isfinite(v):
        raise ValueError("cannot write non-finite number %r" % v)
    s = ("%.*f" % (digits, round(v, digits))).rstrip("0").rstrip(".")
    return "0" if s in ("", "-0") else s


def _children(export):
    kids = {}
    for j in export["joints"]:
        kids.setdefault(export["pose_parents"][j], []).append(j)
    return kids


_XML_BAD = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f]")


def _xml_text(s):
    return escape(_XML_BAD.sub("", str(s)))


def rbxmx_string(export):
    """Roblox XML (version 4) model file with one KeyframeSequence."""
    seed = "%s|%s|%d" % (export["rig_name"], export["name"], len(export["keyframes"]))
    counter = [0]

    def ref():
        counter[0] += 1
        return "RBX" + hashlib.md5(("%s|%d" % (seed, counter[0])).encode("utf-8")).hexdigest().upper()

    kids = _children(export)
    weights = export.get("weights", {})
    out = ['<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" '
           'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
           'xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">',
           "\t<External>null</External>",
           "\t<External>nil</External>",
           '\t<Item class="KeyframeSequence" referent="%s">' % ref(),
           "\t\t<Properties>",
           '\t\t\t<bool name="Loop">%s</bool>' % ("true" if export["loop"] else "false"),
           '\t\t\t<string name="Name">%s</string>' % _xml_text(export["name"]),
           '\t\t\t<token name="Priority">%d</token>' % cfm.ANIMATION_PRIORITY[export["priority"]],
           "\t\t</Properties>"]

    def pose(name, values, poses, depth):
        tab = "\t" * depth
        keys = ("X", "Y", "Z", "R00", "R01", "R02", "R10", "R11", "R12", "R20", "R21", "R22")
        cf = "".join("<%s>%s</%s>" % (k, fmt_num(v), k) for k, v in zip(keys, values))
        out.append('%s<Item class="Pose" referent="%s">' % (tab, ref()))
        out.append("%s\t<Properties>" % tab)
        out.append('%s\t\t<CoordinateFrame name="CFrame">%s</CoordinateFrame>' % (tab, cf))
        out.append('%s\t\t<token name="EasingDirection">0</token>' % tab)
        out.append('%s\t\t<token name="EasingStyle">0</token>' % tab)
        out.append('%s\t\t<string name="Name">%s</string>' % (tab, _xml_text(name)))
        out.append('%s\t\t<float name="Weight">%s</float>' % (tab, fmt_num(weights.get(name, 1))))
        out.append("%s\t</Properties>" % tab)
        for child in kids.get(name, []):
            pose(child, poses[child], poses, depth + 1)
        out.append("%s</Item>" % tab)

    identity = cfm.cf_to_list(cfm.IDENTITY)
    for kf in export["keyframes"]:
        out.append('\t\t<Item class="Keyframe" referent="%s">' % ref())
        out.append("\t\t\t<Properties>")
        out.append('\t\t\t\t<string name="Name">Keyframe</string>')
        out.append('\t\t\t\t<float name="Time">%s</float>' % fmt_num(kf["time"]))
        out.append("\t\t\t</Properties>")
        pose(cfm.R6_ROOT, identity, kf["poses"], 3)
        for m in kf.get("markers", []):
            out.append('\t\t\t<Item class="KeyframeMarker" referent="%s">' % ref())
            out.append("\t\t\t\t<Properties>")
            out.append('\t\t\t\t\t<string name="Name">%s</string>' % _xml_text(m["name"]))
            out.append('\t\t\t\t\t<string name="Value">%s</string>' % _xml_text(m.get("value", "")))
            out.append("\t\t\t\t</Properties>")
            out.append("\t\t\t</Item>")
        out.append("\t\t</Item>")
    out.append("\t</Item>")
    out.append("</roblox>")
    return "\n".join(out) + "\n"


def _lua_str(s):
    out = ['"']
    for ch in str(s):
        o = ord(ch)
        if ch in '"\\':
            out.append("\\" + ch)
        elif ch == "\n":
            out.append("\\n")
        elif o < 32 or o == 127:
            out.append("\\%03d" % o)
        else:
            out.append(ch)
    out.append('"')
    return "".join(out)


def luau_string(export):
    """Self-contained Studio script that rebuilds the KeyframeSequence in
    ServerStorage.RBX_ANIMSAVES.<rig_name> (replacing a sequence with the same name) and returns a summary."""
    joints = export["joints"]
    weights = export.get("weights", {})
    animated = export.get("animated_joints", joints)
    identity = cfm.cf_to_list(cfm.IDENTITY)
    n = len(export["keyframes"])
    grip = export.get("grip", "tool")
    grip_doc = ("weapongrip (Handle = game Motor6D WeaponGrip: C0 = CFrame.new(0,-1,0), C1 = Handle Grip attachment)"
                if grip == "weapongrip" else "tool (Handle = RightGrip: C0 = RightGrip C0, C1 = identity)")
    mask_doc = ("all joints" if list(animated) == list(joints) else
                "%s (other poses: Weight 0, hierarchy only)" % ", ".join(animated))

    def cf_expr(values):
        if list(values) == identity:
            return "I"
        return "C(%s)" % ",".join(fmt_num(v) for v in values)

    lines = [
        "-- Claude Blender MCP: R6 KeyframeSequence %s for rig %s" % (_lua_str(export["name"]), _lua_str(export["rig_name"])),
        "-- %d keyframes, %s s, loop=%s, priority=%s, root_motion=%s, from Blender action %s"
        % (n, fmt_num(export["duration"], 3), str(export["loop"]).lower(), export["priority"],
           export.get("root_motion", "full"), _lua_str(export.get("action", ""))),
        "-- animated joints: %s" % mask_doc,
        "-- grip: %s" % grip_doc,
        "-- Run it in the Studio command bar (or through the Roblox Studio MCP execute_luau).",
        "local NAME = %s" % _lua_str(export["name"]),
        "local RIG = %s" % _lua_str(export["rig_name"]),
        "local LOOP = %s" % ("true" if export["loop"] else "false"),
        "local PRIORITY = Enum.AnimationPriority.%s" % export["priority"],
        "local DURATION = %s" % fmt_num(export["duration"]),
        "local JOINTS = {%s}" % ", ".join(_lua_str(j) for j in joints),
        "local PARENTS = {%s}" % ", ".join("[%s] = %s" % (_lua_str(j), _lua_str(export["pose_parents"][j]))
                                           for j in joints),
        "local WEIGHTS = {%s}" % ", ".join("[%s] = %s" % (_lua_str(j), fmt_num(weights.get(j, 1)))
                                           for j in (cfm.R6_ROOT,) + tuple(joints)),
        "local C = CFrame.new",
        "local I = CFrame.identity",
        "-- K[i] = {time, {CFrame per JOINTS entry}, {{marker name, marker value}, ...}}",
        "local K = {}",
    ]
    for i, kf in enumerate(export["keyframes"], 1):
        poses = ",".join(cf_expr(kf["poses"][j]) for j in joints)
        markers = ",".join("{%s,%s}" % (_lua_str(m["name"]), _lua_str(m.get("value", ""))) for m in kf.get("markers", []))
        lines.append("K[%d]={%s,{%s},{%s}}" % (i, fmt_num(kf["time"]), poses, markers))
    lines += [
        "",
        'local ServerStorage = game:GetService("ServerStorage")',
        'local saves = ServerStorage:FindFirstChild("RBX_ANIMSAVES")',
        "if not saves then",
        '\tsaves = Instance.new("Model")',
        '\tsaves.Name = "RBX_ANIMSAVES"',
        "\tsaves.Parent = ServerStorage",
        "end",
        "local rigEntry = saves:FindFirstChild(RIG)",
        "if not rigEntry then",
        "\t-- Same layout as the Animation Editor: an ObjectValue pointing at the rig model when it exists.",
        '\trigEntry = Instance.new("ObjectValue")',
        "\trigEntry.Name = RIG",
        "\tfor _, inst in ipairs(workspace:GetDescendants()) do",
        '\t\tif inst.Name == RIG and inst:IsA("Model") then',
        "\t\t\trigEntry.Value = inst",
        "\t\t\tbreak",
        "\t\tend",
        "\tend",
        "\trigEntry.Parent = saves",
        "end",
        "local replaced = 0",
        "for _, child in ipairs(rigEntry:GetChildren()) do",
        '\tif child.Name == NAME and child:IsA("KeyframeSequence") then',
        "\t\tchild:Destroy()",
        "\t\treplaced = replaced + 1",
        "\tend",
        "end",
        "",
        "local function newPose(name, cf, parent)",
        '\tlocal pose = Instance.new("Pose")',
        "\tpose.Name = name",
        "\tpose.CFrame = cf",
        "\tpose.EasingStyle = Enum.PoseEasingStyle.Linear",
        "\tpose.EasingDirection = Enum.PoseEasingDirection.In",
        "\tpose.Weight = WEIGHTS[name]",
        "\tpose.Parent = parent",
        "\treturn pose",
        "end",
        "",
        'local seq = Instance.new("KeyframeSequence")',
        "seq.Name = NAME",
        "seq.Loop = LOOP",
        "seq.Priority = PRIORITY",
        "local markerCount = 0",
        "for _, data in ipairs(K) do",
        '\tlocal kf = Instance.new("Keyframe")',
        '\tkf.Name = "Keyframe"',
        "\tkf.Time = data[1]",
        '\tlocal poses = {HumanoidRootPart = newPose("HumanoidRootPart", I, kf)}',
        "\tfor i, joint in ipairs(JOINTS) do",
        "\t\tposes[joint] = newPose(joint, data[2][i], poses[PARENTS[joint]])",
        "\tend",
        "\tfor _, m in ipairs(data[3]) do",
        '\t\tlocal marker = Instance.new("KeyframeMarker")',
        "\t\tmarker.Name = m[1]",
        "\t\tmarker.Value = m[2]",
        "\t\tkf:AddMarker(marker)",
        "\t\tmarkerCount = markerCount + 1",
        "\tend",
        "\tkf.Parent = seq",
        "end",
        "seq.Parent = rigEntry",
        "-- Newer Animation Editor versions read saves from <Rig>.AnimSaves: put a copy there too.",
        "if rigEntry.Value and rigEntry.Value:IsA(\"Model\") then",
        "\tlocal animSaves = rigEntry.Value:FindFirstChild(\"AnimSaves\")",
        "\tif not animSaves then",
        "\t\tanimSaves = Instance.new(\"ObjectValue\")",
        "\t\tanimSaves.Name = \"AnimSaves\"",
        "\t\tanimSaves.Parent = rigEntry.Value",
        "\tend",
        "\tlocal old = animSaves:FindFirstChild(NAME)",
        "\tif old then old:Destroy() end",
        "\tseq:Clone().Parent = animSaves",
        "end",
        "",
        'local summary = string.format("Saved KeyframeSequence \'%s\' (%d keyframes, %d markers, %.3f s, Loop=%s, '
        'Priority=%s) to ServerStorage.RBX_ANIMSAVES.%s%s", NAME, #K, markerCount, DURATION, tostring(LOOP), '
        'PRIORITY.Name, RIG, replaced > 0 and " (replaced the previous version)" or "")',
        "print(summary)",
        "return summary",
    ]
    return "\n".join(lines) + "\n"


def _write_text(path, text):
    folder = os.path.dirname(os.path.abspath(path))
    os.makedirs(folder, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        fh.write(text)
    return os.path.abspath(path)


def json_string(export):
    """Export dict as JSON: readable header, one line per keyframe."""
    head = json.dumps({k: v for k, v in export.items() if k != "keyframes"}, indent=1, ensure_ascii=False)
    rows = ",\n  ".join(json.dumps(kf, separators=(",", ":"), ensure_ascii=False) for kf in export["keyframes"])
    return head[:-1].rstrip() + ',\n "keyframes": [\n  ' + rows + "\n ]\n}\n"


def write_json(export, path):
    """Write the export dict as JSON. Returns the absolute path."""
    return _write_text(path, json_string(export))


def write_rbxmx(export, path):
    """Write a Roblox .rbxmx model (KeyframeSequence) — drag it into Studio. Returns the absolute path."""
    return _write_text(path, rbxmx_string(export))


def write_luau(export, path):
    """Write the Studio Luau script (see luau_string). Returns the absolute path."""
    return _write_text(path, luau_string(export))


def safe_stem(name):
    """File-system safe file stem for an animation name."""
    stem = re.sub(r"[^A-Za-z0-9_.-]+", "_", str(name)).strip("._ ") or "animation"
    if stem.split(".")[0].upper() in _WINDOWS_RESERVED:
        stem = "_" + stem
    return stem[:100]


def default_output_dir():
    return os.path.join(tempfile.gettempdir(), "claude_blender", "exports")


def export_action(rig, action=None, output_dir=None, formats=("rbxmx", "lua", "json"), **opts):
    """Build the export and write the requested formats ("rbxmx", "lua"/"luau", "json").

    opts go to build_export. Returns {"files": {fmt: path}, "name", "keyframes", "duration", "loop",
    "priority", "frame_start", "frame_end", "animated_joints", "grip", "markers", "stats", "warnings"}.
    """
    if isinstance(formats, str):
        formats = [formats]
    unknown = [f for f in formats if f.lower() not in FORMAT_EXTENSIONS]
    if unknown:
        raise ValueError("Unknown export format(s) %s; use %s" % (unknown, sorted(FORMAT_EXTENSIONS)))
    exp = build_export(rig, action, **opts)
    output_dir = output_dir or default_output_dir()
    stem = safe_stem(exp["name"])
    writers = {"rbxmx": write_rbxmx, "lua": write_luau, "luau": write_luau, "json": write_json}
    files = {}
    for fmt in formats:
        key = fmt.lower()
        files[key] = writers[key](exp, os.path.join(output_dir, stem + FORMAT_EXTENSIONS[key]))
    return {
        "files": files,
        "name": exp["name"],
        "rig_name": exp["rig_name"],
        "action": exp["action"],
        "keyframes": len(exp["keyframes"]),
        "duration": exp["duration"],
        "loop": exp["loop"],
        "priority": exp["priority"],
        "frame_start": exp["frame_start"],
        "frame_end": exp["frame_end"],
        "animated_joints": exp["animated_joints"],
        "grip": exp["grip"],
        "markers": exp["markers"],
        "stats": exp["stats"],
        "warnings": exp["warnings"],
    }
