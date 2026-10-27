"""R6 locomotion presets: idles, gait cycles, air states, climbing, swimming and crouching.

Geometry notes (why the ground helpers exist):
- R6 legs are rigid 2-stud boxes hinged at the top OUTER corner (hips at torso y = -1). A leg tilted
  0..28 deg pushes its lowest corner BELOW a vertical leg's sole (up to 0.06 stud at 14 deg), and the
  hips can only drop when the legs are spread wide (forward/back). Every grounded key therefore gets
  its Torso height (or its leg angles) from forward kinematics (_plant, _clear, _touch), and
  _fix_ground() adds Torso keys wherever interpolation between keys would still sink a foot below the
  floor (y = -3 in character space).
- Gait loops are periodic functions of the gait phase (0 = right foot contact) keyed at the classic
  poses (contact, down, passing, up for each leg). Arms and head use their own key grids delayed by a
  few frames (overlap / follow-through). Every joint is keyed at frame 0 and at `length` (close_loop),
  so Blender's Cycles modifier and Roblox loop without a pop.
"""

import math

from mathutils import Vector

from .. import cframe as cfm
from ..clip import Clip, aim_arm, handle_frame, limb, preset, two_hand_left

GROUND = -cfm.R6_HIP_HEIGHT
LEGS = ("Right Leg", "Left Leg")
_BODY = ("Torso",) + LEGS
_CORNERS = [Vector((x, y, z)) for x in (-0.5, 0.5) for y in (-1.0, 1.0) for z in (-0.5, 0.5)]
# slightly shrunk arm box + center vs. the torso half-size minus a small margin (stricter than the lint's 0.08)
_ARM_PTS = [Vector((x, y, z)) for x in (-0.45, 0.45) for y in (-0.8, 0.8) for z in (-0.45, 0.45)] + [Vector()]
_TORSO_IN = (0.96, 0.96, 0.46)
_TAU = 2.0 * math.pi


# ---------------------------------------------------------------------------------------------
# helpers
# ---------------------------------------------------------------------------------------------

def _timer(fps, speed):
    """Seconds -> integer frames at this fps and playback speed."""
    k = fps / float(speed)
    return lambda s: int(round(s * k))


def _sin(phase):
    return math.sin(_TAU * phase)


def _cos(phase):
    return math.cos(_TAU * phase)


def _clamp(v, lo, hi):
    return max(lo, min(hi, v))


def _asin_deg(v):
    return math.degrees(math.asin(_clamp(v, -1.0, 1.0)))


def _choice(value, options, what):
    if value not in options:
        raise ValueError("%s must be one of %s, got %r" % (what, list(options), value))
    return value


def _jv(rot, pos=None):
    """One joint value {"rot", "pos"} with fresh lists."""
    return {"rot": [float(a) for a in rot], "pos": [float(p) for p in (pos or (0.0, 0.0, 0.0))]}


def _periodic(table, phase):
    """Smooth periodic (Catmull-Rom) interpolation of evenly spaced samples; table[i] sits at phase i/n."""
    n = len(table)
    x = (phase % 1.0) * n
    i = int(math.floor(x))
    t = x - i
    p0, p1, p2, p3 = (table[(i + d) % n] for d in (-1, 0, 1, 2))
    return 0.5 * (2.0 * p1 + (p2 - p0) * t + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * t * t
                  + (3.0 * p1 - p0 - 3.0 * p2 + p3) * t * t * t)


def _breath(u, inhale=0.4):
    """Breathing curve 0..1 over one breath (u in [0, 1)): smooth inhale peaking at `inhale`, slower exhale."""
    w = 0.5 * u / inhale if u < inhale else 0.5 + 0.5 * (u - inhale) / (1.0 - inhale)
    return 0.5 - 0.5 * math.cos(_TAU * w)


def _body_parts(joints):
    """Character-space part CFrames from the Torso / leg values present in `joints`."""
    return cfm.fk({p: cfm.friendly_to_transform(joints[p]["rot"], joints[p]["pos"], cfm.R6_JOINTS[p][2])
                   for p in _BODY if p in joints})


def _feet(joints):
    """{leg: lowest corner y (character space)} for the Torso / leg values present in `joints`."""
    parts = _body_parts(joints)
    return {leg: min((parts[leg] @ c).y for c in _CORNERS) for leg in LEGS}


def _lowest(joints):
    return min(_feet(joints).values())


def _plant(joints, lift=0.0, margin=0.01):
    """Feet locked: set Torso pos y so the lowest foot corner rests `lift` studs above the ground."""
    joints["Torso"]["pos"][1] += GROUND + margin + lift - _lowest(joints)
    return joints


def _clear(joints, margin=0.01):
    """Raise the Torso only as much as needed to keep both feet above the ground."""
    dy = GROUND + margin - _lowest(joints)
    if dy > 0.0:
        joints["Torso"]["pos"][1] += dy
    return joints


def _touch(joints, leg, lo, hi, margin=0.01):
    """Swing `leg` (friendly rot x searched in [lo, hi]) until its lowest corner just touches the ground.

    Use an interval beyond ~16 deg from vertical, where tilting a rigid leg further only lifts it.
    Returns False (keeping the end closest to the ground) when no angle in the interval touches.
    """
    target = GROUND + margin
    rot = joints[leg]["rot"]

    def depth(a):
        rot[0] = a
        return _feet(joints)[leg] - target

    d_lo, d_hi = depth(lo), depth(hi)
    if (d_lo > 0.0) == (d_hi > 0.0):
        rot[0] = lo if abs(d_lo) < abs(d_hi) else hi
        return False
    for _ in range(28):
        mid = 0.5 * (lo + hi)
        d_mid = depth(mid)
        if (d_mid > 0.0) == (d_lo > 0.0):
            lo, d_lo = mid, d_mid
        else:
            hi = mid
    rot[0] = 0.5 * (lo + hi)
    return True


def _soles_z(joints):
    """Mean character-space z of both leg soles (leg-local (0, -1, 0))."""
    parts = _body_parts(joints)
    return sum((parts[leg] @ Vector((0.0, -1.0, 0.0))).z for leg in LEGS) / 2.0


def _keep_soles(joints, ref_z):
    """Slide the Torso along z so the soles stay at `ref_z`: a rigid-leg squat sits the hips back
    instead of skating the feet forward."""
    joints["Torso"]["pos"][2] += ref_z - _soles_z(joints)
    return joints


def _arm_inside(side, value):
    """True when an arm value (torso space) cuts into the torso box."""
    _j, _p, c0, c1 = cfm.R6_JOINTS[side + " Arm"]
    arm = c0 @ cfm.friendly_to_transform(value["rot"], value["pos"], c0) @ c1.inverted()
    return any(all(abs(q[i]) < _TORSO_IN[i] for i in range(3)) for q in (arm @ v for v in _ARM_PTS))


def _arm(side, swing=0.0, spread=0.0, twist=0.0, pos=None):
    """Arm value from limb() terms. Raised or spread R6 arms swing their top corner into the torso, so the
    arm is slid outward (torso x, at most 0.4 stud) until it clears, like a shoulder lifting out."""
    value = _jv(limb(side, swing, spread, twist), pos)
    out = 1.0 if side == "Right" else -1.0
    base = value["pos"][0]
    shift = 0.0
    while shift < 0.4 and _arm_inside(side, value):
        shift += 0.02
        value["pos"][0] = base + out * shift
    return value


def _two_hand(rarm, handle, grip, protract=0.0):
    """Left arm holding the handle `grip` studs below the right hand (clip.two_hand_left).

    protract > 0 assumes both shoulders rolled that many studs forward (the right arm value must carry the
    same pos z = -protract): the left arm is aimed from its shifted shoulder, so the grip stays exact while
    both arms cut less into the chest, as real shoulders do when the hands meet in front.
    """
    if not protract:
        return two_hand_left(rarm, handle, grip_distance=grip)
    shift = Vector((0.0, 0.0, -protract))
    target = handle_frame(rarm, handle) @ Vector((0.0, -grip, 0.0))
    value = aim_arm("Left", target - shift)
    value["pos"] = [a + b for a, b in zip(value["pos"], shift)]
    return value


def _merge_key(clip, frame, joints):
    """Add joints at `frame`, keeping the interpolation of the segment the frame falls in."""
    k = clip.keys.get(frame)
    if k is None:
        before = [f for f in clip.keys if f < frame]
        k = clip.keys[max(before)] if before else {"interp": "BEZIER", "easing": "AUTO"}
    clip.key(frame, joints, k["interp"], k["easing"])


def _fix_ground(clip, tol=0.008, margin=0.012, passes=8):
    """Add Torso keys where interpolation between keys would push a foot below the ground."""
    for _ in range(passes):
        runs, worst = [], None
        for f in range(clip.length + 1):
            pen = GROUND - _lowest(clip.resolve(f, _BODY))
            if pen > tol:
                worst = max(worst, (pen, f)) if worst else (pen, f)
            elif worst:
                runs.append(worst)
                worst = None
        if worst:
            runs.append(worst)
        if not runs:
            break
        for pen, f in runs:
            torso = clip.resolve(f, ("Torso",))["Torso"]
            torso["pos"][1] += pen + margin
            frames = [f]
            if clip.loop and f in (0, clip.length):
                frames = [0, clip.length]
            for g in frames:
                _merge_key(clip, g, {"Torso": _jv(torso["rot"], torso["pos"])})
    return clip


def _fix_soles(clip, ref_z, start, end, tol=0.02, passes=6):
    """Add Torso z keys so grounded soles stay at `ref_z` between frames start..end (no skating in-between)."""
    for _ in range(passes):
        runs, worst = [], None
        for f in range(start, end + 1):
            body = clip.resolve(f, _BODY)
            err = _soles_z(body) - ref_z
            if abs(err) > tol and _lowest(body) < GROUND + 0.15:
                worst = max(worst, (abs(err), f, err)) if worst else (abs(err), f, err)
            elif worst:
                runs.append(worst)
                worst = None
        if worst:
            runs.append(worst)
        if not runs:
            break
        for _size, f, err in runs:
            torso = clip.resolve(f, ("Torso",))["Torso"]
            torso["pos"][2] -= err
            _merge_key(clip, f, {"Torso": _jv(torso["rot"], torso["pos"])})
    return clip


def _grid(clip, fn, count, lag=0, interp="BEZIER", easing="AUTO"):
    """Key fn(phase) on a loop: `count` evenly spaced keys delayed by `lag` frames, plus frame 0.

    The phase given to fn is the cycle phase `lag` frames earlier, so a lagged group follows the body.
    """
    period = clip.length
    frames = {0}
    for i in range(count):
        frames.add(int(round(i * period / float(count) + lag)) % period)
    for f in sorted(frames):
        clip.key(f, fn(((f - lag) / float(period)) % 1.0), interp, easing)


def _legs_vertical(joints, swing=(0.0, 0.0), spread=(0.0, 0.0), twist=(0.0, 0.0)):
    """Legs whose world angles are (swing, spread) despite the torso's pitch/roll/sideways shift."""
    trot, tpos = joints["Torso"]["rot"], joints["Torso"]["pos"]
    counter = -trot[2] - _asin_deg(tpos[0] / 2.0)
    for i, side in enumerate(("Right", "Left")):
        rot = limb(side, swing[i] - trot[0], spread[i], twist[i])
        rot[2] += counter
        joints[side + " Leg"] = _jv(rot)
    return joints


# ---------------------------------------------------------------------------------------------
# gait cycles (walk, run, sprint, backpedal, crouch walk)
# ---------------------------------------------------------------------------------------------

def _walk_legs(a):
    """Right-leg world angles (deg) at the 8 classic phases of a walk; stance keeps a constant foot speed."""
    q = _asin_deg(0.5 * math.sin(math.radians(a)))
    return [a, q, 0.0, -q, -a, -0.72 * a, 0.05 * a, 0.76 * a]


def _run_legs(a, contact=0.45):
    """Right-leg world angles for a run: short stance (phases 0..3) then a fast swing with knee drive."""
    s0, s1 = math.sin(math.radians(contact * a)), math.sin(math.radians(-a))
    stance = [_asin_deg(s0 + (s1 - s0) * i / 3.0) for i in range(4)]
    return stance + [-1.04 * a, -0.62 * a, 0.25 * a, 0.9 * a]


def _build_gait(name, description, fps, speed, g):
    """Gait loop from a spec dict.

    g: cycle (s), legs (8 right-leg world angles, phase 0 = right contact), dir (+1 / -1 backwards),
    lean + pulse (deg, extra lean on contacts), yaw / roll (deg) and sway (studs) of the torso,
    height ("plant", lifts above the locked feet) or ("clear", torso heights, raised only to clear the
    ground), arms (swing, bias, spread, arc, cross, twist, lag s; or fn(side, phase) -> limb terms),
    head (yaw / look counter factors, nod deg, lag s).
    """
    F = _timer(fps, speed)
    period = max(8, F(g["cycle"]))
    clip = Clip(name, period, fps, loop=True, priority="Movement", description=description)
    d = g.get("dir", 1)
    table = g["legs"]
    yaw, roll, sway = g["yaw"], g["roll"], g["sway"]
    mode, heights = g["height"]
    margin = g.get("margin", 0.02)

    def lean_at(p):
        return g["lean"] + g["pulse"] * (0.5 + 0.5 * math.cos(2.0 * _TAU * p))

    def torso_at(p):
        return [-lean_at(p), -d * yaw * _cos(p), -roll * _sin(p)], [sway * _sin(p), 0.0, 0.0]

    def body(p):
        trot, tpos = torso_at(p)
        j = _legs_vertical({"Torso": _jv(trot, tpos)}, swing=(d * _periodic(table, p), d * _periodic(table, p + 0.5)))
        h = _periodic(heights, p)
        if mode == "plant":
            _plant(j, h, margin)
        else:
            j["Torso"]["pos"][1] = h
            _clear(j, margin)
        return j

    arms = g["arms"]

    def arm(side, p):
        if "fn" in arms:
            swing, spread, twist = arms["fn"](side, p)
        else:
            fwd = -d * _cos(p)  # +1 = this arm fully forward (its same-side leg is back)
            swing = arms["bias"] + arms["swing"] * fwd
            spread = arms["spread"] + arms["arc"] * (1.0 - fwd * fwd) - arms["cross"] * ((1.0 + fwd) / 2.0) ** 2
            twist = arms["twist"] * fwd
        counter = 0.6 * roll * _sin(p)  # partly cancel the torso roll so the arms hang
        return _arm(side, swing, spread + (counter if side == "Right" else -counter), twist)

    head = g["head"]

    def head_at(p):
        trot, _ = torso_at(p)
        x = head["look"] * lean_at(p) - head["nod"] * (0.5 + 0.5 * math.cos(2.0 * _TAU * p))
        return {"Head": _jv([x, -head["yaw"] * trot[1], -0.6 * trot[2]])}

    _grid(clip, body, 8)
    _grid(clip, lambda p: {"Right Arm": arm("Right", p), "Left Arm": arm("Left", p + 0.5)}, 8, F(arms["lag"]))
    _grid(clip, head_at, 8, F(head["lag"]))
    clip.close_loop()
    return _fix_ground(clip)


_GAIT_PARAMS = {
    "stride": {"default": 1.0, "description": "Leg swing multiplier. Longer strides also dip the hips more "
                                              "on contact (rigid R6 legs)."},
    "arm_swing": {"default": 1.0, "description": "Arm swing multiplier."},
    "bounce": {"default": 1.0, "description": "Vertical rise of the body between contacts (0 = only the "
                                              "geometric dip from the legs)."},
}


@preset("walk", "locomotion",
        "Natural walk loop (1.0 s): contact/down/passing/up per leg, hips dip on contact, torso twists "
        "against the legs, arms swing opposite with 3-frame overlap, head stays level.",
        params=_GAIT_PARAMS, loop=True)
def walk(fps=60, speed=1.0, intensity=1.0, stride=1.0, arm_swing=1.0, bounce=1.0):
    """Walk cycle, right foot contact at frame 0."""
    k = intensity
    a = _clamp(32.0 * stride * k, 4.0, 70.0)
    lift = [v * bounce * k for v in (0.0, 0.0, 0.045, 0.02, 0.0, 0.0, 0.045, 0.02)]
    g = dict(cycle=1.0, legs=_walk_legs(a), lean=5.0, pulse=1.5 * k, yaw=6.0 * k, roll=2.5 * k,
             sway=0.035 * k, height=("plant", lift),
             arms=dict(swing=28.0 * arm_swing * k, bias=4.0, spread=5.0, arc=3.0 * k, cross=3.0 * k,
                       twist=5.0 * k, lag=0.05),
             head=dict(yaw=0.85, look=0.7, nod=1.5 * k, lag=0.065))
    return _build_gait("Walk", "Walk loop: weight dips on each contact, opposite arm swing, level head.",
                       fps, speed, g)


@preset("run", "locomotion",
        "Run loop (0.6 s): short stance, flight phase with the body rising, knee drive, 11 deg forward "
        "lean, strong opposite arm pump with overlap.",
        params=_GAIT_PARAMS, loop=True)
def run(fps=60, speed=1.0, intensity=1.0, stride=1.0, arm_swing=1.0, bounce=1.0):
    """Run cycle with a flight phase, right foot contact at frame 0."""
    k = intensity
    a = _clamp(46.0 * stride * k, 6.0, 72.0)
    heights = [v * bounce * k for v in (0.0, -0.05, 0.05, 0.17, 0.0, -0.05, 0.05, 0.17)]
    g = dict(cycle=0.6, legs=_run_legs(a), lean=11.0, pulse=2.5 * k, yaw=9.0 * k, roll=3.0 * k,
             sway=0.03 * k, height=("clear", heights),
             arms=dict(swing=50.0 * arm_swing * k, bias=12.0, spread=7.0, arc=4.0 * k, cross=7.0 * k,
                       twist=8.0 * k, lag=0.035),
             head=dict(yaw=0.9, look=0.75, nod=2.5 * k, lag=0.05))
    return _build_gait("Run", "Run loop with flight phase and arm pump.", fps, speed, g)


@preset("sprint", "locomotion",
        "Sprint loop (0.5 s): long strides, big flight, strong lean. style='normal' pumps the arms hard; "
        "style='ninja' sweeps both arms straight back with a 30 deg lean.",
        params=dict(_GAIT_PARAMS, style={"default": "normal", "description": "'normal' or 'ninja' (arms back)."}),
        loop=True)
def sprint(fps=60, speed=1.0, intensity=1.0, stride=1.0, arm_swing=1.0, bounce=1.0, style="normal"):
    """Sprint cycle, right foot contact at frame 0."""
    _choice(style, ("normal", "ninja"), "style")
    k = intensity
    heights = [v * bounce * k for v in (0.0, -0.06, 0.06, 0.21, 0.0, -0.06, 0.06, 0.21)]
    if style == "ninja":
        a = _clamp(52.0 * stride * k, 6.0, 72.0)

        def ninja_arm(side, p):
            flutter = 5.0 * arm_swing * k
            off = 0.0 if side == "Right" else 0.25
            return (-72.0 + flutter * math.sin(2.0 * _TAU * (p + off)),
                    13.0 + 3.0 * k * math.cos(2.0 * _TAU * (p + off)), 4.0)

        g = dict(cycle=0.5, legs=_run_legs(a, 0.4), lean=30.0, pulse=2.0 * k, yaw=6.0 * k, roll=2.5 * k,
                 sway=0.02 * k, height=("clear", heights), arms=dict(fn=ninja_arm, lag=0.05),
                 head=dict(yaw=0.9, look=0.85, nod=1.5 * k, lag=0.04))
    else:
        a = _clamp(54.0 * stride * k, 6.0, 74.0)
        g = dict(cycle=0.5, legs=_run_legs(a, 0.4), lean=17.0, pulse=3.0 * k, yaw=11.0 * k, roll=3.0 * k,
                 sway=0.02 * k, height=("clear", heights),
                 arms=dict(swing=66.0 * arm_swing * k, bias=16.0, spread=8.0, arc=5.0 * k, cross=9.0 * k,
                           twist=10.0 * k, lag=0.03),
                 head=dict(yaw=0.9, look=0.8, nod=3.0 * k, lag=0.04))
    return _build_gait("Sprint", "Sprint loop (%s style)." % style, fps, speed, g)


@preset("backpedal", "locomotion",
        "Walking backwards loop (0.95 s): the reaching foot lands behind, slight backward lean, arms a "
        "little wider for balance, head stays forward.",
        params=_GAIT_PARAMS, loop=True)
def backpedal(fps=60, speed=1.0, intensity=1.0, stride=1.0, arm_swing=1.0, bounce=1.0):
    """Backward walk cycle, right foot contact (behind) at frame 0."""
    k = intensity
    a = _clamp(26.0 * stride * k, 4.0, 60.0)
    lift = [v * bounce * k for v in (0.0, 0.0, 0.03, 0.015, 0.0, 0.0, 0.03, 0.015)]
    g = dict(cycle=0.95, dir=-1, legs=_walk_legs(a), lean=-3.0, pulse=1.0 * k, yaw=5.0 * k, roll=2.0 * k,
             sway=0.04 * k, height=("plant", lift),
             arms=dict(swing=18.0 * arm_swing * k, bias=2.0, spread=9.0, arc=3.0 * k, cross=2.0 * k,
                       twist=3.0 * k, lag=0.05),
             head=dict(yaw=0.85, look=0.5, nod=1.2 * k, lag=0.065))
    return _build_gait("Backpedal", "Backward walk loop.", fps, speed, g)


@preset("crouch_walk", "locomotion",
        "Sneaking crouch walk loop (1.2 s): 26 deg forward lean, low hips that bob as the rigid legs pass, "
        "arms held forward and ready, head up.",
        params=_GAIT_PARAMS, loop=True)
def crouch_walk(fps=60, speed=1.0, intensity=1.0, stride=1.0, arm_swing=1.0, bounce=1.0):
    """Crouched walk cycle, right foot contact at frame 0."""
    k = intensity
    a = _clamp(40.0 * stride * k, 4.0, 66.0)
    lift = [v * bounce * k for v in (0.0, 0.0, 0.03, 0.015, 0.0, 0.0, 0.03, 0.015)]
    g = dict(cycle=1.2, legs=_walk_legs(a), lean=26.0, pulse=2.0 * k, yaw=5.0 * k, roll=2.5 * k,
             sway=0.05 * k, height=("plant", lift),
             arms=dict(swing=12.0 * arm_swing * k, bias=40.0, spread=10.0, arc=3.0 * k, cross=2.0 * k,
                       twist=3.0 * k, lag=0.06),
             head=dict(yaw=0.85, look=0.85, nod=1.0 * k, lag=0.07))
    return _build_gait("CrouchWalk", "Crouched sneaking walk loop.", fps, speed, g)


# ---------------------------------------------------------------------------------------------
# idles
# ---------------------------------------------------------------------------------------------

_IDLE_STYLES = {
    # lean: torso rot x (+ = chest up); hip: (pos x, roll) weight shift; arms: limb (swing, spread, twist);
    # head: base rot; legs: right/left world (swing, spread, twist); depth: breath size; shrug: shoulder rise.
    "relaxed": dict(cycle=4.0, breaths=1, depth=1.0, lean=-1.0, hip=(-0.05, -1.2), arms=(2.0, 4.5, 4.0),
                    head=(-2.0, 0.0, 2.0), legs=((3.0, 1.0, 6.0), (0.0, 0.0, 2.0)), look=4.0, shrug=0.004),
    "heroic": dict(cycle=4.0, breaths=1, depth=1.3, lean=3.0, hip=(0.0, 0.0), arms=(-3.0, 9.0, 0.0),
                   head=(4.0, 0.0, 0.0), legs=((0.0, 5.0, 4.0), (0.0, 5.0, 4.0)), look=3.0, shrug=0.006),
    "tired": dict(cycle=3.2, breaths=2, depth=2.2, lean=-9.0, hip=(0.03, 1.0), arms=(7.0, 2.5, 6.0),
                  head=(-13.0, 0.0, 3.0), legs=((0.0, 2.5, 3.0), (2.0, 2.5, 3.0)), look=2.0, shrug=0.02),
}


@preset("idle", "idle",
        "Standing idle loop (3-4 s): breathing (torso rises and opens), slow weight sway, head micro-looks "
        "offset in time, arms slightly out. style: relaxed (hip shifted, one leg loose), heroic (wide "
        "stance, chest out) or tired (hunched, heavy panting).",
        params={"style": {"default": "relaxed", "description": "'relaxed', 'heroic' or 'tired'."},
                "breath": {"default": 1.0, "description": "Breathing amplitude multiplier."}},
        loop=True)
def idle(fps=60, speed=1.0, intensity=1.0, style="relaxed", breath=1.0):
    """Standing idle loop that is never perfectly static."""
    st = _IDLE_STYLES[_choice(style, _IDLE_STYLES, "style")]
    F = _timer(fps, speed)
    k = intensity
    clip = Clip("Idle", max(8, F(st["cycle"])), fps, loop=True, priority="Idle",
                description="Standing idle (%s)." % style)
    amp = breath * k * st["depth"]

    def b_at(p):
        return _breath((p * st["breaths"]) % 1.0) * amp

    def roll_at(p):
        return st["hip"][1] + 0.6 * k * _sin(p + 0.15)

    def body(p):
        b = b_at(p)
        j = {"Torso": _jv([st["lean"] + 0.9 * b, 1.2 * k * _sin(p + 0.35), roll_at(p)],
                          [st["hip"][0] + 0.025 * k * _sin(p), 0.0, 0.0])}
        (rs, ls) = st["legs"]
        _legs_vertical(j, swing=(rs[0], ls[0]), spread=(rs[1], ls[1]), twist=(rs[2], ls[2]))
        return _plant(j, 0.022 * b)

    def arm(side, p, off):
        b = b_at(p)
        sw, sp, tw = st["arms"]
        counter = 0.8 * roll_at(p) * (1.0 if side == "Right" else -1.0)  # hang plumb despite the hip roll
        return _arm(side, sw + 1.3 * k * _sin(p + off), sp + 1.8 * b + 0.5 * k * _sin(2.0 * p + off) - counter,
                    tw, (0.0, st["shrug"] * b, 0.0))

    def head(p):
        b = b_at(p)
        hx, hy, hz = st["head"]
        return {"Head": _jv([hx - 0.5 * b + 0.8 * k * _sin(2.0 * p + 0.3),
                             hy + st["look"] * k * (_sin(p - 0.1) + 0.35 * _sin(3.0 * p)),
                             hz - 0.7 * roll_at(p) + 0.6 * k * _sin(p + 0.6)])}

    _grid(clip, body, 12)
    _grid(clip, lambda p: {"Right Arm": arm("Right", p, 0.0)}, 10, F(0.25))
    _grid(clip, lambda p: {"Left Arm": arm("Left", p, 0.4)}, 10, F(0.33))
    _grid(clip, head, 12, F(0.4))
    clip.close_loop()
    return _fix_ground(clip)


_COMBAT = {
    # yaw/lean: torso rot y/x; depth: hip drop (studs). Armed: rarm = Right Arm friendly rot, handle = Handle
    # rot, grip = two-hand grip distance (None = one hand, larm = left limb), protract = forward shoulder
    # roll for two-hand grips. Unarmed: r/l limb guards (fists in front of the shoulders: crossing further
    # inward sinks rigid R6 arms into the chest).
    "sword": dict(yaw=-22.0, lean=-6.0, depth=0.1, rarm=(48.0, 0.0, -3.0), handle=(0.0, 24.0, 0.0),
                  grip=None, larm=(26.0, 16.0, 0.0)),
    "greatsword": dict(yaw=12.0, lean=-5.0, depth=0.12, rarm=(99.0, 0.0, -41.0), handle=(-15.0, -25.0, 0.0),
                       grip=0.8, protract=0.2),
    "spear": dict(yaw=-26.0, lean=-7.0, depth=0.12, rarm=(66.0, 0.0, -60.0), handle=(-50.0, -22.0, 0.0),
                  grip=-0.8, protract=0.2),
    "unarmed": dict(yaw=-16.0, lean=-7.0, depth=0.1, handle=None, r=(74.0, -6.0, 0.0), l=(86.0, -5.0, 0.0)),
}


@preset("combat_idle", "idle",
        "Combat guard loop (2.4 s): bladed stance (left foot forward, both feet planted), breathing and "
        "weight shift, head locked on the target. weapon: sword (one hand, blade up-forward), greatsword "
        "and spear (two hands via clip.two_hand_left), unarmed (fists up).",
        params={"weapon": {"default": "sword", "description": "'sword', 'greatsword', 'spear' or 'unarmed'."},
                "breath": {"default": 1.0, "description": "Breathing / weight-shift amplitude multiplier."}},
        loop=True)
def combat_idle(fps=60, speed=1.0, intensity=1.0, weapon="sword", breath=1.0):
    """Guard stance loop; armed versions key the Handle joint and set clip.weapon."""
    st = _COMBAT[_choice(weapon, _COMBAT, "weapon")]
    F = _timer(fps, speed)
    k = intensity
    hint = None if weapon == "unarmed" else {"kind": weapon, "hand": "Right"}
    clip = Clip("CombatIdle", max(8, F(2.4)), fps, loop=True, priority="Idle",
                description="Combat guard (%s)." % weapon, weapon=hint)
    amp = breath * k

    def yaw_at(p):
        return st["yaw"] + 2.0 * k * _sin(p + 0.1)

    def body(p):
        b = _breath(p) * amp
        trot = [st["lean"] + 0.8 * b - 1.2 * k * _sin(p + 0.2), yaw_at(p), 1.2 * k * _sin(p + 0.45)]
        tpos = [0.035 * k * _sin(p), -st["depth"] - 0.025 * k * (0.5 - 0.5 * _cos(2.0 * p)) + 0.015 * b, 0.0]
        j = {"Torso": _jv(trot, tpos)}
        _legs_vertical(j, swing=(-30.0, 30.0), spread=(4.0, 4.0), twist=(8.0, 5.0))
        _touch(j, "Left Leg", 16.0 - trot[0], 85.0 - trot[0])
        _touch(j, "Right Leg", -85.0 - trot[0], -16.0 - trot[0])
        return _clear(j)

    def arms(p):
        b = _breath(p) * amp
        if st["handle"] is None:
            r, l = st["r"], st["l"]
            return {"Right Arm": _arm("Right", r[0] + 2.0 * b + 1.5 * k * _sin(p), r[1], r[2]),
                    "Left Arm": _arm("Left", l[0] + 2.0 * b + 1.5 * k * _sin(p + 0.3), l[1], l[2])}
        rx, ry, rz = st["rarm"]
        protract = st.get("protract", 0.0)
        rv = _jv([rx + 1.5 * b + 1.2 * k * _sin(p), ry, rz + 0.8 * k * _sin(p + 0.25)], (0.0, 0.0, -protract))
        hv = _jv(st["handle"])
        out = {"Right Arm": rv, "Handle": hv}
        if st["grip"] is None:
            lx, ls, lt = st["larm"]
            out["Left Arm"] = _arm("Left", lx + 1.5 * b + 1.8 * k * _sin(p + 0.3), ls, lt)
        else:
            out["Left Arm"] = _two_hand(rv, hv, st["grip"], protract)
        return out

    def head(p):
        b = _breath(p) * amp
        return {"Head": _jv([-0.8 * st["lean"] + 2.0 - 0.5 * b + 0.8 * k * _sin(2.0 * p),
                             -0.85 * yaw_at(p) + 1.5 * k * _sin(p - 0.1), 1.0 * k * _sin(p + 0.3)])}

    _grid(clip, body, 8)
    _grid(clip, arms, 8, F(0.15))
    _grid(clip, head, 8, F(0.3))
    clip.close_loop()
    return _fix_ground(clip)


@preset("crouch_idle", "idle",
        "Low crouch loop (3 s): hips dropped `depth` studs, 20 deg forward lean, staggered legs solved so "
        "both feet stay on the ground, slow breathing, arms resting forward, head up and scanning.",
        params={"depth": {"default": 0.5, "description": "Hip drop in studs (0.15-0.85)."},
                "breath": {"default": 1.0, "description": "Breathing amplitude multiplier."}},
        loop=True)
def crouch_idle(fps=60, speed=1.0, intensity=1.0, depth=0.5, breath=1.0):
    """Crouched idle loop with both feet planted."""
    F = _timer(fps, speed)
    k = intensity
    drop = _clamp(float(depth), 0.15, 0.85)
    clip = Clip("CrouchIdle", max(8, F(3.0)), fps, loop=True, priority="Idle", description="Crouched idle.")
    amp = breath * k

    def yaw_at(p):
        return -8.0 + 1.5 * k * _sin(p + 0.4)

    def body(p):
        b = _breath(p) * amp
        trot = [-20.0 + 1.2 * b - 1.0 * k * _sin(p + 0.2), yaw_at(p), 1.0 * k * _sin(p + 0.1)]
        tpos = [0.03 * k * _sin(p), -drop + 0.025 * b, -0.08]
        j = {"Torso": _jv(trot, tpos)}
        _legs_vertical(j, swing=(55.0, -45.0), spread=(5.0, 3.0), twist=(8.0, 5.0))
        _touch(j, "Right Leg", 16.0 - trot[0], 88.0 - trot[0])
        _touch(j, "Left Leg", -88.0 - trot[0], -16.0 - trot[0])
        return _clear(j)

    def arms(p):
        b = _breath(p) * amp
        return {"Right Arm": _arm("Right", 48.0 + 1.0 * b + 1.5 * k * _sin(p), 8.0, 4.0),
                "Left Arm": _arm("Left", 28.0 + 1.0 * b + 1.5 * k * _sin(p + 0.35), 10.0, 4.0)}

    def head(p):
        return {"Head": _jv([17.0 - 0.4 * _breath(p) * amp + 0.8 * k * _sin(2.0 * p),
                             -0.8 * yaw_at(p) + 5.0 * k * _sin(p - 0.15), 1.0 * k * _sin(p + 0.5)])}

    _grid(clip, body, 8)
    _grid(clip, arms, 8, F(0.25))
    _grid(clip, head, 10, F(0.35))
    clip.close_loop()
    return _fix_ground(clip)


# ---------------------------------------------------------------------------------------------
# air: jump, fall, land
# ---------------------------------------------------------------------------------------------

_JUMP_ARMS = {"up": (165.0, 10.0), "forward": (95.0, 12.0), "out": (35.0, 70.0)}


@preset("jump", "air",
        "Jump take-off (0.4 s, play once): quick squat anticipation with arms back, explosive extension, "
        "arms swing up while the leading leg tucks; ends in an airborne pose that blends into 'fall'.",
        params={"arms": {"default": "up", "description": "Final arm pose: 'up', 'forward' or 'out'."},
                "tuck": {"default": 1.0, "description": "How high the leading (right) knee tucks."}})
def jump(fps=60, speed=1.0, intensity=1.0, arms="up", tuck=1.0):
    """Non-looping jump take-off."""
    up_swing, up_spread = _JUMP_ARMS[_choice(arms, _JUMP_ARMS, "arms")]
    F = _timer(fps, speed)
    k = intensity
    clip = Clip("Jump", F(0.4), fps, loop=False, priority="Movement", description="Jump take-off.")

    j = _plant(_legs_vertical({"Torso": _jv([-4.0 * k, 0.0, 0.0])}, swing=(3.0 * k, 3.0 * k)))
    soles = _soles_z(j)
    clip.key(0, j)

    lean = 15.0 * k  # anticipation squat: legs forward and touching, hips sit back so the feet stay put
    j = _legs_vertical({"Torso": _jv([-lean, 0.0, 0.0], [0.0, -0.13 * k, 0.0])}, swing=(30.0, 30.0))
    for leg in LEGS:
        _touch(j, leg, 16.0 + lean, 85.0 + lean)
    clip.key(F(0.08), _keep_soles(_clear(j), soles))

    # launch: the body springs up and forward over the feet, which leave the ground and stay clear
    j = _legs_vertical({"Torso": _jv([5.0 * k, 0.0, 0.0])}, swing=(4.0 * k, -4.0 * k))
    clip.key(F(0.17), _plant(j, 0.18))
    j = _legs_vertical({"Torso": _jv([-3.0 * k, 0.0, 0.0])}, swing=(36.0 * tuck * k, -9.0 * k), spread=(2.0, 2.0))
    clip.key(F(0.29), _plant(j, 0.2))
    j = _legs_vertical({"Torso": _jv([-2.0 * k, 0.0, 0.0])}, swing=(26.0 * tuck * k, -5.0 * k), spread=(2.0, 2.0))
    clip.key(F(0.4), _plant(j, 0.2))

    # arms lag the body: back on the squat, forward-up through the launch, settle into the air pose
    for t, sw, sp in ((0.0, -10.0 * k, 6.0), (0.09, -28.0 * k, 10.0), (0.24, 0.6 * up_swing, 0.8 * up_spread),
                      (0.4, up_swing, up_spread)):
        _merge_key(clip, F(t), {"Right Arm": _arm("Right", sw, sp), "Left Arm": _arm("Left", sw * 0.96, sp + 2.0)})
    for t, hx in ((0.0, 3.0), (0.11, 12.0), (0.2, 8.0), (0.32, 3.0), (0.4, 2.0)):
        _merge_key(clip, F(t), {"Head": [hx * k, 0.0, 0.0]})
    return _fix_ground(_fix_soles(clip, soles, 0, F(0.17)))


_FALL_ARMS = {"up": (150.0, 32.0), "out": (25.0, 82.0)}


@preset("fall", "air",
        "Freefall loop (1.2 s): arms raised and slowly flailing in offset circles, legs paddling, slight "
        "back arch, head looking down toward the landing.",
        params={"flail": {"default": 1.0, "description": "Arm/leg flail amplitude multiplier."},
                "arms": {"default": "up", "description": "'up' (raised overhead) or 'out' (spread sideways)."}},
        loop=True)
def fall(fps=60, speed=1.0, intensity=1.0, flail=1.0, arms="up"):
    """Looping freefall."""
    sw, sp = _FALL_ARMS[_choice(arms, _FALL_ARMS, "arms")]
    F = _timer(fps, speed)
    k = intensity
    fl = flail * k
    clip = Clip("Fall", max(8, F(1.2)), fps, loop=True, priority="Movement", description="Freefall loop.")

    def body(p):
        j = {"Torso": _jv([4.0 * k + 1.5 * fl * _sin(p), 2.0 * fl * _sin(p + 0.25), 1.5 * fl * _sin(p + 0.5)])}
        kick = 9.0 * fl * _sin(p + 0.15)
        _legs_vertical(j, swing=(10.0 * k + kick, -5.0 * k - kick),
                       spread=(4.0 + 2.0 * fl * _cos(p), 4.0 - 2.0 * fl * _cos(p)))
        return _plant(j, 0.17)  # airborne: the paddling feet hang just clear of the ground plane

    def arm(side, p):
        return _arm(side, sw + 9.0 * fl * _sin(p), sp + 9.0 * fl * _cos(p), 6.0 * fl * _sin(p + 0.1))

    _grid(clip, body, 8)
    _grid(clip, lambda p: {"Right Arm": arm("Right", p)}, 8, F(0.06))
    _grid(clip, lambda p: {"Left Arm": arm("Left", p + 0.37)}, 8, F(0.1))
    _grid(clip, lambda p: {"Head": _jv([-9.0 * k + 2.5 * fl * _sin(p + 0.3), 4.0 * fl * _sin(p + 0.6),
                                        -1.5 * fl * _sin(p + 0.5)])}, 8, F(0.1))
    clip.close_loop()
    return _fix_ground(clip)


@preset("land", "air",
        "Landing (about 0.5 s, play once): squash on impact (hips drop into a squat, torso pitches "
        "forward), arms and head follow through, then recover with a small overshoot to a neutral stand.",
        params={"impact": {"default": 1.0, "description": "Squash strength (0.3 soft hop .. 2 heavy drop)."},
                "recover": {"default": 1.0, "description": "Recovery duration multiplier."}})
def land(fps=60, speed=1.0, intensity=1.0, impact=1.0, recover=1.0):
    """Non-looping landing that ends in a neutral standing pose."""
    F = _timer(fps, speed)
    k = intensity
    s = _clamp(impact * k, 0.0, 2.5)
    r = max(0.3, float(recover))
    t_hit = 0.07 + 0.03 * s  # heavier landings compress a little longer
    t_low = t_hit + 0.05
    t_rise, t_end = t_low + 0.2 * r, t_low + 0.38 * r
    clip = Clip("Land", F(t_end), fps, loop=False, priority="Movement", description="Landing.")

    j = _clear(_legs_vertical({"Torso": _jv([2.0 * k, 0.0, 0.0])}, swing=(2.0, -2.0), spread=(3.0, 3.0)))
    soles = _soles_z(j)
    clip.key(0, j, "QUAD", "EASE_OUT")
    for t, lean, drop in ((t_hit, 16.0 * s, 0.2 * s), (t_low, 19.0 * s, 0.24 * s)):
        # squash: legs forward and touching, hips sit back so the planted feet do not skate
        j = _legs_vertical({"Torso": _jv([-lean, 0.0, 0.0], [0.0, -drop, 0.0])}, swing=(30.0, 30.0),
                           spread=(3.0, 3.0))
        for leg in LEGS:
            _touch(j, leg, 16.0 + lean, 85.0 + lean)
        clip.key(F(t), _keep_soles(_clear(j), soles))
    j = _legs_vertical({"Torso": _jv([-3.0 * s, 0.0, 0.0], [0.0, 0.025 * s, 0.0])})
    clip.key(F(t_rise), _keep_soles(_clear(j), soles))
    j = _legs_vertical({"Torso": _jv([-1.0, 0.0, 0.0])})
    clip.key(F(t_end), _plant(j, 0.0, 0.0))

    for t, sw, sp in ((0.0, 95.0 * min(k, 1.0), 30.0), (t_hit + 0.03, 40.0, 26.0), (t_low + 0.05, 18.0 * s, 20.0),
                      (t_low + 0.24 * r, 1.0, 7.0), (t_end, 3.0, 5.0)):
        _merge_key(clip, F(t), {"Right Arm": _arm("Right", sw, sp), "Left Arm": _arm("Left", sw * 0.95, sp)})
    for t, hx in ((0.0, -6.0), (t_hit + 0.03, -15.0 * s), (t_low + 0.05, -10.0 * s), (t_low + 0.22 * r, 3.0 * s),
                  (t_end, 0.0)):
        _merge_key(clip, F(t), {"Head": [hx, 0.0, 0.0]})
    return _fix_ground(_fix_soles(clip, soles, 0, clip.length))


# ---------------------------------------------------------------------------------------------
# traversal: climb, swim, swim_idle
# ---------------------------------------------------------------------------------------------

_CLIMB_ARM = [170.0, 156.0, 132.0, 106.0, 84.0, 76.0, 108.0, 148.0]   # right arm swing, phase 0 = top
_CLIMB_ARM_SPREAD = [-3.0, -2.0, 1.0, 4.0, 6.0, 6.0, 3.0, -1.0]
_CLIMB_LEG = [6.0, 8.0, 26.0, 42.0, 54.0, 46.0, 30.0, 14.0]           # right leg, phase 0 = pushed down


@preset("climb", "traversal",
        "Ladder/truss climb loop (1.0 s): hands alternate reaching high (fast reach, slow pull), opposite "
        "knee steps up while the other leg pushes, body rises on each pull, head follows the reaching hand.",
        params={"reach": {"default": 1.0, "description": "Arm reach amplitude multiplier."},
                "lift": {"default": 1.0, "description": "Knee step-up height multiplier."}},
        loop=True)
def climb(fps=60, speed=1.0, intensity=1.0, reach=1.0, lift=1.0):
    """Looping climb, right hand at the top at frame 0."""
    F = _timer(fps, speed)
    k = intensity
    clip = Clip("Climb", max(8, F(1.0)), fps, loop=True, priority="Movement", description="Climb loop.")
    ra, la = reach * k, lift * k

    def body(p):
        j = {"Torso": _jv([-5.0, 4.0 * k * _cos(p), 3.0 * k * _cos(p)])}
        legs = [6.0 + (_periodic(_CLIMB_LEG, ph) - 6.0) * la for ph in (p, p + 0.5)]
        _legs_vertical(j, swing=legs, spread=(2.0, 2.0))
        # the body rises fast on each pull: the low foot only meets the ground plane while it dwells
        return _plant(j, 0.22 * ra * (1.0 - _cos(p) ** 4))

    def arm(side, p):
        return _arm(side, 123.0 + (_periodic(_CLIMB_ARM, p) - 123.0) * ra, _periodic(_CLIMB_ARM_SPREAD, p))

    _grid(clip, body, 8, F(0.04))
    _grid(clip, lambda p: {"Right Arm": arm("Right", p), "Left Arm": arm("Left", p + 0.5)}, 8)
    _grid(clip, lambda p: {"Head": _jv([13.0 * k + 2.0 * k * _sin(2.0 * p), -5.0 * k * _cos(p), 0.0])}, 8, F(0.08))
    clip.close_loop()
    return _fix_ground(clip)


def _stroke(p):
    """Freestyle arm angle (friendly swing): 180 = reaching overhead, 0 = at the hip, -180 = over the back."""
    w = 0.5 * p / 0.55 if p < 0.55 else 0.5 + 0.5 * (p - 0.55) / 0.45  # slower underwater pull
    return 180.0 - 360.0 * w


@preset("swim", "traversal",
        "Freestyle swim loop (1.3 s): torso pitched ~75 deg forward, alternating full arm circles (slow "
        "pull, fast recovery over the back), body roll with the strokes, 6-beat flutter kick, head turns to "
        "breathe once per cycle.",
        params={"kick": {"default": 1.0, "description": "Flutter kick amplitude multiplier."},
                "pitch": {"default": 75.0, "description": "Forward torso pitch in degrees (70-80 reads best)."}},
        loop=True)
def swim(fps=60, speed=1.0, intensity=1.0, kick=1.0, pitch=75.0):
    """Looping freestyle swim, right hand entering at frame 0."""
    F = _timer(fps, speed)
    k = intensity
    clip = Clip("Swim", max(12, F(1.3)), fps, loop=True, priority="Movement", description="Freestyle swim.")
    kk = 14.0 * kick * k

    def body(p):
        j = {"Torso": _jv([-float(pitch), 22.0 * k * _sin(p - 0.025), 0.0],
                          [0.0, 0.03 * k * _sin(2.0 * p), 0.02 * k * _cos(2.0 * p)])}
        flutter = kk * math.sin(3.0 * _TAU * p)
        j["Right Leg"] = _jv(limb("Right", 6.0 + flutter, 4.0))
        j["Left Leg"] = _jv(limb("Left", 6.0 - flutter, 4.0))
        return _clear(j)

    def arm(side, p):
        a = _stroke(p % 1.0)
        s = math.sin(math.radians(a))
        spread = 6.0 - 8.0 * s if s > 0.0 else 6.0 - 14.0 * s  # inward under the chest, wide over the water
        return _arm(side, a, spread)

    def head(p):
        turn = (0.5 - 0.5 * _cos(p - 0.27)) ** 2  # breathe to the right during the right-arm recovery
        return {"Head": _jv([38.0, -26.0 * k * turn, 0.0])}

    _grid(clip, body, 12)
    _grid(clip, lambda p: {"Right Arm": arm("Right", p), "Left Arm": arm("Left", p + 0.5)}, 12)
    _grid(clip, head, 8, F(0.05))
    clip.close_loop()
    return _fix_ground(clip)


@preset("swim_idle", "traversal",
        "Treading water loop (2 s): upright body bobbing twice per cycle, arms out to the sides sculling in a "
        "figure-8 (swing + palm twist), legs cycling in an eggbeater kick, head looking around.",
        params={"scull": {"default": 1.0, "description": "Arm sculling amplitude multiplier."},
                "bob": {"default": 1.0, "description": "Vertical bob multiplier."}},
        loop=True)
def swim_idle(fps=60, speed=1.0, intensity=1.0, scull=1.0, bob=1.0):
    """Looping treading-water idle."""
    F = _timer(fps, speed)
    k = intensity
    clip = Clip("SwimIdle", max(8, F(2.0)), fps, loop=True, priority="Idle", description="Treading water.")
    sc = scull * k

    def body(p):
        j = {"Torso": _jv([4.0 + 1.5 * k * _sin(2.0 * p + 0.1), 3.0 * k * _sin(p), 1.5 * k * _sin(p + 0.3)])}
        _legs_vertical(j, swing=(12.0 + 18.0 * k * _sin(p), 12.0 - 18.0 * k * _sin(p)),
                       spread=(9.0 + 4.0 * k * _cos(p), 9.0 - 4.0 * k * _cos(p)))
        # afloat: the bob's low points (lowest sole ~0.08 up) meet the kick extremes, where the feet are still
        return _plant(j, max(0.0, 0.165 + 0.085 * bob * k * _cos(2.0 * p)))

    def arm(side, p):
        return _arm(side, 22.0 + 16.0 * sc * _sin(2.0 * p), 58.0 + 6.0 * k * _cos(2.0 * p), 18.0 * sc * _cos(2.0 * p))

    _grid(clip, body, 8)
    _grid(clip, lambda p: {"Right Arm": arm("Right", p), "Left Arm": arm("Left", p + 0.04)}, 12, F(0.08))
    _grid(clip, lambda p: {"Head": _jv([-4.0 + 2.0 * k * _sin(2.0 * p + 0.4), 6.0 * k * _sin(p - 0.2), 0.0])},
          8, F(0.12))
    clip.close_loop()
    return _fix_ground(clip)
