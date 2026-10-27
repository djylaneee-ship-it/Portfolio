"""Motion diagnostics for R6 actions.

Everything is measured in Roblox character space (HumanoidRootPart = identity, ground at y = -3 studs)
on the very samples the exporter produces, so the report describes what Roblox will play:
ground contact / penetration, planted-foot sliding and implied ground speed, loop seam, angular speed
spikes, arm-torso and leg-leg interpenetration, root drift, plus a list of human-readable issues.
"""

import math
import statistics

from mathutils import Vector

from . import cframe as cfm
from . import export

GROUND_Y = -cfm.R6_HIP_HEIGHT
LEGS = ("Left Leg", "Right Leg")
ARMS = ("Left Arm", "Right Arm")
# Collision boxes (part-local center, half extents). The cap above the shoulder/hip pivot is left out:
# R6 limbs always clip a little into the torso near their pivot when raised, which is not an error.
_ARM_TEST = (Vector((0.0, -0.4, 0.0)), Vector((0.45, 0.6, 0.45)))
_LEG_TEST = (Vector((0.0, -0.3, 0.0)), Vector((0.45, 0.7, 0.45)))
_TORSO_BOX = (Vector((0.0, 0.0, 0.0)), Vector((1.0, 1.0, 0.5)))
_SEVERITY_ORDER = {"error": 0, "warning": 1, "info": 2}


def _corners(cf, size):
    sx, sy, sz = (s / 2.0 for s in size)
    return [cf @ Vector((x, y, z)) for x in (-sx, sx) for y in (-sy, sy) for z in (-sz, sz)]


def _box(cf, center, half):
    rot = cf.to_3x3()
    return cf @ center, [rot.col[i].normalized() for i in range(3)], half


def box_overlap(a, b):
    """Penetration depth (studs) of two oriented boxes (center, [axes], half extents); 0 when apart.

    Separating axis theorem: the smallest overlap over the 15 candidate axes.
    """
    ca, axes_a, ha = a
    cb, axes_b, hb = b
    d = cb - ca
    axes = list(axes_a) + list(axes_b)
    for u in axes_a:
        for v in axes_b:
            c = u.cross(v)
            if c.length > 1e-6:
                axes.append(c.normalized())
    depth = float("inf")
    for axis in axes:
        ra = sum(ha[i] * abs(axis.dot(axes_a[i])) for i in range(3))
        rb = sum(hb[i] * abs(axis.dot(axes_b[i])) for i in range(3))
        overlap = ra + rb - abs(d.dot(axis))
        if overlap <= 0.0:
            return 0.0
        depth = min(depth, overlap)
    return depth


def _ranges(frames):
    """[1, 2, 3, 7] -> [[1, 3], [7, 7]]"""
    out = []
    for f in frames:
        if out and f == out[-1][1] + 1:
            out[-1][1] = f
        else:
            out.append([f, f])
    return out


def _ranges_text(ranges, limit=6):
    txt = ", ".join(str(a) if a == b else "%d-%d" % (a, b) for a, b in ranges[:limit])
    return txt + (", ..." if len(ranges) > limit else "")


def _r(v, digits=4):
    return None if v is None else round(float(v), digits)


def _direction(x, z):
    if abs(z) >= abs(x):
        return "forward" if z < 0 else "backward"
    return "right" if x > 0 else "left"


def _ground_speed(velocities):
    """Robust (median) planted-foot velocity -> implied ground speed and sliding."""
    if not velocities:
        return {"planted_samples": 0, "implied_studs_per_s": None, "travel_direction": None,
                "travel_vector": None, "planted_foot_slide_studs_per_s": None, "suggested_walkspeed": None,
                "playback_speed_for_walkspeed_16": None, "moving": False}
    vx = statistics.median(v[0] for v in velocities)
    vz = statistics.median(v[1] for v in velocities)
    speed = math.hypot(vx, vz)
    moving = speed >= 0.5
    if moving:  # deviation from a uniform ground motion
        slide = statistics.median(math.hypot(v[0] - vx, v[1] - vz) for v in velocities)
    else:       # the feet should not move at all
        slide = statistics.median(math.hypot(v[0], v[1]) for v in velocities)
    return {
        "planted_samples": len(velocities),
        "implied_studs_per_s": _r(speed, 3),
        "travel_direction": _direction(-vx, -vz) if moving else "none",
        "travel_vector": [_r(-vx, 3), _r(-vz, 3)],
        "planted_foot_slide_studs_per_s": _r(slide, 3),
        "suggested_walkspeed": _r(speed, 1) if moving else None,
        "playback_speed_for_walkspeed_16": _r(16.0 / speed, 3) if moving else None,
        "moving": moving,
    }


def analyze_action(rig, action=None, root_motion="full", frame_start=None, frame_end=None, loop=None,
                   ground_y=GROUND_Y, tol=0.05, contact_tol=0.15, spike_deg_per_s=1400.0, clip_depth=0.05):
    """Analyse an action and return JSON metrics plus a list of issues {"severity", "code", "message", "frames"}.

    ground_y: ground height in character space (-3 for a default R6). tol: allowed penetration below it.
    contact_tol: a foot whose lowest corner is within this height of the ground counts as planted.
    spike_deg_per_s: joint rotation speed reported as a spike. clip_depth: interpenetration depth reported.
    loop defaults to the action's r6_loop property.
    """
    act = export.resolve_action(rig, action)
    loop = bool(act.get("r6_loop", False)) if loop is None else bool(loop)
    priority = str(act.get("r6_priority", "") or "")
    s = export.sample_action(rig, act, frame_start, frame_end, 1, root_motion)
    frames, fps = s["frames"], s["fps"]
    parts, trs, joints = s["parts"], s["transforms"], s["joints"]
    n = len(frames)
    duration = (frames[-1] - frames[0]) / fps
    issues = []

    def issue(severity, code, message, frame_ranges=None):
        issues.append({"severity": severity, "code": code, "message": message, "frames": frame_ranges or []})

    # -- ground penetration (every part, corners of the Roblox part boxes) -----------------------
    lowest = {p: [min(c.y for c in _corners(pf[p], cfm.R6_SIZES[p])) for pf in parts] for p in cfm.R6_PARTS}
    penetration = {}
    for p in cfm.R6_PARTS:
        bad = [i for i in range(n) if lowest[p][i] < ground_y - tol]
        if not bad:
            continue
        worst = min(bad, key=lambda i: lowest[p][i])
        info = {"frames": _ranges([frames[i] for i in bad]), "count": len(bad),
                "worst_depth": _r(ground_y - lowest[p][worst]), "worst_frame": frames[worst]}
        penetration[p] = info
        hint = ("raise the torso (Torso pos y) or swing the legs so the feet stay above it" if p in LEGS
                else "keep the body above the ground")
        issue("error" if info["worst_depth"] > 0.25 else "warning", "ground_penetration",
              "%s goes %.2f studs below the ground (y=%g) on %d frame(s) [%s], worst at frame %d; %s."
              % (p, info["worst_depth"], ground_y, len(bad), _ranges_text(info["frames"]), info["worst_frame"], hint),
              info["frames"])

    # -- foot contact, planted-foot sliding, implied ground speed ---------------------------------
    contact = {leg: [lowest[leg][i] <= ground_y + contact_tol for i in range(n)] for leg in LEGS}
    soles = {leg: [pf[leg] @ Vector((0.0, -1.0, 0.0)) for pf in parts] for leg in LEGS}
    foot_contact, velocities = {}, []
    for leg in LEGS:
        planted = [frames[i] for i in range(n) if contact[leg][i]]
        low_i = min(range(n), key=lambda i: lowest[leg][i])
        foot_contact[leg] = {"contact_frames": len(planted), "contact_ratio": _r(len(planted) / n, 3),
                             "phases": _ranges(planted), "lowest_y": _r(lowest[leg][low_i]),
                             "lowest_frame": frames[low_i]}
        for i in range(n - 1):
            if contact[leg][i] and contact[leg][i + 1]:
                dt = (frames[i + 1] - frames[i]) / fps
                d = soles[leg][i + 1] - soles[leg][i]
                velocities.append((d.x / dt, d.z / dt))
    ground_speed = _ground_speed(velocities)
    if ground_speed["moving"]:
        sp = ground_speed["implied_studs_per_s"]
        issue("info", "ground_speed",
              "Planted feet imply a ground speed of %.1f studs/s (%s): set Humanoid.WalkSpeed to about %.1f, "
              "or play the track at speed %.2f for the default WalkSpeed 16."
              % (sp, ground_speed["travel_direction"], sp, 16.0 / sp))
    slide = ground_speed["planted_foot_slide_studs_per_s"]
    if slide is not None:
        limit = max(0.75, 0.2 * (ground_speed["implied_studs_per_s"] or 0.0))
        if slide > limit:
            issue("warning", "foot_sliding",
                  "Planted feet slide (%.2f studs/s %s): keep the foot that touches the ground moving at a "
                  "constant speed (or still, in place)." % (slide, "away from a uniform ground speed"
                                                            if ground_speed["moving"] else "while planted"))
    if not any(any(c) for c in contact.values()) and loop and priority in ("Idle", "Movement"):
        low = min(min(lowest[leg]) for leg in LEGS)
        issue("warning", "feet_floating",
              "The feet never touch the ground (lowest point %.2f studs above it) in this %s loop." % (low - ground_y,
                                                                                                      priority))

    # -- loop seam ---------------------------------------------------------------------------------
    seam_deg, seam_studs, seam_joint = export.pose_difference(trs[0], trs[-1], joints)
    loop_info = {"is_loop": loop, "seam_deg": _r(seam_deg), "seam_studs": _r(seam_studs, 5),
                 "worst_joint": seam_joint if (seam_deg > 1e-3 or seam_studs > 1e-5) else None}
    if loop and (seam_deg > 0.5 or seam_studs > 0.01):
        issue("error" if seam_deg > 5.0 or seam_studs > 0.1 else "warning", "loop_seam",
              "Loop seam: frame %d differs from frame %d by %.2f deg / %.3f studs (%s); the loop will pop. "
              "Make the last frame identical to the first." % (frames[-1], frames[0], seam_deg, seam_studs,
                                                               seam_joint), [[frames[-1], frames[-1]]])

    # -- angular speed per joint -----------------------------------------------------------------------
    angular = {}
    for j in joints:
        per_frame = [0.0] + [math.degrees(cfm.angle_between(trs[i - 1][j], trs[i][j])) / (frames[i] - frames[i - 1])
                             for i in range(1, n)]
        spikes = []
        for i in range(1, n):
            neighbours = max(per_frame[i - 1] if i > 1 else 0.0, per_frame[i + 1] if i + 1 < n else 0.0)
            pop = per_frame[i] > 8.0 and per_frame[i] > 3.0 * neighbours
            if per_frame[i] * fps > spike_deg_per_s or pop:
                spikes.append(frames[i])
        top = max(range(n), key=lambda i: per_frame[i])
        angular[j] = {"max_deg_per_frame": _r(per_frame[top], 3), "max_deg_per_s": _r(per_frame[top] * fps, 1),
                      "frame": frames[top], "spike_frames": spikes[:20]}
        if spikes:
            issue("warning", "rotation_spike",
                  "%s rotates very fast or pops on %d frame(s) [%s] (max %.0f deg/s at frame %d); check for "
                  "flipped keys or add in-between frames." % (j, len(spikes), _ranges_text(_ranges(spikes)),
                                                              per_frame[top] * fps, frames[top]),
                  _ranges(spikes))

    # -- interpenetration (oriented boxes; SAT is frame independent, so torso space == character space) ---
    arm_frames = {arm: [] for arm in ARMS}
    arm_depth = {arm: (0.0, None) for arm in ARMS}
    leg_frames, leg_depth = [], (0.0, None)
    for i, pf in enumerate(parts):
        torso = _box(pf["Torso"], *_TORSO_BOX)
        for arm in ARMS:
            d = box_overlap(_box(pf[arm], *_ARM_TEST), torso)
            if d > clip_depth:
                arm_frames[arm].append(frames[i])
                if d > arm_depth[arm][0]:
                    arm_depth[arm] = (d, frames[i])
        d = box_overlap(_box(pf["Left Leg"], *_LEG_TEST), _box(pf["Right Leg"], *_LEG_TEST))
        if d > clip_depth:
            leg_frames.append(frames[i])
            if d > leg_depth[0]:
                leg_depth = (d, frames[i])
    interpenetration = {
        "arm_torso": {arm: {"frames": _ranges(arm_frames[arm]), "count": len(arm_frames[arm]),
                            "worst_depth": _r(arm_depth[arm][0]), "worst_frame": arm_depth[arm][1]} for arm in ARMS},
        "leg_leg": {"frames": _ranges(leg_frames), "count": len(leg_frames), "worst_depth": _r(leg_depth[0]),
                    "worst_frame": leg_depth[1]},
    }
    for arm in ARMS:
        if arm_frames[arm]:
            issue("warning", "arm_torso_clip",
                  "%s passes through the torso on %d frame(s) [%s] (up to %.2f studs deep at frame %d); swing it "
                  "forward/out more." % (arm, len(arm_frames[arm]), _ranges_text(_ranges(arm_frames[arm])),
                                         arm_depth[arm][0], arm_depth[arm][1]), _ranges(arm_frames[arm]))
    if leg_frames:
        issue("warning", "leg_leg_clip",
              "The legs pass through each other on %d frame(s) [%s] (up to %.2f studs deep at frame %d)."
              % (len(leg_frames), _ranges_text(_ranges(leg_frames)), leg_depth[0], leg_depth[1]), _ranges(leg_frames))

    # -- root drift --------------------------------------------------------------------------------------
    rest_torso = rig.rest_parts["Torso"].translation
    offsets = [pf["Torso"].translation - rest_torso for pf in parts]
    horiz = [math.hypot(o.x, o.z) for o in offsets]
    h_i = max(range(n), key=lambda i: horiz[i])
    roots = [w.translation for w in s["root_deltas"]]
    travel = roots[-1] - roots[0]
    root_travel = math.hypot(travel.x, travel.z)
    root = {
        "torso_offset_max": _r(max(o.length for o in offsets)),
        "torso_horizontal_offset_max": _r(horiz[h_i]),
        "torso_horizontal_offset_frame": frames[h_i],
        "torso_net_displacement": [_r(c) for c in (offsets[-1] - offsets[0])],
        "root_controller": {
            "bone": rig.root_bone,
            "max_translation": _r(max(t.length for t in roots)),
            "horizontal_travel": _r(root_travel),
            "travel_speed_studs_per_s": _r(root_travel / duration, 3) if duration > 0 else None,
        },
    }
    if root_motion == "full" and root_travel > 0.5 and horiz[h_i] > 0.5:
        issue("warning", "root_drift",
              "%s travels %.2f studs, so with root_motion='full' the body walks %.2f studs away from "
              "HumanoidRootPart. Roblox moves characters with the Humanoid: export with root_motion='in_place' "
              "(keeps the vertical bob)%s." % (rig.root_bone, root_travel, horiz[h_i],
                                               " and use WalkSpeed %.1f" % (root_travel / duration)
                                               if duration > 0 else ""))
    elif horiz[h_i] > 1.5:
        issue("info", "torso_offset", "The torso moves up to %.2f studs horizontally from HumanoidRootPart "
                                      "(frame %d)." % (horiz[h_i], frames[h_i]))

    issues.sort(key=lambda it: _SEVERITY_ORDER[it["severity"]])
    counts = {sev: sum(1 for it in issues if it["severity"] == sev) for sev in _SEVERITY_ORDER}
    return {
        "action": act.name,
        "rig_name": rig.rig_name,
        "root_motion": root_motion,
        "frames": {"start": frames[0], "end": frames[-1], "count": n, "fps": fps, "duration": _r(duration, 4)},
        "loop": loop_info,
        "ground": {"ground_y": ground_y, "tolerance": tol, "contact_tolerance": contact_tol,
                   "lowest": {p: {"y": _r(min(lowest[p])), "frame": frames[min(range(n), key=lambda i: lowest[p][i])]}
                              for p in cfm.R6_PARTS},
                   "penetration": penetration},
        "foot_contact": foot_contact,
        "ground_speed": ground_speed,
        "angular_speed": angular,
        "interpenetration": interpenetration,
        "root": root,
        "issues": issues,
        "summary": ("no issues" if not issues else
                    ", ".join("%d %s%s" % (c, sev, "" if c == 1 or sev == "info" else "s")
                              for sev, c in counts.items() if c)),
    }
