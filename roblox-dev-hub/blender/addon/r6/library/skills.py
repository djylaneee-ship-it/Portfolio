"""R6 presets: unarmed strikes, bow, magic casts and dodges (owner: agent SKILLS).

Authoring model shared by every preset of this module
- Every key is a full-body pose built by `_body()` (all six joints), so nothing is left for Blender to guess.
- Planted feet use a small leg IK (`_leg_ik`): a foot keeps its spot on the ground (lowest leg corner at
  y = -3 in character space) while the torso twists, leans or shifts. The torso height is the highest one the
  planted legs can reach (R6 legs are rigid); `sink` lowers it further by sliding the legs' tops into the torso,
  where it does not show.
- Arms are aimed at torso-space points with `_aim` (the "hand" is the bottom centre of the arm); a `reach`
  lets the shoulder slide toward / away from the target. `_arm_clear` slides any arm whose top end would sink
  into the torso (rigid R6 arms raised or crossed) just far enough out to clear it.
- Timing is written in seconds with `_Seq` (frame = seconds * fps / speed, strictly increasing).
  `_Seq.to(dt, pose, interp, easing)` sets the curve of the segment that ARRIVES at the new key.
- `intensity` scales the dynamic amplitudes (wind-ups, twists, leans, dips, recoils), not the points the hands
  reach, so a strike still lands on its target and planted feet stay planted.
- Strikes snap with EXPO ease-in but load ALONG the strike line (`_cocked`, chambers), so each joint turns at
  most ~25 deg during the snap (preset_lint's 1400 deg/s limit at 60 fps) and the punch's length comes from the
  shoulder translation (`reach`). Long arcs (uppercut, casts, slam) use a QUAD ease-in drive (`_quad_drive`).
"""

import math

from mathutils import Matrix, Quaternion, Vector

from .. import cframe as cfm
from ..clip import Clip, limb, preset

_GROUND = -cfm.R6_HIP_HEIGHT
_ZERO = (0.0, 0.0, 0.0)
_REST_FEET = {"Right": (0.5, 0.0, 0.0), "Left": (-0.5, 0.0, 0.0)}   # (x, z, yaw deg, + = toes turned left)
_FOOT_CORNERS = [Vector((x, -1.0, z)) for x in (-0.5, 0.5) for z in (-0.5, 0.5)]
_BOW = {"kind": "bow", "hand": "Left"}


# ---------------------------------------------------------------------------------------------
# geometry
# ---------------------------------------------------------------------------------------------

def _motion(rot, pos, pivot):
    """Friendly joint motion in parent axes: T(pos) @ T(pivot) @ R @ T(-pivot)."""
    return Matrix.Translation(Vector(pos) + pivot) @ cfm.angles_deg(*rot) @ Matrix.Translation(-pivot)


def _rest(part):
    """(rest CFrame in the parent part's space, joint pivot, pivot -> bottom-centre vector)."""
    _j, _p, c0, c1 = cfm.R6_JOINTS[part]
    rest = c0 @ c1.inverted()
    pivot = c0.translation.copy()
    return rest, pivot, rest @ Vector((0.0, -1.0, 0.0)) - pivot


def _torso_cf(rot, pos):
    rest, pivot, _v = _rest("Torso")
    return _motion(rot, pos, pivot) @ rest


def _leg_ik(side, torso_cf, foot):
    """Friendly leg value putting the leg's lowest corner on the ground at foot = (x, z, yaw).

    Returns (value, stretch). stretch < 0: the leg slid up into the torso by that much (hidden);
    stretch > 0: the leg would have to grow (callers lower the torso instead).
    """
    rest, pivot, v0 = _rest(side + " Leg")
    x, z, yaw = foot
    inv = torso_cf.inverted()
    yaw = math.radians(yaw)
    want = torso_cf.to_3x3().inverted() @ Vector((-math.sin(yaw), 0.0, -math.cos(yaw)))
    y = _GROUND
    for _ in range(8):
        v1 = (inv @ Vector((x, y, z))) - pivot
        axis = v1.normalized()
        q = v0.rotation_difference(v1)
        front = q @ Vector((0.0, 0.0, -1.0))
        fp = front - axis * front.dot(axis)
        wp = want - axis * want.dot(axis)
        if fp.length > 1e-6 and wp.length > 1e-6:  # twist about the leg so the toes face `yaw`
            ang = fp.angle(wp)
            q = Quaternion(axis, ang if axis.dot(fp.cross(wp)) >= 0.0 else -ang) @ q
        stretch = v1.length - v0.length
        m = Matrix.Translation(axis * stretch + pivot) @ q.to_matrix().to_4x4() @ Matrix.Translation(-pivot)
        leg = torso_cf @ m @ rest
        low = min((leg @ c).y for c in _FOOT_CORNERS)
        if abs(low - _GROUND) < 1e-5:
            break
        y += _GROUND - low
    rot = cfm.to_angles_deg(q.to_matrix().to_4x4())
    return {"rot": list(rot), "pos": list(axis * stretch)}, stretch


def _plant(torso, shift, feet, sink):
    """Torso height (highest the planted legs reach, minus sink) and the planted leg values."""
    def solve(y):
        cf = _torso_cf(torso, (shift[0], y, shift[1]))
        return {side: _leg_ik(side, cf, foot) for side, foot in feet.items()}

    lo, hi = -2.6, 1.2
    for _ in range(26):
        mid = 0.5 * (lo + hi)
        if max(s for _v, s in solve(mid).values()) > 0.0:
            hi = mid
        else:
            lo = mid
    y = lo - sink
    return y, {side: v for side, (v, _s) in solve(y).items()}


def _lowest(joints):
    """Lowest corner (character-space y) of the whole body for a full joints dict."""
    tr = {p: cfm.friendly_to_transform(v["rot"], v["pos"], cfm.R6_JOINTS[p][2]) for p, v in joints.items()
          if p in cfm.R6_JOINTS}
    parts = cfm.fk(tr)
    low = 99.0
    for p in cfm.R6_PARTS:
        sx, sy, sz = (s / 2.0 for s in cfm.R6_SIZES[p])
        for c in ((x, y, z) for x in (-sx, sx) for y in (-sy, sy) for z in (-sz, sz)):
            low = min(low, (parts[p] @ Vector(c)).y)
    return low


def _contact_height(joints, clearance=0.02):
    """Torso pos y that puts the lowest corner of the whole body `clearance` above the ground."""
    return joints["Torso"]["pos"][1] + _GROUND + clearance - _lowest(joints)


def _keep_above_ground(clip, keys):
    """Raise the torso of `keys` (key frames free to move) until no in-between frame dips under the ground."""
    keys = set(keys)
    frames = clip.frames()
    first = max([k for k in frames if k < min(keys)] or [min(keys)])   # include the segments either side
    last = min([k for k in frames if k > max(keys)] or [max(keys)])
    for _ in range(8):
        lift = {}
        for f in range(first, last + 1):
            depth = _GROUND - _lowest(clip.resolve(f))
            if depth > 0.005:
                for k in (max(k for k in frames if k <= f), min(k for k in frames if k >= f)):
                    if k in keys:
                        lift[k] = max(lift.get(k, 0.0), depth)
        if not lift:
            return
        for k, d in lift.items():
            clip.keys[k]["joints"]["Torso"]["pos"][1] += d


def _body(torso=_ZERO, shift=(0.0, 0.0), sink=0.0, feet=None, legs=None, y=None, head=None, look=None,
          rarm=None, larm=None):
    """Full-body joints dict for Clip.key.

    torso: rot (deg). shift: torso (x, z) offset in studs. sink: lower the torso below the height the planted
    legs reach. feet: {side: (x, z, yaw)} planted feet; default = rest spots for every side without a `legs`
    value. legs: {side: friendly value} for free legs. y: explicit torso height (airborne poses, feet={}).
    head: friendly rot in torso axes, or look: head orientation in character space (CFrame.Angles degrees)
    that the neck keeps whatever the torso does. rarm / larm: friendly values (default rest).
    """
    legs = {s: _val(v) for s, v in (legs or {}).items()}
    if feet is None:
        feet = {s: _REST_FEET[s] for s in ("Right", "Left") if s not in legs}
    if y is None:
        if feet:
            y, planted = _plant(torso, shift, feet, sink)
        else:
            y, planted = -sink, {}
    else:
        cf = _torso_cf(torso, (shift[0], y, shift[1]))
        planted = {s: _leg_ik(s, cf, f)[0] for s, f in feet.items()}

    def leg_low(side, v, cf):
        rest, pivot, _v0 = _rest(side + " Leg")
        leg = cf @ _motion(v["rot"], v["pos"], pivot) @ rest
        return min((leg @ c).y for c in _FOOT_CORNERS)

    cf = _torso_cf(torso, (shift[0], y, shift[1]))
    if planted:  # a free (swinging) leg of a supported pose must clear the ground: slide it up into the hip
        for side, v in legs.items():
            low = leg_low(side, v, cf)
            if low < _GROUND + 0.03:
                up = cf.to_3x3().inverted() @ Vector((0.0, _GROUND + 0.03 - low, 0.0))
                v["pos"] = [a + b for a, b in zip(v["pos"], up)]
    elif legs:  # airborne: raise the body until the hanging legs clear the ground
        low = min(leg_low(side, v, cf) for side, v in legs.items())
        y += max(0.0, _GROUND + 0.05 - low)
    legs.update(planted)
    cf = _torso_cf(torso, (shift[0], y, shift[1]))
    rarm = rarm(cf) if callable(rarm) else rarm
    larm = larm(cf) if callable(larm) else larm
    if look is not None:
        head = cfm.to_angles_deg(cfm.angles_deg(*torso).inverted() @ cfm.angles_deg(*look))
    return {"Torso": {"rot": [float(a) for a in torso], "pos": [float(shift[0]), float(y), float(shift[1])]},
            "Head": _val(head), "Right Arm": _arm_clear("Right", _val(rarm)),
            "Left Arm": _arm_clear("Left", _val(larm)),
            "Right Leg": _val(legs.get("Right")), "Left Leg": _val(legs.get("Left"))}


# Arm / torso clearance, matching both checkers: r6.analyze (the lower 1.2 studs of the arm, 0.9 wide, may not
# overlap the torso box by more than 0.05) and tests/preset_lint.py (corners and centre of the arm's lower 0.9 x
# 0.9 x 0.9 block outside the torso shrunk by 0.08), each with a small safety margin.
_AXES = (Vector((1.0, 0.0, 0.0)), Vector((0.0, 1.0, 0.0)), Vector((0.0, 0.0, 1.0)))
_TORSO_HALF = (1.0, 1.0, 0.5)
_ARM_LOW = (Vector((0.0, -0.4, 0.0)), (0.45, 0.6, 0.45))
_LINT_PTS = [Vector((x, y, z)) for x in (-0.45, 0.45) for y in (-0.1, -1.0) for z in (-0.45, 0.45)] + [
    Vector((0.0, -0.55, 0.0))]


def _torso_overlap(cf, center, half):
    """Penetration depth (studs, separating axes) of the box (center, half) placed by cf into the torso box."""
    rot = cf.to_3x3()
    axes = [rot.col[i].normalized() for i in range(3)]
    c = cf @ center
    depth = 99.0
    for axis in axes + list(_AXES) + [u.cross(v) for u in axes for v in _AXES]:
        if axis.length < 1e-6:
            continue
        axis = axis.normalized()
        ra = sum(half[i] * abs(axis.dot(axes[i])) for i in range(3))
        rb = sum(_TORSO_HALF[i] * abs(axis[i]) for i in range(3))
        overlap = ra + rb - abs(c.dot(axis))
        if overlap <= 0.0:
            return 0.0
        depth = min(depth, overlap)
    return depth


def _arm_in_torso(side, rot, pos):
    """Does an arm (friendly rot / pos in torso space) sink into the torso?"""
    rest, pivot, _v = _rest(side + " Arm")
    arm = _motion(rot, pos, pivot) @ rest
    if _torso_overlap(arm, *_ARM_LOW) > 0.02:
        return True
    return any(abs(q.x) < 0.96 and abs(q.y) < 0.96 and abs(q.z) < 0.46 for q in (arm @ p for p in _LINT_PTS))


def _arm_clear(side, value):
    """Slide an arm out of the torso when it would sink into it.

    R6 shoulders pivot on the arm's inner face, so any arm brought forward AND inward (guards, crosses, bow
    draws) rotates its upper inner edge into the chest. The smallest shoulder offset (0.02 stud steps) that
    clears it is added to pos, trying forward first (reads as the shoulder rolling forward, natural in a guard or
    a punch), then up, then outward (a sideways gap at the shoulder shows the most).
    """
    rot = value["rot"]
    pos = Vector(value["pos"])
    if not _arm_in_torso(side, rot, pos):
        return value
    s = 1.0 if side == "Right" else -1.0
    dirs = [Vector(d).normalized() for d in ((0.0, 0.0, -1.0), (0.0, 0.6, -0.8), (0.4 * s, 0.0, -0.9),
                                              (0.0, 1.0, 0.0), (0.7 * s, 0.0, -0.7), (s, 0.0, 0.0))]
    for step in range(1, 41):
        for d in dirs:
            p = pos + d * (0.02 * step)
            if not _arm_in_torso(side, rot, p):
                return {"rot": list(rot), "pos": list(p)}
    return value


def _val(v):
    """Normalize a joint value (None, rot list or {"rot", "pos"}) to a fresh {"rot", "pos"} dict."""
    if v is None:
        return {"rot": [0.0, 0.0, 0.0], "pos": [0.0, 0.0, 0.0]}
    if isinstance(v, dict):
        return {"rot": [float(a) for a in v["rot"]], "pos": [float(a) for a in v.get("pos", _ZERO)]}
    return {"rot": [float(a) for a in v], "pos": [0.0, 0.0, 0.0]}


def _arm(side, swing=0.0, spread=0.0, twist=0.0, pos=_ZERO):
    """Friendly arm/leg value from symmetric angles (clip.limb) plus an optional offset."""
    return {"rot": limb(side, swing, spread, twist), "pos": list(pos)}


_ARM_FORWARD = cfm.angles_deg(90.0, 0.0, 0.0).to_3x3()   # arm swung straight forward (axis along -Z)


def _aim(side, target, reach=0.25, up=None):
    """Arm value pointing the hand (bottom centre of the arm) at a torso-space point.

    The rotation is the shortest arc from the arm swung straight FORWARD (not from rest): near-forward aims
    differ by little twist (snappy strikes stay smooth) and cross-body aims are a pure yaw that keeps the arm
    in front of the chest. `up` (torso-space vector) instead fixes the twist so the grip axis (arm-local -Z,
    the weapon handle's +Y) points as close to it as possible, e.g. to hold a bow upright. Out-of-reach targets
    slide the shoulder up to `reach` studs along the aim.
    """
    _r, pivot, _v = _rest(side + " Arm")
    off = Vector((0.5 if side == "Right" else -0.5, 0.0, 0.0))   # the arm's axis is 0.5 outside the pivot
    target = Vector(target)
    start = pivot + off
    for _ in range(4):
        d = (target - start).normalized()
        u = Vector(up) - d * d.dot(Vector(up)) if up is not None else None
        if u is not None and u.length > 1e-6:
            u.normalize()   # columns: arm-local X, -Y (arm axis) -> d, -Z (grip) -> u
            rot = Matrix((d.cross(u), -d, -u)).transposed()
        else:
            rot = Vector((0.0, 0.0, -1.0)).rotation_difference(d).to_matrix() @ _ARM_FORWARD
        start = pivot + rot @ off
    d = target - start
    shift = max(-reach, min(reach, d.length - 1.5))
    return {"rot": list(cfm.to_angles_deg(rot.to_4x4())), "pos": list(d.normalized() * shift)}


def _hand(side, target, reach=0.25):
    """Arm value aiming the hand at a torso-space point (a ready value dict passes through)."""
    if isinstance(target, dict):
        return target
    return _aim(side, target, reach)


def _reach(side, point, reach=0.25):
    """Arm aimed at a CHARACTER-space point, resolved by _body once the torso is placed."""
    return lambda torso_cf: _aim(side, torso_cf.inverted() @ Vector(point), reach)


def _choice(name, value, allowed):
    if value not in allowed:
        raise ValueError("%s must be one of %s, got %r" % (name, list(allowed), value))
    return value


class _Seq:
    """Sequential key authoring in seconds. `to()` sets the curve of the segment arriving at the new key."""

    def __init__(self, clip, speed):
        self.clip = clip
        self.rate = clip.fps / max(0.05, float(speed))
        self.t = 0.0
        self.frame = 0

    def start(self, joints):
        self.clip.key(0, joints)
        return 0

    def to(self, dt, joints, interp="BEZIER", easing="AUTO"):
        prev = self.frame
        self.t += dt
        self.frame = max(int(math.floor(self.t * self.rate + 0.5)), prev + 1)
        k = self.clip.keys[prev]
        k["interp"], k["easing"] = interp, easing
        self.clip.key(self.frame, joints)
        return self.frame

    def event(self, name, value=""):
        self.clip.event(self.frame, name, value)


def _clip(name, fps, description, loop=False, weapon=None):
    return Clip(name, 0, fps, loop=loop, priority="Action", description=description,
                weapon=dict(weapon) if weapon else None)


def _lerp(a, b, t):
    """Blend two pose arguments: numbers, number tuples (targets, angles) or {"rot", "pos"} values."""
    if isinstance(a, (int, float)) and isinstance(b, (int, float)):
        return a + (b - a) * t
    if isinstance(a, (tuple, list)) and isinstance(b, (tuple, list)):
        return tuple(x + (y - x) * t for x, y in zip(a, b))
    if isinstance(a, dict) and isinstance(b, dict) and "rot" in a and "rot" in b:
        return {"rot": list(_lerp(a["rot"], b["rot"], t)),
                "pos": list(_lerp(a.get("pos", _ZERO), b.get("pos", _ZERO), t))}
    return a if t < 0.5 else b


def _mixkw(a, b, t):
    """Blend two keyword-argument dicts of a pose builder (a key missing on one side keeps the other's)."""
    return {k: _lerp(a.get(k, b.get(k)), b.get(k, a.get(k)), t) for k in set(a) | set(b)}


def _quad_drive(s, dt, build, a, b, mix=_mixkw):
    """QUAD ease-in from pose args `a` to `b`, keyed at t = 0.5 and 0.75 of x = t^2 with every key rebuilt.

    Interpolating joint angles cannot keep planted feet on the ground through a large torso move; re-solving
    two breakdowns along the same ease keeps them planted while the timing stays a quadratic acceleration.
    """
    s.to(dt * 0.5, build(**mix(a, b, 0.25)), "QUAD", "EASE_IN")
    s.to(dt * 0.25, build(**mix(a, b, 0.5625)), "LINEAR")
    s.to(dt * 0.25, build(**b), "LINEAR")


# ---------------------------------------------------------------------------------------------
# Unarmed: orthodox fighting stance (left foot and left fist forward, torso turned right)
# ---------------------------------------------------------------------------------------------

_G_TORSO = (-6.0, -16.0, 0.0)
_G_SINK = 0.08
_G_LOOK = (-4.0, 0.0, 0.0)
_G_LFOOT = (-0.62, -0.62, -6.0)
_G_RFOOT = (0.72, 0.58, -32.0)
_G_LHAND = (-0.42, 1.3, -1.4)
_G_RHAND = (0.42, 1.2, -1.05)


_G = {"torso": _G_TORSO, "shift": (0.0, 0.0), "sink": _G_SINK, "look": _G_LOOK, "rhand": _G_RHAND,
      "lhand": _G_LHAND, "rreach": 0.25, "lreach": 0.25, "rfoot": _G_RFOOT, "lfoot": _G_LFOOT, "rleg": None}


def _fighter(**kw):
    """Pose in the fighting stance from overrides of the guard `_G`.

    Hands are torso-space fist targets (or ready arm values); rleg=<value> lifts the right foot off the ground.
    """
    a = dict(_G, **kw)
    feet = {"Left": a["lfoot"]}
    legs = None
    if a["rleg"] is None:
        feet["Right"] = a["rfoot"]
    else:
        legs = {"Right": a["rleg"]}
    return _body(a["torso"], a["shift"], a["sink"], feet=feet, legs=legs, look=a["look"],
                 rarm=_hand("Right", a["rhand"], a["rreach"]), larm=_hand("Left", a["lhand"], a["lreach"]))


def _mix(a, b, t):
    """Blend two guard-override dicts; the blended pose is rebuilt by _fighter, so feet stay planted."""
    return {k: _lerp(a.get(k, _G[k]), b.get(k, _G[k]), t) for k in set(a) | set(b)}


def _target(height):
    """(fist height in torso space, extra dip) for a head or body shot."""
    _choice("height", height, ("head", "body"))
    return (0.95, 0.0) if height == "head" else (0.05, 0.16)


def _cocked(side, hit, dist=1.2, lift=0.1):
    """Wind-up fist target: on the line from the shoulder to `hit`, pulled back to `dist` studs (the shoulder
    retracts), slightly raised. Loading along the strike line keeps the snap a short, fast rotation."""
    start = _rest(side + " Arm")[1] + Vector((0.5 if side == "Right" else -0.5, 0.0, 0.0))
    p = start + (Vector(hit) - start).normalized() * dist + Vector((0.0, lift, 0.0))
    return (p.x, p.y, p.z)


def _jab(p, height):
    """Lead-hand jab overrides (wind, hit, follow): the lead shoulder drives forward, torso turns right."""
    hy, dip = _target(height)
    wind = dict(torso=(-5.0, -16.0 + 3.0 * p, 0.0), shift=(0.0, 0.04 * p), sink=_G_SINK + 0.02,
                lhand=_cocked("Left", (-0.1, hy, -3.2), 1.25, 0.15), look=(-4.0, 1.0, 0.0))
    hit = dict(torso=(-9.0 - 4.0 * p - 40.0 * dip, -16.0 - 9.0 * p, 2.0 * p), shift=(-0.03, -0.12 * p),
               sink=_G_SINK + 0.05 * p + dip, lhand=(-0.1, hy, -3.2), lreach=0.42,
               rhand=(0.4, 1.12, -1.05), look=(-3.0, 0.0, 0.0))
    follow = dict(torso=(-10.0 - 4.0 * p - 40.0 * dip, -16.0 - 12.0 * p, 2.0 * p), shift=(-0.03, -0.15 * p),
                  sink=_G_SINK + 0.07 * p + dip, lhand=(-0.12, hy - 0.04, -3.3), lreach=0.47,
                  rhand=(0.4, 1.12, -1.05), look=(-4.0, -1.0, 0.0))
    return wind, hit, follow


def _cross(p, height):
    """Rear-hand cross overrides: hips/torso unwind, the rear foot pivots, the lead hand chambers."""
    hy, dip = _target(height)
    wind = dict(torso=(-6.0, -16.0 - 11.0 * p, 0.0), shift=(0.03, 0.1 * p), sink=_G_SINK + 0.02,
                rhand=_cocked("Right", (0.05, hy, -3.3)), lhand=(-0.4, 1.25, -1.5), look=(-4.0, 2.0, 0.0),
                rfoot=(0.72, 0.58, -34.0))
    hit = dict(torso=(-10.0 - 40.0 * dip, -16.0 + 13.0 * p, -3.0 * p), shift=(-0.02, -0.14 * p),
               sink=_G_SINK + 0.06 * p + dip, rhand=(0.05, hy, -3.3), rreach=0.45,
               lhand=(-0.36, 1.18, -1.0), look=(-5.0, 0.0, 0.0), rfoot=(0.72, 0.58, -12.0))
    follow = dict(torso=(-12.0 - 40.0 * dip, -16.0 + 19.0 * p, -4.0 * p), shift=(-0.03, -0.19 * p),
                  sink=_G_SINK + 0.09 * p + dip, rhand=(0.0, hy - 0.05, -3.4), rreach=0.5,
                  lhand=(-0.36, 1.18, -1.0), look=(-5.0, -2.0, 0.0), rfoot=(0.72, 0.58, -8.0))
    return wind, hit, follow


def _hook(p):
    """Lead hook overrides: the arm keeps its bent shape and the torso swing draws the arc."""
    wind = dict(torso=(-8.0, -16.0 + 24.0 * p, 2.0), shift=(0.02, -0.04), sink=_G_SINK + 0.05,
                lhand=(-0.75, 1.0, -1.5), lreach=0.15, rhand=(0.4, 1.15, -1.05), look=(-4.0, 3.0, 0.0),
                lfoot=(-0.62, -0.62, 4.0), rfoot=(0.72, 0.58, -12.0))
    hit = dict(torso=(-10.0, -16.0 - 2.0 * p, -4.0 * p), shift=(-0.02, -0.08), sink=_G_SINK + 0.08,
               lhand=(-0.25, 0.95, -1.75), lreach=0.2, rhand=(0.4, 1.15, -1.05), look=(-5.0, 0.0, 0.0),
               lfoot=(-0.62, -0.62, -18.0), rfoot=(0.72, 0.58, -30.0))
    follow = dict(torso=(-11.0, -16.0 - 8.0 * p, -5.0 * p), shift=(-0.02, -0.09), sink=_G_SINK + 0.1,
                  lhand=(-0.05, 0.92, -1.7), lreach=0.2, rhand=(0.4, 1.15, -1.05), look=(-5.0, -2.0, 0.0),
                  lfoot=(-0.62, -0.62, -22.0), rfoot=(0.72, 0.58, -32.0))
    return wind, hit, follow


def _uppercut(p):
    """Rear uppercut overrides: dip and drop the fist, then rise and scoop it up on a forward arc."""
    wind = dict(torso=(-4.0 - 16.0 * p, -16.0 - 14.0 * p, -8.0 * p), shift=(0.1 * p, 0.02),
                sink=_G_SINK + 0.2 * p, rhand=(0.85, -0.25, -1.05), rreach=0.15,
                lhand=(-0.4, 1.25, -1.3), look=(-3.0, 2.0, 0.0), rfoot=(0.72, 0.58, -36.0))
    hit = dict(torso=(4.0 * p, -16.0 + 18.0 * p, 6.0 * p), shift=(-0.02, -0.12 * p), sink=_G_SINK,
               rhand=(0.05, 1.55, -1.75), rreach=0.3, lhand=(-0.35, 1.2, -1.05), look=(-2.0, 0.0, 0.0),
               rfoot=(0.72, 0.58, -14.0))
    follow = dict(torso=(8.0 * p, -16.0 + 22.0 * p, 7.0 * p), shift=(-0.03, -0.14 * p),
                  sink=max(0.0, _G_SINK - 0.04), rhand=(0.0, 1.9, -1.35), rreach=0.3,
                  lhand=(-0.35, 1.2, -1.05), look=(-1.0, -2.0, 0.0), rfoot=(0.72, 0.58, -10.0))
    return wind, hit, follow


# (overrides builder, snap seconds, snap curve, wind-up seconds). Short arcs snap with EXPO ease-in; the
# uppercut's long scoop is a QUAD ease-in drive (`_quad_drive`, re-solved breakdowns keep the feet planted).
_STRIKES = {"jab": (_jab, 0.05, ("EXPO", "EASE_IN"), 0.1), "cross": (_cross, 0.067, ("EXPO", "EASE_IN"), 0.12),
            "hook": (_hook, 0.067, ("EXPO", "EASE_IN"), 0.1), "uppercut": (_uppercut, 0.117, ("QUAD", "EASE_IN"), 0.15)}


def _strike(s, kind, wind, hit, follow, load, value=""):
    """Append the wind-up, snap (with the 'Hit' event) and follow-through keys of one strike."""
    _fn, snap, curve, _load = _STRIKES[kind]
    s.to(load, _fighter(**wind))
    if curve[0] == "QUAD":
        _quad_drive(s, snap, _fighter, wind, hit, _mix)
    else:
        s.to(snap, _fighter(**hit), *curve)
    s.event("Hit", value)
    s.to(0.05, _fighter(**follow), "QUAD", "EASE_OUT")


def _single_strike(name, description, kind, fps, speed, p, height, recovery):
    """Guard -> wind-up -> snap -> 'Hit' -> follow-through -> recoil -> settle back into the guard."""
    fn, _snap, _curve, load = _STRIKES[kind]
    wind, hit, follow = fn(p, height) if kind in ("jab", "cross") else fn(p)
    c = _clip(name, fps, description)
    s = _Seq(c, speed)
    s.start(_fighter())
    _strike(s, kind, wind, hit, follow, load)
    s.to(0.1, _fighter(**_mix(follow, {}, 0.7)), "CUBIC", "EASE_OUT")
    s.to(max(0.08, float(recovery)), _fighter(), "BACK", "EASE_OUT")
    return c


_STRIKE_PARAMS = {
    "power": {"default": 1.0, "description": "Wind-up, torso drive and follow-through amount (0.5 light .. 1.5 heavy)."},
    "height": {"default": "head", "description": "Target: 'head' (fist at head height) or 'body' (dips and leans in)."},
    "recovery": {"default": 0.3, "description": "Seconds to settle back into the guard after the recoil."},
}


@preset("punch_left", "unarmed", "Lead-hand jab from an orthodox guard (left foot forward): tiny load, 3-frame "
        "EXPO snap with shoulder reach, 'Hit' on contact, quick recoil and settle to the guard. Starts and ends "
        "in the guard so it chains with punch_right.", params=dict(_STRIKE_PARAMS, recovery={
            "default": 0.22, "description": "Seconds to settle back into the guard after the recoil."}))
def punch_left(fps=60, speed=1.0, intensity=1.0, power=1.0, height="head", recovery=0.22):
    return _single_strike("PunchLeft", "Lead jab (unarmed), guard to guard.", "jab", fps, speed,
                          float(power) * float(intensity), height, recovery)


@preset("punch_right", "unarmed", "Rear-hand cross from the orthodox guard: torso coils right with the weight on "
        "the back foot, 4-frame EXPO snap (hips unwind, back foot pivots, lead hand chambers to the chin), 'Hit' "
        "on contact with a weight drop, follow-through, recoil and settle to the guard.", params=_STRIKE_PARAMS)
def punch_right(fps=60, speed=1.0, intensity=1.0, power=1.0, height="head", recovery=0.3):
    return _single_strike("PunchRight", "Rear cross (unarmed), guard to guard.", "cross", fps, speed,
                          float(power) * float(intensity), height, recovery)


@preset("uppercut", "unarmed", "Rear uppercut: dips and drops the right fist to the belly, then rises and scoops "
        "it up on a forward arc (QUAD ease-in drive, 7 frames), 'Hit' at chin height, leans back on the "
        "follow-through and settles to the guard.", params={
            "power": _STRIKE_PARAMS["power"],
            "recovery": {"default": 0.32, "description": "Seconds to settle back into the guard."}})
def uppercut(fps=60, speed=1.0, intensity=1.0, power=1.0, recovery=0.32):
    return _single_strike("Uppercut", "Rear uppercut (unarmed), guard to guard.", "uppercut", fps, speed,
                          float(power) * float(intensity), "head", recovery)


@preset("punch_combo", "unarmed", "Boxing combination from the orthodox guard: jab, cross, then lead hook and rear "
        "uppercut (hits=2..4). Each follow-through flows into the next wind-up; 'Hit' events carry the hit "
        "number ('1'..'4') and 'End' marks the return to the guard.", params={
            "hits": {"default": 3, "description": "2 = jab-cross, 3 = + lead hook, 4 = + rear uppercut."},
            "power": _STRIKE_PARAMS["power"],
            "tempo": {"default": 1.0, "description": "Rhythm between strikes (>1 faster, <1 slower); snaps keep "
                      "their speed."},
            "height": _STRIKE_PARAMS["height"]})
def punch_combo(fps=60, speed=1.0, intensity=1.0, hits=3, power=1.0, tempo=1.0, height="head"):
    hits = int(hits)
    if not 2 <= hits <= 4:
        raise ValueError("hits must be 2, 3 or 4")
    p = float(power) * float(intensity)
    gap = 1.0 / max(0.25, float(tempo))
    c = _clip("PunchCombo", fps, "%d-hit boxing combo (unarmed), guard to guard." % hits)
    s = _Seq(c, speed)
    s.start(_fighter())
    kinds = ("jab", "cross", "hook", "uppercut")[:hits]
    follow = None
    for i, kind in enumerate(kinds):
        fn, _snap, _curve, load = _STRIKES[kind]
        wind, hit, follow = fn(p, height) if kind in ("jab", "cross") else fn(p)
        _strike(s, kind, wind, hit, follow, (load * 0.7 if i == 0 else load * gap), str(i + 1))
    s.to(0.1, _fighter(**_mix(follow, {}, 0.7)), "CUBIC", "EASE_OUT")
    s.to(0.3, _fighter(), "BACK", "EASE_OUT")
    s.event("End")
    return c


@preset("kick", "unarmed", "Rear-leg front kick from the orthodox guard: weight shifts over the lead foot (which "
        "stays planted), knee chamber, 4-frame EXPO snap to ~90 deg with the torso leaning back and the right "
        "arm counterbalancing, 'Hit', retract to the chamber, plant and settle to the guard.", params={
            "power": _STRIKE_PARAMS["power"],
            "height": {"default": "body", "description": "'body' (leg ~88 deg) or 'head' (leg ~104 deg, more lean)."},
            "recovery": {"default": 0.3, "description": "Seconds to settle back into the guard."}})
def kick(fps=60, speed=1.0, intensity=1.0, power=1.0, height="body", recovery=0.3):
    _choice("height", height, ("body", "head"))
    p = float(power) * float(intensity)
    top = 88.0 if height == "body" else 104.0
    lean = 14.0 if height == "body" else 22.0
    c = _clip("Kick", fps, "Rear front kick (unarmed), guard to guard.")
    s = _Seq(c, speed)
    s.start(_fighter())
    over = (-0.34, -0.3)   # torso above the lead foot
    s.to(0.12, _fighter(torso=(-2.0, -12.0, 4.0 * p), shift=(-0.2, -0.18), sink=_G_SINK + 0.03,
                        rhand=_arm("Right", 45.0, 14.0), look=(-4.0, 2.0, 0.0)))
    s.to(0.13, _fighter(torso=(6.0 * p, -8.0, 5.0 * p), shift=over, sink=0.02,
                        rleg=_arm("Right", top - 26.0, 6.0, 4.0), rhand=_arm("Right", -6.0, 14.0),
                        lhand=(-0.42, 1.25, -1.3), look=(-6.0, 3.0, 0.0)))
    s.to(0.067, _fighter(torso=(lean * p, -5.0, 6.0 * p), shift=(over[0], over[1] - 0.06), sink=0.0,
                         rleg=_arm("Right", top, 4.0, 2.0), rhand=_arm("Right", -22.0, 18.0),
                         lhand=(-0.4, 1.25, -1.25), look=(-8.0, 0.0, 0.0)), "EXPO", "EASE_IN")
    s.event("Hit")
    s.to(0.05, _fighter(torso=(lean * p + 3.0, -5.0, 6.0 * p), shift=(over[0], over[1] - 0.08), sink=0.0,
                        rleg=_arm("Right", top + 4.0, 4.0, 2.0), rhand=_arm("Right", -25.0, 19.0),
                        lhand=(-0.4, 1.25, -1.25), look=(-8.0, 0.0, 0.0)), "QUAD", "EASE_OUT")
    s.to(0.1, _fighter(torso=(5.0 * p, -8.0, 5.0 * p), shift=over, sink=0.02,
                       rleg=_arm("Right", 50.0, 5.0, 2.0), rhand=_arm("Right", 6.0, 14.0),
                       lhand=(-0.42, 1.25, -1.3), look=(-5.0, 2.0, 0.0)), "CUBIC", "EASE_OUT")
    s.to(0.1, _fighter(torso=(1.0, -10.0, 3.0 * p), shift=(-0.24, -0.12), sink=0.0,
                       rleg=_arm("Right", 18.0, 4.0, -4.0), rhand=_arm("Right", 40.0, 14.0),
                       look=(-4.0, 1.0, 0.0)))
    s.to(0.1, _fighter(torso=(-6.0, -14.0, 0.0), shift=(-0.04, 0.02), sink=_G_SINK + 0.06,
                       rhand=(0.75, 0.55, -1.0), look=(-4.0, 0.0, 0.0)))
    s.to(max(0.08, recovery), _fighter(), "BACK", "EASE_OUT")
    return c


@preset("block_unarmed", "unarmed", "Unarmed block from the orthodox guard: snaps both forearms up (BACK ease-out), "
        "hunches and braces with breathing while held, then lowers back to the guard. 'BlockStart' when the "
        "arms are up, 'BlockEnd' when they start to lower.", params={
            "hold_time": {"default": 0.6, "description": "Seconds the block is held."},
            "height": {"default": "high", "description": "'high' (forearms shield the face) or 'mid' (forearms "
                       "cross in front of the chest/ribs)."},
            "recovery": {"default": 0.22, "description": "Seconds to lower back into the guard."}})
def block_unarmed(fps=60, speed=1.0, intensity=1.0, hold_time=0.6, height="high", recovery=0.22):
    _choice("height", height, ("high", "mid"))
    k = float(intensity)
    if height == "high":   # shell: forearms stacked in front of the face, fists above the brow
        lhand, rhand, look = (-0.3, 2.25, -0.8), (0.3, 2.15, -0.75), (-14.0, 0.0, 0.0)
    else:                  # forearms crossed in front of the ribs, elbows tucked
        lhand, rhand, look = (0.15, 0.35, -1.35), (-0.05, 0.6, -1.3), (-6.0, 0.0, 0.0)
    c = _clip("BlockUnarmed", fps, "Unarmed %s block, guard to guard." % height)
    s = _Seq(c, speed)
    guard = _fighter()
    s.start(guard)

    def blocked(brace):
        return _fighter(torso=(-8.0 - 10.0 * k - 2.0 * brace, -8.0, 0.0), shift=(0.0, 0.05 * k),
                        sink=_G_SINK + 0.12 * k + 0.03 * brace, lhand=lhand, rhand=rhand, lreach=0.2, rreach=0.2,
                        look=(look[0] - 2.0 * brace, 0.0, 0.0))

    s.to(0.1, blocked(1.0), "BACK", "EASE_OUT")
    s.event("BlockStart")
    hold = max(0.1, float(hold_time))
    s.to(hold * 0.5, blocked(0.4))
    s.to(hold * 0.5, blocked(0.8))
    s.event("BlockEnd")
    s.to(max(0.08, recovery), guard)
    return c


# ---------------------------------------------------------------------------------------------
# Bow (held in the LEFT hand; the right hand draws the string to the face)
# ---------------------------------------------------------------------------------------------

# String hand at full draw, in HEAD space: at the jaw line, right of the chin, a little in front of the face
# (low enough that the bow arm stays near level: R6 shoulders sit a stud below the eyes).
_BOW_ANCHOR = Vector((0.3, -0.6, -1.0))
_BOW_FEET = {"Left": (-0.5, -0.6, -20.0), "Right": (0.5, 0.15, -50.0)}   # left foot stepped toward the target


def _bow_pose(phase, pitch, turn, breath=0.0, drift=(0.0, 0.0)):
    """Archer pose (bow in the left hand), all aims in torso space.

    phase: 'nock' (string hand at the bow, torso 65% turned), 'draw' (full draw, string hand at the anchor),
    'release' (string hand flown back), 'follow' (relaxed follow-through). pitch: aim up (+) / down (-) in
    degrees; turn: torso turned right (deg) so the left shoulder faces the target. The head keeps looking at
    the target and the bow hand sits on the arrow line (anchor -> target) at full arm's length.
    """
    t = turn * (0.65 if phase == "nock" else 1.0)
    torso = (0.3 * pitch + 0.8 * breath, -t, 0.0)
    look = (pitch, 0.0, 0.0 if phase == "nock" else -5.0)
    head = cfm.angles_deg(*torso).to_3x3().inverted() @ cfm.angles_deg(*look).to_3x3()
    aim = head @ Vector((0.0, 0.0, -1.0))
    side = head @ Vector((1.0, 0.0, 0.0))
    anchor = Vector((0.0, 1.5, 0.0)) + head @ _BOW_ANCHOR
    _r, lpivot, lv0 = _rest("Left Arm")
    radius = lv0.length + 0.15
    u = anchor - lpivot
    b = u.dot(aim)
    dist = -b + math.sqrt(max(0.0, b * b - u.length_squared + radius * radius))
    if dist >= 1.2:
        bow_hand = anchor + aim * dist
    else:  # torso barely turned: the arrow line passes too close to the bow shoulder, point the arm instead
        bow_hand = lpivot + aim * radius
    bow_hand += Vector((drift[0], drift[1], 0.0))
    if phase == "nock":
        string = bow_hand - aim * 0.5
    elif phase == "draw":
        string = anchor.copy()
    elif phase == "release":   # the string hand flies back past the jaw and out
        string = anchor - aim * 0.2 + side * 0.65 + Vector((0.0, 0.05, 0.0))
        bow_hand += Vector((0.0, -0.08, 0.0)) + aim * 0.04
    else:
        string = anchor - aim * 0.2 + side * 0.9 + Vector((0.0, -0.15, 0.0))
        bow_hand += Vector((0.0, -0.12, 0.0))
    upright = cfm.angles_deg(*torso).to_3x3().inverted() @ Vector((0.0, 1.0, 0.0))   # world up, torso space
    return _body(torso, shift=(0.0, 0.01 * breath), sink=0.05, feet=_BOW_FEET, look=look,
                 larm=_aim("Left", bow_hand, 0.2, up=upright), rarm=_aim("Right", string, 0.4))


_BOW_PARAMS = {
    "aim_pitch": {"default": 0.0, "description": "Aim angle in degrees (+ up, - down)."},
    "stance_turn": {"default": 65.0, "description": "Torso turned right (deg) so the left shoulder faces the target."},
}


@preset("bow_draw", "bow", "Bow in the LEFT hand: raises the bow arm toward the target, nocks with the right hand "
        "('Nock'), then draws the string back to the chin while the torso turns side-on and the head sights "
        "down the arrow; ends at full draw ('FullDraw'), the pose bow_aim holds and bow_release starts from.",
        params=dict(_BOW_PARAMS, **{
            "draw_time": {"default": 0.55, "description": "Seconds from nock to full draw."},
            "from_rest": {"default": True, "description": "Start with the bow lowered at rest (False: start "
                          "from the nocked pose, e.g. after bow_release with lower=False)."}}), weapon=_BOW)
def bow_draw(fps=60, speed=1.0, intensity=1.0, aim_pitch=0.0, stance_turn=65.0, draw_time=0.55, from_rest=True):
    k = float(intensity)
    turn = float(stance_turn)
    c = _clip("BowDraw", fps, "Bow draw to full draw (bow in the left hand).", weapon=_BOW)
    s = _Seq(c, speed)
    nock = _bow_pose("nock", aim_pitch, turn)
    if from_rest:
        s.start(_body())
        # step the left foot toward the target while the bow comes up and the right hand reaches for it
        lift = _body((2.0 * k, -turn * 0.3, 0.0), sink=0.04, look=(0.0, 0.0, 0.0),
                     feet={"Right": (0.5, 0.08, -25.0)}, legs={"Left": _arm("Left", 22.0, 4.0)},
                     larm=_arm("Left", 55.0, 12.0), rarm=_arm("Right", 55.0, 4.0))
        s.to(0.18, lift)
        s.to(0.14, nock)
    else:
        s.start(nock)
    s.event("Nock")
    full = _bow_pose("draw", aim_pitch, turn)
    s.to(0.06, _bow_pose("nock", aim_pitch, turn))
    over = _bow_pose("draw", aim_pitch, turn, breath=-0.6 * k)
    s.to(max(0.15, float(draw_time)), over, "SINE", "EASE_IN_OUT")
    s.to(0.12, full)
    s.event("FullDraw")
    return c


@preset("bow_aim", "bow", "Holds full draw (bow in the LEFT hand) as a loop: slow breathing in the torso, tiny bow-"
        "arm drift and the head locked on the target. Same pose as the end of bow_draw.",
        params=dict(_BOW_PARAMS, **{
            "breath": {"default": 1.0, "description": "Breathing / drift amplitude (0 = frozen)."},
            "cycle": {"default": 2.0, "description": "Loop length in seconds (one breath)."}}),
        weapon=_BOW, loop=True)
def bow_aim(fps=60, speed=1.0, intensity=1.0, aim_pitch=0.0, stance_turn=65.0, breath=1.0, cycle=2.0):
    b = float(breath) * float(intensity)
    q = max(0.4, float(cycle)) / 4.0
    c = _clip("BowAim", fps, "Bow held at full draw (loop).", loop=True, weapon=_BOW)
    s = _Seq(c, speed)
    turn = float(stance_turn)
    s.start(_bow_pose("draw", aim_pitch, turn))
    s.to(q, _bow_pose("draw", aim_pitch, turn, breath=1.0 * b, drift=(0.0, 0.02 * b)), "SINE", "EASE_IN_OUT")
    s.to(q, _bow_pose("draw", aim_pitch, turn, breath=0.3 * b, drift=(-0.015 * b, 0.0)), "SINE", "EASE_IN_OUT")
    s.to(q, _bow_pose("draw", aim_pitch, turn, breath=-0.4 * b, drift=(0.01 * b, -0.015 * b)), "SINE",
         "EASE_IN_OUT")
    s.to(q, _bow_pose("draw", aim_pitch, turn), "SINE", "EASE_IN_OUT")
    c.close_loop()
    return c


@preset("bow_release", "bow", "Looses the arrow from full draw (bow in the LEFT hand): 2-frame back tension, "
        "'Release', the string hand snaps back past the jaw, the bow arm kicks down slightly, follow-through "
        "hold, then lowers the bow to rest (or stays raised and nocked, lower=False, for bow_draw "
        "from_rest=False).", params=dict(_BOW_PARAMS, **{
            "follow_through": {"default": 0.3, "description": "Seconds the follow-through is held."},
            "lower": {"default": True, "description": "End at rest (True) or back at the nocked pose (False)."}}),
        weapon=_BOW)
def bow_release(fps=60, speed=1.0, intensity=1.0, aim_pitch=0.0, stance_turn=65.0, follow_through=0.3,
                lower=True):
    k = float(intensity)
    turn = float(stance_turn)
    c = _clip("BowRelease", fps, "Bow release from full draw (bow in the left hand).", weapon=_BOW)
    s = _Seq(c, speed)
    s.start(_bow_pose("draw", aim_pitch, turn))
    s.to(0.034, _bow_pose("draw", aim_pitch, turn, breath=-0.5 * k))
    s.event("Release")
    snap = _bow_pose("release", aim_pitch, turn, breath=1.5 * k)
    s.to(0.05, snap, "QUAD", "EASE_OUT")
    s.to(0.08, _bow_pose("follow", aim_pitch, turn, breath=1.0 * k), "QUAD", "EASE_OUT")
    s.to(max(0.05, float(follow_through)), _bow_pose("follow", aim_pitch, turn, breath=0.6 * k))
    if lower:  # lower the bow and step the left foot back
        s.to(0.25, _body((1.0, -turn * 0.3, 0.0), sink=0.04, look=(0.0, 0.0, 0.0),
                         feet={"Right": (0.5, 0.08, -25.0)}, legs={"Left": _arm("Left", 16.0, 4.0)},
                         larm=_arm("Left", 35.0, 8.0), rarm=_arm("Right", 18.0, 16.0)))
        s.to(0.3, _body())
    else:
        s.to(0.35, _bow_pose("nock", aim_pitch, turn))
    return c


# ---------------------------------------------------------------------------------------------
# Magic
# ---------------------------------------------------------------------------------------------

_CAST_FEET = {"Left": (-0.6, -0.42, -4.0), "Right": (0.62, 0.42, -22.0)}


def _caster(torso, shift=(0.0, 0.0), sink=0.06, rhand=None, lhand=None, rreach=0.25, lreach=0.25,
            look=(0.0, 0.0, 0.0), feet=None):
    return _body(torso, shift, sink, feet=feet or _CAST_FEET, look=look,
                 rarm=None if rhand is None else _hand("Right", rhand, rreach),
                 larm=None if lhand is None else _hand("Left", lhand, lreach))


_CAST_PARAMS = {
    "charge_time": {"default": 0.35, "description": "Seconds spent gathering energy before the release."},
    "power": {"default": 1.0, "description": "Size of the weight shift, wind-up and recoil."},
    "recovery": {"default": 0.4, "description": "Seconds to settle back to rest after the cast."},
}


@preset("cast_forward", "magic", "Projectile cast: casting stance, the hands open out then cup energy at the belly "
        "while the weight shifts back and the torso coils right, then thrust at the target (QUAD ease-in drive), "
        "'Cast' at full extension, recoil and settle to rest. 'Charge' when the energy is gathered.",
        params=dict(_CAST_PARAMS, hands={
            "default": "both", "description": "'both' (two-handed blast) or 'right' (one-handed palm strike from "
                                              "the hip, the left hand points the way)."}))
def cast_forward(fps=60, speed=1.0, intensity=1.0, charge_time=0.35, power=1.0, recovery=0.4, hands="both"):
    _choice("hands", hands, ("both", "right"))
    p = float(power) * float(intensity)
    ch = max(0.1, float(charge_time))
    c = _clip("CastForward", fps, "Forward projectile cast (%s hands), rest to rest." % hands)
    s = _Seq(c, speed)
    if hands == "both":   # hands open out and forward, then cup the energy in front of the belly
        opened = (_arm("Right", 30.0, 30.0), _arm("Left", 30.0, 30.0))
        gather, charge = ((0.6, -0.1, -1.75), (-0.05, 0.0, -1.8)), ((0.55, -0.05, -1.7), (0.02, 0.02, -1.75))
        thrust, recoil = ((0.28, 0.55, -3.0), (-0.28, 0.55, -3.0)), ((0.3, 0.75, -2.8), (-0.3, 0.75, -2.8))
        lreach, drive = 0.45, 0.083
    else:                 # right hand loads at the hip, left hand points the way
        opened = (_arm("Right", -10.0, 22.0), _arm("Left", 40.0, 10.0))
        gather, charge = ((1.35, -0.35, -0.75), (-0.4, 0.45, -1.55)), ((1.35, -0.3, -0.7), (-0.35, 0.45, -1.6))
        thrust, recoil = ((0.3, 0.6, -3.1), (-0.6, 0.0, -1.3)), ((0.3, 0.8, -2.9), (-0.6, 0.05, -1.3))
        lreach, drive = 0.2, 0.133

    def kw(torso, shift_z, sink, hands_, reach=0.25, look=0.0):
        return dict(torso=torso, shift=(0.05 if shift_z > 0 else 0.0, shift_z), sink=sink, rhand=hands_[0],
                    lhand=hands_[1], rreach=reach, lreach=min(reach, lreach) if hands == "right" else reach,
                    look=(look, 0.0, 0.0))

    s.start(_body())
    s.to(ch * 0.35, _caster(**kw((3.0 * p, -10.0 * p, 1.0 * p), 0.08 * p, 0.07, opened, look=1.0)))
    s.to(ch * 0.4, _caster(**kw((6.0 * p, -22.0 * p, 3.0 * p), 0.18 * p, 0.1, gather, look=2.0)))
    loaded = kw((8.0 * p, -26.0 * p, 3.0 * p), 0.22 * p, 0.13, charge, look=1.0)
    s.to(ch * 0.25, _caster(**loaded), "SINE", "EASE_IN_OUT")
    s.event("Charge")
    _quad_drive(s, drive, _caster, loaded, kw((-10.0 * p, 6.0 * p, -2.0 * p), -0.25 * p, 0.16, thrust, 0.45, -2.0))
    s.event("Cast")
    s.to(0.1, _caster(**kw((-5.0 * p, 4.0 * p, -1.0 * p), -0.17 * p, 0.13, recoil, 0.3, -1.0)), "QUAD", "EASE_OUT")
    s.to(0.12, _caster(**kw((-4.0 * p, 3.0 * p, -1.0 * p), -0.15 * p, 0.12, recoil, 0.25, -1.0)))
    rec = max(0.1, float(recovery))
    s.to(rec * 0.45, _caster((-2.0 * p, 1.0, 0.0), shift=(0.0, -0.06 * p), sink=0.07,
                             rhand=_arm("Right", 30.0, 10.0), lhand=_arm("Left", 30.0, 10.0)))
    s.to(rec * 0.55, _body())
    return c


@preset("cast_overhead", "magic", "Overhead cast: raises both arms above the head and charges (torso arched back, "
        "arms pulsing), extra wind-up, then whips the arms forward and down (QUAD ease-in drive) with the torso "
        "folding forward; 'Cast' as the hands pass head height, follow-through and settle to rest.",
        params=dict(_CAST_PARAMS, charge_time={"default": 0.45, "description": "Seconds spent charging overhead."}))
def cast_overhead(fps=60, speed=1.0, intensity=1.0, charge_time=0.45, power=1.0, recovery=0.4):
    p = float(power) * float(intensity)
    ch = max(0.1, float(charge_time))
    c = _clip("CastOverhead", fps, "Overhead cast (both hands), rest to rest.")
    s = _Seq(c, speed)

    def kw(swing, spread, lean, sink, shift_z, turn, look):
        return dict(torso=(lean, turn, 0.0), shift=(0.0, shift_z), sink=sink, rhand=_arm("Right", swing, spread),
                    lhand=_arm("Left", swing, spread), look=(look, 0.0, 0.0))

    s.start(_body())
    s.to(0.25, _caster(**kw(150.0, 20.0, 8.0 * p, 0.04, 0.1 * p, -6.0 * p, 6.0)))
    s.to(ch * 0.5, _caster(**kw(158.0, 26.0, 11.0 * p, 0.03, 0.12 * p, -6.0 * p, 6.0)), "SINE", "EASE_IN_OUT")
    s.event("Charge")
    s.to(ch * 0.5, _caster(**kw(154.0, 18.0, 10.0 * p, 0.05, 0.12 * p, -6.0 * p, 6.0)), "SINE", "EASE_IN_OUT")
    wind = kw(162.0, 12.0, 14.0 * p, 0.04, 0.16 * p, -6.0 * p, 6.0)
    s.to(0.08, _caster(**wind))
    _quad_drive(s, 0.15, _caster, wind, kw(80.0, 4.0, -14.0 * p, 0.14, -0.18 * p, 2.0, -2.0))
    s.event("Cast")
    s.to(0.1, _caster(**kw(62.0, 6.0, -20.0 * p, 0.17, -0.22 * p, 2.0, -4.0)), "QUAD", "EASE_OUT")
    s.to(0.15, _caster(**kw(50.0, 6.0, -12.0 * p, 0.12, -0.15 * p, 1.0, -2.0)))
    s.to(max(0.1, recovery), _body())
    return c


@preset("cast_ground_slam", "magic", "Ground slam: dips, raises both fists overhead and charges, hops, then drops "
        "into a wide crouch hammering both fists toward the ground in front (QUAD ease-in drive); 'Cast' on "
        "impact with a torso bounce, holds, pushes up and steps back to rest.", params=dict(_CAST_PARAMS, crouch={
            "default": 1.0, "description": "Depth of the landing crouch (0.5 shallow .. 1.5 deep)."},
            recovery={"default": 0.45, "description": "Seconds to push up and step back to rest."}))
def cast_ground_slam(fps=60, speed=1.0, intensity=1.0, charge_time=0.35, power=1.0, recovery=0.45, crouch=1.0):
    p = float(power) * float(intensity)
    cr = max(0.2, float(crouch))
    ch = max(0.1, float(charge_time))
    c = _clip("CastGroundSlam", fps, "Two-fist ground slam, rest to rest.")
    s = _Seq(c, speed)
    both = lambda swing, spread: {"rarm": _arm("Right", swing, spread), "larm": _arm("Left", swing, spread)}  # noqa
    s.start(_body())
    s.to(0.1, _body((-8.0 * p, 0.0, 0.0), sink=0.12 * p, look=(-4.0, 0.0, 0.0), **both(25.0, 8.0)))
    s.to(0.2, _body((8.0 * p, 0.0, 0.0), sink=0.0, look=(6.0, 0.0, 0.0), **both(124.0, 10.0)))
    s.event("Charge")
    s.to(ch, _body((11.0 * p, 0.0, 0.0), sink=0.02, look=(8.0, 0.0, 0.0), **both(130.0, 12.0)),
         "SINE", "EASE_IN_OUT")
    s.to(0.1, _body((12.0 * p, 0.0, 0.0), y=0.3 * p, feet={}, look=(6.0, 0.0, 0.0),
                    legs={"Right": _arm("Right", -6.0, 4.0), "Left": _arm("Left", 8.0, 4.0)}, **both(130.0, 10.0)),
         "QUAD", "EASE_OUT")
    wide = {"Left": (-1.1, -0.35, 12.0), "Right": (1.1, 0.35, -12.0)}

    def slam(lean, sink, fist_y, look):
        return _body((lean * p, 0.0, 0.0), sink=sink * cr, feet=wide, look=(look, 0.0, 0.0),
                     rarm=_reach("Right", (0.75, fist_y, -2.4), 0.35), larm=_reach("Left", (-0.75, fist_y, -2.4), 0.35))

    s.to(0.2, slam(-32.0, 0.16, -2.95, -26.0), "QUAD", "EASE_IN")
    s.event("Cast")
    s.to(0.07, slam(-28.0, 0.1, -2.7, -18.0), "QUAD", "EASE_OUT")
    s.to(0.15, slam(-30.0, 0.14, -2.85, -14.0))
    rec = max(0.12, float(recovery))
    s.to(rec * 0.35, _body((-17.0 * p, 0.0, 0.0), sink=0.1 * cr, feet=wide, look=(-6.0, 0.0, 0.0),
                           **both(18.0, 10.0)))
    s.to(rec * 0.3, _body((-6.0 * p, 0.0, 0.0), sink=0.04, look=(-2.0, 0.0, 0.0), feet={
        "Left": (-0.7, -0.15, 6.0), "Right": (0.7, 0.15, -6.0)}, **both(12.0, 8.0)))
    s.to(rec * 0.35, _body())
    return c


@preset("channel", "magic", "Channel loop: braced stance, arms held toward the target (or raised), energy pulses "
        "push the hands forward with a small torso recoil, breathing and a faint tremble. Seamless loop.",
        params={"hands": {"default": "both", "description": "'both' (arms forward), 'right' (right arm forward, "
                          "left hand bracing the forearm) or 'up' (both arms raised)."},
                "pulses": {"default": 2, "description": "Energy pulses per loop (1..4)."},
                "pulse": {"default": 1.0, "description": "Pulse / tremble amplitude (0 = steady hold)."},
                "cycle": {"default": 1.0, "description": "Loop length in seconds."}}, loop=True)
def channel(fps=60, speed=1.0, intensity=1.0, hands="both", pulses=2, pulse=1.0, cycle=1.0):
    _choice("hands", hands, ("both", "right", "up"))
    n = max(1, min(4, int(pulses)))
    a = float(pulse) * float(intensity)
    seg = max(0.4, float(cycle)) / n
    c = _clip("Channel", fps, "Channel loop (%s), %d pulses per cycle." % (hands, n), loop=True)
    s = _Seq(c, speed)

    def pose(push, tremble, breath):
        if hands == "both":
            rh, lh = (0.3 + 0.01 * tremble, 0.55 + 0.02 * tremble, -2.4), (-0.3, 0.55 - 0.02 * tremble, -2.4)
            rr = lr = 0.3 + 0.12 * push
        elif hands == "right":
            rh, lh = (0.15 + 0.01 * tremble, 0.6 + 0.02 * tremble, -2.5), (0.45, 0.05, -1.45)
            rr, lr = 0.3 + 0.12 * push, 0.25 + 0.05 * push
        else:
            rh = _arm("Right", 165.0 + 3.0 * push, 14.0 + 1.0 * tremble)
            lh = _arm("Left", 165.0 + 3.0 * push, 14.0 - 1.0 * tremble)
            rr = lr = 0.0
        lean = (-6.0 if hands != "up" else 4.0) - 2.5 * push
        return _caster((lean + 0.6 * breath, -8.0, 0.0), shift=(0.0, -0.03 * push), sink=0.08 - 0.015 * breath,
                       rhand=rh, lhand=lh, rreach=rr, lreach=lr, look=(-2.0 if hands != "up" else 6.0, 0.0, 0.0))

    s.start(pose(0.0, 0.0, 0.0))
    for i in range(n):
        breath = math.sin(math.pi * 2.0 * (i + 0.5) / n) if n > 1 else 1.0
        s.to(seg * 0.18, pose(a, a, breath * a), "QUAD", "EASE_OUT")
        s.to(seg * 0.42, pose(-0.3 * a, -a, breath * a * 0.6))
        s.to(seg * 0.4, pose(0.0, 0.0, 0.0) if i == n - 1 else pose(0.0, 0.4 * a, 0.0))
    c.close_loop()
    return c


# ---------------------------------------------------------------------------------------------
# Dodges and roll (Torso translation shows the burst; the game moves the HumanoidRootPart)
# ---------------------------------------------------------------------------------------------

_DODGE_PARAMS = {
    "distance": {"default": 1.5, "description": "Studs the torso travels before the root catches up (1..2)."},
    "hop": {"default": 0.22, "description": "Height of the hop in studs (feet leave the ground)."},
    "recovery": {"default": 0.3, "description": "Seconds to settle back to rest after landing."},
}


@preset("dodge_back", "dodge", "Back-step dodge: quick dip, push off the front foot, hop back (Torso +Z by "
        "`distance`, hips leading, arms up for balance), land wide and absorb, then settle back to rest. "
        "'IFrameStart' at push-off, 'IFrameEnd' after landing.", params=_DODGE_PARAMS)
def dodge_back(fps=60, speed=1.0, intensity=1.0, distance=1.5, hop=0.22, recovery=0.3):
    k = float(intensity)
    d = float(distance)
    c = _clip("DodgeBack", fps, "Backward dodge, rest to rest.")
    s = _Seq(c, speed)
    s.start(_body())
    s.to(0.05, _body((-7.0 * k, 0.0, 0.0), shift=(0.0, -0.06), sink=0.14 * k, look=(0.0, 0.0, 0.0),
                     rarm=_arm("Right", -6.0, 6.0), larm=_arm("Left", -6.0, 6.0)))
    s.to(0.05, _body((-9.0 * k, 0.0, 0.0), shift=(0.0, 0.32 * d), sink=0.04,
                     feet={"Left": (-0.5, 0.12, 0.0)}, legs={"Right": _arm("Right", -20.0, 4.0)},
                     rarm=_arm("Right", 24.0, 10.0), larm=_arm("Left", 24.0, 10.0), look=(0.0, 0.0, 0.0)),
         "QUAD", "EASE_IN")
    s.event("IFrameStart")
    s.to(0.1, _body((-11.0 * k, 0.0, 0.0), shift=(0.0, 0.78 * d), y=float(hop) * k, feet={},
                    legs={"Right": _arm("Right", -24.0, 6.0), "Left": _arm("Left", 22.0, 6.0)},
                    rarm=_arm("Right", 55.0, 14.0), larm=_arm("Left", 50.0, 14.0), look=(0.0, 0.0, 0.0)),
         "QUAD", "EASE_OUT")
    land_feet = {"Right": (0.58, d + 0.5, -10.0), "Left": (-0.52, d - 0.32, 6.0)}
    s.to(0.07, _body((-14.0 * k, 0.0, 0.0), shift=(0.0, d), sink=0.2 * k, feet=land_feet,
                     rarm=_arm("Right", 42.0, 12.0), larm=_arm("Left", 38.0, 12.0), look=(-2.0, 0.0, 0.0)),
         "QUAD", "EASE_IN")
    s.to(0.07, _body((-12.0 * k, 0.0, 0.0), shift=(0.0, d), sink=0.26 * k, feet=land_feet,
                     rarm=_arm("Right", 30.0, 10.0), larm=_arm("Left", 26.0, 10.0), look=(-3.0, 0.0, 0.0)),
         "QUAD", "EASE_OUT")
    s.event("IFrameEnd")
    s.to(0.1, _body((-6.0 * k, 0.0, 0.0), shift=(0.0, d * 0.75), sink=0.1 * k,
                    feet={"Right": (0.55, d * 0.75 + 0.3, -6.0), "Left": (-0.5, d * 0.75 - 0.2, 4.0)},
                    rarm=_arm("Right", 14.0, 6.0), larm=_arm("Left", 12.0, 6.0), look=(-1.0, 0.0, 0.0)))
    s.to(max(0.1, recovery), _body())
    return c


def _dodge_side(name, sgn, fps, speed, intensity, distance, hop, recovery):
    """Sideways dodge toward +X (sgn=1, right) or -X (sgn=-1, left)."""
    k = float(intensity)
    d = float(distance)
    lead, trail = ("Right", "Left") if sgn > 0 else ("Left", "Right")
    c = _clip(name, fps, "%s dodge, rest to rest." % ("Right" if sgn > 0 else "Left"))
    s = _Seq(c, speed)

    def arms(lead_spread, trail_spread, lead_swing, trail_swing):
        a = {lead: _arm(lead, lead_swing, lead_spread), trail: _arm(trail, trail_swing, trail_spread)}
        return {"rarm": a["Right"], "larm": a["Left"]}

    s.start(_body())
    s.to(0.05, _body((-5.0 * k, 0.0, 4.0 * sgn * k), shift=(-0.06 * sgn, 0.0), sink=0.13 * k,
                     look=(0.0, 0.0, 0.0), **arms(4.0, 4.0, 8.0, 8.0)))
    rest_trail = _REST_FEET[trail]
    s.to(0.05, _body((-6.0 * k, -4.0 * sgn * k, -8.0 * sgn * k), shift=(0.32 * d * sgn, 0.0), sink=0.03,
                     feet={trail: rest_trail}, legs={lead: _arm(lead, 4.0, 16.0)}, look=(0.0, 0.0, 0.0),
                     **arms(28.0, 10.0, 25.0, 15.0)), "QUAD", "EASE_IN")
    s.event("IFrameStart")
    s.to(0.1, _body((-6.0 * k, -6.0 * sgn * k, -14.0 * sgn * k), shift=(0.78 * d * sgn, 0.0),
                    y=float(hop) * k, feet={}, legs={lead: _arm(lead, 6.0, 18.0), trail: _arm(trail, -4.0, 16.0)},
                    look=(0.0, 0.0, 0.0), **arms(40.0, 30.0, 35.0, 20.0)), "QUAD", "EASE_OUT")
    land = {lead: (sgn * (d + 0.85), 0.08, -6.0 * sgn), trail: (sgn * (d - 0.32), -0.06, 4.0 * sgn)}
    s.to(0.07, _body((-9.0 * k, -6.0 * sgn * k, -9.0 * sgn * k), shift=(d * sgn, 0.0), sink=0.18 * k, feet=land,
                     look=(-2.0, 0.0, 0.0), **arms(30.0, 22.0, 30.0, 18.0)), "QUAD", "EASE_IN")
    s.to(0.07, _body((-8.0 * k, -4.0 * sgn * k, -5.0 * sgn * k), shift=(d * sgn, 0.0), sink=0.24 * k, feet=land,
                     look=(-3.0, 0.0, 0.0), **arms(20.0, 14.0, 22.0, 12.0)), "QUAD", "EASE_OUT")
    s.event("IFrameEnd")
    mid = {lead: (sgn * (0.75 * d + 0.7), 0.05, -4.0 * sgn), trail: (sgn * (0.75 * d - 0.25), -0.04, 3.0 * sgn)}
    s.to(0.1, _body((-4.0 * k, -2.0 * sgn * k, -2.0 * sgn * k), shift=(0.75 * d * sgn, 0.0), sink=0.1 * k,
                    feet=mid, look=(-1.0, 0.0, 0.0), **arms(10.0, 8.0, 10.0, 6.0)))
    s.to(max(0.1, recovery), _body())
    return c


@preset("dodge_left", "dodge", "Sidestep dodge to the left: dip, push off the right foot, hop left with the torso "
        "leaning into the motion (Torso -X by `distance`), land wide and absorb, settle to rest. "
        "'IFrameStart' at push-off, 'IFrameEnd' after landing.", params=_DODGE_PARAMS)
def dodge_left(fps=60, speed=1.0, intensity=1.0, distance=1.5, hop=0.22, recovery=0.3):
    return _dodge_side("DodgeLeft", -1.0, fps, speed, intensity, distance, hop, recovery)


@preset("dodge_right", "dodge", "Sidestep dodge to the right: dip, push off the left foot, hop right with the torso "
        "leaning into the motion (Torso +X by `distance`), land wide and absorb, settle to rest. "
        "'IFrameStart' at push-off, 'IFrameEnd' after landing.", params=_DODGE_PARAMS)
def dodge_right(fps=60, speed=1.0, intensity=1.0, distance=1.5, hop=0.22, recovery=0.3):
    return _dodge_side("DodgeRight", 1.0, fps, speed, intensity, distance, hop, recovery)


@preset("roll_forward", "dodge", "Forward combat roll in place: crouch, dive with the hands reaching for the ground, "
        "full somersault (Torso rot x -90/-180/-270/-360, LINEAR so the spin is even) with legs and arms tucked "
        "and the body kept on the ground, crouched landing and rise to rest. 'IFrameStart' at the dive, "
        "'IFrameEnd' at the landing.", params={
            "duration": {"default": 0.5, "description": "Seconds for the somersault itself (dive to landing)."},
            "tuck": {"default": 1.0, "description": "How tight legs, arms and head are tucked (0.5 .. 1.2)."},
            "recovery": {"default": 0.3, "description": "Seconds to rise from the landing crouch to rest."}})
def roll_forward(fps=60, speed=1.0, intensity=1.0, duration=0.5, tuck=1.0, recovery=0.3):
    k = float(intensity)
    t = max(0.3, float(tuck))
    step = max(0.2, float(duration)) / 9.0
    c = _clip("RollForward", fps, "Forward roll, rest to rest.")
    s = _Seq(c, speed)
    s.start(_body())
    s.to(0.1, _body((-26.0, 0.0, 0.0), shift=(0.0, -0.1), sink=0.3 * k, look=(-10.0, 0.0, 0.0),
                    rarm=_arm("Right", 75.0, 6.0), larm=_arm("Left", 75.0, 6.0)))
    # Somersault in 45-degree steps: (torso pitch, leg swing, arm swing, arm spread, head pitch, duration in
    # steps). Legs tuck to the chest while inverted, then unfold so the feet meet the ground in front of the
    # hips at -315 (torso reclined 45 deg) and the body rocks up over them.
    steps = [(-55.0, 20.0, 130.0, 8.0, -15.0, 1.4),
             (-90.0, 70.0, 130.0, 2.0, -28.0, 1.0),
             (-135.0, 110.0, 120.0, -2.0, -35.0, 1.0),
             (-180.0, 125.0, 110.0, -3.0, -38.0, 1.0),
             (-225.0, 125.0, 105.0, -3.0, -38.0, 1.0),
             (-270.0, 100.0, 95.0, -2.0, -32.0, 1.0),
             (-315.0, 0.0, 70.0, 0.0, -22.0, 1.6),
             (-337.5, 0.0, 58.0, 4.0, -16.0, 0.7)]
    rolling = []
    for i, (pitch, leg, arm, spread, head, dur) in enumerate(steps):
        leg = leg * t if i else leg   # the dive pushes off the same way whatever the tuck
        legv = {"Right": _arm("Right", leg, 4.0), "Left": _arm("Left", leg, 4.0)}
        j = _body((pitch, 0.0, 0.0), y=0.0, feet={}, legs=legv, head=(head * t, 0.0, 0.0),
                  rarm=_arm("Right", arm, spread * t), larm=_arm("Left", arm, spread * t))
        j["Torso"]["pos"][1] = _contact_height(j, 0.12 if i == 0 else 0.02)
        rolling.append(s.to(step * dur, j, *(("LINEAR", "AUTO") if i else ("QUAD", "EASE_IN"))))
        if i == 0:
            s.event("IFrameStart")
    s.to(step * 0.8, _body((-360.0, 0.0, 0.0), sink=0.34 * k, head=(-12.0, 0.0, 0.0),
                           rarm=_arm("Right", 50.0, 8.0), larm=_arm("Left", 50.0, 8.0)), "LINEAR")
    s.event("IFrameEnd")
    _keep_above_ground(c, rolling)   # the tumbling body is not round: keep its corners out of the floor
    s.to(0.08, _body((-370.0, 0.0, 0.0), sink=0.3 * k, look=(-6.0, 0.0, 0.0),
                     rarm=_arm("Right", 35.0, 8.0), larm=_arm("Left", 35.0, 8.0)), "QUAD", "EASE_OUT")
    s.to(max(0.1, recovery), _body())
    return c
