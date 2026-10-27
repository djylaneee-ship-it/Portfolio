"""Melee weapon presets for R6: sword, greatsword, spear, dagger, axe (weapon in the RIGHT hand).

Authoring model (degrees, studs, character space: +X right, +Y up, -Z forward; HumanoidRootPart at the origin)
- The Roblox grip keeps the blade perpendicular to the arm (arm hanging -> blade forward), so a right-arm
  pose is written as intentions: ("dir", arm_dir, blade_dir) with WORLD directions, or
  ("grip", hand_point, blade_dir) with the hand point in TORSO-LOCAL coordinates (follows the torso twist).
  `_d(az, el)` builds directions: az 0 = forward, +90 = the character's right; el +90 = up.
- Feet are WORLD ground points {"R": (x, z[, lift]), "L": ...}; a small leg IK aims each leg at its point and
  the torso is lowered/raised so the lowest planted leg corner sits on the ground (y = -3): stances and
  lunges drop the hips by themselves and feet never sink.
- The head keeps looking at world (az, el) whatever the torso does; two-handed weapons derive the left arm
  from `clip.two_hand_left()` on every key (the largest gap is kept in `clip.grip_gap`).
- `intensity` scales each key's deviation from the preset's guard pose (rotation angles, offsets, feet).
- Strikes: wind-up hold -> EASE_IN (CUBIC/QUART) into a mid-strike key -> LINEAR into the impact ("Hit"),
  BACK EASE_OUT follow-through overshoot, BEZIER recovery to the guard. "Start"/"End" frame the damage window.
"""

import copy
import math

from mathutils import Matrix, Quaternion, Vector

from .. import cframe as cfm
from ..clip import Clip, aim_arm, handle_frame, preset, two_hand_left

GROUND = -cfm.R6_HIP_HEIGHT
_A0 = Vector((0.0, -1.0, 0.0))   # arm axis at rest (shoulder -> hand)
_B0 = Vector((0.0, 0.0, -1.0))   # blade at rest (handle +Y with the arm hanging)
_REST = Matrix((_A0, _B0, _A0.cross(_B0)))
_SHOULDER_R = Vector((1.0, 0.5, 0.0))
_HIP = {"Right Leg": Vector((1.0, -1.0, 0.0)), "Left Leg": Vector((-1.0, -1.0, 0.0))}
_SOLE = {"Right Leg": Vector((-0.5, -2.0, 0.0)), "Left Leg": Vector((0.5, -2.0, 0.0))}  # sole centre - hip pivot
_FEET_KEYS = (("Right Leg", "R"), ("Left Leg", "L"))

SWORD = {"kind": "sword", "hand": "Right"}
GREATSWORD = {"kind": "greatsword", "hand": "Right"}
SPEAR = {"kind": "spear", "hand": "Right"}
DAGGER = {"kind": "dagger", "hand": "Right"}
AXE = {"kind": "axe", "hand": "Right"}


# ---------------------------------------------------------------------------------------------
# geometry helpers
# ---------------------------------------------------------------------------------------------

def _d(az, el=0.0):
    """Unit direction: az degrees from forward toward the character's right, el degrees up."""
    a, e = math.radians(az), math.radians(el)
    return Vector((math.sin(a) * math.cos(e), math.sin(e), -math.cos(a) * math.cos(e)))


def _rmat(rot):
    return cfm.angles_deg(*rot).to_3x3()


def _euler(m3):
    return [round(v, 3) for v in cfm.to_angles_deg(m3.to_4x4())]


def torso_rot(lean, twist, tilt):
    """Friendly Torso rot from body-relative intentions: twist (y, + = turn left) applied last, so lean
    (x, - = forward) and tilt (z, + = left) happen about the torso's own axes and keep the hips level."""
    m = (Matrix.Rotation(math.radians(twist), 3, "Y") @ Matrix.Rotation(math.radians(lean), 3, "X")
         @ Matrix.Rotation(math.radians(tilt), 3, "Z"))
    return _euler(m)


def _twist_to(m, axis, cur, want):
    """Rotate m about `axis` so that direction `cur` (already rotated by m) best matches `want`."""
    p1 = cur - axis * cur.dot(axis)
    p2 = want - axis * want.dot(axis)
    if p1.length < 1e-6 or p2.length < 1e-6:
        return m
    ang = p1.angle(p2)
    if p1.cross(p2).dot(axis) < 0.0:
        ang = -ang
    return Quaternion(axis, ang).to_matrix() @ m


def arm_dirs(a, b, torso=(0.0, 0.0, 0.0)):
    """Right-arm friendly rot: arm along world dir `a`, blade as close as possible to world dir `b`."""
    inv = _rmat(torso).transposed()
    a = (inv @ Vector(a)).normalized()
    b = inv @ Vector(b)
    b = b - a * b.dot(a)
    if b.length < 1e-6:
        b = a.orthogonal()
    b.normalize()
    return _euler(Matrix((a, b, a.cross(b))).transposed() @ _REST)


def arm_grip(hand, b, torso=(0.0, 0.0, 0.0)):
    """Right-arm value {"rot","pos"}: grip at torso-local point `hand`, blade toward world dir `b`."""
    target = Vector(hand)
    base = aim_arm("Right", target)
    m = _rmat(base["rot"])
    axis = (target - _SHOULDER_R).normalized()
    want = _rmat(torso).transposed() @ Vector(b)
    m = _twist_to(m, axis, m @ _B0, want)
    return {"rot": _euler(m), "pos": [round(v, 4) for v in base["pos"]]}


def point_limb(a, torso=(0.0, 0.0, 0.0), twist=0.0):
    """Friendly rot pointing an arm (shoulder -> hand) along world dir `a`; twist turns it about itself."""
    local = (_rmat(torso).transposed() @ Vector(a)).normalized()
    m = _A0.rotation_difference(local).to_matrix()
    if twist:
        m = Quaternion(local, math.radians(twist)).to_matrix() @ m
    return _euler(m)


def look(torso, az=0.0, el=0.0, roll=0.0):
    """Head friendly rot keeping the face toward world direction (az, el) whatever the torso does."""
    f = _d(az, el)
    right = f.cross(Vector((0.0, 1.0, 0.0))).normalized()
    up = right.cross(f)
    world = Matrix((right, up, -f)).transposed()
    if roll:
        world = Matrix.Rotation(math.radians(roll), 3, f) @ world
    return _euler(_rmat(torso).transposed() @ world)


def leg_to(part, target, torso_rot, torso_pos, twist=0.0):
    """Leg friendly rot so the sole centre reaches world `target` (shortest swing from rest), optionally
    twisted `twist` degrees about the hip->sole line (keeps the sole centre in place)."""
    rt = _rmat(torso_rot)
    pivot = Vector(torso_pos) + rt @ _HIP[part]
    local = rt.transposed() @ (Vector(target) - pivot)
    if local.length < 1e-6:
        return [0.0, 0.0, 0.0]
    m = _SOLE[part].rotation_difference(local).to_matrix()
    if twist:
        m = Quaternion(local.normalized(), math.radians(twist)).to_matrix() @ m
    return _euler(m)


_TWISTS = (0.0, -10.0, 10.0, -20.0, 20.0, -30.0, 30.0, -40.0, 40.0)
PIVOT = 0.6   # fraction of the torso twist (relative to the guard) the stance follows


def legs_cross(joints):
    """Number of Left Leg corners (shrunk box) inside the Right Leg box: > 0 when the legs scissor."""
    tr = {p: cfm.friendly_to_transform(joints[p]["rot"], joints[p]["pos"], cfm.R6_JOINTS[p][2])
          for p in ("Torso", "Left Leg", "Right Leg")}
    parts = cfm.fk(tr)
    inv = parts["Right Leg"].inverted()
    left = parts["Left Leg"]
    n = 0
    for x in (-0.45, 0.45):
        for y in (-0.8, 0.8):
            for z in (-0.45, 0.45):
                p = inv @ (left @ Vector((x, y, z)))
                if abs(p.x) < 0.44 and abs(p.y) < 0.94 and abs(p.z) < 0.44:
                    n += 1
    return n


def legs_low(joints, legs=("Left Leg", "Right Leg")):
    """Lowest leg-corner height (character space) for joints holding Torso and the legs."""
    tr = {}
    for p in ("Torso",) + tuple(legs):
        v = joints.get(p)
        if v:
            tr[p] = cfm.friendly_to_transform(v["rot"], v["pos"], cfm.R6_JOINTS[p][2])
    parts = cfm.fk(tr)
    low = 1e9
    for leg in legs:
        sx, sy, sz = (s / 2.0 for s in cfm.R6_SIZES[leg])
        for x in (-sx, sx):
            for z in (-sz, sz):
                low = min(low, (parts[leg] @ Vector((x, -sy, z))).y)
    return low


# Collision volumes, part-local (center, half extents), same as r6.analyze: the arm's lower 60% (the cap
# above the shoulder pivot always clips a little on a raised R6 arm) against the whole torso.
_ARM_BOX = (Vector((0.0, -0.4, 0.0)), Vector((0.45, 0.6, 0.45)))
_TORSO_BOX = (Vector((0.0, 0.0, 0.0)), Vector((1.0, 1.0, 0.5)))


def _obb(m, center, half):
    rot = m.to_3x3()
    return m @ center, [rot.col[i].normalized() for i in range(3)], half


def sat_depth(a, b):
    """Penetration depth (studs) of two oriented boxes (center, axes, half extents) by separating axes."""
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


def arm_overlap(joints, arms=("Right Arm", "Left Arm")):
    """Summed penetration depth (studs) of the arms' lower part into the torso, in torso space (the
    measure r6.analyze reports as arm/torso clipping)."""
    torso = _obb(Matrix.Identity(4), *_TORSO_BOX)
    total = 0.0
    for arm in arms:
        v = joints.get(arm)
        if v:
            _j, _p, c0, c1 = cfm.R6_JOINTS[arm]
            m = c0 @ cfm.friendly_to_transform(v["rot"], v["pos"], c0) @ c1.inverted()
            total += sat_depth(_obb(m, *_ARM_BOX), torso)
    return total


def blade_point(joints, dist):
    """Character-space point `dist` studs along the blade (handle +Y) for a resolved pose."""
    t = joints["Torso"]
    torso = Matrix.Translation(Vector(t["pos"])) @ cfm.angles_deg(*t["rot"])
    return torso @ (handle_frame(joints["Right Arm"]) @ Vector((0.0, dist, 0.0)))


def _scale_value(value, guard, k):
    """Scale a joint value's deviation from the guard value by k (rotation angle and offset)."""
    if guard is None or abs(k - 1.0) < 1e-9:
        return value
    rg = _rmat(guard["rot"])
    axis, ang = (_rmat(value["rot"]) @ rg.transposed()).to_quaternion().to_axis_angle()
    rot = Quaternion(axis, ang * k).to_matrix() @ rg
    pos = [g + (v - g) * k for v, g in zip(value["pos"], guard["pos"])]
    return {"rot": _euler(rot), "pos": pos}


# ---------------------------------------------------------------------------------------------
# pose specs and the key builder
# ---------------------------------------------------------------------------------------------

def S(torso, tpos=(0.0, 0.0, 0.0), arm=None, larm=None, feet=None, head=(0.0, -4.0), handle=None, grip=None):
    """A pose intention. torso: (lean, twist, tilt) degrees, body-relative (see torso_rot); tpos: Torso
    offset in studs (its y is solved by planting the feet).
    arm: ("dir", a, b) | ("grip", hand_local, b) | rot list. larm: ("dir", a[, twist]) | rot list | None.
    feet: {"R": (x, z[, lift]), "L": (x, z[, lift])}. head: (az, el[, roll]) world look or ("rot", [..]).
    grip: two-handed grip distance override for this key (left hand position along the handle).
    """
    return {"torso": list(torso), "tpos": list(tpos), "arm": arm, "larm": larm, "feet": feet, "head": head,
            "handle": handle, "grip": grip}


def with_(spec, **changes):
    out = copy.deepcopy(spec)
    out.update(changes)
    return out


class Anim:
    """Builds a Clip from pose specs: seconds -> frames, intensity, two-hand grip, leg IK + planting."""

    def __init__(self, name, fps, speed, intensity, guard, priority="Action", loop=False, description="",
                 two_hand=False, grip=0.8, pivot=PIVOT):
        self.clip = Clip(name, 0, fps, loop, priority, description)
        self.fps = int(fps)
        self.speed = max(0.05, float(speed))
        self.k = max(0.0, min(2.0, float(intensity)))
        self.two_hand = two_hand
        self.grip = grip
        self.pivot = pivot
        self.max_gap = 0.0
        self.last_gap = 0.0
        self.gaps = {}
        self._last = -1
        self._lags = []
        self._cache = {}
        self._ref_twist = None
        self.guard_spec = guard
        self.guard = self._joints(guard) if guard else None

    def frame(self, t):
        return int(math.floor(t * self.fps / self.speed + 0.5))

    # -- spec -> joints ------------------------------------------------------------------------
    def _joints(self, s):
        torso = torso_rot(*s["torso"])
        j = {"Torso": {"rot": torso, "pos": [float(s["tpos"][0]), 0.0, float(s["tpos"][2])]}}
        h = s["head"]
        if h and h[0] == "rot":
            j["Head"] = {"rot": list(h[1]), "pos": [0.0, 0.0, 0.0]}
        elif h is not None:
            j["Head"] = {"rot": look(torso, *h), "pos": [0.0, 0.0, 0.0]}
        arm = s["arm"]
        if arm is not None:
            if arm[0] == "dir":
                j["Right Arm"] = {"rot": arm_dirs(arm[1], arm[2], torso), "pos": [0.0, 0.0, 0.0]}
            elif arm[0] == "grip":
                hand = arm[1]
                if self.two_hand:
                    hand = self._reach(hand, arm[2], torso, self.grip if s.get("grip") is None else s["grip"])
                j["Right Arm"] = arm_grip(hand, arm[2], torso)
            else:
                j["Right Arm"] = {"rot": list(arm), "pos": [0.0, 0.0, 0.0]}
        la = s["larm"]
        if la is not None:
            if la[0] == "dir":
                j["Left Arm"] = {"rot": point_limb(la[1], torso, la[2] if len(la) > 2 else 0.0),
                                 "pos": [0.0, 0.0, 0.0]}
            else:
                j["Left Arm"] = {"rot": list(la), "pos": [0.0, 0.0, 0.0]}
        if s.get("handle") is not None:
            j["Handle"] = {"rot": list(s["handle"]), "pos": [0.0, 0.0, 0.0]}
        return j

    @staticmethod
    def _reach(hand, b, torso, grip, ok=0.1):
        """Nudge the right-hand point so the left hand can hold the grip, neither arm sinks into the torso
        and the blade really points along `b` (the grip keeps it perpendicular to the arm): minimises
        gap + 1.5 * overlap + 0.03 * blade_error_deg + 0.6 * nudge over a grid (0.1 stud steps, radius 0.3,
        then 0.5 if still poor); keeps the authored point when it is already fine. (Two hands near the
        centre line always clip ~0.2 stud into an R6 torso; the weight trades that against the pose.)"""
        bw = Vector(b).normalized()
        rt = _rmat(torso)

        def cost(p):
            right = arm_grip(p, b, torso)
            left, gap = two_hand_left(right, grip_distance=grip, return_gap=True)
            blade = rt @ (handle_frame(right).to_3x3() @ Vector((0.0, 1.0, 0.0)))
            return (gap + 1.5 * arm_overlap({"Right Arm": right, "Left Arm": left})
                    + 0.03 * math.degrees(blade.angle(bw, 0.0)))
        base = Vector(hand)
        best_c = cost(base)
        if best_c <= ok:
            return hand
        best = base
        for radius in (3, 5):
            steps = [0.1 * i for i in range(-radius, radius + 1)]
            for dx in steps:
                for dy in steps:
                    for dz in steps:
                        if radius == 5 and max(abs(dx), abs(dy), abs(dz)) < 0.35:
                            continue
                        p = base + Vector((dx, dy, dz))
                        c = cost(p) + 0.6 * (p - base).length
                        if c < best_c:
                            best, best_c = p, c
            if best_c <= 0.6:
                break
        return tuple(best)

    def _feet(self, s, torso_yaw):
        """Foot points of a spec: scaled by intensity around the guard's, then pivoted about the vertical
        axis by PIVOT x the torso twist relative to the guard (feet turn on the balls during coils)."""
        feet = {}
        gf = self.guard_spec["feet"] if self.guard_spec else None
        turn = self.pivot * (torso_yaw - self.guard_spec["torso"][1]) if self.guard_spec else 0.0
        c, sn = math.cos(math.radians(turn)), math.sin(math.radians(turn))
        for _part, key in _FEET_KEYS:
            v = list(s["feet"][key]) + [0.0] * (3 - len(s["feet"][key]))
            if gf and abs(self.k - 1.0) > 1e-9:
                g = list(gf[key]) + [0.0] * (3 - len(gf[key]))
                v = [gv + (x - gv) * self.k for x, gv in zip(v, g)]
            feet[key] = [v[0] * c + v[1] * sn, -v[0] * sn + v[1] * c, v[2]]
        return feet

    def _yaw(self, s):
        """Torso twist of a spec after intensity scaling (drives the stance pivot)."""
        if self.guard is None or abs(self.k - 1.0) < 1e-9:
            return s["torso"][1]
        return self.guard_spec["torso"][1] + (s["torso"][1] - self.guard_spec["torso"][1]) * self.k

    def solve(self, s):
        """Full joints dict for a spec (scaled, two-handed, legs aimed and planted). Cached per spec."""
        hit = self._cache.get(id(s))
        if hit is not None and hit[0] is s:
            self.last_gap = hit[2]
            return copy.deepcopy(hit[1])
        j = self._solve(s)
        self._cache[id(s)] = (s, copy.deepcopy(j), self.last_gap)
        return j

    def _solve(self, s):
        j = self._joints(s)
        if self.guard:
            for name in list(j):
                j[name] = _scale_value(j[name], self.guard.get(name), self.k)
        if self.two_hand and "Right Arm" in j:
            grip = self.grip if s.get("grip") is None else s["grip"]
            left, gap = two_hand_left(j["Right Arm"], grip_distance=grip, return_gap=True)
            j["Left Arm"] = left
            self.max_gap = max(self.max_gap, gap)
            self.last_gap = gap
        if s["feet"]:
            self._solve_legs(j, self._feet(s, self._yaw(s)))
        return j

    def _solve_legs(self, j, feet):
        """Aim the legs at the foot points, pick the leg twist that digs the box corners least (R6 legs are
        square, the twist barely shows), plant the torso so the lowest planted corner touches the ground,
        keep lifted feet's lowest corner at their lift, then slide a still-floating planted foot toward its
        hanging point until it touches (the other leg keeps holding the hips)."""
        low = min(feet[key][2] for _p, key in _FEET_KEYS)   # both feet lifted = airborne by `low`
        planted = [p for p, key in _FEET_KEYS if feet[key][2] <= low + 1e-6]
        feet = {k: list(v) for k, v in feet.items()}
        twist = {"R": 0.0, "L": 0.0}
        yoff = {"R": 0.0, "L": 0.0}

        def aim(part, key, tw):
            x, z, lift = feet[key]
            j[part] = {"rot": leg_to(part, (x, GROUND + lift + yoff[key], z), j["Torso"]["rot"],
                                     j["Torso"]["pos"], tw), "pos": [0.0, 0.0, 0.0]}

        for it in range(6):
            for part, key in _FEET_KEYS:
                if it < 3:   # least digging twist, kept close to the guard's (no leg spinning)
                    best = None
                    ref = self._ref_twist[key] if self._ref_twist else None
                    for tw in _TWISTS:
                        aim(part, key, tw)
                        score = legs_low(j, (part,)) - 0.0015 * abs(tw)
                        if ref is not None:
                            score -= 0.0015 * abs(tw - ref)
                        if key == "L" and "Right Leg" in j:
                            score -= 0.12 * legs_cross(j)
                        if best is None or score > best[0] + 1e-9:
                            best = (score, tw)
                    twist[key] = best[1]
                aim(part, key, twist[key])
                if part not in planted:     # lifted foot: its lowest corner (not the sole centre) at the lift
                    yoff[key] += GROUND + feet[key][2] - legs_low(j, (part,))
                    aim(part, key, twist[key])
            j["Torso"]["pos"][1] += GROUND + low - legs_low(j, planted)
        if self._ref_twist is None:      # the first solved pose is the guard: it sets the reference
            self._ref_twist = dict(twist)
        if len(planted) < 2:
            return
        floor = GROUND + low
        for part, key in _FEET_KEYS:
            if legs_low(j, (part,)) <= floor + 0.015:
                continue
            x0, z0 = feet[key][0], feet[key][1]
            yaw = _rmat((0.0, j["Torso"]["rot"][1], 0.0))    # under the hip, sole offset turned with the hips
            hang = Vector(j["Torso"]["pos"]) + _rmat(j["Torso"]["rot"]) @ _HIP[part] + yaw @ _SOLE[part]

            def at(t):
                feet[key][0], feet[key][1] = x0 + (hang.x - x0) * t, z0 + (hang.z - z0) * t
                aim(part, key, twist[key])
                return legs_low(j, (part,)) - floor

            lo, hi = 0.0, None
            for i in range(1, 11):
                if at(i / 10.0) <= 0.005:
                    hi = i / 10.0
                    break
                lo = i / 10.0
            if hi is None:
                best_t = min((abs(at(i / 10.0)), i / 10.0) for i in range(11))[1]
                at(best_t)
                continue
            for _ in range(6):
                mid = (lo + hi) / 2.0
                if at(mid) <= 0.005:
                    hi = mid
                else:
                    lo = mid
            at(hi)

    # -- keys -----------------------------------------------------------------------------------
    def key(self, t, spec, interp="BEZIER", easing="AUTO", lag=0):
        """Key a pose spec at t seconds; returns the frame (strictly increasing). `lag` (frames at 60 fps)
        delays the head and the free off-arm for overlapping action (BEZIER segments only)."""
        j = self.solve(spec)
        f = self.joints(j, t, interp, easing)
        if self.two_hand:
            self.gaps[f] = round(self.last_gap, 4)
        if lag:
            self._lags.append((f, int(round(lag * self.fps / 60.0 / self.speed))))
        return f

    def inbetween(self, t, spec_a, spec_b, frac, interp="BEZIER", easing="AUTO"):
        """Key a breakdown `frac` of the way between two pose specs: upper body slerped (the path the
        curves take anyway), left hand re-gripped for two-handed weapons, legs re-solved from the blended
        foot points so feet stay planted and legs do not cross while the stance pivots."""
        j = blend(self.solve(spec_a), self.solve(spec_b), frac)
        gap = 0.0
        if self.two_hand:
            ga = spec_a.get("grip") if spec_a.get("grip") is not None else self.grip
            gb = spec_b.get("grip") if spec_b.get("grip") is not None else self.grip
            j["Left Arm"], gap = two_hand_left(j["Right Arm"], grip_distance=ga + (gb - ga) * frac,
                                               return_gap=True)
            self.max_gap = max(self.max_gap, gap)
        if spec_a["feet"] and spec_b["feet"]:
            fa, fb = self._feet(spec_a, self._yaw(spec_a)), self._feet(spec_b, self._yaw(spec_b))
            self._solve_legs(j, {k: [x + (y - x) * frac for x, y in zip(fa[k], fb[k])] for k in fa})
        f = self.joints(j, t, interp, easing)
        if self.two_hand:
            self.gaps[f] = round(gap, 4)
        return f

    def joints(self, joints, t, interp="BEZIER", easing="AUTO"):
        """Key already solved joints at t seconds; returns the frame (strictly increasing)."""
        f = max(self.frame(t), self._last + 1)
        self._last = f
        self.clip.key(f, joints, interp, easing)
        return f

    def event(self, frame, name, value=""):
        self.clip.event(frame, name, value)

    def _ground_pass(self, tol=0.03, passes=3):
        """Inside BEZIER / LINEAR segments, key a corrective Torso lift where interpolation drags a foot
        below the ground (big pose changes between planted keys). Eased strike segments (EASE_IN, BACK)
        keep their curves untouched."""
        for _ in range(passes):
            added = False
            frames = self.clip.frames()
            for a, b in zip(frames, frames[1:]):
                interp = self.clip.keys[a]["interp"]
                if interp not in ("BEZIER", "LINEAR") or b - a < 2:
                    continue
                worst = None
                for f in range(a + 1, b):
                    full = self.clip.resolve(f)
                    deficit = GROUND - legs_low(full)
                    if deficit > tol and (worst is None or deficit > worst[0]):
                        worst = (deficit, f, full["Torso"])
                if worst:
                    deficit, f, torso = worst
                    torso["pos"][1] += deficit
                    self.clip.keys[f] = {"joints": {"Torso": torso}, "interp": interp, "easing": "AUTO"}
                    added = True
            if not added:
                break

    def done(self):
        frames = self.clip.frames()
        for f, lag in self._lags:
            nxt = [x for x in frames if x > f]
            if lag < 1 or not nxt or f == 0 or f + lag >= nxt[0]:
                continue
            k = self.clip.keys[f]
            moved = {j: k["joints"].pop(j) for j in ("Head",) + (() if self.two_hand else ("Left Arm",))
                     if j in k["joints"]}
            self.clip.keys[f + lag] = {"joints": moved, "interp": k["interp"], "easing": k["easing"]}
        self._ground_pass()
        if self.clip.loop:
            self.clip.close_loop()
        self.clip.grip_gap = round(self.max_gap, 4)   # informative: largest two-hand gap over the keys
        self.clip.grip_gaps = dict(self.gaps)
        return self.clip


def blend(ja, jb, t):
    """Joint-wise slerp between two solved poses (a point on the path Blender/Roblox will take)."""
    out = {}
    for name, va in ja.items():
        vb = jb.get(name, va)
        c0 = cfm.WEAPON_C0 if name == "Handle" else cfm.R6_JOINTS[name][2]
        m = cfm.lerp_cframe(cfm.friendly_to_transform(va["rot"], va["pos"], c0),
                            cfm.friendly_to_transform(vb["rot"], vb["pos"], c0), t)
        rot, pos = cfm.transform_to_friendly(m, c0)
        out[name] = {"rot": [round(v, 3) for v in rot], "pos": [round(v, 4) for v in pos]}
    return out


def strike(an, t0, mid, imp, t_mid, t_imp, ease_in="CUBIC", pre=0.3):
    """The strike: wind-up end pose t0 = (time, spec) accelerating (ease_in EASE_IN) into an automatic key
    `pre` of the way to `mid` (same path, it only spreads the acceleration over more frames), LINEAR
    through `mid`, LINEAR into the impact `imp` (keyed BACK EASE_OUT for the follow-through overshoot).
    Returns (mid frame, impact frame)."""
    f0 = an.key(t0[0], t0[1], ease_in, "EASE_IN")
    tp = t0[0] + (t_mid - t0[0]) * 0.4
    if pre and f0 < an.frame(tp) < an.frame(t_mid):
        an.inbetween(tp, t0[1], mid, pre, "LINEAR")
    fm = an.key(t_mid, mid, "LINEAR")
    fi = an.key(t_imp, imp, "BACK", "EASE_OUT")
    return fm, fi


# ---------------------------------------------------------------------------------------------
# one-handed sword
# ---------------------------------------------------------------------------------------------

SW_FEET = {"R": (0.45, -1.25), "L": (-0.4, 1.2)}   # long front/back stance keeps the R6 hips low


def _feet(base, r=(0.0, 0.0, 0.0), l=(0.0, 0.0, 0.0), width=1.0, turn=0.0):
    """Offset a feet dict: r/l = (dx, dz, lift); width scales the stance around the centre; turn pivots the
    stance about the vertical axis (degrees, + = toward the left like a Torso y twist) before the offsets."""
    out = {}
    c, s = math.cos(math.radians(turn)), math.sin(math.radians(turn))
    for key, off in (("R", r), ("L", l)):
        x, z = base[key][0] * width, base[key][1] * width
        x, z = x * c + z * s, -x * s + z * c
        out[key] = (x + off[0], z + off[1], off[2] if len(off) > 2 else 0.0)
    return out


def sword_guard(style="mid", width=1.0):
    """Right-foot-forward guard: chest turned a little left, blade toward the opponent."""
    arms = {"mid": (_d(20, -50), _d(-2, 28)), "low": (_d(25, -64), _d(-4, -12)),
            "high": (_d(70, 15), _d(150, 70))}
    a, b = arms.get(style, arms["mid"])
    return S(torso=(-6, 14, 0), arm=("dir", a, b), larm=("dir", _d(-28, -66)), feet=_feet(SW_FEET, width=width))


@preset("sword_idle", "combat", "One-handed sword guard loop: right foot forward, blade toward the opponent, "
        "slow breath with the tip drifting and head/off-hand overlapping.",
        params={"guard": {"default": "mid", "description": "mid (tip at the opponent's throat), low (tip down, "
                          "relaxed) or high (blade cocked over the right shoulder)"},
                "stance": {"default": 1.0, "description": "stance width multiplier (0.6 narrow .. 1.5 wide)"},
                "breath": {"default": 1.0, "description": "breathing / sway amplitude multiplier"}},
        weapon=SWORD, loop=True)
def sword_idle(fps=60, speed=1.0, intensity=1.0, guard="mid", stance=1.0, breath=1.0):
    g = sword_guard(guard, stance)
    an = Anim("SwordIdle", fps, speed, 1.0, g, priority="Idle", loop=True,
              description="Sword guard idle loop (%s guard)" % guard)
    b = breath * intensity
    arm_b = g["arm"][2]
    inhale = with_(g, torso=(-6 + 2.5 * b, 14 - 1.2 * b, 0.8 * b), tpos=(0.0, 0.0, 0.03 * b),
                   arm=("dir", _d(20 - 2 * b, -50 + 4 * b), arm_b + Vector((0.0, 0.06 * b, 0.0))),
                   larm=("dir", _d(-28 + 2 * b, -62)), head=(1.5 * b, -2.5))
    sway = with_(g, torso=(-6 - 0.8 * b, 14 + 1.2 * b, -0.6 * b), tpos=(0.02 * b, 0.0, -0.02 * b),
                 arm=("dir", _d(20 + 2 * b, -51), arm_b - Vector((0.03 * b, 0.02 * b, 0.0))),
                 larm=("dir", _d(-30, -67)), head=(-1.0 * b, -4.5))
    feet_in = _feet(SW_FEET, r=(0.0, -0.06 * b), l=(0.0, 0.06 * b), width=stance)  # wider = lower hips
    sway["feet"] = feet_in
    L = 2.4
    an.key(0.0, g)
    an.key(L * 0.40, inhale, lag=8)
    an.key(L * 0.72, sway, lag=6)
    an.key(L, g)
    return an.done()


def _slash_common(an, g, wind, wind2, mid, imp, ft, settle, wind_up, recover, hold=0.05, strike_t=(0.06, 0.095),
                  ft_t=0.11, settle_t=0.12, back_t=0.17, ease_in="CUBIC", pre_wind=None):
    """Standard light-attack timeline. Returns (start, hit, end) frames."""
    an.key(0.0, g)
    if pre_wind is not None:          # extra key when the wind-up re-orients the blade a lot
        an.key(wind_up * 0.45, pre_wind)
    an.key(wind_up, wind, lag=3)
    t0 = wind_up + hold
    fm, fi = strike(an, (t0, wind2), mid, imp, t0 + strike_t[0], t0 + strike_t[1], ease_in)
    t = t0 + strike_t[1]
    fe = an.key(t + ft_t, ft)
    if recover:
        an.key(t + ft_t + settle_t, settle, lag=3)
        an.key(t + ft_t + settle_t + back_t, g)
    else:
        an.key(t + ft_t + 0.08, ft)   # hold the follow-through (chain straight into the next attack)
    an.event(max(0, fm - 1), "Start")
    an.event(fi, "Hit")
    an.event(fe, "End")
    return fm, fi, fe


_SLASH_PARAMS = {
    "wind_up": {"default": 0.16, "description": "anticipation time in seconds (0.08 snappy .. 0.35 telegraphed)"},
    "tilt": {"default": 15.0, "description": "slash plane tilt in degrees (0 = flat, + = descending diagonal)"},
    "step": {"default": True, "description": "step in with the front foot on the strike"},
    "recover": {"default": True, "description": "return to the sword guard (False: stop after the follow-through)"},
}


@preset("sword_slash_1", "combat", "Combo hit 1: forehand slash right-to-left. Coil right with the blade cocked "
        "high, fast leading-edge sweep across the front with a step-in, BACK overshoot, back to guard.",
        params=_SLASH_PARAMS, weapon=SWORD)
def sword_slash_1(fps=60, speed=1.0, intensity=1.0, wind_up=0.16, tilt=15.0, step=True, recover=True):
    g = sword_guard()
    an = Anim("SwordSlash1", fps, speed, intensity, g, description="Forehand slash right to left")
    st = 1.0 if step else 0.0
    wind = S((3, -30, -4), (0.05, 0, 0.16), ("dir", _d(118, 10 + tilt), _d(45, 62)),
             ("dir", _d(-14, -2)), _feet(SW_FEET, r=(0, 0.1 * st)))
    wind2 = with_(wind, torso=(4, -34, -5), arm=("dir", _d(124, 12 + tilt), _d(50, 64)))
    mid = S((-3, -4, -1), (0.0, 0, -0.08), ("dir", _d(88, 6 + tilt * 0.6), _d(15, 40 + tilt * 0.4)),
            ("dir", _d(-70, -40)), _feet(SW_FEET, r=(0, -0.35 * st, 0.12 * st)))
    imp = S((-9, 24, 3), (0.0, 0, -0.3 * (0.4 + 0.6 * st)), ("dir", _d(28, -4), _d(-58, -tilt * 0.6)),
            ("dir", _d(-160, -50)), _feet(SW_FEET, r=(0.05, -0.7 * st)), head=(0, -6))
    ft = S((-11, 40, 2), (0.0, 0, -0.34 * (0.4 + 0.6 * st)), ("dir", _d(-35, -16 - tilt * 0.5),
           _d(-128, -8 - tilt * 0.5)), ("dir", _d(-165, -45)), _feet(SW_FEET, r=(0.05, -0.7 * st)),
           head=(0, -6))
    settle = S((-8, 28, 2), (0.0, 0, -0.18 * (0.4 + 0.6 * st)), ("dir", _d(-5, -42), _d(-60, 12)),
               ("dir", _d(-60, -62)), _feet(SW_FEET, r=(0.0, -0.3 * st)))
    _slash_common(an, g, wind, wind2, mid, imp, ft, settle, wind_up, recover)
    return an.done()


@preset("sword_slash_2", "combat", "Combo hit 2: rising backhand left-to-right. Coil left with the hand across "
        "the belly and the blade cocked low, whip up across the front with a step, overshoot, back to guard.",
        params=dict(_SLASH_PARAMS, wind_up={"default": 0.14, "description": "anticipation time in seconds"},
                    tilt={"default": -12.0, "description": "slash plane tilt in degrees (- = rising from low-left "
                          "to high-right, + = descending)"}),
        weapon=SWORD)
def sword_slash_2(fps=60, speed=1.0, intensity=1.0, wind_up=0.14, tilt=-12.0, step=True, recover=True):
    g = sword_guard()
    an = Anim("SwordSlash2", fps, speed, intensity, g, description="Backhand slash left to right")
    st = 1.0 if step else 0.0
    lz = 0.4 + 0.6 * st
    wind = S((2, 44, 2), (-0.04, 0, 0.1), ("dir", _d(-46, 1 + tilt * 0.5), _d(-140, -45)),
             ("dir", _d(-115, -62)), _feet(SW_FEET, l=(0, 0.08 * st)), head=(0, -5))
    wind2 = with_(wind, torso=(3, 49, 3), arm=("dir", _d(-50, -1 + tilt * 0.5), _d(-145, -48)))
    mid = S((-3, 18, 1), (0.0, 0, -0.08), ("dir", _d(-18, 3 + tilt * 0.3), _d(25, -55)),
            ("dir", _d(-80, -45)), _feet(SW_FEET, r=(0, -0.35 * st, 0.1 * st)), head=(0, -5))
    imp = S((-8, -14, -3), (0.0, 0, -0.28 * lz), ("dir", _d(-20, -4 - tilt * 0.5), _d(62, -tilt * 0.6)),
            ("dir", _d(-35, -28)), _feet(SW_FEET, r=(0.05, -0.65 * st)), head=(0, -5))
    ft = S((-10, -32, -4), (0.02, 0, -0.32 * lz), ("dir", _d(62, 16 - tilt * 0.5), _d(132, 18 - tilt * 0.5)),
           ("dir", _d(-30, -20)), _feet(SW_FEET, r=(0.05, -0.65 * st)), head=(0, -5))
    settle = S((-7, -8, -2), (0.0, 0, -0.16 * lz), ("dir", _d(45, -38), _d(15, 42)),
               ("dir", _d(-30, -55)), _feet(SW_FEET, r=(0.0, -0.3 * st)))
    gather = S((-4, 30, 1), (-0.02, 0, 0.05), ("dir", _d(-25, -48), _d(-75, -5)), ("dir", _d(-70, -64)),
               SW_FEET, head=(0, -5))    # blade swings across to the left before cocking low
    _slash_common(an, g, wind, wind2, mid, imp, ft, settle, wind_up, recover, pre_wind=gather)
    return an.done()


@preset("sword_slash_3", "combat", "Combo finisher: overhead downward cut. Rise onto the back foot with the blade "
        "cocked behind the head, lunge and whip it over the top, heavy impact hold, rise back to guard.",
        params={"wind_up": {"default": 0.2, "description": "anticipation time in seconds"},
                "step": {"default": True, "description": "lunge forward with the front foot"},
                "hold": {"default": 0.12, "description": "seconds the impact pose is held (weight)"},
                "recover": {"default": True, "description": "return to the sword guard"}},
        weapon=SWORD)
def sword_slash_3(fps=60, speed=1.0, intensity=1.0, wind_up=0.2, step=True, hold=0.12, recover=True):
    g = sword_guard()
    an = Anim("SwordSlash3", fps, speed, intensity, g, description="Overhead finisher")
    st = 1.0 if step else 0.0
    lz = 0.35 + 0.65 * st
    wind = S((11, 6, -2), (0.0, 0, 0.18), ("dir", _d(15, 78), _d(180, 8)), ("dir", _d(-12, 6)),
             _feet(SW_FEET, r=(0, 0.1 * st)), head=(0, 0))
    wind2 = with_(wind, torso=(13, 4, -3), arm=("dir", _d(10, 86), _d(180, 2)))
    mid = S((-6, 6, 0), (0.0, 0, -0.12), ("dir", _d(5, 22), _d(180, 68)), ("dir", _d(-60, -30)),
            _feet(SW_FEET, r=(0, -0.4 * st, 0.12 * st)), head=(0, -3))
    imp = S((-23, 6, 0), (0.0, 0, -0.5 * lz), ("dir", _d(3, -64), _d(0, 24)), ("dir", _d(-165, -48)),
            _feet(SW_FEET, r=(0.03, -0.8 * st), l=(0, 0.1 * st)), head=(0, -8))
    ft = S((-27, 7, 1), (0.0, 0, -0.56 * lz), ("dir", _d(180, -84), _d(0, -14)), ("dir", _d(-170, -42)),
           _feet(SW_FEET, r=(0.03, -0.8 * st), l=(0, 0.1 * st)), head=(0, -10))
    held = with_(ft, torso=(-25, 7, 1), tpos=(0.0, 0, -0.54 * lz), arm=("dir", _d(180, -86), _d(0, -10)))
    settle = S((-11, 10, 0), (0.0, 0, -0.25 * lz), ("dir", _d(15, -58), _d(0, 12)), ("dir", _d(-60, -62)),
               _feet(SW_FEET, r=(0.0, -0.35 * st)), head=(0, -5))
    an.key(0.0, g)
    an.key(wind_up, wind, lag=3)
    t0 = wind_up + 0.08
    fm, fi = strike(an, (t0, wind2), mid, imp, t0 + 0.05, t0 + 0.085, "QUART")
    fe = an.key(t0 + 0.185, ft)
    t = t0 + 0.185 + max(0.02, hold)
    if recover:
        an.key(t, held)
        an.key(t + 0.15, settle, lag=4)
        an.key(t + 0.32, g)
    else:
        an.key(t, held)
    an.event(max(0, fm - 1), "Start")
    an.event(fi, "Hit")
    an.event(fe, "End")
    return an.done()


@preset("sword_heavy", "combat", "Charged heavy slash: deep coil with the blade raised over the right shoulder, "
        "trembling charge hold, explosive descending diagonal with a big step, long recovery.",
        params={"charge": {"default": 0.4, "description": "charge hold in seconds (0 = no hold)"},
                "step": {"default": True, "description": "big step-in on the release"},
                "shake": {"default": 1.0, "description": "charge tremble amplitude multiplier (0 = still)"}},
        weapon=SWORD)
def sword_heavy(fps=60, speed=1.0, intensity=1.0, charge=0.4, step=True, shake=1.0):
    g = sword_guard()
    an = Anim("SwordHeavy", fps, speed, intensity, g, priority="Action2", description="Charged heavy slash")
    st = 1.0 if step else 0.0
    wide = _feet(SW_FEET, r=(0.05, -0.15), l=(-0.05, 0.2))
    coil = S((6, -44, -6), (0.08, 0, 0.24), ("dir", _d(128, 44), _d(165, 40)), ("dir", _d(-14, 2)),
             wide, head=(0, -2))
    coil2 = with_(coil, torso=(8, -48, -7), tpos=(0.1, 0, 0.26), arm=("dir", _d(133, 48), _d(168, 38)))
    tense = with_(coil2, torso=(9, -51, -8), arm=("dir", _d(136, 50), _d(170, 37)))
    mid = S((-6, -8, -2), (0.0, 0, -0.12), ("dir", _d(78, 26), _d(20, 70)), ("dir", _d(-80, -40)),
            _feet(wide, r=(0, -0.45 * st, 0.14 * st)), head=(0, -4))
    imp = S((-15, 30, 5), (0.0, 0, -0.62 * (0.4 + 0.6 * st)), ("dir", _d(12, -22), _d(-62, -22)),
            ("dir", _d(-165, -40)), _feet(wide, r=(0.05, -0.85 * st), l=(0, 0.15 * st)), head=(0, -8))
    ft = S((-19, 50, 3), (0.0, 0, -0.66 * (0.4 + 0.6 * st)), ("dir", _d(-42, -46), _d(-125, -34)),
           ("dir", _d(-170, -38)), _feet(wide, r=(0.05, -0.85 * st), l=(0, 0.15 * st)), head=(0, -8))
    held = with_(ft, torso=(-17, 47, 2), arm=("dir", _d(-40, -50), _d(-118, -30)))
    settle = S((-10, 30, 2), (0.0, 0, -0.3), ("dir", _d(-5, -48), _d(-45, 15)), ("dir", _d(-60, -62)),
               _feet(SW_FEET, r=(0, -0.4 * st)), head=(0, -5))
    an.key(0.0, g)
    an.key(0.18, coil, lag=4)
    fc = an.key(0.26, coil2)
    an.event(fc, "Charge")
    t = 0.26
    n = int(charge / 0.07)
    for i in range(n):  # tremble: tiny alternating offsets, sharper toward the release
        t += charge / max(1, n)
        amp = shake * (0.6 + 0.8 * i / max(1, n - 1)) * (1 if i % 2 == 0 else -1)
        jitter = with_(coil2, torso=(8 + 0.4 * amp, -48 - 1.2 * (i + 1) / n - 0.5 * amp, -7),
                       arm=("dir", _d(133 + 1.5 * amp, 48 + 1.0 * amp), _d(168, 38)))
        an.key(t, jitter, "LINEAR" if shake else "BEZIER")
    t0 = t + 0.05
    fm, fi = strike(an, (t0, tense), mid, imp, t0 + 0.07, t0 + 0.105, "QUART")
    fe = an.key(t0 + 0.235, ft)
    an.key(t0 + 0.32, held)
    an.key(t0 + 0.47, settle, lag=4)
    an.key(t0 + 0.66, g)
    an.event(max(0, fm - 1), "Start")
    an.event(fi, "Hit")
    an.event(fe, "End")
    return an.done()


@preset("sword_thrust", "combat", "Lunging thrust: chamber the blade at the right side (body coiled, off-hand "
        "aiming), drive the shoulder and the front foot forward, extension hold, retract to guard.",
        params={"wind_up": {"default": 0.18, "description": "chamber time in seconds"},
                "reach": {"default": 1.0, "description": "lunge depth multiplier (0.3 .. 1.6)"},
                "height": {"default": "mid", "description": "mid (chest), high (face) or low (belly)"}},
        weapon=SWORD)
def sword_thrust(fps=60, speed=1.0, intensity=1.0, wind_up=0.18, reach=1.0, height="mid"):
    g = sword_guard()
    an = Anim("SwordThrust", fps, speed, intensity, g, description="Lunging thrust (%s)" % height)
    el = {"high": 8.0, "low": -14.0}.get(height, -3.0)
    chamber = S((2, -24, -3), (0.05, 0, 0.22), ("dir", _d(128, -16 + el * 0.5), _d(-4, el)),
                ("dir", _d(-8, -2 + el * 0.3)), _feet(SW_FEET, r=(0, 0.12)), head=(0, -3 + el * 0.3))
    chamber2 = with_(chamber, torso=(3, -28, -3), tpos=(0.06, 0, 0.25),
                     arm=("dir", _d(132, -16 + el * 0.5), _d(-3, el)))
    mid = S((-5, 6, 0), (0.0, 0, -0.2 * reach), ("dir", _d(110, -8 + el * 0.3), _d(-6, el)),
            ("dir", _d(-90, -40)), _feet(SW_FEET, r=(0, -0.45 * reach, 0.12)), head=(0, -3 + el * 0.3))
    imp = S((-11, 34, 2), (0.0, 0, -0.6 * reach), ("dir", _d(80, -6 + el * 0.4), _d(-10, el)),
            ("dir", _d(-155, -50)), _feet(SW_FEET, r=(0.02, -0.95 * reach), l=(0, 0.1 * reach)),
            head=(0, -4 + el * 0.4))
    ext = with_(imp, torso=(-12, 36, 2), tpos=(0.0, 0, -0.66 * reach),
                arm=("dir", _d(78, -6 + el * 0.4), _d(-11, el - 1)))
    back = S((-7, 22, 1), (0.0, 0, -0.3 * reach), ("dir", _d(60, -30), _d(-8, 15)), ("dir", _d(-70, -60)),
             _feet(SW_FEET, r=(0, -0.4 * reach)))
    an.key(0.0, g)
    an.key(wind_up, chamber, lag=3)
    t0 = wind_up + 0.06
    fm, fi = strike(an, (t0, chamber2), mid, imp, t0 + 0.045, t0 + 0.08, "QUART")
    fe = an.key(t0 + 0.17, ext)
    an.key(t0 + 0.31, back, lag=3)
    an.key(t0 + 0.47, g)
    an.event(max(0, fm - 1), "Start")
    an.event(fi, "Hit")
    an.event(fe, "End")
    return an.done()


def _block_pose(height, support, width, push=0.0):
    el = 30.0 if height == "high" else 6.0
    torso = (-4 + push * 2, 8, 0)
    return S(torso, (0.0, 0, 0.06 - 0.04 * push), ("dir", _d(14, el + push * 3), _d(-84, 4)),
             None if support else ("dir", _d(-30, -60)),
             _feet(SW_FEET, r=(0.05, 0.1), l=(-0.05, 0.05), width=width),
             head=(0, -9 if height == "high" else -4))


@preset("sword_block", "combat", "Block hold (loop): blade horizontal in front of the face, off-hand bracing the "
        "flat, braced stance with a tense micro push.",
        params={"height": {"default": "high", "description": "high (blade in front of the face) or mid (chest)"},
                "support": {"default": True, "description": "left hand braces the flat of the blade"},
                "stance": {"default": 1.0, "description": "stance width multiplier"}},
        weapon=SWORD, loop=True)
def sword_block(fps=60, speed=1.0, intensity=1.0, height="high", support=True, stance=1.0):
    base = _block_pose(height, support, stance)
    an = Anim("SwordBlock", fps, speed, 1.0, None, priority="Action", loop=True,
              description="Sword block hold (%s)" % height)
    k = intensity
    push = _block_pose(height, support, stance, push=k)
    j0 = an.solve(base)
    j1 = an.solve(push)
    if support:
        for j in (j0, j1):
            j["Left Arm"] = _brace(j["Right Arm"])
    an.joints(j0, 0.0)
    an.joints(j1, 0.8)
    an.joints(j0, 1.6)
    return an.done()


def _brace(rarm, dist=2.2):
    """Left arm pressing the flat of the blade `dist` studs from the grip."""
    target = handle_frame(rarm) @ Vector((0.0, dist, -0.15))
    return aim_arm("Left", target)


@preset("sword_parry", "combat", "Parry: tiny dip, snap the blade upright to meet the strike, deflect "
        "(\"Parry\" marker), recoil from the impact and settle back to guard.",
        params={"side": {"default": "outside", "description": "outside (deflect to the right) or inside (left)"},
                "recoil": {"default": 1.0, "description": "recoil amount multiplier (0 = none)"}},
        weapon=SWORD)
def sword_parry(fps=60, speed=1.0, intensity=1.0, side="outside", recoil=1.0):
    g = sword_guard()
    an = Anim("SwordParry", fps, speed, intensity, g, description="Parry (%s)" % side)
    s = 1.0 if side != "inside" else -1.0
    r = recoil
    dip = with_(g, torso=(-8, 15, 0), arm=("dir", _d(18, -55), _d(0, 22)))
    # the knock-back pose is the snap pose pushed by `recoil` (0 = the blade just stays where it met the hit)
    if s > 0:
        snap = S((-4, 2, -2), (0.0, 0, -0.05), ("dir", _d(42, -12), _d(-8, 76)), ("dir", _d(-35, -55)),
                 g["feet"], head=(0, -3))
        knock = S((-4 + 9 * r, 2 - 10 * r, -2 - 2 * r), (0.04 * r, 0, -0.05 + 0.21 * r),
                  ("dir", _d(42 + 32 * r, -12 + 22 * r), _d(-8 + 48 * r, 76 - 4 * r)),
                  ("dir", _d(-35 - 5 * r, -55 + 7 * r)), _feet(SW_FEET, r=(0, 0.06 * r)),
                  head=(4 * r, -3 + 5 * r, 6 * r))
    else:
        snap = S((-4, 30, 2), (0.0, 0, -0.05), ("dir", _d(-12, -18), _d(12, 76)), ("dir", _d(-45, -60)),
                 g["feet"], head=(0, -3))
        knock = S((-4 + 9 * r, 30 + 8 * r, 2 + 2 * r), (-0.04 * r, 0, -0.05 + 0.21 * r),
                  ("dir", _d(-12 - 21 * r, -18 + 26 * r), _d(12 - 57 * r, 76 - 4 * r)),
                  ("dir", _d(-45 - 15 * r, -60 + 10 * r)), _feet(SW_FEET, r=(0, 0.06 * r)),
                  head=(-4 * r, -3 + 5 * r, -6 * r))
    settle = with_(g, torso=(-5, 12, 0), arm=("dir", _d(22, -45), _d(-2, 34)))
    an.key(0.0, g)
    fs = an.key(0.035, dip, "QUART", "EASE_IN")
    fp = an.key(0.1, snap, "BACK", "EASE_OUT")
    fk = an.key(0.2, knock)
    an.key(0.34, settle, lag=3)
    an.key(0.5, g)
    an.event(fs, "Start")
    an.event(fp, "Parry")
    an.event(fk, "End")
    return an.done()


NEUTRAL_FEET = {"R": (0.6, -0.15), "L": (-0.6, 0.15)}


@preset("sword_equip", "combat", "Draw the sword: reach for the hilt, rip it out in a wide arc, optional "
        "upright flourish, drop into the sword guard with a settle while the feet set the stance.",
        params={"style": {"default": "hip", "description": "hip (scabbard on the left hip) or back (over the "
                          "right shoulder)"},
                "flourish": {"default": True, "description": "raise the blade upright before taking guard"}},
        weapon=SWORD)
def sword_equip(fps=60, speed=1.0, intensity=1.0, style="hip", flourish=True):
    g = sword_guard()
    an = Anim("SwordEquip", fps, speed, intensity, g, description="Sword draw (%s)" % style)
    rest = S((0, 0, 0), arm=[0.0, 0.0, 0.0], larm=[0.0, 0.0, 0.0], feet=NEUTRAL_FEET, head=(0, 0))
    if style == "back":
        reach = S((4, -12, -3), (0.0, 0, 0.05), ("dir", _d(150, 76), _d(180, -40)), ("dir", _d(-20, -70)),
                  NEUTRAL_FEET, head=(10, -2))
        draw = S((-2, 4, 0), (0.0, 0, -0.04), ("dir", _d(30, 55), _d(170, 30)), ("dir", _d(-25, -65)),
                 _feet(NEUTRAL_FEET, r=(0.03, -0.3, 0.1)), head=(0, 0))
    else:
        reach = S((-8, 24, 2), (0.0, 0, 0.02), ("grip", (-0.3, -1.3, -1.45), _d(175, -28)),
                  ("dir", _d(-115, -72)), NEUTRAL_FEET, head=(-25, -32))
        draw = S((-2, -6, -2), (0.0, 0, -0.04), ("dir", _d(75, 32), _d(40, 30)), ("dir", _d(-60, -72)),
                 _feet(NEUTRAL_FEET, r=(0.03, -0.3, 0.1)), head=(5, -4))
    salute = S((-3, 6, 0), (0.0, 0, -0.03), ("dir", _d(20, -18), _d(-6, 82)), ("dir", _d(-35, -66)),
               _feet(SW_FEET, r=(0, 0.15)), head=(0, -3))
    an.key(0.0, rest)
    if style != "back":   # the arm crosses the belly first (keeps the hand-to-hilt path readable)
        an.key(0.07, S((-4, 12, 1), (0.0, 0, 0.01), ("dir", _d(-15, -72), _d(-80, -20)), ("dir", _d(-60, -75)),
                       NEUTRAL_FEET, head=(-12, -18)))
    fr = an.key(0.15, reach, lag=3)
    if style != "back":   # the hand pulls the blade out across the front of the belly
        an.key(0.225, S((-5, 10, 0), (0.0, 0, -0.01), ("dir", _d(10, -28), _d(-95, 8)), ("dir", _d(-90, -70)),
                        _feet(NEUTRAL_FEET, r=(0.02, -0.15, 0.05)), head=(-8, -14)))
    fd = an.key(0.3, draw, "BACK", "EASE_OUT")        # the draw overshoots into the next pose
    t = 0.3
    if flourish:
        an.key(0.43, salute)
        an.key(0.52, with_(salute, arm=("dir", _d(22, -20), _d(-5, 84))), "BACK", "EASE_OUT")
        t = 0.52
    an.key(t + 0.17, with_(g, torso=(-7, 15, 0)))
    fend = an.key(t + 0.3, g)
    an.event(fr, "Grab")
    an.event(fd, "Draw")
    an.event(fend, "Ready")
    return an.done()


# ---------------------------------------------------------------------------------------------
# greatsword (two hands: right hand on top, left hand 0.8 stud lower on the grip)
# ---------------------------------------------------------------------------------------------

GS_FEET = {"R": (0.45, -1.2), "L": (-0.4, 1.2)}
GS_GRIP = 0.6


def greatsword_guard():
    """Two-handed mid guard: hands well in front of the stomach (arms clear of the torso), long blade
    angled up at the opponent."""
    return S((-5, 10, 0), arm=("grip", (0.05, -0.1, -1.35), _d(-4, 42)), feet=GS_FEET)


@preset("greatsword_slam", "combat", "Two-handed overhead slam: lift the greatsword behind the head, rise on the "
        "back foot, whip it over the top into the ground with a lunge (Hit value 'slam'), embedded hold, "
        "heavy pull-out back to guard.",
        params={"wind_up": {"default": 0.32, "description": "lift time in seconds"},
                "hold": {"default": 0.18, "description": "seconds the blade stays planted after impact"},
                "hop": {"default": False, "description": "small leap into the slam (feet leave the ground)"}},
        weapon=GREATSWORD)
def greatsword_slam(fps=60, speed=1.0, intensity=1.0, wind_up=0.32, hold=0.18, hop=False):
    g = greatsword_guard()
    an = Anim("GreatswordSlam", fps, speed, intensity, g, priority="Action2", two_hand=True, grip=GS_GRIP,
              description="Greatsword overhead slam")
    up = 0.35 if hop else 0.0
    lift = S((6, 6, -1), (0.0, 0, 0.08), ("grip", (0.0, 0.7, -1.2), _d(5, 82)), feet=GS_FEET, head=(0, -2))
    wind = S((13, 4, -2), (0.0, 0, 0.2), ("grip", (-0.05, 1.85, 0.0), _d(180, 42)),
             feet=_feet(GS_FEET, r=(0, 0.12)), head=(0, 0))
    wind2 = with_(wind, torso=(15, 3, -2), tpos=(0.0, 0, 0.24), arm=("grip", (-0.05, 1.9, 0.1), _d(180, 34)))
    mid = S((-8, 4, 0), (0.0, 0, -0.18), ("grip", (-0.05, 1.45, -1.1), _d(0, 86)),
            feet=_feet(GS_FEET, r=(0, -0.4, 0.15 + up), l=(0, 0, up)), head=(0, -3))
    # impact: deep forward lean, hands low in front, hands slid closer on the grip (0.45): the lowest blade
    # a two-handed R6 grip allows (the blade is perpendicular to the arms) - tip around shin height in front
    imp = S((-40, 4, 0), (0.0, 0, -0.6), ("grip", (-0.1, -0.1, -1.4), _d(0, -34)),
            feet=_feet(GS_FEET, r=(0.03, -0.75), l=(0, 0.15)), head=(0, -16), grip=0.45)
    ft = with_(imp, torso=(-43, 4, 0), tpos=(0.0, 0, -0.64), arm=("grip", (-0.1, -0.2, -1.38), _d(0, -36)))
    held = with_(ft, torso=(-41, 5, 0), tpos=(0.0, 0, -0.62), arm=("grip", (-0.1, -0.15, -1.4), _d(0, -35)))
    pull = S((-14, 8, 0), (0.0, 0, -0.3), ("grip", (0.05, -0.2, -1.35), _d(0, 8)),
             feet=_feet(GS_FEET, r=(0.0, -0.35)), head=(0, -5))
    an.key(0.0, g)
    an.key(wind_up * 0.5, lift)
    an.key(wind_up, wind, lag=4)
    t0 = wind_up + 0.1
    fm, fi = strike(an, (t0, wind2), mid, imp, t0 + 0.055, t0 + 0.095, "QUART")
    fe = an.key(t0 + 0.175, ft)
    t = t0 + 0.175 + max(0.03, hold)
    an.key(t, held)
    an.key(t + 0.22, pull, lag=4)
    an.key(t + 0.48, g)
    an.event(max(0, fm - 1), "Start")
    an.event(fi, "Hit", "slam")
    an.event(fe, "End")
    return an.done()


@preset("greatsword_sweep", "combat", "Two-handed horizontal sweep right-to-left: coil with the blade cocked over "
        "the right shoulder (bat-swing load), drive the hips, flatten the blade across the front, wrap over the "
        "left shoulder, recover.",
        params={"wind_up": {"default": 0.3, "description": "coil time in seconds"},
                "height": {"default": "mid", "description": "mid (waist/chest) or low (knees)"},
                "step": {"default": True, "description": "step in with the front foot"}},
        weapon=GREATSWORD)
def greatsword_sweep(fps=60, speed=1.0, intensity=1.0, wind_up=0.3, height="mid", step=True):
    g = greatsword_guard()
    an = Anim("GreatswordSweep", fps, speed, intensity, g, priority="Action", two_hand=True, grip=GS_GRIP,
              pivot=0.85, description="Greatsword sweep (%s)" % height)
    st = 1.0 if step else 0.0
    low = height == "low"
    el = -16.0 if low else 0.0
    dip = -0.12 if low else 0.0
    wind = S((4, -56, -2), (0.08, 0, 0.16), ("grip", (0.65, 0.5, -0.95), _d(150, 55)),
             feet=_feet(GS_FEET, r=(0.05, 0.1)), head=(0, -3))
    wind2 = with_(wind, torso=(5, -60, -3), tpos=(0.1, 0, 0.18), arm=("grip", (0.7, 0.55, -0.9), _d(155, 58)))
    mid = S((-3 - 4 * low, -24, -2), (0.0, 0, -0.06), ("grip", (0.3, 0.05 + dip, -1.3), _d(85, 18 + el * 0.5)),
            feet=_feet(GS_FEET, r=(0, -0.3 * st, 0.12 * st)), head=(0, -4))
    imp = S((-9 - 8 * low, 12, 1), (0.0, 0, -0.32 * (0.4 + 0.6 * st)),
            ("grip", (0.1, -0.15 + dip, -1.38), _d(-25, el)),
            feet=_feet(GS_FEET, r=(0.03, -0.6 * st), l=(0, 0.1 * st)), head=(0, -5))
    ft = S((-7 - 4 * low, 52, 2), (0.0, 0, -0.34 * (0.4 + 0.6 * st)), ("grip", (-0.45, 0.3, -1.1), _d(-120, 35)),
           feet=_feet(GS_FEET, r=(0.03, -0.6 * st), l=(0, 0.1 * st)), head=(0, -5))
    held = with_(ft, torso=(-6, 49, 2), arm=("grip", (-0.42, 0.25, -1.1), _d(-115, 32)))
    settle = S((-7, 25, 1), (0.0, 0, -0.18), ("grip", (0.05, -0.2, -1.3), _d(-40, 25)),
               feet=_feet(GS_FEET, r=(0, -0.3 * st)), head=(0, -4))
    an.key(0.0, g)
    an.inbetween(wind_up * 0.5, g, wind, 0.45)      # planted breakdown while the stance pivots into the coil
    an.key(wind_up, wind, lag=4)
    t0 = wind_up + 0.08
    fm, fi = strike(an, (t0, wind2), mid, imp, t0 + 0.055, t0 + 0.095, "CUBIC")
    fe = an.key(t0 + 0.21, ft)
    an.key(t0 + 0.31, held)
    an.key(t0 + 0.5, settle, lag=4)
    an.key(t0 + 0.72, g)
    an.event(max(0, fm - 1), "Start")
    an.event(fi, "Hit")
    an.event(fe, "End")
    return an.done()


# ---------------------------------------------------------------------------------------------
# spear (two hands: left hand 1 stud ahead on the shaft, left side forward)
# ---------------------------------------------------------------------------------------------

SP_BASE = {"R": (0.42, 1.25), "L": (-0.45, -1.2)}
SP_YAW = -45.0                          # body turned right: left side toward the opponent
SP_FEET = _feet(SP_BASE, turn=SP_YAW + 5)   # stance aligned with the hips
SP_GRIP = -1.0                          # lead (left) hand one stud toward the tip
# (shaft elevation, right-hand point in torso space) of the overhand hold per target height
_SP_HOLD = {"high": (-12.0, Vector((0.8, 1.8, -0.2))), "mid": (-20.0, Vector((0.6, 1.8, -0.2))),
            "low": (-30.0, Vector((0.4, 1.55, -0.2)))}


def spear_guard(height="mid"):
    """Overhand (hoplite) spear guard, side-on: right hand above the shoulder, lead hand one stud ahead on
    the shaft, tip angled down at the opponent's chest. The Roblox grip keeps the shaft perpendicular to the
    arm, so a forward-pointing two-handed spear needs the hands high (a low hold would aim the tip up)."""
    el, hand = _SP_HOLD.get(height, _SP_HOLD["mid"])
    return S((-2, SP_YAW, 0), arm=("grip", tuple(hand), _d(0, el)), feet=SP_FEET, head=(0, -3))


def _staff_dir(torso, drop=0.0):
    """World direction of the torso's left side, tipped `drop` degrees down (staff hold across the body)."""
    return _rmat(torso_rot(*torso)) @ Vector((-math.cos(math.radians(drop)), -math.sin(math.radians(drop)), 0.0))


@preset("spear_thrust", "combat", "Two-handed overhand spear thrust: chamber the shaft back over the shoulder "
        "(weight on the back foot), untwist and lunge on the lead foot to drive the tip along its own line, "
        "extension, retract to the overhand guard.",
        params={"wind_up": {"default": 0.18, "description": "chamber time in seconds"},
                "reach": {"default": 1.0, "description": "lunge depth multiplier (0.3 .. 1.6)"},
                "height": {"default": "mid", "description": "mid (chest), high (face) or low (legs)"}},
        weapon=SPEAR)
def spear_thrust(fps=60, speed=1.0, intensity=1.0, wind_up=0.18, reach=1.0, height="mid"):
    g = spear_guard()
    an = Anim("SpearThrust", fps, speed, intensity, g, two_hand=True, grip=SP_GRIP,
              description="Spear thrust (%s)" % height)
    el, h = _SP_HOLD.get(height, _SP_HOLD["mid"])
    y = SP_YAW

    def hand(dx, dy, dz):
        return ("grip", tuple(h + Vector((dx, dy, dz))))

    # the shaft angle is tied to the arm angle (Roblox grip), so the hands stay in the hold and the drive
    # comes from the body: weight back + coil, then lunge and untwist (the right shoulder travels forward)
    chamber = S((5, y - 18, -2), (0.0, 0, 0.25), hand(0.05, 0.05, 0.1) + (_d(0, el + 4),),
                feet=_feet(SP_FEET, l=(0, 0.1)), head=(0, -2))
    chamber2 = with_(chamber, torso=(6, y - 20, -2), tpos=(0.0, 0, 0.28), arm=hand(0.05, 0.05, 0.12) + (_d(0, el + 4),))
    mid = S((0, y - 2, -1), (0.0, 0, -0.25 * reach), hand(0.0, 0.0, 0.0) + (_d(0, el + 2),),
            feet=_feet(SP_FEET, l=(0, -0.45 * reach, 0.12)), head=(0, -3))
    imp = S((-2, y + 3, 1), (0.0, 0, -0.95 * reach), hand(0.0, 0.0, -0.05) + (_d(0, el),),
            feet=_feet(SP_FEET, l=(0.02, -1.05 * reach), r=(0, 0.1 * reach)), head=(0, -5))
    ext = with_(imp, torso=(-3, y + 4, 1), tpos=(0.0, 0, -1.02 * reach), arm=hand(0.0, 0.0, -0.06) + (_d(0, el - 1),))
    back = S((-2, y + 2, 0), (0.0, 0, -0.35 * reach), hand(0.0, 0.0, 0.0) + (_d(0, el * 0.5 - 10),),
             feet=_feet(SP_FEET, l=(0, -0.4 * reach)), head=(0, -3))
    an.key(0.0, g)
    an.key(wind_up, chamber, lag=3)
    t0 = wind_up + 0.05
    fm, fi = strike(an, (t0, chamber2), mid, imp, t0 + 0.045, t0 + 0.08, "QUART")
    fe = an.key(t0 + 0.17, ext)
    an.key(t0 + 0.32, back, lag=3)
    an.key(t0 + 0.48, g)
    an.event(max(0, fm - 1), "Start")
    an.event(fi, "Hit")
    an.event(fe, "End")
    return an.done()


@preset("spear_sweep", "combat", "Two-handed spear sweep left-to-right (staff hold): drop the shaft across the "
        "body with the head on the left, coil left, whip the hips round so the trailing spearhead slices across "
        "the front at hip/knee height (trip / crowd control), follow through, back to the overhand guard.",
        params={"wind_up": {"default": 0.24, "description": "coil time in seconds"},
                "height": {"default": "low", "description": "low (knees) or mid (waist)"},
                "arc": {"default": 1.0, "description": "sweep width multiplier (0.6 .. 1.3)"}},
        weapon=SPEAR)
def spear_sweep(fps=60, speed=1.0, intensity=1.0, wind_up=0.24, height="low", arc=1.0):
    g = spear_guard()
    an = Anim("SpearSweep", fps, speed, intensity, g, two_hand=True, grip=SP_GRIP, pivot=0.85,
              description="Spear sweep (%s)" % height)
    low = height == "low"
    lean = -18.0 if low else -6.0
    drop = 16.0 if low else 4.0          # spearhead tipped down toward the knees
    staff = (0.9, 0.0, -1.5)             # right hand in the staff hold (torso space)
    y = SP_YAW
    wide = _feet(SP_FEET, r=(0.05, 0.15), l=(-0.05, -0.15))

    def pose_at(lean_, yaw, tilt, tpos, hand=staff, feet=wide, head=(0, -6)):
        torso = (lean_, yaw, tilt)
        return S(torso, tpos, ("grip", hand, _staff_dir(torso, drop)), feet=feet, head=head)

    wind = pose_at(2, y + 48 * arc, 3, (-0.04, 0, 0.12))
    wind2 = pose_at(3, y + 53 * arc, 3, (-0.05, 0, 0.14))
    mid = pose_at(lean * 0.6, y - 5 * arc, 0, (0.0, 0, -0.06), head=(0, -8))
    imp = pose_at(lean, y - 48 * arc, -2, (0.0, 0, -0.18), head=(0, -8))
    ft = pose_at(lean * 0.8, y - 82 * arc, -2, (0.0, 0, -0.2), feet=_feet(wide, r=(0.0, -0.15)))
    held = pose_at(lean * 0.75, y - 78 * arc, -2, (0.0, 0, -0.2), feet=_feet(wide, r=(0.0, -0.15)))
    settle = S((-4, y - 20, 0), (0.0, 0, -0.08), ("grip", (0.7, 1.3, -0.4), _d(10, -12)), feet=SP_FEET,
               head=(0, -4))
    an.key(0.0, g)
    an.inbetween(wind_up * 0.5, g, wind, 0.5)        # shaft drops from overhand to the staff hold
    an.key(wind_up, wind, lag=3)
    t0 = wind_up + 0.07
    fm, fi = strike(an, (t0, wind2), mid, imp, t0 + 0.05, t0 + 0.09, "CUBIC")
    fe = an.key(t0 + 0.2, ft)
    an.key(t0 + 0.3, held)
    an.inbetween(t0 + 0.385, held, settle, 0.5)      # and rises back, the lead hand keeping its grip
    an.key(t0 + 0.47, settle, lag=3)
    an.key(t0 + 0.66, g)
    an.event(max(0, fm - 1), "Start")
    an.event(fi, "Hit")
    an.event(fe, "End")
    return an.done()


# ---------------------------------------------------------------------------------------------
# dagger
# ---------------------------------------------------------------------------------------------

DG_FEET = {"R": (0.45, -1.15), "L": (-0.42, 1.15)}


def dagger_guard():
    """Low crouched knife guard: blade forward at the belly, off-hand up in front of the chest."""
    return S((-12, 18, 0), (0.0, 0, -0.05), ("dir", _d(28, -38), _d(-6, 18)), ("dir", _d(-12, -8)),
             DG_FEET, head=(0, -2))


@preset("dagger_combo", "combat", "Fast dagger string: forehand slash, backhand slash chained from its "
        "follow-through, then a lunging overhand stab (3 Hit markers valued 1/2/3), back to the knife guard.",
        params={"hits": {"default": 3, "description": "2 (slash, backhand) or 3 (+ lunging stab)"},
                "step": {"default": True, "description": "shuffle-step into each hit"},
                "tempo": {"default": 1.0, "description": "time multiplier between hits (0.7 frantic .. 1.4)"}},
        weapon=DAGGER)
def dagger_combo(fps=60, speed=1.0, intensity=1.0, hits=3, step=True, tempo=1.0):
    g = dagger_guard()
    an = Anim("DaggerCombo", fps, speed, intensity, g, description="Dagger %d-hit combo" % hits)
    st = 1.0 if step else 0.0
    T = float(tempo)
    w1 = S((-8, -16, -2), (0.02, 0, 0.08), ("dir", _d(102, 6), _d(35, 55)), ("dir", _d(-10, -2)),
           _feet(DG_FEET, r=(0, 0.05)), head=(0, -3))
    m1 = S((-10, 6, 0), (0.0, 0, -0.08), ("dir", _d(65, -2), _d(0, 25)), ("dir", _d(-60, -30)),
           _feet(DG_FEET, r=(0, -0.2 * st, 0.08 * st)), head=(0, -3))
    i1 = S((-13, 30, 3), (0.0, 0, -0.22 * st), ("dir", _d(18, -10), _d(-62, -8)), ("dir", _d(-140, -45)),
           _feet(DG_FEET, r=(0, -0.4 * st)), head=(0, -4))
    f1 = S((-13, 42, 1), (0.0, 0, -0.25 * st), ("dir", _d(-42, -20), _d(-128, -6)), ("dir", _d(-150, -45)),
           _feet(DG_FEET, r=(0, -0.4 * st)), head=(0, -4))
    r2 = S((-12, 40, 1), (0.0, 0, -0.24 * st), ("dir", _d(-37, -16), _d(-145, -48)), ("dir", _d(-140, -50)),
           _feet(DG_FEET, r=(0, -0.4 * st)), head=(0, -4))      # re-cock the blade low for the backhand
    m2 = S((-11, 15, 0), (0.0, 0, -0.2 * st), ("dir", _d(-15, -9), _d(20, -45)), ("dir", _d(-80, -40)),
           _feet(DG_FEET, r=(0, -0.4 * st)), head=(0, -4))
    i2 = S((-11, -16, -3), (0.0, 0, -0.3 * st), ("dir", _d(-12, -6), _d(66, 6)), ("dir", _d(-35, -25)),
           _feet(DG_FEET, r=(0, -0.55 * st)), head=(0, -4))
    f2 = S((-10, -30, -4), (0.0, 0, -0.3 * st), ("dir", _d(60, 12), _d(132, 15)), ("dir", _d(-25, -20)),
           _feet(DG_FEET, r=(0, -0.55 * st)), head=(0, -4))
    c3 = S((-3, -26, -3), (0.03, 0, 0.12), ("dir", _d(118, 34), _d(-4, -8)), ("dir", _d(-8, 0)),
           _feet(DG_FEET, r=(0, -0.15 * st)), head=(0, -2))
    c3b = with_(c3, torso=(-2, -29, -3), arm=("dir", _d(122, 36), _d(-3, -6)))
    m3 = S((-9, 0, 0), (0.0, 0, -0.25), ("dir", _d(85, 30), _d(-6, -12)), ("dir", _d(-80, -40)),
           _feet(DG_FEET, r=(0, -0.6 * st, 0.12 * st)), head=(0, -4))
    i3 = S((-17, 26, 2), (0.0, 0, -0.62), ("dir", _d(42, 16), _d(-8, -20)), ("dir", _d(-150, -50)),
           _feet(DG_FEET, r=(0.02, -0.95 * st), l=(0, 0.1 * st)), head=(0, -6))
    f3 = with_(i3, torso=(-18, 28, 2), tpos=(0.0, 0, -0.66), arm=("dir", _d(40, 12), _d(-8, -24)))
    settle = S((-12, 22, 1), (0.0, 0, -0.25), ("dir", _d(30, -30), _d(-6, 12)), ("dir", _d(-30, -30)),
               _feet(DG_FEET, r=(0, -0.3 * st)), head=(0, -3))
    an.key(0.0, g)
    an.key(0.07 * T, w1)
    fm1, fi1 = strike(an, (0.1 * T, w1), m1, i1, 0.1 * T + 0.03, 0.1 * T + 0.065, "CUBIC")
    fe1 = an.key(0.1 * T + 0.13, f1)
    t = 0.1 * T + 0.13 + 0.07 * T
    fm2, fi2 = strike(an, (t, r2), m2, i2, t + 0.05, t + 0.085, "CUBIC")
    fe2 = an.key(t + 0.14, f2)
    marks = [(fm1, fi1, fe1, "1"), (fm2, fi2, fe2, "2")]
    t += 0.14
    if int(hits) >= 3:
        an.key(t + 0.05 * T, S((-6, -28, -3), (0.02, 0, -0.05), ("dir", _d(85, 18), _d(100, 85)), ("dir", _d(-15, -10)),
                               _feet(DG_FEET, r=(0, -0.3 * st)), head=(0, -3)))   # blade flips over the top
        an.key(t + 0.1 * T, c3, lag=2)
        t3 = t + 0.1 * T + 0.05
        fm3, fi3 = strike(an, (t3, c3b), m3, i3, t3 + 0.035, t3 + 0.072, "QUART")
        fe3 = an.key(t3 + 0.14, f3)
        marks.append((fm3, fi3, fe3, "3"))
        t = t3 + 0.14
    an.key(t + 0.15, settle, lag=3)
    an.key(t + 0.32, g)
    for fm, fi, fe, v in marks:
        an.event(max(0, fm - 1), "Start", v)
        an.event(fi, "Hit", v)
        an.event(fe, "End", v)
    return an.done()


# ---------------------------------------------------------------------------------------------
# axe
# ---------------------------------------------------------------------------------------------

def _axe_specs(two):
    """(guard, wind, wind2, mid, impact, follow, tug, settle) arm specs for one- or two-handed chops."""
    if two:
        return (("grip", (0.05, -0.15, -1.35), _d(0, 42)), ("grip", (0.1, 1.85, 0.05), _d(180, 28)),
                ("grip", (0.1, 1.9, 0.12), _d(180, 22)), ("grip", (0.05, 1.4, -1.1), _d(0, 84)),
                ("grip", (0.05, -0.1, -1.42), _d(0, 14)), ("grip", (0.05, -0.25, -1.4), _d(0, 8)),
                ("grip", (0.05, -0.15, -1.38), _d(0, 12)), ("grip", (0.05, -0.25, -1.3), _d(0, 30)))
    return (("dir", _d(18, -55), _d(0, 32)), ("dir", _d(25, 80), _d(180, 12)),
            ("dir", _d(22, 86), _d(180, 4)), ("dir", _d(8, 24), _d(180, 66)),
            ("dir", _d(4, -60), _d(0, 28)), ("dir", _d(4, -70), _d(0, 18)),
            ("dir", _d(6, -64), _d(0, 24)), ("dir", _d(15, -55), _d(0, 22)))


@preset("axe_chop", "combat", "Heavy axe chop: lean back with the axe raised behind the head, whip it over the top "
        "into a deep lunge, the head bites in (hold), yank it out and recover.",
        params={"wind_up": {"default": 0.28, "description": "raise time in seconds"},
                "two_handed": {"default": False, "description": "both hands on the haft (left hand from "
                               "two_hand_left)"},
                "step": {"default": True, "description": "lunge forward with the front foot"}},
        weapon=AXE)
def axe_chop(fps=60, speed=1.0, intensity=1.0, wind_up=0.28, two_handed=False, step=True):
    two = bool(two_handed)
    ga, wa, wa2, ma, ia, fa, ta, sa = _axe_specs(two)
    st = 1.0 if step else 0.0
    lz = 0.35 + 0.65 * st
    free = (lambda d: None) if two else (lambda d: ("dir", d))
    g = S((-6, 12, 0), arm=ga, larm=free(_d(-26, -64)), feet=SW_FEET)
    an = Anim("AxeChop", fps, speed, intensity, g, two_hand=two, grip=0.7,
              description="Axe chop (%s)" % ("two-handed" if two else "one-handed"))
    wind = S((14, -8, -4), (0.04, 0, 0.2), wa, free(_d(-12, 8)), _feet(SW_FEET, r=(0, 0.12)), head=(0, 0))
    wind2 = with_(wind, torso=(16, -9, -4), tpos=(0.05, 0, 0.23), arm=wa2)
    mid = S((-6, 6, 0), (0.0, 0, -0.15), ma, free(_d(-60, -30)), _feet(SW_FEET, r=(0, -0.4 * st, 0.14 * st)),
            head=(0, -3))
    imp = S((-26, 8, 1), (0.0, 0, -0.52 * lz), ia, free(_d(-165, -45)),
            _feet(SW_FEET, r=(0.03, -0.8 * st), l=(0, 0.12 * st)), head=(0, -10))
    ft = with_(imp, torso=(-29, 8, 1), tpos=(0.0, 0, -0.57 * lz), arm=fa)
    tug = with_(imp, torso=(-22, 5, 0), tpos=(0.0, 0, -0.5 * lz), arm=ta)
    settle = S((-11, 11, 0), (0.0, 0, -0.25 * lz), sa, free(_d(-50, -62)), _feet(SW_FEET, r=(0, -0.35 * st)),
               head=(0, -5))
    an.key(0.0, g)
    an.key(wind_up, wind, lag=4)
    t0 = wind_up + 0.1
    fm, fi = strike(an, (t0, wind2), mid, imp, t0 + 0.05, t0 + 0.085, "QUART")
    fe = an.key(t0 + 0.17, ft)
    an.key(t0 + 0.3, ft)
    an.key(t0 + 0.38, tug, "BACK", "EASE_OUT")
    an.key(t0 + 0.55, settle, lag=4)
    an.key(t0 + 0.75, g)
    an.event(max(0, fm - 1), "Start")
    an.event(fi, "Hit")
    an.event(fe, "End")
    return an.done()
