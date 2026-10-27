"""R6 reaction presets: hits, stagger, knockdown / get-up, deaths, stun and emotes.

Authoring model (SPEC section 6):
- Presets are written in seconds through _Seq (frame = round(t * fps / speed)). Separate tracks
  ("body" = Torso + legs, "head", arms) keep their own timing, so the head and arms overlap the torso.
- R6 legs are rigid 2-stud boxes hinged at their top OUTER edge. Standing poses go through _plant(): it aims
  the legs (swing + spread, no twist) at ground points and sets Torso pos y so the lowest foot corner touches
  y = -3, so leans, steps and dips never sink the feet. Sitting / lying poses use _rest(), which lays the
  lowest corner of the body on the ground (contact rotations are kept in the ground plane).
- R6 shoulders pivot on the arm's inner face, 0.5 stud below its top: raising or crossing an arm pushes that
  "stub" into the torso. Every arm key goes through _clear_arm() (a small shrug / push-out offset), and
  _guard() repairs in-between frames (ground dips, arms through the torso) after a clip is built.
- `intensity` and the strength / energy params scale expressive amplitudes only; contact poses (lying, seated,
  hand on the brow) stay exact, so knockdown always ends on the pose get_up starts from.
"""

import math

from mathutils import Vector

from .. import cframe as cfm
from ..clip import Clip, aim_arm, limb, preset

GROUND = -cfm.R6_HIP_HEIGHT
_TABLE = cfm.R6_JOINTS
_LEGS = ("Right Leg", "Left Leg")
_ARMS = ("Right Arm", "Left Arm")
_BODY = ("Torso", "Head") + _LEGS
_REST_FEET = ((0.5, 0.0), (-0.5, 0.0))     # leg bottom-centre (x, z) at rest, right / left
_LEG_TIP_X = {"Right Leg": -0.5, "Left Leg": 0.5}  # hip -> foot vector is (x, -2, 0) in torso axes at rest
_ARM_BOX = (0.9, 1.6, 0.9)                 # same shrunk arm box as tests/preset_lint.py
_DOWN = Vector((0.0, -1.0, 0.0))


# ---------------------------------------------------------------------------------------------------------
# Values and geometry
# ---------------------------------------------------------------------------------------------------------

def _opt(name, value, options):
    v = str(value).strip().lower()
    for o in options:
        if v == o.lower():
            return o
    raise ValueError("%s must be one of %s, got %r" % (name, list(options), value))


def _clamp(value, lo, hi):
    return max(lo, min(hi, float(value)))


def _jv(rot=(0.0, 0.0, 0.0), pos=(0.0, 0.0, 0.0)):
    return {"rot": [float(a) for a in rot], "pos": [float(p) for p in pos]}


def _val(v, pos=(0.0, 0.0, 0.0)):
    if isinstance(v, dict):
        return {"rot": [float(a) for a in v["rot"]], "pos": [float(p) for p in v.get("pos", (0, 0, 0))]}
    return _jv(v, pos)


def _pose(torso=(0, 0, 0), tpos=(0, 0, 0), head=(0, 0, 0), ra=(0, 0, 0), la=(0, 0, 0), rl=(0, 0, 0),
          ll=(0, 0, 0)):
    """Full six-joint pose. Each value is a rot [x, y, z] or a {"rot", "pos"} dict (e.g. from aim_arm)."""
    return {"Torso": _val(torso, tpos), "Head": _val(head), "Right Arm": _val(ra), "Left Arm": _val(la),
            "Right Leg": _val(rl), "Left Leg": _val(ll)}


def _sub(joints, names):
    return {n: _val(joints[n]) for n in names if n in joints}


def _fk(joints):
    tr = {p: cfm.friendly_to_transform(v["rot"], v["pos"], _TABLE[p][2]) for p, v in joints.items() if p in _TABLE}
    return cfm.fk(tr)


def _corners(cf, size):
    hx, hy, hz = (s / 2.0 for s in size)
    return [cf @ Vector((x, y, z)) for x in (-hx, hx) for y in (-hy, hy) for z in (-hz, hz)]


def _low(parts, names):
    return min(c.y for n in names for c in _corners(parts[n], cfm.R6_SIZES[n]))


def lowest_point(joints):
    """Lowest box corner (character-space y; ground = -3) of the six R6 parts for a friendly joints dict."""
    return _low(_fk(joints), cfm.R6_PARTS)


def _torso_cf(joints):
    return _fk({"Torso": joints["Torso"]})["Torso"]


def _torso_rot_inv(joints):
    return cfm.angles_deg(*joints["Torso"]["rot"]).to_3x3().inverted()


def _wrap(a):
    return (a + math.pi) % (2.0 * math.pi) - math.pi


def _aim_leg(leg, v):
    """Swing / spread (no twist, so legs stay in their lanes) pointing the hip -> foot vector along v."""
    x0 = _LEG_TIP_X[leg]
    n = v.length
    if n < 1e-6:
        return [0.0, 0.0, 0.0]
    phi = math.atan2(2.0, x0)
    spread = min((_wrap(phi - math.acos(max(-1.0, min(1.0, v.x / n)))),
                  _wrap(phi + math.acos(max(-1.0, min(1.0, v.x / n))))), key=abs)
    y = x0 * math.sin(spread) - 2.0 * math.cos(spread)
    swing = _wrap(math.atan2(v.z, v.y) - math.atan2(0.0, y))
    return [math.degrees(swing), 0.0, math.degrees(spread)]


def _plant(joints, feet=_REST_FEET, lift=(0.0, 0.0), air=0.0):
    """Aim both legs at ground points and set Torso pos y so the feet stand on the ground.

    feet: ((x, z) right, (x, z) left) leg bottom-centre targets in character space.
    lift: per-foot height of a swinging foot; air: whole-body hop height.
    Planted feet (lift 0) touch exactly; no corner of either leg goes below the ground.
    """
    torso = joints.setdefault("Torso", _jv())
    for _ in range(10):
        tcf = _torso_cf(joints)
        inv = tcf.to_3x3().inverted()
        for leg, foot, up in zip(_LEGS, feet, lift):
            hip = tcf @ _TABLE[leg][2].translation
            joints[leg] = _jv(_aim_leg(leg, inv @ (Vector((foot[0], GROUND + air + up, foot[1])) - hip)))
        parts = _fk(joints)
        planted = [leg for leg, up in zip(_LEGS, lift) if up <= 0.0] or list(_LEGS)
        need = max(GROUND + air - _low(parts, [leg]) for leg in planted)
        for leg, up in zip(_LEGS, lift):
            if up > 0.0:
                need = max(need, GROUND - _low(parts, [leg]))
        torso["pos"][1] += need
        if abs(need) < 1e-5:
            break
    return joints


def _lift_arms(joints):
    """Raise (pos offset) any arm whose box dips below the ground, e.g. a shoulder stub when lying.
    The 2 cm clearance absorbs the difference between Clip.resolve and Blender's Bezier curves."""
    parts = _fk(joints)
    inv = _torso_rot_inv(joints)
    for arm in _ARMS:
        if arm in joints:
            dip = GROUND - _low(parts, [arm])
            if dip > -0.02:
                v = _val(joints[arm])
                up = inv @ Vector((0.0, dip + 0.02, 0.0))
                v["pos"] = [v["pos"][i] + up[i] for i in range(3)]
                joints[arm] = v
    return joints


def _rest(joints, only_up=False):
    """Shift Torso pos y so the lowest body corner lies on the ground (only_up: just lift it out), then
    lift arms that still dig in. `joints` must be a full six-joint pose."""
    d = GROUND - _low(_fk(joints), _BODY)
    if d > 0.0 or not only_up:
        joints["Torso"]["pos"][1] += d
    return _lift_arms(joints)


def _arm_cf(side, value):
    _j, _p, c0, c1 = _TABLE[side + " Arm"]
    return c0 @ cfm.friendly_to_transform(value["rot"], value["pos"], c0) @ c1.inverted()


def _box_depth(center, axes, half, half_b):
    """Penetration depth of an oriented box into an axis-aligned box at the origin (separating axes)."""
    axes_b = (Vector((1.0, 0.0, 0.0)), Vector((0.0, 1.0, 0.0)), Vector((0.0, 0.0, 1.0)))
    cands = list(axes) + list(axes_b) + [u.cross(v) for u in axes for v in axes_b]
    depth = float("inf")
    for axis in cands:
        if axis.length < 1e-6:
            continue
        axis = axis.normalized()
        ra = sum(half[i] * abs(axis.dot(axes[i])) for i in range(3))
        rb = sum(half_b[i] * abs(axis.dot(axes_b[i])) for i in range(3))
        overlap = ra + rb - abs(center.dot(axis))
        if overlap <= 0.0:
            return 0.0
        depth = min(depth, overlap)
    return depth


def _arm_in_torso(side, value, margin=0.05, depth=0.03):
    """Does an arm (friendly value, torso space) reach into the torso? Combines the corner test of
    tests/preset_lint.py (shrunk box incl. part of the shoulder cap) and the box-overlap test of
    r6/analyze.py (lower 1.2 studs of the arm vs the full torso)."""
    cf = _arm_cf(side, value)
    hx, hy, hz = 1.0 - margin, 1.0 - margin, 0.5 - margin
    if any(abs(p.x) < hx and abs(p.y) < hy and abs(p.z) < hz for p in _corners(cf, _ARM_BOX) + [cf.translation]):
        return True
    rot = cf.to_3x3()
    axes = [rot.col[i].normalized() for i in range(3)]
    return _box_depth(cf @ Vector((0.0, -0.4, 0.0)), axes, (0.45, 0.6, 0.45), (1.0, 1.0, 0.5)) > depth


def _clear_arm(side, value):
    """Smallest shrug / push-out (arm pos) that takes an arm out of the torso; unchanged when already clear."""
    v = _val(value)
    if not _arm_in_torso(side, v):
        return v
    s = 1.0 if side == "Right" else -1.0
    for i in range(1, 31):
        d = 0.02 * i
        for dx, dy, dz in ((s, 0.0, 0.0), (0.6 * s, 0.8, 0.0), (0.0, 1.0, 0.0), (0.0, 0.0, -1.0),
                           (0.7 * s, 0.0, -0.7)):
            cand = {"rot": v["rot"], "pos": [v["pos"][0] + dx * d, v["pos"][1] + dy * d, v["pos"][2] + dz * d]}
            if not _arm_in_torso(side, cand):
                return cand
    return v


def _hang(side, torso_rot, swing=0.0, spread=0.0, twist=0.0, g=1.0):
    """Arm rot that keeps a loose arm hanging toward the ground while the torso leans / tilts."""
    r = limb(side, swing, spread, twist)
    return [r[0] - g * torso_rot[0], r[1], r[2] - g * torso_rot[2]]


def _arm_dir(direction):
    """Arm rot (torso axes) whose long axis points along `direction` (shoulder -> hand)."""
    q = _DOWN.rotation_difference(Vector(direction).normalized())
    return list(cfm.to_angles_deg(q.to_matrix().to_4x4()))


def _yaw_pitch(yaw, pitch):
    """Unit direction: yaw > 0 turns from forward (-Z) toward the character's left, pitch > 0 is up."""
    y, p = math.radians(yaw), math.radians(pitch)
    return (-math.sin(y) * math.cos(p), math.sin(p), -math.cos(y) * math.cos(p))


def _hand_to(joints, side, point, stretch=0.12):
    """Aim an arm so its hand (bottom centre) reaches a character-space point."""
    local = _torso_cf(joints).inverted() @ Vector(point)
    joints[side + " Arm"] = _val(aim_arm(side, local, stretch))
    return joints


def _hip_mid(joints):
    return _torso_cf(joints) @ Vector((0.0, -1.0, 0.0))


def _torso_on_hips(rot, hip_xz):
    """Torso pos (x, 0, z) that puts the hip mid-point (torso-local (0, -1, 0)) above hip_xz."""
    off = cfm.angles_deg(*rot).to_3x3() @ Vector((0.0, -1.0, 0.0))
    return (hip_xz[0] - off.x, 0.0, hip_xz[1] - off.z)


def _stand(rot=(0, 0, 0), tpos=(0, 0, 0), feet=_REST_FEET, lift=(0.0, 0.0), air=0.0):
    """Torso + planted legs. The "_plant" entry lets _Seq re-plant an in-between key on long moves."""
    j = _plant({"Torso": _jv(rot, tpos)}, feet=feet, lift=lift, air=air)
    j["_plant"] = (tuple(rot), tuple(tpos), tuple(map(tuple, feet)), tuple(lift), air)
    return j


def _standing(rot, tpos, feet, head, ra, la, lift=(0.0, 0.0)):
    """Full six-joint pose on planted feet (tagged like _stand for in-between re-planting)."""
    j = _lift_arms(_plant(_pose(rot, tpos, head, ra, la), feet=feet, lift=lift))
    j["_plant"] = (tuple(rot), tuple(tpos), tuple(map(tuple, feet)), tuple(lift), 0.0)
    return j


def _blend_plant(p0, p1, u):
    """Planting parameters between two _stand() calls (u = 0..1)."""
    def mix(a, b):
        if isinstance(a, tuple):
            return tuple(mix(x, y) for x, y in zip(a, b))
        return a + (b - a) * u
    return mix(p0, p1)


def _arms(ra, la):
    return {"Right Arm": _val(ra), "Left Arm": _val(la)}


# ---------------------------------------------------------------------------------------------------------
# Clip building
# ---------------------------------------------------------------------------------------------------------

class _Seq:
    """Author a clip in seconds. Each track keeps strictly increasing frames; tracks merge per frame."""

    def __init__(self, clip, speed):
        if float(speed) <= 0.0:
            raise ValueError("speed must be > 0")
        self.clip = clip
        self.scale = clip.fps / float(speed)
        self._last = {}
        self._planted = None  # (frame, planting params) of the last planted body key

    def frame(self, t):
        return int(round(t * self.scale))

    def key(self, t, joints, interp=None, easing="AUTO", track="body"):
        """Key joints at time t (s). interp None keeps the frame's interpolation (BEZIER for a new frame).

        A planted body (from _stand) that moves a lot since the previous planted key gets a re-planted
        in-between key, so the interpolated legs do not sink into the ground."""
        joints = dict(joints)
        plant = joints.pop("_plant", None)
        f = max(self.frame(t), self._last.get(track, -1) + 1)
        if track == "body":
            prev = self._planted
            k0 = self.clip.keys.get(prev[0]) if prev else None
            if plant is not None and k0 is not None and k0["interp"] == "BEZIER":
                p0, f0 = prev[1], prev[0]
                change = max([abs(a - b) for a, b in zip(p0[0], plant[0])] +
                             [40.0 * abs(a - b) for x, y in zip(p0[2], plant[2]) for a, b in zip(x, y)] +
                             [40.0 * abs(a - b) for a, b in zip(p0[1], plant[1])])
                pieces = min(int(math.ceil(change / 10.0)), (f - f0) // 5)
                for i in range(1, pieces):  # in-betweens on the same ease-in-out (smoothstep) timing
                    u = i / float(pieces)
                    mid = _stand(*_blend_plant(p0, plant, u * u * (3.0 - 2.0 * u)))
                    mid.pop("_plant")
                    self.clip.key(int(round(f0 + u * (f - f0))), mid, "BEZIER", "AUTO")
            self._planted = (f, plant) if plant is not None else None
        self._last[track] = f
        for side in ("Right", "Left"):
            if side + " Arm" in joints:
                joints[side + " Arm"] = _clear_arm(side, joints[side + " Arm"])
        old = self.clip.keys.get(f)
        if interp is None:
            interp, easing = (old["interp"], old["easing"]) if old else ("BEZIER", "AUTO")
        self.clip.key(f, joints, interp, easing)
        return f

    def event(self, frame, name, value=""):
        self.clip.event(frame, name, value)

    def emit(self, beats, lag_head=0.0, lag_arms=0.0):
        """Key full poses [(t, joints[, {"interp", "easing", "lag"}])]: Torso + legs at t, Head at t + lag_head,
        arms at t + lag_arms (no lag on the first / last pose or when "lag" is False). Returns body frames."""
        frames = []
        last = len(beats) - 1
        for i, b in enumerate(beats):
            t, j = b[0], b[1]
            o = b[2] if len(b) > 2 else {}
            lag = o.get("lag", True) and 0 < i < last
            body = _sub(j, ("Torso",) + _LEGS)
            if "_plant" in j:
                body["_plant"] = j["_plant"]
            frames.append(self.key(t, body, o.get("interp", "BEZIER"), o.get("easing", "AUTO")))
            self.key(t + (lag_head if lag else 0.0), _sub(j, ("Head",)), track="head")
            self.key(t + (lag_arms if lag else 0.0), _sub(j, _ARMS), track="arms")
        return frames

    def close(self, period):
        """Finish a loop: last frame = period, identical to frame 0."""
        self.clip.length = max(self.frame(period), max(self.clip.keys) + 1)
        self.clip.close_loop()


def _guard(clip, tol=0.004, passes=8, pinned=()):
    """Repair interpolation artefacts between keys: add Torso keys where a body part dips more than `tol`
    below the ground and arm keys where an arm sinks into the ground or passes through the torso.
    Frames in `pinned` are never modified (poses other clips chain from)."""
    for _ in range(passes):
        bad = {}
        for f in range(clip.length + 1):
            if f in pinned:
                continue
            full = clip.resolve(f)
            parts = _fk(full)
            if GROUND - _low(parts, _BODY) > tol:
                bad.setdefault("Torso", []).append((f, GROUND - _low(parts, _BODY)))
            for side in ("Right", "Left"):
                arm = side + " Arm"
                dip = GROUND - _low(parts, [arm])
                if dip > tol or _arm_in_torso(side, full[arm], 0.075):
                    bad.setdefault(arm, []).append((f, max(dip, 0.0) + 1.0))
        if not bad:
            break
        for joint, items in bad.items():
            runs, cur = [], [items[0]]
            for it in items[1:]:
                if it[0] == cur[-1][0] + 1:
                    cur.append(it)
                else:
                    runs.append(cur)
                    cur = [it]
            runs.append(cur)
            for run in runs:
                f = max(run, key=lambda x: x[1])[0]
                full = clip.resolve(f)
                if joint == "Torso":
                    full["Torso"]["pos"][1] += GROUND - _low(_fk(full), _BODY) + 0.004
                else:
                    full[joint] = _clear_arm(joint.split()[0], full[joint])
                    _lift_arms(full)
                frames = [f, clip.length] if (clip.loop and f == 0) else [f]
                frames = [0, f] if (clip.loop and f == clip.length) else frames
                for fr in frames:
                    old = clip.keys.get(fr)
                    clip.key(fr, {joint: full[joint]}, old["interp"] if old else "BEZIER",
                             old["easing"] if old else "AUTO")
    return clip


def _tidy(clip):
    for k in clip.keys.values():
        for v in k["joints"].values():
            v["rot"] = [round(a, 3) + 0.0 for a in v["rot"]]
            v["pos"] = [round(p, 4) + 0.0 for p in v["pos"]]
    clip.events.sort(key=lambda e: e["frame"])
    return clip


def _finish(clip, mirror_name=None, tol=0.004, pinned=()):
    """Guard (ground tolerance `tol` studs), round and optionally mirror (left <-> right) a built clip."""
    clip = _tidy(_guard(clip, tol, pinned=set(pinned)))
    return _tidy(clip.mirrored(mirror_name)) if mirror_name else clip


# ---------------------------------------------------------------------------------------------------------
# Hits
# ---------------------------------------------------------------------------------------------------------

_HIT_PARAMS = {
    "strength": {"default": 1.0, "description": "Impact force 0.2-2.5: snap amplitude, shove distance and "
                                                "recovery length."},
    "target": {"default": "body", "description": "'body' (torso snaps, head whips after it), 'head' (head "
                                                "snaps first, torso follows) or 'gut' (body folds around the "
                                                "blow, hands clutch)."},
    "recovery": {"default": 0.45, "description": "Seconds from the end of the snap back to neutral (0.2-1.5)."},
}


def _hit(name, description, push, fps, speed, intensity, strength, target, recovery):
    """push = (dx, dz): direction the body is shoved (+x right, +z back)."""
    target = _opt("target", target, ("body", "head", "gut"))
    s = _clamp(strength, 0.2, 2.5)
    a = s * intensity
    dx, dz = push
    rec = _clamp(recovery, 0.2, 1.5) * (0.85 + 0.15 * s)
    t_set, t_end = 0.22 + 0.5 * rec, 0.22 + rec
    clip = Clip(name, 0, fps, False, "Action", description)
    q = _Seq(clip, speed)

    # Torso + planted legs: instant snap (QUAD ease-out over 3 frames), drift, small overshoot, settle.
    lean = {"body": 13.0, "head": 6.0, "gut": -20.0}[target] * a
    shove = 0.28 * a
    delay = 0.03 if target == "head" else 0.0
    for i, (t, k, kp) in enumerate(((0.0, 0.0, 0.0), (0.05, 0.85, 0.65), (0.10, 1.0, 1.0), (0.22, 0.55, 0.9),
                                    (t_set, -0.15, 0.3), (t_end, 0.0, 0.0))):
        yaw = (3.0 * dz - 6.0 * dx) * a * k * (0.3 if target == "gut" else 1.0)
        body = _stand((lean * dz * k, yaw, -lean * dx * k),
                      (shove * dx * kp, 0.0, shove * dz * kp))
        f = q.key(t + delay if 0 < i < 5 else t, body, "QUAD" if i == 0 else "BEZIER",
                  "EASE_OUT" if i == 0 else "AUTO")
        if i == 1:
            q.event(f, "Hit")
        elif i == 4:
            q.event(f, "Recover")

    # Head: lags the torso then whips past it (body), leads (head shot) or drops toward the blow (gut).
    sign = -1.0 if target == "gut" else 1.0
    mag, prof = {
        "body": (20.0, ((0.033, -0.35), (0.11, 1.0), (0.21, 0.4), (t_set + 0.04, -0.2))),
        "head": (30.0, ((0.06, 1.0), (0.14, 0.8), (0.27, 0.35), (t_set, -0.12))),
        "gut": (16.0, ((0.033, -0.3), (0.12, 0.9), (0.30, 0.45), (t_set + 0.04, -0.1))),
    }[target]
    q.key(0.0, {"Head": _jv()}, track="head")
    for t, k in prof:
        m = mag * a * k * sign
        q.key(t, {"Head": _jv((m * dz, -10.0 * a * k * dx, -m * dx))}, track="head")
    q.key(t_end, {"Head": _jv()}, track="head")

    # Arms: inertia flings them against the shove (overlap: left arm one frame later), or clutch the gut.
    if target == "gut":
        prof = ((0.07, 0.6), (0.15, 1.0), (0.30, 0.85), (t_set + 0.08, 0.25))
    else:
        prof = ((0.067, 0.5), (0.14, 1.0), (0.27, 0.3), (t_set + 0.08, -0.15))
    amp = (a ** 0.8) * (0.55 if target == "head" else 1.0)
    for side, sgn, gain, lag in (("Right", 1.0, 1.0, 0.0), ("Left", -1.0, 0.82, 0.017)):
        part = side + " Arm"
        q.key(0.017, {part: _jv()}, track=part)
        for t, k in prof:
            if target == "gut":
                near = -dx * sgn > 0.5  # arm on the attacker's side
                swing = (38.0 * dz + abs(dx) * (15.0 if near else 45.0)) * k * min(a, 1.5)
                spread = (5.0 + abs(dx) * (6.0 if near else -8.0)) * k
                rot = limb(side, swing, spread, 15.0 * k)
            else:
                swing = 45.0 * dz * amp * k * gain
                spread = max(-2.0, (14.0 - 30.0 * dx * sgn) * amp * k * gain)
                rot = limb(side, swing, spread, 10.0 * sgn * amp * k)
            q.key(t + lag, {part: _jv(rot)}, track=part)
        q.key(t_end, {part: _jv()}, track=part)
    return clip


@preset("hit_front", "reaction", "Hit from the front: torso snaps back in 3 frames, head whips after it, arms "
        "fly forward with overlap, small shove back, eased recovery. Events Hit, Recover.", params=_HIT_PARAMS)
def hit_front(fps=60, speed=1.0, intensity=1.0, strength=1.0, target="body", recovery=0.45):
    return _finish(_hit("HitFront", "Hit reaction from the front", (0.0, 1.0), fps, speed, intensity, strength,
                        target, recovery))


@preset("hit_back", "reaction", "Hit from behind: the body lurches forward, head lags then drops, arms fling "
        "back, eased recovery. Events Hit, Recover.", params=_HIT_PARAMS)
def hit_back(fps=60, speed=1.0, intensity=1.0, strength=1.0, target="body", recovery=0.45):
    return _finish(_hit("HitBack", "Hit reaction from behind", (0.0, -1.0), fps, speed, intensity, strength,
                        target, recovery))


@preset("hit_left", "reaction", "Hit from the character's left: torso tilts and shoves right, head whips right, "
        "left arm flies out. Events Hit, Recover.", params=_HIT_PARAMS)
def hit_left(fps=60, speed=1.0, intensity=1.0, strength=1.0, target="body", recovery=0.45):
    return _finish(_hit("HitLeft", "Hit reaction from the left", (1.0, 0.0), fps, speed, intensity, strength,
                        target, recovery))


@preset("hit_right", "reaction", "Hit from the character's right (exact mirror of hit_left). Events Hit, "
        "Recover.", params=_HIT_PARAMS)
def hit_right(fps=60, speed=1.0, intensity=1.0, strength=1.0, target="body", recovery=0.45):
    c = _hit("HitLeft", "Hit reaction from the right", (1.0, 0.0), fps, speed, intensity, strength, target,
             recovery)
    return _finish(c, "HitRight")


# ---------------------------------------------------------------------------------------------------------
# Stagger
# ---------------------------------------------------------------------------------------------------------

@preset("stagger", "reaction", "Heavy hit: stumble two steps with windmilling arms, wobble, step back to the "
        "start and recover. Events Hit, Step (x4), Recover.", params={
            "strength": {"default": 1.0, "description": "0.3-2.0: lean, step length and arm flail."},
            "direction": {"default": "back", "description": "Stumble direction: back, forward, left, right."},
        })
def stagger(fps=60, speed=1.0, intensity=1.0, strength=1.0, direction="back"):
    direction = _opt("direction", direction, ("back", "forward", "left", "right"))
    if direction == "left":
        return _finish(_stagger("right", fps, speed, intensity, strength), "Stagger")
    return _finish(_stagger(direction, fps, speed, intensity, strength))


def _stagger(direction, fps, speed, intensity, strength):
    s = _clamp(strength, 0.3, 2.0)
    a = s * intensity
    dx, dz = {"back": (0.0, 1.0), "forward": (0.0, -1.0), "right": (1.0, 0.0)}[direction]
    lateral = dx != 0.0
    a1 = 0.7 * min(a, 2.0)                                   # lead (right) foot step
    a2 = a1 - 0.05 if lateral else a1 + 0.35 * min(a, 2.0)   # trail foot (keeps 1 stud between feet sideways)
    clip = Clip("Stagger", 0, fps, False, "Action", "Stumble %s and recover" % direction)
    q = _Seq(clip, speed)

    def foot(i, amount):
        return (_REST_FEET[i][0] + dx * amount, _REST_FEET[i][1] + dz * amount)

    # (t, lean factor, body lead past the feet, lead amount, trail amount, lead lift, trail lift, event)
    beats = [
        (0.00, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, None),
        (0.07, 0.8, 0.22, 0.0, 0.0, 0.0, 0.0, "Hit"),
        (0.17, 1.0, 0.35, 0.45 * a1, 0.0, 0.3, 0.0, None),
        (0.29, 0.75, 0.25, a1, 0.0, 0.0, 0.0, "Step"),
        (0.40, 0.65, 0.3, a1, 0.5 * a2, 0.0, 0.28, None),
        (0.53, 0.35, 0.12, a1, a2, 0.0, 0.0, "Step"),
        (0.68, -0.4, 0.0, a1, a2, 0.0, 0.0, None),
        (0.85, 0.2, 0.02, a1, a2, 0.0, 0.0, None),
        (1.00, -0.15, -0.05, a1, 0.5 * a2, 0.0, 0.25, None),
        (1.13, -0.1, 0.0, a1, 0.0, 0.0, 0.0, "Step"),
        (1.27, 0.0, 0.0, 0.5 * a1, 0.0, 0.22, 0.0, None),
        (1.40, 0.05, 0.0, 0.0, 0.0, 0.0, 0.0, "Step"),
        (1.62, -0.04, 0.0, 0.0, 0.0, 0.0, 0.0, None),
        (1.80, 0.0, 0.0, 0.0, 0.0, 0.0, 0.0, None),
    ]
    lean = 17.0 * a
    for i, (t, k, ahead, la, ta, ll, tl, ev) in enumerate(beats):
        rot = (lean * dz * k, -4.0 * a * k * dx, -lean * dx * k)
        mid = 0.5 * (la + ta) + ahead * min(a, 2.0)
        j = _stand(rot, (dx * mid, 0.0, dz * mid), (foot(0, la), foot(1, ta)), (ll, tl))
        f = q.key(t, j, "QUAD" if i == 0 else "BEZIER", "EASE_OUT" if i == 0 else "AUTO")
        if ev:
            q.event(f, ev)
            if i == 11:
                q.event(f, "Recover")
        # Head: whips with the hit, then counter-rotates to keep the eyes level (lags 0.04 s).
        whip = 12.0 * a if i == 1 else 0.0
        q.key(t + (0.04 if 0 < i < len(beats) - 1 else 0.0),
              {"Head": _jv((-0.55 * rot[0] + whip * dz, 0.0, -0.55 * rot[2] - whip * dx))}, track="head")

    # Arms: balance windmill (forward / up against a backward stumble, out to the sides for lateral ones).
    wind = [  # (t, R swing, R spread, L swing, L spread)
        (0.017, 0, 0, 0, 0), (0.10, 38, 18, 30, 20), (0.21, 72, 22, 38, 40), (0.33, 42, 36, 68, 24),
        (0.44, 66, 22, 40, 36), (0.57, 36, 28, 46, 24), (0.72, 14, 24, 18, 20), (0.89, 8, 16, 10, 14),
        (1.16, -6, 8, 10, 9), (1.43, 8, 5, -6, 5), (1.64, -2, 3, 2, 3), (1.80, 0, 0, 0, 0)]
    g = min(a, 1.6)
    for t, rs, rp, ls, lp in wind:
        joints = {}
        for side, sgn, sw, sp in (("Right", 1.0, rs, rp), ("Left", -1.0, ls, lp)):
            swing = sw * (0.3 if lateral else dz)
            spread = sp * (1.0 - 0.6 * dx * sgn) * (1.8 if lateral else 1.0)
            joints[side + " Arm"] = _jv(limb(side, swing * g, max(2.0 if sp else 0.0, spread * g), 0.0))
        q.key(t, joints, track="arms")
    return clip


# ---------------------------------------------------------------------------------------------------------
# Knockdown / get up
# ---------------------------------------------------------------------------------------------------------

def lying_back_pose():
    """Constant pose shared by knockdown (last key) and get_up (first key): flat on the back, feet forward."""
    j = _pose((90, 0, 8), (0.15, 0, 2.4), (0, 0, 10), limb("Right", 0, 58), limb("Left", 0, 36),
              limb("Right", 0, 12), limb("Left", 0, 5))
    return _rest(j)


def _lying_with(base, torso=None, dy=0.0, head=None, ra=None, la=None, rl=None, ll=None):
    """Variation of a lying pose resting on the ground (dy > 0: bounced up by dy)."""
    j = {k: _val(v) for k, v in base.items()}
    if torso is not None:
        j["Torso"]["rot"] = [float(x) for x in torso]
    for part, v in (("Head", head), ("Right Arm", ra), ("Left Arm", la), ("Right Leg", rl), ("Left Leg", ll)):
        if v is not None:
            j[part] = _jv(v)
    _rest(j)
    j["Torso"]["pos"][1] += dy
    return _lift_arms(j)


def _free(rot, tpos, rl, ll, head, ra, la, touch=False):
    """Airborne / falling pose with explicit legs, kept above the ground (touch: resting on it)."""
    j = _pose(rot, tpos, head, ra, la, limb("Right", *rl), limb("Left", *ll))
    return _rest(j, only_up=not touch)


@preset("knockdown", "reaction", "Knocked off the feet: snap back, fall on the back with the legs flying up, "
        "bounce, settle lying (the exact pose get_up starts from). Events Hit, Land, Down.", params={
            "strength": {"default": 1.0, "description": "0.3-2.0: impact snap, arm flail and bounce size."},
            "hold": {"default": 0.4, "description": "Seconds to hold the lying pose at the end (0-3)."},
        })
def knockdown(fps=60, speed=1.0, intensity=1.0, strength=1.0, hold=0.4):
    a = _clamp(strength, 0.3, 2.0) * intensity
    hold = _clamp(hold, 0.0, 3.0)
    clip = Clip("Knockdown", 0, fps, False, "Action", "Knocked down onto the back")
    q = _Seq(clip, speed)
    down = lying_back_pose()
    R, L = "Right", "Left"
    f15 = min(a, 1.5)
    end = 0.92
    nolag = {"lag": False}
    beats = [
        (0.00, _standing((0, 0, 0), (0, 0, 0), _REST_FEET, (0, 0, 0), (0, 0, 0), (0, 0, 0)),
         {"interp": "QUAD", "easing": "EASE_OUT"}),
        (0.06, _standing((16 * a, 0, 0), (0, 0, 0.25 * a), _REST_FEET, (-6, 0, 0), limb(R, 28 * f15, 16 * f15),
                         limb(L, 22 * f15, 18 * f15))),
        (0.16, _standing((36, 0, 3), (0, 0, 0.75), ((0.5, -0.3), (-0.5, -0.3)), (14 * f15, 0, 0),
                         limb(R, 75, 18 * f15), limb(L, 62, 22 * f15)), {"interp": "QUAD", "easing": "EASE_IN"}),
        (0.28, _free((64, 0, 5), (0.05, -1.15, 1.6), (38, 6), (46, 4), (-18, 0, 0), limb(R, 100, 24),
                     limb(L, 90, 28)), nolag),
        (0.37, _free((84, 0, 7), (0.1, -2.05, 2.2), (58, 8), (64, 5), (-22, 0, 0), limb(R, 55, 44),
                     limb(L, 48, 36)), nolag),
        (0.43, _lying_with(down, rl=limb(R, 50, 10), ll=limb(L, 55, 5), head=(-4, 0, 4), ra=limb(R, 0, 60),
                           la=limb(L, 0, 40)), nolag),
        (0.51, _lying_with(down, torso=(87, 0, 8), dy=0.1 * f15, rl=limb(R, 34, 11), ll=limb(L, 38, 5),
                           head=(-10, 0, 6), ra=limb(R, 0, 60), la=limb(L, 0, 38)), nolag),
        (0.59, _lying_with(down, rl=limb(R, 16, 12), ll=limb(L, 20, 5), head=(-3, 0, 8)), nolag),
        (0.69, _lying_with(down, head=(0, 0, 9))),
        (0.78, _lying_with(down, rl=limb(R, 6 * f15, 12), ll=limb(L, 4 * f15, 5))),
        (end, down),
        (end + max(hold, 0.02), down),
    ]
    frames = q.emit(beats, lag_head=0.035, lag_arms=0.05)
    q.event(frames[1], "Hit")
    q.event(frames[5], "Land")
    q.event(frames[-2], "Down")
    return _finish(clip, tol=0.0015, pinned=range(frames[-2], clip.length + 1))


@preset("get_up", "reaction", "Get up from the knockdown pose: lift the head, sit up, push off the ground, "
        "drag the feet under, rise and settle with a small foot adjustment. Events Push, Stand, Step.", params={
            "pace": {"default": 1.0, "description": "0.6-1.6: below 1 = slow, groggy rise; above 1 = quick, "
                                                    "athletic (scales timing on top of speed)."},
        })
def get_up(fps=60, speed=1.0, intensity=1.0, pace=1.0):
    pace = _clamp(pace, 0.6, 1.6)
    k = intensity
    clip = Clip("GetUp", 0, fps, False, "Action", "Get up from lying on the back")
    q = _Seq(clip, speed * pace)
    down = lying_back_pose()
    R, L = "Right", "Left"
    hip = _hip_mid(down)
    hx, hz = hip.x, hip.z

    def sitting(rot, legs, head, hands_z, hand_y=0.18):
        j = _pose(rot, _torso_on_hips(rot, (hx, hz)), head, rl=limb(R, legs[0], 10), ll=limb(L, legs[1], 6))
        _rest(j)
        for side, sx in ((R, 1.0), (L, -1.0)):
            _hand_to(j, side, (hx + sx * 1.5, GROUND + hand_y, hz + hands_z))
        _rest(j)
        j["Torso"]["pos"][1] += 0.012  # absorbs the chord sag of the hips' arc between keys
        return j

    def rising(rot, hip_xz, feet, head, ra=None, la=None, lift=(0.0, 0.0), hands_z=None):
        j = _standing(rot, _torso_on_hips(rot, hip_xz), feet, head, ra or (0, 0, 0), la or (0, 0, 0), lift)
        if hands_z is not None:  # hands still pushing on the ground beside the hips
            for side, sx in ((R, 1.0), (L, -1.0)):
                _hand_to(j, side, (hip_xz[0] + sx * 1.5, GROUND + 0.18, hip_xz[1] + hands_z), 0.25)
        return _lift_arms(j)

    feet_up = ((0.5, 0.0), (-0.5, 0.28))
    nolag = {"lag": False}  # arms stay in sync with the torso while they prop the body up
    beats = [
        (0.00, down),
        (0.13, _lying_with(down, head=(-28, 0, 6), ra=limb(R, 0, 22), la=limb(L, 0, 18), rl=limb(R, 8, 12),
                           ll=limb(L, 10, 5)), nolag),
    ]
    # sit up on evenly spaced, fully solved keys (hips stay on the ground, hands prop the body up)
    for t, lean, hz_, hy_ in ((0.21, 74, 1.0, 0.45), (0.28, 58, 0.85, 0.32), (0.35, 44, 0.7, 0.22),
                              (0.42, 30, 0.55, 0.18), (0.51, 12, 0.32, 0.15), (0.60, -4, 0.12, 0.12)):
        u = (90.0 - lean) / 94.0
        pose = sitting((lean, 0, 6 - 4 * u), (88 - lean, 86 - lean), (-28 + 20 * u, 0, 2 - 2 * u), hz_, hy_)
        beats.append((t, pose, nolag))
    beats += [
        (0.65, rising((-6, 0, 0), (hx * 0.9, hz - 0.03), ((0.5, -0.64), (-0.5, -0.58)), (-6, 0, 0), hands_z=0.1)),
        (0.70, rising((-16, 0, 0), (hx * 0.8, hz - 0.1), ((0.5, -0.62), (-0.5, -0.55)), (-4, 0, 0), hands_z=0.1)),
        (0.81, rising((-34, 0, 0), (hx * 0.5, hz - 0.55), ((0.5, -0.42), (-0.5, -0.2)), (2, 0, 0),
                      limb(R, 20 * k, 12), limb(L, 16 * k, 12))),
        (0.93, rising((-36, 0, 0), (hx * 0.25, 0.55), ((0.5, -0.15), (-0.5, 0.2)), (8, 0, 0),
                      limb(R, 36 * k, 12), limb(L, 32 * k, 12))),
        (1.06, rising((-20, 0, 0), (0.0, 0.2), feet_up, (6, 0, 0), limb(R, 44 * k, 12), limb(L, 40 * k, 12))),
        (1.21, rising((-6, 0, 0), (0.0, 0.05), feet_up, (0, 0, 0), limb(R, 20 * k, 8), limb(L, 18 * k, 8))),
        (1.37, rising((3, 0, 0), (0.0, 0.0), feet_up, (-3, 0, 0), limb(R, -6 * k, 4), limb(L, -5 * k, 4))),
        (1.49, rising((1, 2, -1), (0.0, 0.0), ((0.5, 0.0), (-0.5, 0.12)), (-1, 2, 0), limb(R, -2, 3),
                      limb(L, 2, 3), lift=(0.0, 0.16))),
        (1.61, rising((0, 0, 0), (0.0, 0.0), _REST_FEET, (0, 0, 0), limb(R, 1, 1), limb(L, -1, 1))),
        (1.78, _plant(_pose())),
    ]
    frames = q.emit(beats, lag_head=0.035, lag_arms=0.03)
    q.event(frames[7], "Push")
    q.event(frames[12], "Stand")
    q.event(frames[16], "Step")
    return _finish(clip, tol=0.0015, pinned=(0,))


# ---------------------------------------------------------------------------------------------------------
# Deaths
# ---------------------------------------------------------------------------------------------------------

_DEATH_PARAMS = {
    "strength": {"default": 1.0, "description": "0.3-2.0: impact snap and flail size (the fall is constant)."},
    "stumble": {"default": True, "description": "Take a stumbling step before collapsing."},
    "head_side": {"default": "left", "description": "Side the head lolls to at the end ('left' or 'right'; "
                                                     "'right' mirrors the whole death)."},
    "hold": {"default": 0.5, "description": "Seconds to hold the dead pose at the end (0-5)."},
}


def _death_finish(clip, q, frames, hit_i, land_i, head_side):
    q.event(frames[hit_i], "Hit")
    q.event(frames[land_i], "Land")
    q.event(frames[-2], "Dead")
    right = _opt("head_side", head_side, ("left", "right")) == "right"
    return _finish(clip, clip.name if right else None, tol=0.0015)


@preset("death_back", "reaction", "Dramatic death falling backward: shot snap, stumble, the body goes limp, feet "
        "slide out, hips then back hit the ground, bounce, head lolls. Ends lying. Events Hit, Land, Dead.",
        params=_DEATH_PARAMS)
def death_back(fps=60, speed=1.0, intensity=1.0, strength=1.0, stumble=True, head_side="left", hold=0.5):
    a = _clamp(strength, 0.3, 2.0) * intensity
    f15 = min(a, 1.5)
    hold = _clamp(hold, 0.0, 5.0)
    clip = Clip("DeathBack", 0, fps, False, "Action4", "Death falling backward")
    q = _Seq(clip, speed)
    R, L = "Right", "Left"
    dead = _rest(_pose((90, 0, -8), (0.2, 0, 2.0), (0, 0, 20), limb(R, 0, 76), limb(L, 0, 20),
                       limb(R, 0, 14), limb(L, 0, 4)))
    nolag = {"lag": False}
    sh = 0.0 if stumble else -0.28
    slump = (-9, 9, -4)
    beats = [(0.00, _standing((0, 0, 0), (0, 0, 0), _REST_FEET, (0, 0, 0), (0, 0, 0), (0, 0, 0)),
              {"interp": "QUAD", "easing": "EASE_OUT"}),
             (0.06, _standing((14 * a, 4 * a, 0), (0, 0, 0.2 * a), _REST_FEET, (24 * f15, 0, 0),
                              limb(R, 40 * f15, 20 * f15), limb(L, 32 * f15, 22 * f15)))]
    feet_after = _REST_FEET
    if stumble:
        feet_after = ((0.5, 0.7), (-0.5, 0.0))
        beats += [
            (0.22, _standing((12 * f15, 6, -3), (0, 0, 0.42), ((0.5, 0.35), (-0.5, 0.0)), (12, 4, 6),
                             limb(R, 50, 22), limb(L, 36, 26), lift=(0.3, 0.0))),
            (0.36, _standing((6, 8, -4), (0, 0, 0.55), feet_after, (2, 6, 8), limb(R, 25, 18), limb(L, 20, 20))),
        ]
    z0 = 0.45 if stumble else 0.1
    beats += [
        (0.58 + sh, _standing(slump, (0, 0, z0), feet_after, (-30, 6, 10), _hang(R, slump, 4, 8),
                              _hang(L, slump, 4, 8))),
        (0.72 + sh, _standing((16, 7, -5), (0.05, 0, z0 + 0.35), ((0.5, 0.15), (-0.5, -0.35)), (-26, 5, 12),
                              limb(R, 12, 14), limb(L, 10, 12))),
        (0.84 + sh, _standing((30, 6, -6), (0.1, 0, z0 + 0.6), ((0.55, -0.15), (-0.45, -0.4)), (-18, 4, 12),
                              limb(R, 30, 22), limb(L, 26, 18))),
        (0.92 + sh, _free((40, 5, -6), (0.12, 0, z0 + 0.8), (34, 8), (40, 5), (-15, 2, 13), limb(R, 38, 26),
                          limb(L, 28, 20), touch=True)),
        (1.00 + sh, _free((52, 3, -7), (0.15, 0, 1.5), (40, 9), (46, 5), (-12, 0, 14), limb(R, 45, 30),
                          limb(L, 30, 22), touch=True)),
        (1.18 + sh, _free((90, 0, -8), (0.2, 0, 2.0), (22, 12), (30, 5), (-8, 0, 16), limb(R, 0, 72),
                          limb(L, 0, 24), touch=True), nolag),
        (1.28 + sh, _lying_with(dead, torso=(87, 0, -8), dy=0.07 * f15, rl=limb(R, 12, 13), ll=limb(L, 16, 5),
                                head=(-2, 0, 18)), nolag),
        (1.40 + sh, _lying_with(dead, rl=limb(R, 0, 14), ll=limb(L, 4, 4))),
        (1.62 + sh, dead),
        (1.62 + sh + max(hold, 0.02), dead),
    ]
    frames = q.emit(beats, lag_head=0.04, lag_arms=0.06)
    return _death_finish(clip, q, frames, 1, len(beats) - 5, head_side)


@preset("death_forward", "reaction", "Dramatic death falling forward: hit from behind arches the back, stumble "
        "forward, legs buckle, fall face down, bounce, still. Events Hit, Land, Dead.", params=_DEATH_PARAMS)
def death_forward(fps=60, speed=1.0, intensity=1.0, strength=1.0, stumble=True, head_side="left", hold=0.5):
    a = _clamp(strength, 0.3, 2.0) * intensity
    f15 = min(a, 1.5)
    hold = _clamp(hold, 0.0, 5.0)
    clip = Clip("DeathForward", 0, fps, False, "Action4", "Death falling forward onto the face")
    q = _Seq(clip, speed)
    R, L = "Right", "Left"
    dead = _rest(_pose((-90, 0, 6), (-0.15, 0, -2.05), (8, 0, 18), limb(R, 0, 34), limb(L, 0, 95),
                       limb(R, 0, 8), limb(L, 0, 15)))
    nolag = {"lag": False}
    sh = 0.0 if stumble else -0.25
    beats = [(0.00, _standing((0, 0, 0), (0, 0, 0), _REST_FEET, (0, 0, 0), (0, 0, 0), (0, 0, 0)),
              {"interp": "QUAD", "easing": "EASE_OUT"}),
             (0.06, _standing((10 * a, -4 * a, 0), (0, 0, -0.2 * a), _REST_FEET, (22 * f15, 0, 0),
                              limb(R, -35 * f15, 18 * f15), limb(L, -30 * f15, 20 * f15)))]
    feet_after, z_after = _REST_FEET, -0.25
    if stumble:
        feet_after, z_after = ((0.5, -0.75), (-0.5, 0.0)), -0.62
        beats.append((0.24, _standing((-20, -6, 3), (0, 0, -0.45), ((0.5, -0.4), (-0.5, 0.0)), (-22, -4, 0),
                                      limb(R, 10, 12), limb(L, 16, 10), lift=(0.3, 0.0))))
    lean = (-30, -8, 4)
    beats += [
        (0.40 + sh, _standing(lean, (0, 0, z_after), feet_after, (-30, -6, -4), _hang(R, lean, 2, 8),
                              _hang(L, lean, 2, 8))),
        (0.62 + sh, _free((-48, -6, 5), (-0.05, 0, -1.05), (-4, 4), (6, 3), (-20, -4, -8), limb(R, 50, 12),
                          limb(L, 42, 10), touch=True)),
        (0.72 + sh, _free((-62, -4, 6), (-0.08, 0, -1.4), (-9, 4), (-3, 3), (-14, -2, -9), limb(R, 30, 14),
                          limb(L, 22, 14), touch=True)),
        (0.82 + sh, _free((-74, -3, 6), (-0.1, -2.0, -1.7), (-14, 5), (-10, 4), (-6, 0, -10), limb(R, -15, 18),
                          limb(L, -20, 26))),
        (0.95 + sh, _free((-90, 0, 6), (-0.15, 0, -2.05), (-10, 6), (-8, 12), (6, 0, 12), limb(R, 0, 30),
                          limb(L, 0, 70), touch=True), nolag),
        (1.04 + sh, _lying_with(dead, torso=(-87, 0, 6), dy=0.07 * f15, rl=limb(R, -16, 7), ll=limb(L, -14, 13),
                                head=(2, 0, 14), ra=limb(R, -20 * f15, 32), la=limb(L, -24 * f15, 80)), nolag),
        (1.16 + sh, _lying_with(dead, rl=limb(R, -4, 8), ll=limb(L, -3, 14), head=(8, 0, 16), ra=limb(R, -4, 34),
                                la=limb(L, -6, 88))),
        (1.38 + sh, dead),
        (1.38 + sh + max(hold, 0.02), dead),
    ]
    frames = q.emit(beats, lag_head=0.04, lag_arms=0.06)
    return _death_finish(clip, q, frames, 1, len(beats) - 5, head_side)


# ---------------------------------------------------------------------------------------------------------
# Stun (loop)
# ---------------------------------------------------------------------------------------------------------

@preset("stun", "reaction", "Dazed loop: slumped torso circling on planted feet, heavy head lolling behind it, "
        "arms dangling with lag (or one hand holding the head).", params={
            "sway": {"default": 7.0, "description": "Sway amplitude in degrees (0-20)."},
            "cycle": {"default": 2.4, "description": "Seconds per sway circle (1-6); the loop is one circle."},
            "hands": {"default": "dangle", "description": "'dangle' (limp arms) or 'head' (right hand on the "
                                                         "forehead)."},
        }, loop=True)
def stun(fps=60, speed=1.0, intensity=1.0, sway=7.0, cycle=2.4, hands="dangle"):
    hands = _opt("hands", hands, ("dangle", "head"))
    sw = _clamp(sway, 0.0, 20.0) * intensity
    period = _clamp(cycle, 1.0, 6.0)
    clip = Clip("Stun", 0, fps, True, "Action", "Dazed / stunned loop")
    q = _Seq(clip, speed)

    def torso_rot(ph):
        return (-7.0 + 0.55 * sw * math.sin(ph), 0.35 * sw * math.sin(2.0 * ph), sw * math.cos(ph))

    n = 12
    for i in range(n):
        ph = 2.0 * math.pi * i / n
        j = _stand(torso_rot(ph), feet=((0.6, 0.0), (-0.6, 0.0)))
        hp = ph - 0.9
        j["Head"] = _jv((-14.0 + 0.8 * sw * math.sin(hp), 0.7 * sw * math.sin(2.0 * hp), 1.7 * sw * math.cos(hp)))
        late = torso_rot(ph - 1.3)
        j["Right Arm"] = _jv(_hang("Right", late, 4, 9 + 1.5 * math.sin(ph - 1.6), 0, 0.9))
        j["Left Arm"] = _jv(_hang("Left", late, 3, 9 + 1.5 * math.sin(ph - 1.9), 0, 0.9))
        if hands == "head":
            brow = _fk(j)["Head"] @ Vector((0.3, 0.3, -0.85))
            _hand_to(j, "Right", brow, 0.2)
        q.key(period * i / n, j)
    q.close(period)
    return _finish(clip)


# ---------------------------------------------------------------------------------------------------------
# Emotes
# ---------------------------------------------------------------------------------------------------------

@preset("victory", "emote", "Victory: anticipation dip, arms thrown up in a V with a hop (or fist pumps pulled "
        "down), shaking fists, arms drop with follow-through. Event Victory.", params={
            "style": {"default": "arms_up", "description": "'arms_up' (V with a hop) or 'fist_pump' (right fist "
                                                           "pulled down repeatedly)."},
            "hold": {"default": 0.6, "description": "Seconds of celebration after the climax (0.2-3)."},
            "hop": {"default": True, "description": "Small jump on the climax (arms_up)."},
        })
def victory(fps=60, speed=1.0, intensity=1.0, style="arms_up", hold=0.6, hop=True):
    style = _opt("style", style, ("arms_up", "fist_pump"))
    hold = _clamp(hold, 0.2, 3.0)
    k = intensity
    clip = Clip("Victory", 0, fps, False, "Action", "Victory celebration (%s)" % style)
    q = _Seq(clip, speed)
    R, L = "Right", "Left"
    if style == "arms_up":
        q.key(0.0, _stand())
        q.key(0.28, _stand((-10 * k, 0, 0)))
        q.key(0.46, _stand((8 * k, 0, 0)))
        f = q.key(0.56, _stand((12 * k, 0, 0), air=0.35 * k if hop else 0.0))
        q.event(f, "Victory")
        q.key(0.68, _stand((3 * k, 0, 0)))
        n = max(1, int(round(hold / 0.3)))
        t = 0.68
        for i in range(n):
            t += hold / n
            q.key(t, _stand(((5 if i % 2 else 2) * k, (3 if i % 2 else -3) * k, 0)))
        q.key(t + 0.28, _stand((-3 * k, 0, 0)))
        q.key(t + 0.62, _stand())
        for tt, hd in ((0.0, 0), (0.31, -8), (0.5, 14), (0.6, 22 * k), (0.72, 15 * k), (t + 0.05, 12 * k),
                       (t + 0.32, -4), (t + 0.62, 0)):
            q.key(tt, {"Head": _jv((hd, 0, 0))}, track="head")
        arms = [(0.0, limb(R, 0, 0), limb(L, 0, 0)), (0.30, limb(R, -22, 8), limb(L, -22, 8)),
                (0.54, limb(R, 168, 20), limb(L, 168, 20)), (0.66, limb(R, 160, 24), limb(L, 160, 24))]
        tt = 0.66
        for i in range(n):
            tt += hold / n
            wob = 8.0 if i % 2 else -8.0
            arms.append((tt, limb(R, 160 + wob, 22), limb(L, 160 - wob, 22)))
        arms += [(t + 0.28, limb(R, 30, 10), limb(L, 28, 10)), (t + 0.48, limb(R, -5, 3), limb(L, -4, 3)),
                 (t + 0.62, limb(R, 0, 0), limb(L, 0, 0))]
        for tt, ra, la in arms:
            q.key(tt, _arms(ra, la), track="arms")
    else:
        body = [(0.0, (0, 0, 0)), (0.25, (-8 * k, -10 * k, 0)), (0.45, (6 * k, 6 * k, -4 * k))]
        arms = [(0.0, limb(R, 0, 0), limb(L, 0, 0)), (0.25, limb(R, -25, 10), limb(L, 10, 4)),
                (0.45, limb(R, 150, 12), limb(L, 20, 6))]
        head = [(0.0, (0, 0, 0)), (0.27, (-6, -8, 0)), (0.48, (14 * k, 4, 0))]
        t = 0.45
        pumps = max(2, int(round(hold / 0.3)) + 1)
        for i in range(pumps):
            t += 0.15
            body.append((t, (-6 * k, -4 * k, 2 * k)))
            arms.append((t, limb(R, 55, 12, 10), limb(L, 18, 6)))
            head.append((t + 0.02, (-12 * k, -6, 0)))
            if i < pumps - 1:
                t += 0.17
                body.append((t, (5 * k, 6 * k, -3 * k)))
                arms.append((t, limb(R, 140, 12), limb(L, 22, 6)))
                head.append((t + 0.02, (10 * k, 4, 0)))
        body += [(t + 0.3, (2 * k, 0, 0)), (t + 0.6, (0, 0, 0))]
        arms += [(t + 0.3, limb(R, 18, 6), limb(L, 6, 3)), (t + 0.6, limb(R, 0, 0), limb(L, 0, 0))]
        head += [(t + 0.3, (4, 0, 0)), (t + 0.6, (0, 0, 0))]
        for i, (tt, rot) in enumerate(body):
            f = q.key(tt, _stand(rot))
            if i == 2:
                q.event(f, "Victory")
        for tt, ra, la in arms:
            q.key(tt, _arms(ra, la), track="arms")
        for tt, hd in head:
            q.key(tt, {"Head": _jv(hd)}, track="head")
    return _finish(clip)


@preset("wave", "emote", "Friendly wave: small dip, arm swings up beside the head, hand waves side to side with "
        "torso / head secondary motion, arm drops and settles. Event Wave.", params={
            "hand": {"default": "Right", "description": "Waving hand: 'Right' or 'Left'."},
            "waves": {"default": 3, "description": "Number of back-and-forth waves (1-8)."},
            "energy": {"default": 1.0, "description": "0.2-2.0: wave amplitude and body motion."},
        })
def wave(fps=60, speed=1.0, intensity=1.0, hand="Right", waves=3, energy=1.0):
    hand = _opt("hand", hand, ("Right", "Left"))
    n = int(_clamp(waves, 1, 8))
    e = _clamp(energy, 0.2, 2.0) * intensity
    clip = Clip("Wave", 0, fps, False, "Action", "Wave hello")
    q = _Seq(clip, speed)
    R, L = "Right", "Left"
    half, up = 0.18, 0.46
    q.key(0.0, _stand())
    q.key(0.18, _stand((0, 0, 2 * e)))
    f = q.key(up, _stand((2 * e, -4 * e, -4 * e)))
    q.event(f, "Wave")
    q.key(0.0, _arms(limb(R, 0, 0), limb(L, 0, 0)), track="arms")
    q.key(0.18, _arms(limb(R, -10 * e, 8), limb(L, 2, 3)), track="arms")
    q.key(up, _arms(limb(R, 160, 18), limb(L, 6, 5)), track="arms")
    q.key(0.0, {"Head": _jv()}, track="head")
    q.key(0.21, {"Head": _jv((-3, 0, 0))}, track="head")
    q.key(up + 0.04, {"Head": _jv((4, -8 * e, -7 * e))}, track="head")
    t = up
    for i in range(2 * n):
        t += half
        inward = i % 2 == 0
        spread = 18.0 + (-14.0 if inward else 8.0) * min(e, 1.5)
        q.key(t, _arms(limb(R, 160, spread, (12 if inward else -8) * e), limb(L, 6, 5 + (1.5 if inward else 0))),
              track="arms")
        q.key(t, _stand((2 * e, (-2 if inward else -6) * e, -4 * e)))
        q.key(t + 0.03, {"Head": _jv(((2 if inward else 5), (-6 if inward else -10) * e, -7 * e))}, track="head")
    down = t + 0.1
    q.key(down + 0.26, _arms(limb(R, 40, 10), limb(L, 3, 4)), track="arms")
    q.key(down + 0.46, _arms(limb(R, -5, 3), limb(L, 0, 2)), track="arms")
    q.key(down + 0.26, _stand((0, 0, 1.5 * e)))
    q.key(down + 0.62, _stand())
    q.key(down + 0.3, {"Head": _jv((2, -2, -2))}, track="head")
    q.key(down + 0.62, {"Head": _jv()}, track="head")
    q.key(down + 0.62, _arms(limb(R, 0, 0), limb(L, 0, 0)), track="arms")
    return _finish(clip, "Wave" if hand == "Left" else None)


_POINT_DIRS = {  # torso yaw, torso lean, arm yaw (in torso), arm pitch, head (x, y)
    "forward": (0.0, 0.0, 4.0, 2.0, (0.0, 0.0)),
    "up": (0.0, 6.0, 4.0, 45.0, (24.0, 0.0)),
    "down": (0.0, -8.0, 4.0, -40.0, (-24.0, 0.0)),
    "left": (22.0, 0.0, 30.0, 2.0, (0.0, 38.0)),
    "right": (-22.0, 0.0, -42.0, 2.0, (0.0, -40.0)),
}


@preset("point", "emote", "Point at something: eyes lead, arm reaches out with a small overshoot, torso turns "
        "into it, hold with a small jab, return. Event Point.", params={
            "hand": {"default": "Right", "description": "Pointing hand: 'Right' or 'Left'."},
            "direction": {"default": "forward", "description": "forward, up, down, left or right."},
            "hold": {"default": 0.8, "description": "Seconds holding the point (0.2-4)."},
        })
def point(fps=60, speed=1.0, intensity=1.0, hand="Right", direction="forward", hold=0.8):
    hand = _opt("hand", hand, ("Right", "Left"))
    direction = _opt("direction", direction, tuple(_POINT_DIRS))
    hold = _clamp(hold, 0.2, 4.0)
    if hand == "Left" and direction in ("left", "right"):
        direction = "right" if direction == "left" else "left"
    k = intensity
    turn, lean, ayaw, apitch, head = _POINT_DIRS[direction]
    clip = Clip("Point", 0, fps, False, "Action", "Point %s" % direction)
    q = _Seq(clip, speed)
    R, L = "Right", "Left"
    aim = _arm_dir(_yaw_pitch(ayaw, apitch))
    aim_hi = _arm_dir(_yaw_pitch(ayaw, apitch + 5 * k))
    t_on, t_set = 0.42, 0.54
    t_hold = t_set + hold
    q.key(0.0, _stand())
    q.key(0.20, _stand((-0.3 * lean, -0.25 * turn, 0)))
    f = q.key(t_on, _stand((lean, turn, 0)))
    q.event(f, "Point")
    q.key(t_set + 0.5 * hold, _stand((lean - 2 * k, turn, 0)))
    q.key(t_hold, _stand((lean, turn, 0)))
    q.key(t_hold + 0.24, _stand((0.3 * lean, 0.3 * turn, 0)))
    q.key(t_hold + 0.48, _stand())
    for tt, hd in ((0.0, (0, 0)), (0.17, (0.6 * head[0], 0.6 * head[1])), (t_on - 0.02, head),
                   (t_hold + 0.08, head), (t_hold + 0.32, (0.2 * head[0], 0.2 * head[1])), (t_hold + 0.48, (0, 0))):
        q.key(tt, {"Head": _jv((hd[0], hd[1], 0))}, track="head")
    arms = [(0.0, limb(R, 0, 0), limb(L, 0, 0)), (0.20, limb(R, -10 * k, 8), limb(L, 3, 3)),
            (t_on, aim_hi, limb(L, -6 * k, 5)), (t_set, aim, limb(L, -4 * k, 5)),
            (t_set + 0.5 * hold, {"rot": aim, "pos": [0.0, 0.0, -0.08 * k]}, limb(L, -4 * k, 5)),
            (t_hold, aim, limb(L, -4 * k, 5)), (t_hold + 0.26, limb(R, 16, 6), limb(L, 2, 3)),
            (t_hold + 0.48, limb(R, 0, 0), limb(L, 0, 0))]
    for tt, ra, la in arms:
        q.key(tt, _arms(ra, la), track="arms")
    return _finish(clip, "Point" if hand == "Left" else None)


@preset("cheer", "emote", "Cheering: repeated jumps with arms thrown up (anticipation dip, takeoff, apex, "
        "landing absorb), then arms wave overhead. Events Jump, Land.", params={
            "jumps": {"default": 2, "description": "Number of jumps (1-4)."},
            "energy": {"default": 1.0, "description": "0.3-2.0: jump height and arm amplitude."},
        })
def cheer(fps=60, speed=1.0, intensity=1.0, jumps=2, energy=1.0):
    n = int(_clamp(jumps, 1, 4))
    e = _clamp(energy, 0.3, 2.0) * intensity
    clip = Clip("Cheer", 0, fps, False, "Action", "Cheering with jumps")
    q = _Seq(clip, speed)
    R, L = "Right", "Left"
    wide = ((0.62, 0.0), (-0.62, 0.0))
    q.key(0.0, _stand())
    q.key(0.0, _arms(limb(R, 0, 0), limb(L, 0, 0)), track="arms")
    q.key(0.0, {"Head": _jv()}, track="head")
    t = 0.0
    for i in range(n):
        c = t
        q.key(c + 0.16, _stand((-12 * e, 0, 0)))
        f = q.key(c + 0.28, _stand((2 * e, 0, 0)))
        q.event(f, "Jump")
        q.key(c + 0.40, _stand((8 * e, (4 if i % 2 else -4) * e, 0), feet=wide, air=0.5 * e))
        f = q.key(c + 0.52, _stand((-6 * e, 0, 0)))
        q.event(f, "Land")
        if i == 0:
            q.key(c + 0.16, _arms(limb(R, -22 * e, 8), limb(L, -22 * e, 8)), track="arms")
        else:
            q.key(c + 0.18, _arms(limb(R, 120, 16), limb(L, 120, 16)), track="arms")
        q.key(c + 0.42, _arms(limb(R, 168, 18), limb(L, 168, 18)), track="arms")
        q.key(c + 0.55, _arms(limb(R, 158, 22), limb(L, 158, 22)), track="arms")
        q.key(c + 0.18, {"Head": _jv((-6, 0, 0))}, track="head")
        q.key(c + 0.43, {"Head": _jv((18 * e, 0, (5 if i % 2 else -5) * e))}, track="head")
        q.key(c + 0.56, {"Head": _jv((4, 0, 0))}, track="head")
        t = c + 0.52
    for i, sgn in enumerate((1, -1, 1)):
        tt = t + 0.2 * (i + 1)
        q.key(tt, _stand((3 * e, 0, 4 * sgn * e)))
        q.key(tt, _arms(limb(R, 160, 18 + 10 * sgn * e), limb(L, 160, 18 - 10 * sgn * e)), track="arms")
        q.key(tt + 0.03, {"Head": _jv((10 * e, 0, 6 * sgn * e))}, track="head")
    t += 0.6
    q.key(t + 0.32, _arms(limb(R, 34, 10), limb(L, 34, 10)), track="arms")
    q.key(t + 0.52, _arms(limb(R, -4, 3), limb(L, -4, 3)), track="arms")
    q.key(t + 0.3, _stand((-2, 0, 0)))
    q.key(t + 0.68, _stand())
    q.key(t + 0.68, _arms((0, 0, 0), (0, 0, 0)), track="arms")
    q.key(t + 0.68, {"Head": _jv()}, track="head")
    return _finish(clip)


@preset("salute", "emote", "Military salute: come to attention, bring the hand to the brow with a tiny "
        "overshoot, hold, snap down. Event Salute.", params={
            "hand": {"default": "Right", "description": "Saluting hand: 'Right' or 'Left'."},
            "hold": {"default": 1.0, "description": "Seconds holding the salute (0.2-4)."},
        })
def salute(fps=60, speed=1.0, intensity=1.0, hand="Right", hold=1.0):
    hand = _opt("hand", hand, ("Right", "Left"))
    hold = _clamp(hold, 0.2, 4.0)
    k = intensity
    clip = Clip("Salute", 0, fps, False, "Action", "Military salute")
    q = _Seq(clip, speed)
    R, L = "Right", "Left"
    brow = aim_arm(R, Vector((0.86, 1.74, -0.66)), 0.1)
    over = aim_arm(R, Vector((0.9, 1.84, -0.72)), 0.1)
    t_on = 0.40
    t_off = t_on + 0.1 + hold
    q.key(0.0, _stand())
    q.key(0.16, _stand((3 * k, 0, 0)))
    f = q.key(t_on, _stand((4 * k, 2 * k, 0)))
    q.event(f, "Salute")
    q.key(t_off, _stand((3 * k, 1 * k, 0)))
    q.key(t_off + 0.42, _stand())
    for tt, hd in ((0.0, (0, 0, 0)), (0.18, (5 * k, 0, 0)), (t_on + 0.02, (3 * k, 0, 0)), (t_off, (3 * k, 0, 0)),
                   (t_off + 0.42, (0, 0, 0))):
        q.key(tt, {"Head": _jv(hd)}, track="head")
    arms = [(0.0, limb(R, 0, 0), limb(L, 0, 0)), (0.16, limb(R, 4, 1), limb(L, 0, 1)),
            (0.28, limb(R, 75, 32), limb(L, 0, 1)),  # out and up first: the hand arcs around the shoulder
            (t_on, over, limb(L, 0, 1)), (t_on + 0.1, brow, limb(L, 0, 1)), (t_off, brow, limb(L, 0, 1)),
            (t_off + 0.12, limb(R, 70, 30), limb(L, 0, 1)), (t_off + 0.24, limb(R, 10, 8), limb(L, 0, 1)),
            (t_off + 0.34, limb(R, -3, 2), limb(L, 0, 0)), (t_off + 0.42, limb(R, 0, 0), limb(L, 0, 0))]
    for tt, ra, la in arms:
        q.key(tt, _arms(ra, la), track="arms")
    return _finish(clip, "Salute" if hand == "Left" else None)


@preset("sit", "emote", "Seated idle loop: legs forward 90 deg, Torso lowered so the hips rest on a seat (or "
        "the floor), breathing, slow look around, feet swing on a chair.", params={
            "seat": {"default": "chair", "description": "'chair' (Torso pos y -1, legs off the seat edge) or "
                                                         "'ground' (sitting on the floor)."},
            "arms": {"default": "lap", "description": "'lap' (hands on the thighs) or 'lean_back' (leaning back on "
                                                       "the hands)."},
            "cycle": {"default": 3.2, "description": "Breathing cycle in seconds (2-6); the loop is one cycle."},
        }, loop=True)
def sit(fps=60, speed=1.0, intensity=1.0, seat="chair", arms="lap", cycle=3.2):
    seat = _opt("seat", seat, ("chair", "ground"))
    arms = _opt("arms", arms, ("lap", "lean_back"))
    period = _clamp(cycle, 2.0, 6.0)
    k = intensity
    clip = Clip("Sit", 0, fps, True, "Action", "Sitting (%s, %s)" % (seat, arms))
    q = _Seq(clip, speed)
    hip_y = -2.0 if seat == "chair" else GROUND + 0.5
    base = {"lap": -4.0, "lean_back": 14.0}[arms] + (0.0 if seat == "chair" else -2.0)
    n = 8
    for i in range(n):
        ph = 2.0 * math.pi * i / n
        b = math.sin(ph)
        rx = base + 1.2 * k * b
        rot = (rx, 0.0, 0.6 * k * math.sin(ph + 1.0))
        tp = _torso_on_hips(rot, (0.0, 0.0))
        off = cfm.angles_deg(*rot).to_3x3() @ Vector((0.0, -1.0, 0.0))
        swing_r = swing_l = 90.0 - rx
        if seat == "chair":
            swing_r += 3.0 * k * math.sin(2.0 * ph)
            swing_l += 2.5 * k * math.sin(2.0 * ph + 2.0)
        j = _pose(rot, (tp[0], hip_y - off.y + 0.015 * k * b, tp[2]),
                  (-3.0 + 2.0 * k * math.sin(2.0 * ph), 10.0 * k * math.sin(ph), 2.0 * k * math.sin(ph + 1.0)),
                  rl=limb("Right", swing_r, 5), ll=limb("Left", swing_l, 5))
        for side, sx in (("Right", 1.0), ("Left", -1.0)):
            if arms == "lap":
                _hand_to(j, side, (sx * 0.9, hip_y + 0.8, -1.1))
            else:
                _hand_to(j, side, (sx * 1.5, hip_y - 0.38, 0.85))
        q.key(period * i / n, j)
    q.close(period)
    return _finish(clip)


@preset("dance", "emote", "Dance loop, 8 beats (4 s at 120 BPM): step-touch groove with alternating raised-arm "
        "waves, then disco points and a raise-the-roof; head bobs and torso bounces on every beat. "
        "Event Beat (value 1-8).", params={
            "tempo": {"default": 120.0, "description": "Beats per minute (60-180); the loop is 8 beats."},
            "energy": {"default": 1.0, "description": "0.3-2.0: groove amplitude (bounce, tilt, head bob, steps)."},
            "mirror": {"default": False, "description": "Start on the left side."},
        }, loop=True)
def dance(fps=60, speed=1.0, intensity=1.0, tempo=120.0, energy=1.0, mirror=False):
    beat = 60.0 / _clamp(tempo, 60.0, 180.0)
    e = _clamp(energy, 0.3, 2.0) * intensity
    clip = Clip("Dance", 0, fps, True, "Action", "Dance loop at %d BPM" % round(60.0 / beat))
    q = _Seq(clip, speed)
    R, L = "Right", "Left"
    out = 0.5 + 0.35 * min(e, 1.4)
    feet = [  # (right x, left x) at every half beat
        (out, -0.5), (out, out - 1.0), (out, -out), (1.0 - out, -out),
        (out, -out), (out, out - 1.0), (out, -out), (1.0 - out, -out),
        (0.6, -out), (0.6, -0.6), (0.6, -0.6), (0.6, -0.6), (0.6, -0.6), (0.6, -0.6), (0.6, -0.6), (0.6, -0.5)]
    up_right = limb(R, 150, 20)                  # up and out; the torso tilt / turn sells the diagonal
    down_left = _arm_dir((-0.05, -0.62, -0.78))  # reads as down-left once the torso turns left
    hip_hand = limb(L, -12, 24)
    for h in range(16):
        on = h % 2 == 0
        b = h // 2
        rx, lx = feet[h]
        cx = 0.5 * (rx + lx)
        if b < 4:  # step-touch: the arm on the stepping side is up and waves out on the beat, in on the "and"
            side = 1.0 if cx > 0 else -1.0
            tilt, turn = -5.0 * side * e, -8.0 * side * e
            head = ((-12.0 if on else 5.0) * e, -6.0 * side * e, -4.0 * side * e)
            wave_arm = limb(R if b % 2 == 0 else L, 165, 19 if on else 4, 8 if on else -6)
            low = limb(L if b % 2 == 0 else R, *((20, 8) if on else (12, 12)))
            ra, la = (wave_arm, low) if b % 2 == 0 else (low, wave_arm)
        elif b < 7:  # disco: up-right on the beat, down-left on the "and"
            tilt, turn = (-7.0 * e, -10.0 * e) if on else (5.0 * e, 10.0 * e)
            head = (12.0 * e, -15.0 * e, -4.0 * e) if on else (-15.0 * e, 15.0 * e, 3.0 * e)
            ra, la = (up_right if on else down_left), hip_hand
        else:  # raise the roof
            tilt, turn = 0.0, 0.0
            head = (10.0 * e, 0.0, 0.0) if on else (-6.0 * e, 0.0, 0.0)
            ra, la = (limb(R, 168, 12), limb(L, 168, 12)) if on else (limb(R, 140, 16), limb(L, 140, 16))
        rot = ((-4.0 if on else 1.5) * e, turn, tilt)
        t = h * 0.5 * beat
        f = q.key(t, _stand(rot, (cx, 0.0, 0.0), ((rx, 0.0), (lx, 0.0)), air=0.0 if on else 0.05 * e))
        if on:
            q.event(f, "Beat", str(b + 1))
        q.key(t + 0.04 * beat, {"Head": _jv(head)}, track="head")
        q.key(t, _arms(ra, la), track="arms")
        # quarter beat: lift the foot that moves to the next half-beat position
        nr, nl = feet[(h + 1) % 16]
        lift = (0.22 * min(e, 1.5) if abs(nr - rx) > 1e-3 else 0.0, 0.22 * min(e, 1.5) if abs(nl - lx) > 1e-3 else 0.0)
        if any(lift):
            nrot = ((1.5 if on else -4.0) * e, turn, tilt)
            mrot = tuple(0.5 * (x + y) for x, y in zip(rot, nrot))
            q.key(t + 0.25 * beat, _stand(mrot, (0.25 * (rx + nr + lx + nl), 0.0, 0.0),
                                          ((0.5 * (rx + nr), 0.0), (0.5 * (lx + nl), 0.0)), lift))
    q.close(8 * beat)
    return _finish(clip, "Dance" if mirror else None)


@preset("laugh", "emote", "Big laugh: inhale, burst leaning back with the head thrown up, shaking chuckles, "
        "double over clutching the belly (or pointing at someone), straighten. Event Laugh.", params={
            "style": {"default": "belly", "description": "'belly' (hands on the belly) or 'point' (point at the "
                                                         "target while laughing)."},
            "duration": {"default": 2.2, "description": "Total seconds (1.4-5)."},
        })
def laugh(fps=60, speed=1.0, intensity=1.0, style="belly", duration=2.2):
    style = _opt("style", style, ("belly", "point"))
    dur = _clamp(duration, 1.4, 5.0)
    a = intensity
    clip = Clip("Laugh", 0, fps, False, "Action", "Laughing (%s)" % style)
    q = _Seq(clip, speed)
    R, L = "Right", "Left"
    t_burst = 0.36
    t_fold = t_burst + 0.18 + 0.28 * (dur - 0.9)
    t_up = dur - 0.3
    belly = (limb(R, 36, 4, 20), limb(L, 34, 4, 20))
    back_rot, fold_rot = (14 * a, 5 * a, 0), (-26 * a, -4 * a, 0)

    def arms_at(phase, shake):
        lift = [0.0, 0.05 * a * shake, 0.0]
        if style == "point":
            torso = back_rot if phase == "back" else fold_rot
            d = cfm.angles_deg(*torso).to_3x3().inverted() @ Vector((0.12, 0.05, -1.0))
            return _arms({"rot": _arm_dir(d), "pos": lift}, {"rot": belly[1], "pos": lift})
        if phase == "back":
            return _arms({"rot": limb(R, 15, 16), "pos": lift}, {"rot": limb(L, 12, 15), "pos": lift})
        return _arms({"rot": belly[0], "pos": lift}, {"rot": belly[1], "pos": lift})

    q.key(0.0, _stand())
    q.key(0.18, _stand((4 * a, 0, 0)))
    f = q.key(t_burst, _stand(back_rot))
    q.event(f, "Laugh")
    q.key(0.0, _arms((0, 0, 0), (0, 0, 0)), track="arms")
    q.key(0.18, _arms({"rot": limb(R, 0, 6), "pos": [0, 0.08 * a, 0]}, {"rot": limb(L, 0, 6), "pos": [0, 0.08 * a, 0]}),
          track="arms")
    q.key(t_burst, arms_at("back", 0.0), track="arms")
    q.key(0.0, {"Head": _jv()}, track="head")
    q.key(0.2, {"Head": _jv((6 * a, 0, 0))}, track="head")
    q.key(t_burst + 0.03, {"Head": _jv((26 * a, 0, -4 * a))}, track="head")
    # chuckles: quick shoulder / torso bounces ("ha ha ha") every 0.11 s
    t, i = t_burst, 0
    while t + 0.11 < t_fold - 0.12:
        t += 0.11
        sh = 1.0 if i % 2 == 0 else -1.0
        q.key(t, _stand((back_rot[0] + 3 * sh * a, back_rot[1], 1.5 * sh * a)))
        q.key(t, arms_at("back", sh), track="arms")
        q.key(t + 0.02, {"Head": _jv(((26 - 5 * sh) * a, 0, -4 * a))}, track="head")
        i += 1
    q.key(t_fold, _stand(fold_rot))
    q.key(t_fold, arms_at("fold", 0.0), track="arms")
    q.key(t_fold + 0.04, {"Head": _jv((-8 * a, 0, 0))}, track="head")
    t, i = t_fold, 0
    while t + 0.12 < t_up - 0.15:
        t += 0.12
        sh = 1.0 if i % 2 == 0 else -1.0
        q.key(t, _stand((fold_rot[0] + 3 * sh * a, fold_rot[1], 2 * sh * a)))
        q.key(t, arms_at("fold", sh), track="arms")
        q.key(t + 0.02, {"Head": _jv(((10 - 4 * sh) * a, 0, 3 * sh * a))}, track="head")
        i += 1
    q.key(t_up, _stand((3 * a, 0, 0)))
    q.key(t_up, _arms(limb(R, 10, 6), limb(L, 10, 6)), track="arms")
    q.key(t_up + 0.03, {"Head": _jv((5 * a, 0, 0))}, track="head")
    q.key(dur, _stand())
    q.key(dur, _arms((0, 0, 0), (0, 0, 0)), track="arms")
    q.key(dur, {"Head": _jv()}, track="head")
    return _finish(clip)


@preset("bow_greeting", "emote", "Respectful bow: straighten, bow from the hips with the head following late, "
        "hold, rise. 'courtly' adds a hand on the heart, the other arm sweeping out and the right foot drawn "
        "back. Event Bow.", params={
            "style": {"default": "formal", "description": "'formal' (arms at the sides) or 'courtly' (hand on "
                                                           "heart, arm sweep, foot back)."},
            "depth": {"default": 40.0, "description": "Bow angle in degrees (10-70)."},
            "hold": {"default": 0.5, "description": "Seconds held at the bottom (0-3)."},
        })
def bow_greeting(fps=60, speed=1.0, intensity=1.0, style="formal", depth=40.0, hold=0.5):
    style = _opt("style", style, ("formal", "courtly"))
    d = _clamp(_clamp(depth, 10.0, 70.0) * intensity, 5.0, 75.0)
    hold = _clamp(hold, 0.0, 3.0)
    clip = Clip("BowGreeting", 0, fps, False, "Action", "Bow (%s)" % style)
    q = _Seq(clip, speed)
    R, L = "Right", "Left"
    courtly = style == "courtly"
    back_foot = ((0.5, 0.55), (-0.5, -0.05)) if courtly else _REST_FEET
    shift = -0.8 * math.sin(math.radians(d))
    t_dn = 0.62
    t_up = t_dn + 0.1 + hold
    q.key(0.0, _stand())
    q.key(0.22, _stand((2, 0, 0)))
    if courtly:
        q.key(0.36, _stand((0, 0, 0), (0, 0, 0.1), ((0.5, 0.28), (-0.5, 0.0)), (0.15, 0.0)))
    f = q.key(t_dn, _stand((-d, 0, 0), (0, 0, shift), back_foot))
    q.event(f, "Bow")
    q.key(t_up, _stand((-d - 3, 0, 0), (0, 0, shift), back_foot))
    q.key(t_up + 0.38, _stand((3, 0, 0), (0, 0, 0), back_foot))
    if courtly:
        q.key(t_up + 0.52, _stand((1, 0, 0), (0, 0, 0), ((0.5, 0.25), (-0.5, 0.0)), (0.15, 0.0)))
    q.key(t_up + 0.68, _stand())
    for tt, hd in ((0.0, 0), (0.24, 3), (t_dn + 0.08, -0.35 * d), (t_up + 0.05, -0.4 * d), (t_up + 0.42, 4),
                   (t_up + 0.68, 0)):
        q.key(tt, {"Head": _jv((hd, 0, 0))}, track="head")
    if courtly:
        heart = aim_arm(R, Vector((-0.1, 0.3, -1.0)), 0.12)  # right hand on the heart (torso space)
        arms = [(0.0, limb(R, 0, 0), limb(L, 0, 0)), (0.16, limb(R, 55, 10), limb(L, -4, 14)),
                (0.3, heart, limb(L, -8, 24)),
                (t_dn + 0.06, heart, limb(L, -35, 40, 10)), (t_up, heart, limb(L, -38, 42, 10)),
                (t_up + 0.42, limb(R, 25, 6), limb(L, -6, 10)), (t_up + 0.68, limb(R, 0, 0), limb(L, 0, 0))]
    else:
        arms = [(0.0, limb(R, 0, 0), limb(L, 0, 0)), (0.24, limb(R, 0, 1), limb(L, 0, 1)),
                (t_dn + 0.06, limb(R, 0.25 * d, 1), limb(L, 0.25 * d, 1)),
                (t_up, limb(R, 0.3 * d, 1), limb(L, 0.3 * d, 1)),
                (t_up + 0.42, limb(R, -3, 1), limb(L, -3, 1)), (t_up + 0.68, limb(R, 0, 0), limb(L, 0, 0))]
    for tt, ra, la in arms:
        q.key(tt, _arms(ra, la), track="arms")
    return _finish(clip)
