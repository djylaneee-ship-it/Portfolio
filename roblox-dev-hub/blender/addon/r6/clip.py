"""Clip: a rig-independent R6 animation described in Roblox "friendly" joint space.

A clip is a set of keys. Each key sets some joints at a frame:
    joints = {"Right Arm": {"rot": [x, y, z], "pos": [x, y, z]}, ...}
rot is in degrees (CFrame.Angles order, parent-part axes, about the joint pivot), pos in studs.
See cframe.py for the cheat sheet. Frames are integers starting at 0 (the clip's first frame).

JSON form (Clip.to_dict / Clip.from_dict) is what the MCP tool r6_apply_clip accepts.
"""

import copy
import math

from mathutils import Vector

from . import cframe as cfm

JOINTS = cfm.R6_PARTS + (cfm.WEAPON_JOINT,)

INTERPOLATIONS = ("BEZIER", "LINEAR", "CONSTANT", "SINE", "QUAD", "CUBIC", "QUART", "QUINT",
                  "EXPO", "CIRC", "BACK", "BOUNCE", "ELASTIC")
EASINGS = ("AUTO", "EASE_IN", "EASE_OUT", "EASE_IN_OUT")
PRIORITIES = tuple(cfm.ANIMATION_PRIORITY.keys())

_JOINT_ALIASES = {
    "torso": "Torso", "root": "Torso", "rootjoint": "Torso", "body": "Torso",
    "head": "Head", "neck": "Head",
    "rightarm": "Right Arm", "rarm": "Right Arm", "armr": "Right Arm", "rightshoulder": "Right Arm",
    "leftarm": "Left Arm", "larm": "Left Arm", "arml": "Left Arm", "leftshoulder": "Left Arm",
    "rightleg": "Right Leg", "rleg": "Right Leg", "legr": "Right Leg", "righthip": "Right Leg",
    "leftleg": "Left Leg", "lleg": "Left Leg", "legl": "Left Leg", "lefthip": "Left Leg",
    "handle": "Handle", "weapon": "Handle", "tool": "Handle",
}


def joint_name(name):
    """Normalize user/LLM joint names ('rarm', 'right_arm', 'Right Arm') to R6 part names."""
    if name in JOINTS:
        return name
    key = "".join(ch for ch in name.lower() if ch.isalnum())
    if key in _JOINT_ALIASES:
        return _JOINT_ALIASES[key]
    raise ValueError("Unknown joint '%s'. Use one of %s" % (name, list(JOINTS)))


def _vec3(v, what):
    if v is None:
        return [0.0, 0.0, 0.0]
    v = list(v)
    if len(v) != 3:
        raise ValueError("%s needs 3 numbers, got %r" % (what, v))
    return [float(x) for x in v]


def _norm_joint_value(value):
    if isinstance(value, dict):
        return {"rot": _vec3(value.get("rot"), "rot"), "pos": _vec3(value.get("pos"), "pos")}
    # bare [x, y, z] = rotation only
    return {"rot": _vec3(value, "rot"), "pos": [0.0, 0.0, 0.0]}


def ease(t, interp="BEZIER", easing="AUTO"):
    """Approximate Blender's interpolation curve, used only to fill joints missing at a key."""
    t = max(0.0, min(1.0, t))
    if interp == "CONSTANT":
        return 0.0
    if interp == "LINEAR":
        return t
    if interp == "BEZIER":
        return t * t * (3.0 - 2.0 * t)
    if easing == "AUTO":  # Blender: dynamic effects ease out, transitional types ease in
        easing = "EASE_OUT" if interp in ("BACK", "BOUNCE", "ELASTIC") else "EASE_IN"
    powers = {"QUAD": 2, "CUBIC": 3, "QUART": 4, "QUINT": 5, "EXPO": 6, "CIRC": 2, "SINE": 1.6,
              "BACK": 3, "BOUNCE": 2, "ELASTIC": 3}
    p = powers.get(interp, 2)
    if easing == "EASE_IN":
        return t ** p
    if easing == "EASE_OUT":
        return 1.0 - (1.0 - t) ** p
    return (2 ** (p - 1)) * t ** p if t < 0.5 else 1.0 - ((-2 * t + 2) ** p) / 2.0


def limb(side, swing=0.0, spread=0.0, twist=0.0):
    """Friendly rot for an arm/leg with symmetric meaning.

    side: 'Right' or 'Left'. swing>0 = forward, spread>0 = away from the body, twist>0 = outward.
    """
    if side.lower().startswith("r"):
        return [float(swing), -float(twist), float(spread)]
    return [float(swing), float(twist), -float(spread)]


def pose(torso=None, torso_pos=None, head=None, rarm=None, larm=None, rleg=None, lleg=None,
         handle=None, handle_pos=None, rarm_pos=None, larm_pos=None, rleg_pos=None, lleg_pos=None, head_pos=None):
    """Compact joints dict builder. Each argument is a rot [x, y, z] (degrees) or a *_pos [x, y, z] (studs)."""
    out = {}

    def put(joint, rot, pos):
        if rot is None and pos is None:
            return
        out[joint] = {"rot": _vec3(rot, "rot"), "pos": _vec3(pos, "pos")}

    put("Torso", torso, torso_pos)
    put("Head", head, head_pos)
    put("Right Arm", rarm, rarm_pos)
    put("Left Arm", larm, larm_pos)
    put("Right Leg", rleg, rleg_pos)
    put("Left Leg", lleg, lleg_pos)
    put("Handle", handle, handle_pos)
    return out


def mirror_joint(joint, value):
    """Mirror a joint value across the character's YZ plane (left <-> right)."""
    if joint == "Handle":
        return None, None
    if "Right" in joint:
        joint = joint.replace("Right", "Left")
    elif "Left" in joint:
        joint = joint.replace("Left", "Right")
    rot = value["rot"]
    pos = value["pos"]
    return joint, {"rot": [rot[0], -rot[1], -rot[2]], "pos": [-pos[0], pos[1], pos[2]]}


def mirror_joints(joints):
    out = {}
    for j, v in joints.items():
        mj, mv = mirror_joint(j, v)
        if mj:
            out[mj] = mv
    return out


class Clip:
    def __init__(self, name, length, fps=60, loop=False, priority="Action", description="", weapon=None):
        if priority not in PRIORITIES:
            raise ValueError("priority must be one of %s" % (PRIORITIES,))
        self.name = name
        self.length = int(length)          # last frame index (a loop's frame `length` equals frame 0)
        self.fps = int(fps)
        self.loop = bool(loop)
        self.priority = priority
        self.description = description
        self.weapon = weapon               # hint for previews, e.g. {"kind": "sword", "hand": "Right"}
        self.keys = {}                     # frame -> {"joints": {...}, "interp": str, "easing": str}
        self.events = []                   # [{"frame": int, "name": str, "value": str}]

    # -- authoring ---------------------------------------------------------------------
    def key(self, frame, joints=None, interp="BEZIER", easing="AUTO"):
        """Add/merge a key. joints: {joint: {"rot": [...], "pos": [...]}} or {joint: [x, y, z]}."""
        frame = int(round(frame))
        if frame < 0:
            raise ValueError("frame must be >= 0")
        if interp not in INTERPOLATIONS:
            raise ValueError("interp must be one of %s" % (INTERPOLATIONS,))
        if easing not in EASINGS:
            raise ValueError("easing must be one of %s" % (EASINGS,))
        k = self.keys.setdefault(frame, {"joints": {}, "interp": interp, "easing": easing})
        k["interp"] = interp
        k["easing"] = easing
        for j, v in (joints or {}).items():
            k["joints"][joint_name(j)] = _norm_joint_value(v)
        self.length = max(self.length, frame)
        return self

    def event(self, frame, name, value=""):
        """A KeyframeMarker in Roblox (GetMarkerReachedSignal(name)), a pose marker in Blender."""
        self.events.append({"frame": int(round(frame)), "name": str(name), "value": str(value)})
        return self

    def close_loop(self):
        """For loops: make the last frame identical to frame 0 so Roblox loops without a pop."""
        if self.loop and 0 in self.keys:
            first = self.resolve(0)
            k = self.keys.get(self.length)
            interp = k["interp"] if k else self.keys[0]["interp"]
            easing = k["easing"] if k else self.keys[0]["easing"]
            self.keys[self.length] = {"joints": copy.deepcopy(first), "interp": interp, "easing": easing}
        return self

    def uses_weapon_joint(self):
        return any("Handle" in k["joints"] for k in self.keys.values())

    # -- queries ---------------------------------------------------------------------------
    def frames(self):
        return sorted(self.keys)

    def _joint_track(self, joint):
        return [(f, self.keys[f]) for f in self.frames() if joint in self.keys[f]["joints"]]

    def resolve(self, frame, joints=None):
        """Full pose at a frame: every joint, interpolated from that joint's own keys when missing."""
        joints = joints or (JOINTS if self.uses_weapon_joint() else cfm.R6_PARTS)
        out = {}
        for j in joints:
            track = self._joint_track(j)
            if not track:
                out[j] = {"rot": [0.0, 0.0, 0.0], "pos": [0.0, 0.0, 0.0]}
                continue
            if frame <= track[0][0]:
                out[j] = copy.deepcopy(track[0][1]["joints"][j])
                continue
            if frame >= track[-1][0]:
                out[j] = copy.deepcopy(track[-1][1]["joints"][j])
                continue
            for (f0, k0), (f1, k1) in zip(track, track[1:]):
                if f0 <= frame <= f1:
                    t = ease((frame - f0) / float(f1 - f0), k0["interp"], k0["easing"])
                    out[j] = _blend_joint(j, k0["joints"][j], k1["joints"][j], t)
                    break
        return out

    def resolved_keys(self):
        """[(frame, full_joints, interp, easing)] for every key frame."""
        return [(f, self.resolve(f), self.keys[f]["interp"], self.keys[f]["easing"]) for f in self.frames()]

    # -- transforms of the whole clip ---------------------------------------------------
    def mirrored(self, name=None):
        c = Clip(name or (self.name + "_Mirror"), self.length, self.fps, self.loop, self.priority,
                 self.description, None)
        for f, k in self.keys.items():
            c.keys[f] = {"joints": mirror_joints(k["joints"]), "interp": k["interp"], "easing": k["easing"]}
        c.events = copy.deepcopy(self.events)
        if self.weapon:
            w = dict(self.weapon)
            w["hand"] = "Left" if w.get("hand", "Right") == "Right" else "Right"
            c.weapon = w
        return c

    def retimed(self, fps=None, speed=1.0):
        """Copy with frames rescaled to another fps and/or played `speed` times faster."""
        fps = int(fps or self.fps)
        factor = (fps / float(self.fps)) / float(speed)
        c = Clip(self.name, max(1, _round_half_up(self.length * factor)), fps, self.loop, self.priority,
                 self.description, copy.deepcopy(self.weapon))
        for f, k in sorted(self.keys.items()):
            nf = _round_half_up(f * factor)
            if nf in c.keys:
                c.keys[nf]["joints"].update(copy.deepcopy(k["joints"]))
            else:
                c.keys[nf] = copy.deepcopy(k)
        for e in self.events:
            c.events.append({"frame": _round_half_up(e["frame"] * factor), "name": e["name"], "value": e["value"]})
        return c

    def scaled(self, intensity=1.0):
        """Copy with every rotation and translation multiplied by `intensity` (exaggerate / calm down)."""
        c = copy.deepcopy(self)
        for k in c.keys.values():
            for v in k["joints"].values():
                v["rot"] = [a * intensity for a in v["rot"]]
                v["pos"] = [p * intensity for p in v["pos"]]
        return c

    # -- serialization ---------------------------------------------------------------------
    def to_dict(self):
        return {
            "name": self.name, "fps": self.fps, "length": self.length, "loop": self.loop,
            "priority": self.priority, "description": self.description, "weapon": self.weapon,
            "keys": [{"frame": f, "interp": self.keys[f]["interp"], "easing": self.keys[f]["easing"],
                      "joints": copy.deepcopy(self.keys[f]["joints"])} for f in self.frames()],
            "events": copy.deepcopy(self.events),
        }

    @classmethod
    def from_dict(cls, d):
        c = cls(d.get("name", "Clip"), d.get("length", 0), d.get("fps", 60), d.get("loop", False),
                d.get("priority", "Action"), d.get("description", ""), d.get("weapon"))
        for k in d.get("keys", []):
            c.key(k["frame"], k.get("joints", {}), k.get("interp", "BEZIER"), k.get("easing", "AUTO"))
        for e in d.get("events", []):
            c.event(e["frame"], e["name"], e.get("value", ""))
        if "length" in d:
            c.length = max(int(d["length"]), max(c.keys) if c.keys else 0)
        return c


def _round_half_up(x):
    return int(math.floor(x + 0.5))


def _blend_joint(joint, a, b, t):
    """Interpolate two friendly joint values through their Motor6D transforms (slerp)."""
    c0 = _c0(joint)
    ta = cfm.friendly_to_transform(a["rot"], a["pos"], c0)
    tb = cfm.friendly_to_transform(b["rot"], b["pos"], c0)
    rot, pos = cfm.transform_to_friendly(cfm.lerp_cframe(ta, tb, t), c0)
    return {"rot": rot, "pos": pos}


def _c0(joint):
    if joint == "Handle":
        return cfm.WEAPON_C0
    return cfm.R6_JOINTS[joint][2]


# ---------------------------------------------------------------------------
# Geometry helpers for authors (all in TORSO space = character axes when the torso is at rest)
# ---------------------------------------------------------------------------

def arm_hand_point(side, value):
    """Torso-space position of the hand grip point (arm-local (0,-1,0)) for a friendly arm value."""
    part = side + " Arm"
    _j, _p, c0, c1 = cfm.R6_JOINTS[part]
    t = cfm.friendly_to_transform(value["rot"], value["pos"], c0)
    return (c0 @ t @ c1.inverted()) @ Vector((0.0, -1.0, 0.0))


def handle_frame(rarm_value, handle_value=None):
    """Torso-space CFrame of the right-hand weapon handle (blade along handle +Y)."""
    _j, _p, c0, c1 = cfm.R6_JOINTS["Right Arm"]
    t = cfm.friendly_to_transform(rarm_value["rot"], rarm_value["pos"], c0)
    arm = c0 @ t @ c1.inverted()
    ht = cfm.IDENTITY
    if handle_value:
        ht = cfm.friendly_to_transform(handle_value["rot"], handle_value["pos"], cfm.WEAPON_C0)
    return arm @ cfm.WEAPON_C0 @ ht @ cfm.WEAPON_C1.inverted()


def aim_arm(side, target, max_stretch=0.25):
    """Friendly value that points an arm's hand at a torso-space target point.

    The arm is rigid, so when the target is out of reach the shoulder is shifted by at most
    `max_stretch` studs toward/away from it (small shifts read as a natural reach in R6).
    """
    part = side + " Arm"
    _j, _p, c0, c1 = cfm.R6_JOINTS[part]
    pivot = c0.translation.copy()
    rest_hand = (c0 @ c1.inverted()) @ Vector((0.0, -1.0, 0.0))
    v0 = rest_hand - pivot
    v1 = Vector(target) - pivot
    if v1.length < 1e-6:
        return {"rot": [0.0, 0.0, 0.0], "pos": [0.0, 0.0, 0.0]}
    q = v0.rotation_difference(v1)
    rot = cfm.to_angles_deg(q.to_matrix().to_4x4())
    gap = v1.length - v0.length
    shift = max(-max_stretch, min(max_stretch, gap))
    pos = v1.normalized() * shift
    return {"rot": list(rot), "pos": [pos.x, pos.y, pos.z]}


def two_hand_left(rarm_value, handle_value=None, grip_distance=0.8, max_stretch=0.25, return_gap=False):
    """Left-arm value so the left hand holds the weapon handle `grip_distance` studs below the right hand.

    The left hand can only reach when the right hand is near the body's centerline (bring the right arm
    inward: Right Arm rot z around -20..-45 and some forward swing). With return_gap=True returns
    (value, gap_in_studs); keep the gap under ~0.3 for a believable grip.
    """
    h = handle_frame(rarm_value, handle_value)
    target = h @ Vector((0.0, -float(grip_distance), 0.0))
    value = aim_arm("Left", target, max_stretch)
    if return_gap:
        return value, (arm_hand_point("Left", value) - target).length
    return value


# ---------------------------------------------------------------------------
# Preset registry (filled by library/*.py with @preset)
# ---------------------------------------------------------------------------

PRESETS = {}


def preset(name, category, description, params=None, weapon=None, loop=False):
    """Register a preset builder: fn(fps=60, speed=1.0, intensity=1.0, **params) -> Clip."""
    def deco(fn):
        PRESETS[name] = {"fn": fn, "category": category, "description": description,
                         "params": params or {}, "weapon": weapon, "loop": loop}
        return fn
    return deco
