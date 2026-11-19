"""Funciones para armar personajes por piezas (las mismas que usa elfos_piezas.py).

Se cargan con exec(open(".../piezas_comun.py", encoding="utf-8").read(), globals()) desde el script de
una raza. Empieza un archivo nuevo de Blender (vacío) y deja: mat(), box(), ball(), loft(), punta(),
aro(), tubo() (a lo largo de una curva), plano() (silueta plana con grosor) y escena(ruta), que agrega
suelo, luz y cámara y guarda el .blend.
"""
import bpy, bmesh, math, random
from mathutils import Matrix, Vector

bpy.ops.wm.read_homefile(use_empty=True)
for _m in list(bpy.data.materials):
    bpy.data.materials.remove(_m)
D = bpy.data
SC = bpy.data.scenes[0]
MATS = {}


def node(tree, t):
    return next(n for n in tree.nodes if n.type == t)


def mat(name, rgb, rough=0.8):
    m = D.materials.new(name)
    b = node(m.node_tree, "BSDF_PRINCIPLED")
    lin = tuple(x ** 2.2 for x in rgb)
    b.inputs["Base Color"].default_value = (*lin, 1); b.inputs["Roughness"].default_value = rough
    m.diffuse_color = (*lin, 1)
    MATS[name] = m


def obj(bm, name, parent, m, bevel=0.0, sub=1, loc=(0, 0, 0), rot=(0, 0, 0), bseg=2):
    me = D.meshes.new(name); bm.to_mesh(me); bm.free()
    ob = D.objects.new(name, me); parent.users_collection[0].objects.link(ob)
    ob.parent = parent; ob.location = loc; ob.rotation_euler = [math.radians(a) for a in rot]
    me.materials.append(MATS[m])
    if bevel:
        b = ob.modifiers.new("Bisel", "BEVEL"); b.width = bevel; b.segments = bseg; b.limit_method = "ANGLE"
    if sub:
        s = ob.modifiers.new("Suavizado", "SUBSURF"); s.levels = s.render_levels = sub
    return ob


def box(name, parent, size, loc, m, bevel=None, top=(1, 1), bottom=(1, 1), rot=(0, 0, 0), sub=1):
    bm = bmesh.new(); bmesh.ops.create_cube(bm, size=1)
    for v in bm.verts:
        t = top if v.co.z > 0 else bottom
        v.co.x *= t[0] * size[0]; v.co.y *= t[1] * size[1]; v.co.z *= size[2]
    return obj(bm, name, parent, m, min(size) * 0.14 if bevel is None else bevel, sub, loc, rot)


def ball(name, parent, r, loc, m, scale=(1, 1, 1), subdiv=2):
    bm = bmesh.new(); bmesh.ops.create_icosphere(bm, subdivisions=subdiv, radius=r)
    for v in bm.verts:
        v.co.x *= scale[0]; v.co.y *= scale[1]; v.co.z *= scale[2]
    return obj(bm, name, parent, m, 0, 0, loc)


def loft(name, parent, rings, m, segs=8, sub=1, bevel=0.0):
    """rings: (z, rx, ry, oy)"""
    bm = bmesh.new(); loops = []
    for z, rx, ry, oy in rings:
        loops.append([bm.verts.new((rx * math.cos(2 * math.pi * i / segs + math.pi / segs), ry * math.sin(2 * math.pi * i / segs + math.pi / segs) + oy, z)) for i in range(segs)])
    for a, b in zip(loops, loops[1:]):
        for i in range(segs):
            bm.faces.new((a[i], a[(i + 1) % segs], b[(i + 1) % segs], b[i]))
    bm.faces.new(list(reversed(loops[0]))); bm.faces.new(loops[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj(bm, name, parent, m, bevel, sub)


def punta(name, parent, base, d, largo, ancho, grosor, m, sub=0):
    """Púa (mechón, oreja, espina): base rectangular que se afina hasta la punta en la dirección d."""
    d = Vector(d).normalized()
    up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((0, 1, 0))
    w = (up - d * up.dot(d)).normalized(); t = d.cross(w)
    base = Vector(base)
    bm = bmesh.new()
    vs = [bm.verts.new(base + w * a * ancho / 2 + t * b * grosor / 2) for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    vs += [bm.verts.new(base + d * largo + w * a * ancho * 0.06 + t * b * grosor * 0.15) for a, b in ((-1, -1), (1, -1), (1, 1), (-1, 1))]
    for f in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
        bm.faces.new([vs[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj(bm, name, parent, m, 0, sub)


def aro(name, parent, rx, ry, z, r, m, cy=0.0, seg=28, seg2=6):
    """Cuerda o cinto alrededor de la cintura (toro de contorno elíptico)."""
    bm = bmesh.new(); vs = []
    for i in range(seg):
        a = 2 * math.pi * i / seg
        c = Vector((rx * math.cos(a), cy + ry * math.sin(a), z)); n = Vector((math.cos(a) * ry, math.sin(a) * rx, 0)).normalized()
        for k in range(seg2):
            b = 2 * math.pi * k / seg2
            vs.append(bm.verts.new(c + n * r * math.cos(b) + Vector((0, 0, r * math.sin(b)))))
    for i in range(seg):
        for k in range(seg2):
            a, b = i * seg2 + k, i * seg2 + (k + 1) % seg2
            c, d = ((i + 1) % seg) * seg2 + (k + 1) % seg2, ((i + 1) % seg) * seg2 + k
            bm.faces.new((vs[a], vs[d], vs[c], vs[b]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj(bm, name, parent, m, 0, 0)


def tubo(name, parent, puntos, radios, m, segs=8, sub=1, aplastar=1.0):
    """Tubo cerrado a lo largo de una curva (cola, cuerno): anillos perpendiculares a la curva."""
    pts = [Vector(p) for p in puntos]
    bm = bmesh.new(); loops = []
    for i, (p, r) in enumerate(zip(pts, radios)):
        t = (pts[min(i + 1, len(pts) - 1)] - pts[max(i - 1, 0)]).normalized()
        u = t.cross(Vector((1, 0, 0)))
        if u.length < 1e-3:
            u = t.cross(Vector((0, 1, 0)))
        u.normalize(); w = t.cross(u).normalized()
        loops.append([bm.verts.new(p + (u * math.cos(2 * math.pi * k / segs) * aplastar + w * math.sin(2 * math.pi * k / segs)) * r) for k in range(segs)])
    for a, b in zip(loops, loops[1:]):
        for k in range(segs):
            bm.faces.new((a[k], a[(k + 1) % segs], b[(k + 1) % segs], b[k]))
    bm.faces.new(list(reversed(loops[0]))); bm.faces.new(loops[-1])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj(bm, name, parent, m, 0, sub)


def plano(name, parent, contorno, origen, eje_u, eje_v, grosor, m, sub=0):
    """Silueta plana con grosor (ala): contorno = [(u, v)] en el plano de eje_u y eje_v."""
    o = Vector(origen); U = Vector(eje_u).normalized(); Vv = Vector(eje_v).normalized(); N = U.cross(Vv).normalized()
    bm = bmesh.new()
    fr = [bm.verts.new(o + U * u + Vv * v + N * grosor / 2) for u, v in contorno]
    at = [bm.verts.new(o + U * u + Vv * v - N * grosor / 2) for u, v in contorno]
    bm.faces.new(fr); bm.faces.new(list(reversed(at)))
    n = len(contorno)
    for k in range(n):
        bm.faces.new((fr[k], at[k], at[(k + 1) % n], fr[(k + 1) % n]))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj(bm, name, parent, m, 0, sub)


def escena(ruta, cam_y=-5.0, cam_z=0.85):
    me = D.meshes.new("suelo"); me.from_pydata([(-10, -10, 0), (10, -10, 0), (10, 10, 0), (-10, 10, 0)], [], [(0, 1, 2, 3)])
    suelo = D.objects.new("suelo", me); SC.collection.objects.link(suelo)
    ms = D.materials.new("suelo"); node(ms.node_tree, "BSDF_PRINCIPLED").inputs["Base Color"].default_value = (0.9, 0.9, 0.9, 1); me.materials.append(ms)
    sun = D.objects.new("sol", D.lights.new("sol", "SUN")); SC.collection.objects.link(sun)
    sun.data.energy = 3.5; sun.data.angle = math.radians(8); sun.rotation_euler = (math.radians(45), 0, math.radians(-35))
    cam = D.objects.new("camara", D.cameras.new("camara")); SC.collection.objects.link(cam)
    cam.location = (0, cam_y, cam_z); cam.rotation_euler = (math.radians(88), 0, 0); SC.camera = cam
    w = D.worlds.new("mundo"); SC.world = w
    bg = node(w.node_tree, "BACKGROUND"); bg.inputs["Color"].default_value = (0.85, 0.85, 0.85, 1); bg.inputs["Strength"].default_value = 0.9
    SC.render.engine = "BLENDER_EEVEE"; SC.render.resolution_x = 1600; SC.render.resolution_y = 900
    SC.view_settings.view_transform = "Standard"
    bpy.ops.wm.save_as_mainfile(filepath=ruta)
