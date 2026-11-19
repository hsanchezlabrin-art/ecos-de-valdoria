"""Convierte un gnomo hecho de piezas en una sola malla esculpida.

Se ejecuta dentro de Blender con gnomos.blend abierto:
    g = {"CHAR": "Gnomo_M"}
    exec(open(r".../gnomos_malla_unica.py", encoding="utf-8").read(), g)

Pasos:
  1. Une las piezas de volumen (cuerpo, ropa, pelo, gorro) y las fusiona con un
     remallado por vóxeles: queda una sola superficie continua, sin interiores.
  2. Pinta cada cara de la malla densa con el material de la pieza original más
     cercana, limpia manchas sueltas y endereza los bordes entre colores.
  3. Esculpe por código: suavizado sin encoger (Taubin) para fundir uniones y
     mechones en la barba y el pelo de la nuca.
  4. Reduce a malla low-poly (decimate) protegiendo los bordes entre colores.
  5. Añade como islas de la misma malla los detalles finos (ojos, sonrisa,
     gafas, cuello) para que conserven su forma limpia.
Las piezas originales se guardan en la colección "<CHAR>_piezas", excluida de la vista.
Con POSE_T=True (por defecto) los brazos quedan horizontales, como pide el esqueleto del juego.
Cada vértice guarda en el atributo "parte" el índice de la pieza de la que viene (la lista de
nombres está en la propiedad "partes" de la malla): gnomos_rig.py lo usa para los pesos.
"""
import bpy, bmesh, math, os, sys, importlib
import numpy as np
from mathutils import Vector
from mathutils.bvhtree import BVHTree

sys.path.insert(0, r"G:\Mi unidad\Juego\blender\scripts")
import gnomos_comun as GC  # noqa: E402
importlib.reload(GC)

C_NAME = globals().get("CHAR", "Gnomo_M")
VOXEL = globals().get("VOXEL", 0.0045)
TARGET_TRIS = globals().get("TARGET_TRIS", 24000)
POSE_T = globals().get("POSE_T", True)
ISLAND_KEYS = ("_ojo_", "_sonrisa", "_gafas_", "_cuello", "_flor")

D = bpy.data
scene = bpy.context.scene
vl = bpy.context.view_layer

root = D.objects[C_NAME]
piezas = root.users_collection[0]
lc = vl.layer_collection.children.get(piezas.name)
if lc: lc.exclude = False
dg = bpy.context.evaluated_depsgraph_get()
dg.update()
pose_t = GC.matrices_pose_t(root) if POSE_T else None

parts = [o for o in root.children if o.type == "MESH"]
vol = [o for o in parts if not any(k in o.name for k in ISLAND_KEYS)]
isl = [o for o in parts if o not in vol]
MATS = []
PARTS = [o.name[len(C_NAME) + 1:] for o in vol]


def mat_index(name):
    if name not in MATS:
        MATS.append(name)
    return MATS.index(name)


# 1. unir + remallado por voxeles, por grupos ------------------------------
# Cada grupo se mueve con su propio hueso o cadena (cabeza con pelo, barba y gorro; tronco; cada
# brazo; cada pierna con su bota). Se funden por separado y quedan en la misma malla, encastrados:
# así la barba no queda soldada al hombro ni una pierna a la otra (se estirarían al animar).
TRONCO_P = ("camisa", "cinturon", "borde_camisa", "torso_camisa", "vestido", "canesu", "cordon", "chaleco", "falda", "panel")


def grupo(nombre):
    if GC.es_brazo("_" + nombre):
        return "brazo" + nombre[-2:]
    if nombre.startswith(("pierna", "bota")):
        return "pierna" + nombre[-2:]
    if nombre.startswith(TRONCO_P):
        return "tronco"
    if nombre.startswith(GC.QUITABLES):  # aparte: algunas armaduras lo reemplazan (capucha, yelmo)
        return "gorro"
    return "cabeza"


GRUPOS = {}
for pi in range(len(vol)):
    GRUPOS.setdefault(grupo(PARTS[pi]), []).append(pi)
V, F, FM, FP = [], [], [], []   # todas las piezas juntas (respaldo para ubicar vértices)
allco, allf, allfp, allfm = [], [], [], []
voff = 0
for gname, pis in GRUPOS.items():
    gV, gF, gFM, gFP = [], [], [], []
    for pi in pis:
        ob = vol[pi]
        ev = ob.evaluated_get(dg); me = ev.to_mesh(); M = GC.matriz_pieza(ob, root, pose_t)
        off = len(gV)
        gV += [tuple(M @ v.co) for v in me.vertices]
        for p in me.polygons:
            gF.append([off + i for i in p.vertices])
            gFM.append(mat_index(ob.material_slots[p.material_index].material.name))
            gFP.append(pi)
        ev.to_mesh_clear()
    o2 = len(V); V += gV; F += [[o2 + i for i in f] for f in gF]; FM += gFM; FP += gFP
    bvh_g = BVHTree.FromPolygons(gV, gF)
    src_me = D.meshes.new(C_NAME + "_src"); src_me.from_pydata(gV, [], gF)
    src_ob = D.objects.new(C_NAME + "_src", src_me); scene.collection.objects.link(src_ob)
    rm = src_ob.modifiers.new("Remesh", "REMESH")
    rm.mode = "VOXEL"; rm.voxel_size = VOXEL; rm.adaptivity = 0.0
    dg.update()
    gm = D.meshes.new_from_object(src_ob.evaluated_get(dg))
    D.objects.remove(src_ob); D.meshes.remove(src_me)
    gn, gnf = len(gm.vertices), len(gm.polygons)
    gco = np.empty(gn * 3, dtype=np.float32); gm.vertices.foreach_get("co", gco)
    glt = np.empty(gnf, dtype=np.int32); gm.polygons.foreach_get("loop_total", glt)
    assert (glt == 4).all(), "se esperaba una malla de cuadrados"
    glv = np.empty(gnf * 4, dtype=np.int32); gm.loops.foreach_get("vertex_index", glv)
    gcen = np.empty(gnf * 3, dtype=np.float32); gm.polygons.foreach_get("center", gcen)
    hit = np.array([bvh_g.find_nearest(Vector(c))[2] for c in gcen.reshape(-1, 3)])
    allfp.append(np.array(gFP)[hit]); allfm.append(np.array(gFM)[hit])
    allco.append(gco.reshape(-1, 3)); allf.append(glv.reshape(-1, 4) + voff); voff += gn
    D.meshes.remove(gm)
bvh = BVHTree.FromPolygons(V, F)
dense = D.meshes.new(C_NAME + "_densa")
dense.from_pydata(np.vstack(allco).tolist(), [], np.vstack(allf).tolist())
dense.update(calc_edges=True)
fpart0 = np.concatenate(allfp); fmat0 = np.concatenate(allfm)

n = len(dense.vertices); nf = len(dense.polygons); ne = len(dense.edges)
co = np.empty(n * 3, dtype=np.float32); dense.vertices.foreach_get("co", co)
co = co.reshape(-1, 3).astype(np.float64)
ed = np.empty(ne * 2, dtype=np.int32); dense.edges.foreach_get("vertices", ed)
ed = ed.reshape(-1, 2); a, b = ed[:, 0], ed[:, 1]
deg = (np.bincount(a, minlength=n) + np.bincount(b, minlength=n)).astype(np.float64)
deg[deg == 0] = 1
ltot = np.empty(nf, dtype=np.int32); dense.polygons.foreach_get("loop_total", ltot)
assert (ltot == 4).all(), "se esperaba una malla de cuadrados"
lv = np.empty(nf * 4, dtype=np.int32); dense.loops.foreach_get("vertex_index", lv); lv = lv.reshape(-1, 4)
le = np.empty(nf * 4, dtype=np.int32); dense.loops.foreach_get("edge_index", le); le = le.reshape(-1, 4)
# caras a cada lado de cada arista
lf = np.repeat(np.arange(nf), 4)
order = np.argsort(le.ravel(), kind="stable")
ef = lf[order].reshape(-1, 2)            # malla cerrada: 2 caras por arista
ef_full = np.empty((ne, 2), dtype=np.int64); ef_full[le.ravel()[order][::2]] = ef
neigh = np.where(ef_full[le][:, :, 0] == np.arange(nf)[:, None], ef_full[le][:, :, 1], ef_full[le][:, :, 0])


def taubin(co, it, lam=0.5, mu=-0.53, mask=None):
    for _ in range(it):
        for f in (lam, mu):
            s = np.empty_like(co)
            for k in range(3):
                s[:, k] = np.bincount(a, weights=co[b, k], minlength=n) + np.bincount(b, weights=co[a, k], minlength=n)
            d = s / deg[:, None] - co
            co = co + f * (d if mask is None else d * mask[:, None])
    return co


co = taubin(co, 3)
dense.vertices.foreach_set("co", co.astype(np.float32).ravel()); dense.update()

# 2. colores en la malla densa --------------------------------------------
fpart = fpart0.copy()
fmat = fmat0.copy()
for _ in range(4):                       # filtro de moda: borra manchas sueltas
    nm = fmat[neigh]
    cnt = np.stack([(nm == nm[:, k:k + 1]).sum(1) for k in range(4)], 1)
    best = nm[np.arange(nf), cnt.argmax(1)]
    ch = (cnt.max(1) >= 3) & (best != fmat)
    fmat[ch] = best[ch]
    fpart[ch] = fpart[neigh][np.arange(nf), cnt.argmax(1)][ch]
bedge = fmat[ef_full[:, 0]] != fmat[ef_full[:, 1]]
bv = np.zeros(n, bool); bv[ed[bedge].ravel()] = True
bdeg = np.bincount(ed[bedge].ravel(), minlength=n)
movable = bdeg == 2                      # puntos de union de 3 colores quedan fijos
ba, bb = ed[bedge, 0], ed[bedge, 1]
for _ in range(10):                      # endereza la linea entre colores
    s = np.empty_like(co)
    for k in range(3):
        s[:, k] = np.bincount(ba, weights=co[bb, k], minlength=n) + np.bincount(bb, weights=co[ba, k], minlength=n)
    avg = s / np.maximum(bdeg, 1)[:, None]
    co[movable] += 0.5 * (avg[movable] - co[movable])
co = taubin(co, 2, mask=(~bv).astype(np.float64))

# 3. esculpido --------------------------------------------------------------
vpart = np.empty(n, dtype=np.int64); vpart[lv.ravel()] = np.repeat(fpart, 4)
dense.vertices.foreach_set("co", co.astype(np.float32).ravel()); dense.update()
nor = np.empty(n * 3, dtype=np.float32); dense.vertex_normals.foreach_get("vector", nor)
nor = nor.reshape(-1, 3).astype(np.float64)
x, y, z = co.T


def part_mask(*keys):
    ids = [i for i, p in enumerate(PARTS) if any(k in p for k in keys)]
    return np.isin(vpart, ids)


def mechones(mask, xs, period, depth):
    # crestas redondeadas con surcos suaves entre mechon y mechon
    s = np.abs(np.sin(np.pi * xs / period)) ** 0.6
    return np.where(mask, depth * (s - 0.7), 0.0)


disp = mechones(part_mask("pelo_nuca"), x, 0.06, 0.006)
if C_NAME == "Gnomo_M":
    xs = x / np.clip((z - 0.40) / 0.32, 0.4, 1.0)   # convergen hacia la punta
    disp += mechones(part_mask("barba", "patilla"), xs, 0.08, 0.008)
co = co + nor * disp[:, None]
co = taubin(co, 1, 0.35, -0.37, mask=(~bv).astype(np.float64))
dense.vertices.foreach_set("co", co.astype(np.float32).ravel()); dense.update()

# 4. low-poly protegiendo los bordes de color --------------------------------
for m in MATS:
    dense.materials.append(D.materials[m])
dense.polygons.foreach_set("material_index", fmat.astype(np.int32))
dense.attributes.new("parte_f", "INT", "FACE").data.foreach_set("value", fpart.astype(np.int32))
dense_ob = D.objects.new(C_NAME + "_densa", dense); scene.collection.objects.link(dense_ob)
vg = dense_ob.vertex_groups.new(name="borde"); vg.add(np.nonzero(bv)[0].tolist(), 1.0, "REPLACE")
dm = dense_ob.modifiers.new("Decimate", "DECIMATE")
dm.decimate_type = "COLLAPSE"; dm.ratio = min(1.0, TARGET_TRIS / (nf * 2))
# en el colapso, peso 0 = se conserva; invertimos para que el borde quede en 0
dm.vertex_group = "borde"; dm.invert_vertex_group = True; dm.vertex_group_factor = 5.0
dg.update()
low = D.meshes.new_from_object(dense_ob.evaluated_get(dg))
low.name = C_NAME + "_malla"
# pieza de origen de cada vertice: la de sus caras (se conserva al reducir); si no, la más cercana
if "parte_f" in low.attributes:
    pf = np.empty(len(low.polygons), dtype=np.int32); low.attributes["parte_f"].data.foreach_get("value", pf)
    llt = np.empty(len(low.polygons), dtype=np.int32); low.polygons.foreach_get("loop_total", llt)
    llv = np.empty(len(low.loops), dtype=np.int32); low.loops.foreach_get("vertex_index", llv)
    vparte = np.zeros(len(low.vertices), dtype=np.int32); vparte[llv] = np.repeat(pf, llt)
    low.attributes.remove(low.attributes["parte_f"])
else:
    lco = np.empty(len(low.vertices) * 3, dtype=np.float32); low.vertices.foreach_get("co", lco)
    vparte = np.array([FP[bvh.find_nearest(Vector(p))[2]] for p in lco.reshape(-1, 3)], dtype=np.int32)
low.attributes.new("parte", "INT", "POINT").data.foreach_set("value", vparte)

# 5. islas de detalle + sombreado ------------------------------------------
bm = bmesh.new(); bm.from_mesh(low)
lay = bm.verts.layers.int.get("parte")
for ob in isl:
    ev = ob.evaluated_get(dg); me = ev.to_mesh(); M = GC.matriz_pieza(ob, root, pose_t)
    PARTS.append(ob.name[len(C_NAME) + 1:])
    vs = [bm.verts.new(M @ v.co) for v in me.vertices]
    for v in vs:
        v[lay] = len(PARTS) - 1
    for p in me.polygons:
        f = bm.faces.new([vs[i] for i in p.vertices])
        name = ob.material_slots[p.material_index].material.name
        if name not in MATS:
            MATS.append(name); low.materials.append(D.materials[name])
        f.material_index = MATS.index(name)
    ev.to_mesh_clear()
for f in bm.faces:
    f.smooth = True
for e in bm.edges:
    if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(38):
        e.smooth = False
bm.to_mesh(low); bm.free(); low.update()
low["partes"] = PARTS
low["pose_t"] = bool(POSE_T)

# objeto final y limpieza
old = D.objects.get(C_NAME + "_malla")
if old:
    old_me = old.data; D.objects.remove(old)
    if old_me.users == 0: D.meshes.remove(old_me)
low.name = C_NAME + "_malla"
coll = D.collections.get(C_NAME + "_malla") or D.collections.new(C_NAME + "_malla")
if coll.name not in scene.collection.children: scene.collection.children.link(coll)
final = D.objects.new(C_NAME + "_malla", low)
coll.objects.link(final)
final.location = root.matrix_world.translation
me = dense_ob.data; D.objects.remove(dense_ob); D.meshes.remove(me)
if not piezas.name.endswith("_piezas"):
    piezas.name = C_NAME + "_piezas"
vl.layer_collection.children[piezas.name].exclude = True

result = {"malla": final.name, "vertices": len(low.vertices),
          "triangulos": sum(len(p.vertices) - 2 for p in low.polygons),
          "densa_caras": nf, "vertices_borde": int(bv.sum()), "materiales": MATS}
