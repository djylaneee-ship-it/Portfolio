"""Roblox CFrame math on top of mathutils, plus the R6 joint table.

Conventions (see SPEC.md section 3):
- A CFrame is a 4x4 mathutils.Matrix (rotation + translation, no scale).
- Roblox list form is 12 numbers: [x, y, z, R00, R01, R02, R10, R11, R12, R20, R21, R22]
  (rotation rows, same order as CFrame.new(x, y, z, R00, ...)).
- angles(rx, ry, rz) == Roblox CFrame.Angles(rx, ry, rz) == Rx @ Ry @ Rz (radians).
- Character space: +X = character's right, +Y = up, +Z = backward (the character looks toward -Z).
"""

import math

from mathutils import Matrix, Quaternion, Vector

IDENTITY = Matrix.Identity(4)


def cf(x, y, z, r00=1.0, r01=0.0, r02=0.0, r10=0.0, r11=1.0, r12=0.0, r20=0.0, r21=0.0, r22=1.0):
    """Build a CFrame like Roblox CFrame.new(x, y, z, R00, ..., R22)."""
    return Matrix((
        (r00, r01, r02, x),
        (r10, r11, r12, y),
        (r20, r21, r22, z),
        (0.0, 0.0, 0.0, 1.0),
    ))


def cf_from_list(values):
    """12-number Roblox list -> CFrame."""
    if len(values) != 12:
        raise ValueError("A CFrame list needs 12 numbers, got %d" % len(values))
    return cf(*[float(v) for v in values])


def orthonormalize(m):
    """Strip scale/shear: keep translation, rebuild a pure rotation from the 3x3 part."""
    q = m.to_quaternion().normalized()
    out = q.to_matrix().to_4x4()
    out.translation = m.translation
    return out


def cf_to_list(m, digits=6):
    """CFrame -> 12-number Roblox list (orthonormalized, rounded)."""
    m = orthonormalize(m)
    t = m.translation
    vals = [t.x, t.y, t.z,
            m[0][0], m[0][1], m[0][2],
            m[1][0], m[1][1], m[1][2],
            m[2][0], m[2][1], m[2][2]]
    out = []
    for v in vals:
        r = round(v, digits)
        out.append(0.0 if r == 0 else r)  # avoid "-0.0"
    return out


def translation(x, y, z):
    return Matrix.Translation(Vector((x, y, z)))


def angles(rx, ry, rz):
    """Roblox CFrame.Angles(rx, ry, rz) in radians: Rx @ Ry @ Rz."""
    return (Matrix.Rotation(rx, 4, 'X') @ Matrix.Rotation(ry, 4, 'Y') @ Matrix.Rotation(rz, 4, 'Z'))


def angles_deg(dx, dy, dz):
    return angles(math.radians(dx), math.radians(dy), math.radians(dz))


def to_angles(m):
    """Inverse of angles(): returns (rx, ry, rz) radians with R = Rx @ Ry @ Rz (Roblox ToEulerAnglesXYZ)."""
    r02 = max(-1.0, min(1.0, m[0][2]))
    ry = math.asin(r02)
    if abs(r02) < 0.999999:
        rx = math.atan2(-m[1][2], m[2][2])
        rz = math.atan2(-m[0][1], m[0][0])
    else:  # gimbal lock: put everything in rx
        rz = 0.0
        rx = math.atan2(m[2][1], m[1][1])
    return rx, ry, rz


def to_angles_deg(m):
    return tuple(math.degrees(a) for a in to_angles(m))


def rotation_part(m):
    out = m.to_3x3().to_4x4()
    return out


def lerp_cframe(a, b, t):
    """Roblox-style CFrame:Lerp (slerp rotation, lerp position)."""
    qa = a.to_quaternion()
    qb = b.to_quaternion()
    if qa.dot(qb) < 0.0:
        qb = -qb
    q = qa.slerp(qb, t)
    out = q.to_matrix().to_4x4()
    out.translation = a.translation.lerp(b.translation, t)
    return out


def angle_between(a, b):
    """Rotation angle (radians) between the rotation parts of two CFrames."""
    q = a.to_quaternion().rotation_difference(b.to_quaternion())
    ang = q.angle
    return min(ang, 2.0 * math.pi - ang)


# ---------------------------------------------------------------------------
# R6 joint table (identical to the default Roblox R6 rig and to the den_S RigMeta)
# part name -> (Motor6D name, parent part, C0, C1)
# ---------------------------------------------------------------------------

_ROOT_ROT = (-1, 0, 0, 0, 0, 1, 0, 1, 0)
_RIGHT_ROT = (0, 0, 1, 0, 1, 0, -1, 0, 0)
_LEFT_ROT = (0, 0, -1, 0, 1, 0, 1, 0, 0)

R6_ROOT = "HumanoidRootPart"

R6_JOINTS = {
    "Torso": ("RootJoint", R6_ROOT, cf(0, 0, 0, *_ROOT_ROT), cf(0, 0, 0, *_ROOT_ROT)),
    "Head": ("Neck", "Torso", cf(0, 1, 0, *_ROOT_ROT), cf(0, -0.5, 0, *_ROOT_ROT)),
    "Right Arm": ("Right Shoulder", "Torso", cf(1, 0.5, 0, *_RIGHT_ROT), cf(-0.5, 0.5, 0, *_RIGHT_ROT)),
    "Left Arm": ("Left Shoulder", "Torso", cf(-1, 0.5, 0, *_LEFT_ROT), cf(0.5, 0.5, 0, *_LEFT_ROT)),
    "Right Leg": ("Right Hip", "Torso", cf(1, -1, 0, *_RIGHT_ROT), cf(0.5, 1, 0, *_RIGHT_ROT)),
    "Left Leg": ("Left Hip", "Torso", cf(-1, -1, 0, *_LEFT_ROT), cf(-0.5, 1, 0, *_LEFT_ROT)),
}

# Order matters: parents before children.
R6_PARTS = ("Torso", "Head", "Right Arm", "Left Arm", "Right Leg", "Left Leg")

# Optional weapon joint (Motor6D "Handle" inside the arm, like a Tool RightGrip).
# Part0 = Right Arm, C0 = RightGrip default C0, C1 = Tool.Grip (identity by default).
WEAPON_JOINT = "Handle"
WEAPON_PARENT = "Right Arm"
WEAPON_C0 = cf(0, -1, 0, 1, 0, 0, 0, 0, 1, 0, -1, 0)
WEAPON_C1 = IDENTITY.copy()

# Roblox part sizes (studs) for the analysis / preview helpers.
R6_SIZES = {
    "Torso": (2.0, 2.0, 1.0),
    "Head": (2.0, 1.0, 1.0),
    "Right Arm": (1.0, 2.0, 1.0),
    "Left Arm": (1.0, 2.0, 1.0),
    "Right Leg": (1.0, 2.0, 1.0),
    "Left Leg": (1.0, 2.0, 1.0),
}

# HumanoidRootPart is 3 studs above the ground for a default R6 (legs 2 + half torso 1).
R6_HIP_HEIGHT = 3.0

ANIMATION_PRIORITY = {"Idle": 0, "Movement": 1, "Action": 2, "Action2": 3, "Action3": 4, "Action4": 5, "Core": 1000}


def joint_table(c0_overrides=None, c1_overrides=None):
    """R6 joint table, optionally with C0/C1 taken from a RigMeta (exact rig values)."""
    table = {}
    for part, (jname, parent, c0, c1) in R6_JOINTS.items():
        if c0_overrides and part in c0_overrides:
            c0 = c0_overrides[part]
        if c1_overrides and part in c1_overrides:
            c1 = c1_overrides[part]
        table[part] = (jname, parent, c0.copy(), c1.copy())
    return table


def rest_parts(table=None):
    """Rest CFrames of every part in character space (HumanoidRootPart = identity)."""
    table = table or R6_JOINTS
    parts = {R6_ROOT: IDENTITY.copy()}
    for part in R6_PARTS:
        _j, parent, c0, c1 = table[part]
        parts[part] = parts[parent] @ c0 @ c1.inverted()
    return parts


def fk(transforms, table=None, root=None):
    """Forward kinematics.

    transforms: {part: Motor6D.Transform CFrame} (missing = identity)
    root: CFrame of HumanoidRootPart in character space (default identity)
    returns {part: CFrame in character space} including HumanoidRootPart.
    """
    table = table or R6_JOINTS
    parts = {R6_ROOT: (root.copy() if root is not None else IDENTITY.copy())}
    for part in R6_PARTS:
        _j, parent, c0, c1 = table[part]
        t = transforms.get(part, IDENTITY)
        parts[part] = parts[parent] @ c0 @ t @ c1.inverted()
    return parts


def ik_transforms(parts, table=None):
    """Inverse of fk(): part CFrames (character space) -> Motor6D.Transform per part."""
    table = table or R6_JOINTS
    out = {}
    for part in R6_PARTS:
        _j, parent, c0, c1 = table[part]
        out[part] = c0.inverted() @ parts[parent].inverted() @ parts[part] @ c1
    return out


# ---------------------------------------------------------------------------
# "Friendly" joint rotation <-> Motor6D.Transform
# ---------------------------------------------------------------------------
# A friendly pose for a joint is rot = (x, y, z) degrees and pos = (x, y, z) studs.
# rot is CFrame.Angles(x, y, z) expressed in the PARENT part's axes (character axes at rest),
# applied about the joint pivot (C0 position). pos is an extra translation in the parent's axes.
#   M = T(pos) @ T(pivot) @ R @ T(-pivot)        (motion of the child, parent space)
#   Transform = C0^-1 @ M @ C0
# Cheat sheet (right-hand rule):
#   Arms / Legs: +x swings FORWARD, Right side +z = outward (to the right), Left side -z = outward,
#                +y twists toward the character's left.
#   Torso / Head: +x leans/looks BACK (up), -x leans/looks FORWARD (down), +y turns LEFT, +z tilts LEFT.


def friendly_to_transform(rot_deg, pos, c0):
    pivot = c0.translation.copy()
    r = angles_deg(*rot_deg)
    m = translation(*pos) @ Matrix.Translation(pivot) @ r @ Matrix.Translation(-pivot)
    return c0.inverted() @ m @ c0


def transform_to_friendly(transform, c0):
    m = c0 @ transform @ c0.inverted()
    m = orthonormalize(m)
    pivot = c0.translation.copy()
    r3 = m.to_3x3()
    pos = m.translation - pivot + r3 @ pivot
    rot = to_angles_deg(m)
    return [rot[0], rot[1], rot[2]], [pos.x, pos.y, pos.z]
