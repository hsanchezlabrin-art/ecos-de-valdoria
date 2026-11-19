"""Elfo y Elfa por piezas (estilo de bloques, como la hoja de referencia del usuario).

Se ejecuta dentro de Blender: crea un archivo nuevo con los dos personajes y lo guarda en
blender/proyectos/elfos.blend. Después se usan los mismos scripts que con los gnomos:
gnomos_malla_unica.py, gnomos_rig.py (CHAR = "Elfo_M" / "Elfa_F") y elfos_armaduras.py.

Convenciones (ver gnomos_comun.py): cada personaje es un vacío "Elfo_M"/"Elfa_F" con sus piezas como
hijos (<raíz>_<pieza>_<I|D>), con las propiedades raza="elfo" y hombro (pivote del brazo). El pelo
de arriba se llama "copete_*": va en una cáscara aparte que el yelmo reemplaza; debajo queda
"pelo_base", un pelo corto pegado a la cabeza.
"""
import bpy, bmesh, math, random
from mathutils import Matrix, Vector

SALIDA_BLEND = r"G:\Mi unidad\Juego\blender\proyectos\elfos.blend"
bpy.ops.wm.read_homefile(use_empty=True)
for m in list(bpy.data.materials):
    bpy.data.materials.remove(m)
D = bpy.data
SC = bpy.data.scenes[0]


def node(tree, t):
    return next(n for n in tree.nodes if n.type == t)


MATS = {}


def mat(name, rgb, rough=0.8):
    m = D.materials.new(name)
    b = node(m.node_tree, "BSDF_PRINCIPLED")
    lin = tuple(x ** 2.2 for x in rgb)
    b.inputs["Base Color"].default_value = (*lin, 1); b.inputs["Roughness"].default_value = rough
    m.diffuse_color = (*lin, 1)
    MATS[name] = m


mat("piel", (0.95, 0.7, 0.57)); mat("piel_osc", (0.86, 0.6, 0.48))
mat("pelo", (0.36, 0.58, 0.2)); mat("pelo_osc", (0.25, 0.46, 0.14))
mat("tunica", (0.52, 0.7, 0.28)); mat("tunica_osc", (0.42, 0.6, 0.22)); mat("canesu", (0.52, 0.35, 0.18))
mat("pantalon", (0.17, 0.36, 0.2)); mat("botas", (0.46, 0.28, 0.15)); mat("botas_borde", (0.54, 0.34, 0.19))
mat("cuerda", (0.78, 0.65, 0.44)); mat("ojos", (0.08, 0.06, 0.05), 0.4)
mat("chaleco", (0.2, 0.48, 0.24)); mat("vestido", (0.55, 0.37, 0.2))
mat("flor", (0.98, 0.97, 0.9)); mat("flor_centro", (1.0, 0.78, 0.2)); mat("flor_naranja", (1.0, 0.6, 0.16))


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
    """Púa (mechón de pelo, oreja): base rectangular que se afina hasta la punta en la dirección d."""
    d = Vector(d).normalized()
    up = Vector((0, 0, 1)) if abs(d.z) < 0.9 else Vector((0, 1, 0))
    w = (up - d * up.dot(d)).normalized(); t = d.cross(w)
    base = Vector(base)
    bm = bmesh.new()
    vs = []
    for k, (a, b) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        vs.append(bm.verts.new(base + w * a * ancho / 2 + t * b * grosor / 2))
    for k, (a, b) in enumerate(((-1, -1), (1, -1), (1, 1), (-1, 1))):
        vs.append(bm.verts.new(base + d * largo + w * a * ancho * 0.06 + t * b * grosor * 0.15))
    for f in ((0, 1, 2, 3), (7, 6, 5, 4), (0, 4, 5, 1), (1, 5, 6, 2), (2, 6, 7, 3), (3, 7, 4, 0)):
        bm.faces.new([vs[i] for i in f])
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return obj(bm, name, parent, m, 0, sub)


def aro(name, parent, rx, ry, z, r, m, cy=0.0, seg=28, seg2=6):
    """Cuerda alrededor de la cintura (toro de contorno elíptico)."""
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


def nudo(P, parent, x, y, z, m="cuerda"):
    ball(P("cinturon_nudo"), parent, 0.032, (x, y, z), m, scale=(1.2, 0.8, 0.9))
    for k, (dx, largo, rz) in enumerate(((-0.025, 0.13, 8), (0.02, 0.11, -10))):
        box(P(f"cinturon_cabo_{k}"), parent, (0.026, 0.024, largo), (x + dx, y - 0.005, z - largo / 2 - 0.02), m, rot=(0, rz, 0), sub=0, bevel=0.006)


def personaje(cname, x, fem):
    coll = D.collections.new(cname); SC.collection.children.link(coll)
    root = D.objects.new(cname, None); coll.objects.link(root)
    root.location = (x, 0, 0); root.empty_display_size = 0.4
    root["raza"] = "elfo"
    root["hombro"] = (0.25, 0.0, 0.84)
    P = lambda n: f"{cname}_{n}"
    rnd = random.Random(5 if fem else 3)
    for s, L in ((-1, "D"), (1, "I")):
        # botas y piernas
        box(P(f"bota_{L}"), root, (0.17, 0.235, 0.15), (s * 0.1, -0.025, 0.075), "botas", top=(0.97, 0.85))
        box(P(f"bota_borde_{L}"), root, (0.188, 0.2, 0.055), (s * 0.1, 0.0, 0.168), "botas_borde", bevel=0.012)
        if fem:
            box(P(f"pierna_{L}"), root, (0.125, 0.135, 0.17), (s * 0.088, 0, 0.255), "piel")
        else:
            box(P(f"pierna_{L}"), root, (0.158, 0.17, 0.23), (s * 0.096, 0, 0.285), "pantalon", top=(1.05, 1.05))
        # brazo: manga corta, brazo de piel y mano de bloque con pulgar
        if fem:
            box(P(f"manga_{L}"), root, (0.16, 0.19, 0.1), (s * 0.28, 0, 0.85), "chaleco", rot=(0, -s * 8, 0))
            box(P(f"manga_puno_{L}"), root, (0.165, 0.195, 0.025), (s * 0.284, 0, 0.8), "chaleco", rot=(0, -s * 8, 0), bevel=0.008)
            box(P(f"manga_brazalete_{L}"), root, (0.14, 0.155, 0.04), (s * 0.292, 0, 0.7), "chaleco", rot=(0, -s * 7, 0), bevel=0.01)
        else:
            box(P(f"manga_{L}"), root, (0.17, 0.2, 0.17), (s * 0.282, 0, 0.81), "tunica", rot=(0, -s * 8, 0), bottom=(1.06, 1.04))
            box(P(f"manga_puno_{L}"), root, (0.178, 0.208, 0.03), (s * 0.29, 0, 0.73), "tunica_osc", rot=(0, -s * 8, 0), bevel=0.01)
        box(P(f"brazo_{L}"), root, (0.125, 0.14, 0.27), (s * 0.3, 0, 0.6), "piel", rot=(0, -s * 6, 0))
        box(P(f"mano_{L}"), root, (0.15, 0.15, 0.12), (s * 0.312, -0.005, 0.41), "piel")
        box(P(f"pulgar_{L}"), root, (0.05, 0.06, 0.065), (s * 0.285, -0.082, 0.44), "piel", bevel=0.012)
        # cara: ojos, cejas, orejas en punta
        box(P(f"ojo_{L}"), root, (0.046, 0.014, 0.088), (s * 0.092, -0.203, 1.095), "ojos", sub=0, bevel=0.008)
        box(P(f"ceja_{L}"), root, (0.125, 0.032, 0.034), (s * 0.095, -0.205, 1.18), "pelo_osc", rot=(0, -s * (12 if not fem else 4), 0), bevel=0.008)
        punta(P(f"oreja_{L}"), root, (s * 0.215, 0.02, 1.1), (s * 0.85, 0.1, 0.52), 0.24, 0.11, 0.04, "piel", sub=1)
    box(P("cabeza"), root, (0.46, 0.4, 0.42), (0, 0, 1.1), "piel", bevel=0.05)
    box(P("nariz"), root, (0.045, 0.035, 0.06), (0, -0.212, 1.035), "piel_osc", bevel=0.012)
    # pelo corto de base (queda bajo el yelmo) y nuca
    box(P("pelo_base"), root, (0.485, 0.425, 0.09), (0, 0.0, 1.3), "pelo", bevel=0.03)
    if fem:
        box(P("pelo_nuca"), root, (0.5, 0.14, 0.56), (0, 0.17, 1.03), "pelo", bevel=0.04, bottom=(1.04, 1.1))
        for s, L in ((-1, "D"), (1, "I")):
            box(P(f"melena_{L}"), root, (0.08, 0.12, 0.56), (s * 0.235, -0.1, 0.96), "pelo", bevel=0.03, bottom=(0.85, 0.8))
            box(P(f"melena_lazo_{L}"), root, (0.09, 0.13, 0.03), (s * 0.235, -0.1, 0.74), "chaleco", bevel=0.008)
            punta(P(f"melena_punta_{L}"), root, (s * 0.235, -0.1, 0.73), (0, -0.05, -1), 0.09, 0.07, 0.1, "pelo", sub=1)
            # flequillo con raya al medio: alto en el centro, cae hacia los costados
            box(P(f"flequillo_{L}"), root, (0.25, 0.06, 0.1), (s * 0.12, -0.2, 1.27), "pelo", rot=(0, s * 24, 0), bevel=0.02)
            box(P(f"mechon_{L}"), root, (0.06, 0.13, 0.3), (s * 0.235, -0.06, 1.15), "pelo", bevel=0.02)
        # trenza en la espalda
        for i in range(8):
            z = 1.0 - i * 0.058
            for k, side in enumerate((-1, 1)):
                ball(P(f"trenza_{i}_{k}"), root, 0.05 - i * 0.0018, (side * 0.022, 0.255 + i * 0.006, z - (0.014 if side > 0 else 0)), "pelo_osc" if (i + k) % 2 else "pelo", scale=(0.95, 0.85, 0.62))
        box(P("trenza_lazo"), root, (0.07, 0.07, 0.03), (0, 0.31, 0.52), "canesu", bevel=0.008)
        punta(P("trenza_punta"), root, (0, 0.31, 0.51), (0, 0.05, -1), 0.13, 0.1, 0.06, "pelo", sub=1)
        # copete: el volumen de arriba (lo reemplaza el yelmo)
        loft(P("copete"), root, [(1.3, 0.255, 0.225, 0.01), (1.345, 0.24, 0.21, 0.01), (1.37, 0.16, 0.14, 0.015)], "pelo", segs=10)
        # flores
        for k, (fx, fy, fz, grande) in enumerate(((0.235, -0.12, 1.25, True), (-0.24, -0.05, 1.21, True), (0.24, 0.12, 1.08, False), (0.12, 0.27, 0.98, True), (-0.1, 0.27, 0.86, True), (0.08, 0.275, 0.76, False), (-0.245, 0.1, 1.12, False))):
            c = Vector((fx, fy, fz))
            n = Vector((fx, fy, 0)).normalized()
            if grande:
                ball(P(f"flor_{k}_c"), root, 0.016, c + n * 0.012, "flor_centro", subdiv=1)
                t = n.cross(Vector((0, 0, 1))).normalized()
                for j, dd in enumerate((t, -t, Vector((0, 0, 1)), Vector((0, 0, -1)))):
                    ball(P(f"flor_{k}_p{j}"), root, 0.017, c + dd * 0.022, "flor", scale=(1, 1, 1), subdiv=1)
            else:
                ball(P(f"flor_{k}_c"), root, 0.014, c + n * 0.01, "flor_naranja", subdiv=1)
    else:
        box(P("pelo_nuca"), root, (0.49, 0.13, 0.36), (0, 0.165, 1.14), "pelo", bevel=0.03)
        for s, L in ((-1, "D"), (1, "I")):
            box(P(f"mechon_{L}"), root, (0.05, 0.14, 0.22), (s * 0.233, -0.04, 1.19), "pelo", bevel=0.015)
        # flequillo: mechones anchos hacia abajo y a los lados
        for k, (fx, largo, ladeo) in enumerate(((-0.16, 0.11, -0.45), (-0.06, 0.14, -0.2), (0.05, 0.13, 0.15), (0.15, 0.12, 0.45))):
            punta(P(f"flequillo_{k}"), root, (fx, -0.2, 1.32), (ladeo, -0.45, -1), largo, 0.15, 0.05, "pelo" if k % 2 else "pelo_osc")
        # copete: volumen de pelo y mechones anchos como hojas, en capas (lo reemplaza el yelmo)
        box(P("copete_base"), root, (0.5, 0.44, 0.1), (0, 0.01, 1.355), "pelo", bevel=0.035)
        C = Vector((0, 0.03, 1.33))
        capas = [(0.0, 7, 0.17, 0.75), (0.13, 9, 0.14, 0.45), (0.2, 11, 0.12, 0.2)]  # radio, cantidad, largo, subida
        k = 0
        for radio, n, largo, subida in capas:
            for i in range(n):
                a = 2 * math.pi * i / n + rnd.uniform(-0.25, 0.25) + radio * 3
                p = C + Vector((math.cos(a) * radio * 1.15, math.sin(a) * radio, 0.02 if radio else 0.05))
                hacia = Vector((math.cos(a), math.sin(a) + 0.35, 0)).normalized() if radio else Vector((rnd.uniform(-0.6, 0.6), 0.4, 0)).normalized()
                d = hacia + Vector((0, 0, subida + rnd.uniform(-0.1, 0.15)))
                punta(P(f"copete_{k}"), root, p, d, largo * rnd.uniform(0.85, 1.2), rnd.uniform(0.15, 0.2), 0.06, "pelo" if k % 3 else "pelo_osc", sub=1)
                k += 1
        for s in (-1, 1):  # mechones de los costados, sobre las orejas
            for j, (pz, py) in enumerate(((1.27, -0.06), (1.22, 0.08))):
                punta(P(f"mechon_punta_{'I' if s > 0 else 'D'}_{j}"), root, (s * 0.225, py, pz), (s * 0.6, 0.25, -0.8), 0.12, 0.14, 0.05, "pelo")
        for j, px in enumerate((-0.16, 0.0, 0.16)):  # nuca, hacia abajo
            punta(P(f"pelo_atras_{j}"), root, (px, 0.22, 1.1), (px * 0.6, 0.35, -1), 0.13, 0.17, 0.05, "pelo_osc" if j % 2 else "pelo", sub=1)
    # ropa
    if fem:
        box(P("vestido"), root, (0.42, 0.26, 0.38), (0, 0, 0.69), "vestido", top=(0.96, 0.96), bottom=(1.02, 1.02))
        loft(P("falda"), root, [(0.29, 0.25, 0.18, 0), (0.42, 0.235, 0.17, 0), (0.54, 0.215, 0.145, 0)], "vestido", segs=8)
        loft(P("falda_verde"), root, [(0.34, 0.268, 0.196, 0), (0.45, 0.25, 0.183, 0), (0.56, 0.228, 0.157, 0)], "chaleco", segs=8)
        box(P("panel_falda"), root, (0.15, 0.03, 0.22), (0, -0.185, 0.45), "vestido", top=(0.8, 1), bottom=(1.15, 1), sub=0, bevel=0.01)
        box(P("chaleco"), root, (0.44, 0.2, 0.33), (0, 0.04, 0.72), "chaleco", bevel=0.03)
        for s in (-1, 1):
            box(P(f"chaleco_frente_{'I' if s > 0 else 'D'}"), root, (0.12, 0.05, 0.33), (s * 0.165, -0.115, 0.72), "chaleco", top=(1.25, 1), bevel=0.012)
        aro(P("cinturon"), root, 0.24, 0.16, 0.565, 0.022, "cuerda")
        nudo(P, root, 0.06, -0.165, 0.555)
    else:
        box(P("camisa"), root, (0.44, 0.27, 0.54), (0, 0, 0.62), "tunica", top=(0.95, 0.95), bottom=(1.08, 1.08), bevel=0.04)
        box(P("canesu"), root, (0.458, 0.285, 0.12), (0, 0, 0.83), "canesu", bevel=0.02)
        for sy, tam in ((-1, 0.15), (1, 0.21)):
            box(P(f"canesu_pico_{'f' if sy < 0 else 'a'}"), root, (tam, 0.02, tam), (0, sy * 0.139, 0.775), "canesu", rot=(0, 45, 0), sub=0, bevel=0.004)
        for s in (-1, 1):
            box(P(f"cordon_{'I' if s > 0 else 'D'}"), root, (0.075, 0.014, 0.014), (0, -0.152, 0.82), "cuerda", rot=(0, s * 40, 0), sub=0, bevel=0.003)
        ball(P("cordon_nudo"), root, 0.016, (0, -0.156, 0.82), "cuerda", subdiv=1)
        aro(P("cinturon"), root, 0.258, 0.172, 0.47, 0.025, "cuerda")
        nudo(P, root, 0.07, -0.185, 0.46)
    return root


personaje("Elfo_M", -0.55, False)
personaje("Elfa_F", 0.55, True)

# escena: suelo, luz, cámara
me = D.meshes.new("suelo"); me.from_pydata([(-10, -10, 0), (10, -10, 0), (10, 10, 0), (-10, 10, 0)], [], [(0, 1, 2, 3)])
suelo = D.objects.new("suelo", me); SC.collection.objects.link(suelo)
ms = D.materials.new("suelo"); node(ms.node_tree, "BSDF_PRINCIPLED").inputs["Base Color"].default_value = (0.9, 0.9, 0.9, 1); me.materials.append(ms)
sun = D.objects.new("sol", D.lights.new("sol", "SUN")); SC.collection.objects.link(sun)
sun.data.energy = 3.5; sun.data.angle = math.radians(8); sun.rotation_euler = (math.radians(45), 0, math.radians(-35))
cam = D.objects.new("camara", D.cameras.new("camara")); SC.collection.objects.link(cam)
cam.location = (0, -5.0, 0.85); cam.rotation_euler = (math.radians(88), 0, 0); SC.camera = cam
w = D.worlds.new("mundo"); SC.world = w
bg = node(w.node_tree, "BACKGROUND"); bg.inputs["Color"].default_value = (0.85, 0.85, 0.85, 1); bg.inputs["Strength"].default_value = 0.9
SC.render.engine = "BLENDER_EEVEE"; SC.render.resolution_x = 1600; SC.render.resolution_y = 900
SC.view_settings.view_transform = "Standard"
bpy.ops.wm.save_as_mainfile(filepath=SALIDA_BLEND)
result = {"archivo": SALIDA_BLEND, "objetos": len(D.objects)}
