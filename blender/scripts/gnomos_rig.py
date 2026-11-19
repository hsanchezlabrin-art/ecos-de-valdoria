"""Esqueleto y pesos de un gnomo (malla única en pose T) y datos para tools/make_gnomo.js.

Se ejecuta dentro de Blender con gnomos.blend abierto, después de gnomos_malla_unica.py:
    g = {"CHAR": "Gnomo_M"}
    exec(open(r".../gnomos_rig.py", encoding="utf-8").read(), g)

1. Calcula la posición de los 24 huesos del juego a partir de las piezas del gnomo (cadera, piernas,
   columna, cabeza y brazos en pose T).
2. Pesa cada vértice según la pieza de la que viene: la barba, el pelo y el gorro siguen a la
   cabeza; la ropa del tronco reparte su peso por la columna; brazos y piernas tienen tramos
   rígidos con una transición corta en cada articulación.
3. Crea un esqueleto de Blender (solo para mirar y posar aquí) y pone los brazos abajo.
4. Escribe blender/salida/gnomo_<m|f>_rig.json + .bin: la malla separada por color y normal, con
   huesos y pesos en coordenadas glTF (Y arriba, frente +Z). tools/make_gnomo.js arma el .glb con
   el esqueleto original (las mismas rotaciones de reposo que usan las animaciones compartidas).
"""
import bpy, math, json, os, sys, importlib
import numpy as np
from mathutils import Matrix, Vector

sys.path.insert(0, r"G:\Mi unidad\Juego\blender\scripts")
import gnomos_comun as GC  # noqa: E402
importlib.reload(GC)

C_NAME = globals().get("CHAR", "Gnomo_M")
SALIDA = r"G:\Mi unidad\Juego\blender\salida"
D = bpy.data
vl = bpy.context.view_layer
root = D.objects[C_NAME]
ob = D.objects[C_NAME + "_malla"]
me = ob.data
assert me.get("pose_t"), "la malla debe estar en pose T (gnomos_malla_unica.py con POSE_T=True)"
PARTES = list(me["partes"])
INF = float("inf")

# 1. huesos ---------------------------------------------------------------------
piezas = root.users_collection[0]
lc = vl.layer_collection.children[piezas.name]
lc.exclude = False
dg = bpy.context.evaluated_depsgraph_get(); dg.update()
pose_t = GC.matrices_pose_t(root)


def caja(*nombres):
    pts = []
    for n in nombres:
        o = D.objects[f"{C_NAME}_{n}"]
        ev = o.evaluated_get(dg); m = ev.to_mesh(); M = GC.matriz_pieza(o, root, pose_t)
        pts += [M @ v.co for v in m.vertices]
        ev.to_mesh_clear()
    mn = Vector([min(p[i] for p in pts) for i in range(3)])
    mx = Vector([max(p[i] for p in pts) for i in range(3)])
    return mn, mx


pierna = caja("pierna_I"); bota = caja("bota_I", "bota_borde_I"); cab = caja("cabeza")
manga = caja("manga_I"); puno = caja("manga_puno_I"); brazo = caja("brazo_I"); mano = caja("mano_I")
lc.exclude = True
cen = lambda b: (b[0] + b[1]) / 2

xl = cen(pierna).x
z_cad = pierna[1].z                      # arriba de las piernas
z_rod = (z_cad - 0.03 + bota[1].z) / 2   # rodilla
z_tob = bota[1].z - 0.05                 # tobillo
z_cab = cab[0].z                         # base de la cabeza
z_brazo = cen(brazo).z
t = lambda f: z_cad + f * (z_cab - z_cad)
J = {
    "Hips": (0, 0, z_cad), "Spine02": (0, 0, t(0.3)), "Spine01": (0, 0, t(0.6)), "Spine": (0, 0, t(0.85)),
    "neck": (0, 0, z_cab - 0.01), "Head": (0, 0, z_cab + 0.03), "head_end": (0, 0, cab[1].z),
    "headfront": (0, cab[0].y, cen(cab).z),
}
for S, s in (("Left", 1), ("Right", -1)):
    J[S + "UpLeg"] = (s * xl, 0, z_cad - 0.03)
    J[S + "Leg"] = (s * xl, 0, z_rod)
    J[S + "Foot"] = (s * xl, 0, z_tob)
    J[S + "ToeBase"] = (s * xl, bota[0].y + 0.06, 0.03)
    J[S + "Shoulder"] = (s * 0.06, 0, z_brazo)
    J[S + "Arm"] = (s * GC.HOMBRO[0], 0, z_brazo)
    J[S + "ForeArm"] = (s * (cen(puno).x + cen(brazo).x) / 2, 0, z_brazo)
    J[S + "Hand"] = (s * (cen(brazo).x + cen(mano).x) / 2, 0, z_brazo)
J = {k: Vector(v) for k, v in J.items()}

# 2. pesos ----------------------------------------------------------------------
def cadena(c, chain, b):
    """chain: [(hueso, inicio)] de menor a mayor. Tramos rígidos con mezcla de ancho 2b en cada unión."""
    k = max(i for i, (_, st) in enumerate(chain) if c >= st)
    w = {chain[k][0]: 1.0}
    if k + 1 < len(chain) and c > chain[k + 1][1] - b:
        u = (c - (chain[k + 1][1] - b)) / (2 * b)
        w = {chain[k][0]: 1 - u, chain[k + 1][0]: u}
    if k > 0 and c < chain[k][1] + b:
        u = (c - (chain[k][1] - b)) / (2 * b)
        w = {chain[k - 1][0]: 1 - u, chain[k][0]: u}
    return w


CABEZA = ("oreja", "nariz", "ojo", "ceja", "bigote", "barba", "patilla", "pelo_nuca", "flequillo",
          "mechon", "sonrisa", "gorro", "gafas")
TRONCO = ("camisa", "cinturon", "borde_camisa", "torso_camisa", "cuello", "vestido")
tronco = [("Hips", -INF), ("Spine02", J["Spine02"].z), ("Spine01", J["Spine01"].z), ("Spine", J["Spine"].z)]


def pesos(parte, p):
    S = "Left" if p.x > 0 else "Right"
    if parte.startswith("cabeza"):
        return cadena(p.z, [("Spine", -INF), ("Head", z_cab + 0.02)], 0.025)
    if parte.startswith("trenza"):
        return cadena(p.z, [("Spine", -INF), ("Head", 0.64)], 0.04)
    if parte.startswith(CABEZA):
        return {"Head": 1.0}
    if parte.startswith(TRONCO):
        return cadena(p.z, tronco, 0.04)
    if parte.startswith("pierna"):
        # se recorre de arriba hacia abajo (c = -z): cadera, muslo, pierna, pie
        return cadena(-p.z, [("Hips", -INF), (S + "UpLeg", -z_cad), (S + "Leg", -z_rod), (S + "Foot", -z_tob)], 0.025)
    if parte.startswith("bota"):
        return cadena(-p.y, [(S + "Foot", -INF), (S + "ToeBase", -J[S + "ToeBase"].y)], 0.02)
    if GC.es_brazo("_" + parte):
        return cadena(abs(p.x), [("Spine", -INF), (S + "Arm", abs(J[S + "Arm"].x)),
                                 (S + "ForeArm", abs(J[S + "ForeArm"].x)), (S + "Hand", abs(J[S + "Hand"].x))], 0.025)
    return {"Hips": 1.0}


HUESOS = list(J.keys())
nv = len(me.vertices)
pid = np.empty(nv, dtype=np.int32); me.attributes["parte"].data.foreach_get("value", pid)
co = np.empty(nv * 3, dtype=np.float32); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
W = np.zeros((nv, len(HUESOS)), dtype=np.float64)
HI = {n: i for i, n in enumerate(HUESOS)}
for i in range(nv):
    for n, w in pesos(PARTES[pid[i]], Vector(co[i])).items():
        W[i, HI[n]] += w
SIN_PESO = int((W.sum(1) <= 0).sum())
W /= np.maximum(W.sum(1, keepdims=True), 1e-9)

# 3. esqueleto de Blender (para mirar y posar) ------------------------------------
HIJO = {"Hips": "Spine02", "Spine02": "Spine01", "Spine01": "Spine", "Spine": "neck", "neck": "Head", "Head": "head_end",
        "LeftShoulder": "LeftArm", "LeftArm": "LeftForeArm", "LeftForeArm": "LeftHand",
        "RightShoulder": "RightArm", "RightArm": "RightForeArm", "RightForeArm": "RightHand",
        "LeftUpLeg": "LeftLeg", "LeftLeg": "LeftFoot", "LeftFoot": "LeftToeBase",
        "RightUpLeg": "RightLeg", "RightLeg": "RightFoot", "RightFoot": "RightToeBase"}
PADRE = {h: p for p, h in HIJO.items()}
PADRE.update({"headfront": "Head", "LeftShoulder": "Spine", "RightShoulder": "Spine", "LeftUpLeg": "Hips", "RightUpLeg": "Hips"})
viejo = D.objects.get(C_NAME + "_esqueleto")
if viejo:
    ad = viejo.data; D.objects.remove(viejo); D.armatures.remove(ad)
ad = D.armatures.new(C_NAME + "_esqueleto")
arm = D.objects.new(C_NAME + "_esqueleto", ad)
ob.users_collection[0].objects.link(arm)
arm.location = ob.location
arm.show_in_front = True
for o in bpy.context.scene.objects:
    if o and o.visible_get(): o.select_set(False)
vl.objects.active = arm; arm.select_set(True)
bpy.ops.object.mode_set(mode="EDIT")
for n in HUESOS:
    eb = ad.edit_bones.new(n)
    eb.head = J[n]
    if n in HIJO:
        eb.tail = J[HIJO[n]]
    elif n == "headfront":
        eb.tail = J[n] + Vector((0, -0.04, 0))
    else:  # punta: sigue la dirección del padre
        d = J[n] - J[PADRE[n]]
        eb.tail = J[n] + (d.normalized() * 0.05 if d.length > 1e-4 else Vector((0, 0, 0.05)))
    if (eb.tail - eb.head).length < 1e-3:
        eb.tail = eb.head + Vector((0, 0, 0.03))
for n in HUESOS:
    if n in PADRE:
        ad.edit_bones[n].parent = ad.edit_bones[PADRE[n]]
bpy.ops.object.mode_set(mode="OBJECT")

ob.vertex_groups.clear()
for n in HUESOS:
    g = ob.vertex_groups.new(name=n)
    idx = np.nonzero(W[:, HI[n]] > 1e-4)[0]
    for i in idx:
        g.add([int(i)], float(W[i, HI[n]]), "REPLACE")
# El gorro (con sus gafas) va aparte: las túnicas con capucha, sombrero o corona lo ocultan.
# En Blender se oculta con un modificador Máscara sobre este grupo; en el .glb es otra primitiva.
ES_GORRO = np.array([PARTES[i].startswith(("gorro", "gafas")) for i in pid])
ob.vertex_groups.new(name="GORRO").add(np.nonzero(ES_GORRO)[0].tolist(), 1.0, "REPLACE")
for m in [m for m in ob.modifiers if m.type == "ARMATURE"]:
    ob.modifiers.remove(m)
mod = ob.modifiers.new("esqueleto", "ARMATURE"); mod.object = arm
# brazos abajo para verlo como en el diseño (la malla queda en pose T)
for S, s in (("Left", 1), ("Right", -1)):
    pb = arm.pose.bones[S + "Arm"]; h = pb.bone.head_local
    R = Matrix.Rotation(math.radians(s * 72), 4, "Y")
    pb.matrix = Matrix.Translation(h) @ R @ Matrix.Translation(-h) @ pb.bone.matrix_local

# 4. datos para el .glb ------------------------------------------------------------
me.calc_loop_triangles()
nt = len(me.loop_triangles)
tl = np.empty(nt * 3, dtype=np.int32); me.loop_triangles.foreach_get("loops", tl)
tm = np.empty(nt, dtype=np.int32); me.loop_triangles.foreach_get("material_index", tm)
lv = np.empty(len(me.loops), dtype=np.int32); me.loops.foreach_get("vertex_index", lv)
cn = np.empty(len(me.loops) * 3, dtype=np.float32); me.corner_normals.foreach_get("vector", cn); cn = cn.reshape(-1, 3)
cv = lv[tl]; cm = np.repeat(tm, 3); cnor = cn[tl]
key = np.column_stack([cv, cm, np.round(cnor * 1000).astype(np.int32)])
uniq, inv = np.unique(key, axis=0, return_inverse=True)
inv = inv.ravel()
first = np.zeros(len(uniq), dtype=np.int64); first[inv] = np.arange(len(inv))
uv = cv[first]; um = cm[first]; un = cnor[first]


def srgb(m):
    nd = next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
    c = nd.inputs["Base Color"].default_value
    return [max(0.0, x) ** (1 / 2.2) for x in c[:3]]


colmat = np.array([srgb(m) for m in me.materials], dtype=np.float32)
to_gl = lambda a: np.column_stack([a[:, 0], a[:, 2], -a[:, 1]]).astype(np.float32)
pos = to_gl(co[uv]); nor = to_gl(un); col = colmat[um]
order = np.argsort(-W, axis=1)[:, :4]
wt = np.take_along_axis(W, order, 1); wt /= wt.sum(1, keepdims=True)
jn = order[uv].astype(np.uint16); wv = wt[uv].astype(np.float32)
# triángulos del cuerpo primero y después los del gorro (dos primitivas con los mismos vértices)
tri = inv.reshape(-1, 3)
gorro_t = ES_GORRO[cv.reshape(-1, 3)].all(1)
idx = np.concatenate([tri[~gorro_t].ravel(), tri[gorro_t].ravel()]).astype(np.uint32)
os.makedirs(SALIDA, exist_ok=True)
base = os.path.join(SALIDA, "gnomo_%s_rig" % ("f" if C_NAME.endswith("_F") else "m"))
with open(base + ".bin", "wb") as f:
    for a in (pos, nor, col, jn, wv, idx):
        f.write(np.ascontiguousarray(a).tobytes())
info = {"huesos": HUESOS, "posiciones": {n: [J[n].x, J[n].z, -J[n].y] for n in HUESOS},
        "vertices": int(len(uniq)), "indices": int(len(idx)),
        "primitivas": [{"nombre": "cuerpo", "indices": int((~gorro_t).sum() * 3)},
                       {"nombre": "gorro", "indices": int(gorro_t.sum() * 3)}],
        "orden": ["pos f32x3", "nor f32x3", "col f32x3", "joints u16x4", "weights f32x4", "indices u32"]}
with open(base + ".json", "w", encoding="utf-8") as f:
    json.dump(info, f, indent=1)

result = {"huesos": {n: [round(c, 3) for c in J[n]] for n in ("Hips", "Spine", "Head", "LeftArm", "LeftForeArm", "LeftHand", "LeftUpLeg", "LeftLeg", "LeftFoot")},
          "vertices_glb": int(len(uniq)), "triangulos": nt,
          "sin_peso": SIN_PESO, "archivo": base}
