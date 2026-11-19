"""Kit para armar armaduras sobre un personaje hecho por piezas (malla única en pose T + esqueleto).

No se ejecuta solo: lo cargan los scripts de diseños (por ejemplo elfos_armaduras.py) con
    exec(open(".../kit_armaduras.py", encoding="utf-8").read(), globals())
después de definir CHAR (raíz del personaje) y FAMILIA (prefijo de los archivos: "cuero", "tela"…).

Es la base de gnomos_tunicas.py, generalizada (el gnomo sigue usando su propio script, que funciona
igual): mide el cuerpo con rayos desde afuera y arma cáscaras con grosor. Además de cuerpo de túnica
o chaqueta, mangas, capucha, cuello alto, hombreras, capa, bandas, runas y gemas, trae pantalón,
botas, rodilleras, guantes, hojas superpuestas, yelmo y alas.

Tipos de pieza → pesos: TR tronco (columna; bajo la cadera, mezcla con las piernas), BR brazo,
HO hombrera, CA cabeza, CU cuello (pecho), CP capa, PI pierna, BO bota, MA mano.
Salida: blender/salida/<raza>_<m|f>_armadura_<FAMILIA>_<grado>.json + .bin (lo convierte el
tools/make_*.js de la raza).
"""
import bpy, bmesh, math, json, os, random
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

C_NAME = globals().get("CHAR", "Elfo_M")
FAMILIA = globals().get("FAMILIA", "cuero")
SALIDA = r"G:\Mi unidad\Juego\blender\salida"
D = bpy.data
ROOT = D.objects[C_NAME]
RAZA = ROOT.get("raza", "gnomo")
cuerpo = D.objects[C_NAME + "_malla"]
arm = D.objects[C_NAME + "_esqueleto"]
me = cuerpo.data
J = {b.name: b.head_local.copy() for b in arm.data.bones}
PARTES = list(me["partes"])
FEM = C_NAME.endswith("_F")
INF = float("inf")
TAU = 2 * math.pi
FRENTE = -math.pi / 2  # el frente es -y

nv = len(me.vertices)
co = np.empty(nv * 3, dtype=np.float32); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
pid = np.empty(nv, dtype=np.int32); me.attributes["parte"].data.foreach_get("value", pid)
NOMBRE = np.array(PARTES, dtype=object)[pid]
TRONCO = ("camisa", "cinturon", "borde_camisa", "torso_camisa", "vestido", "cuello", "canesu", "cordon", "chaleco", "falda", "panel", "panza")
CABEZA = ("cabeza", "oreja", "pelo", "flequillo", "mechon", "patilla", "ceja", "nariz", "ojo")
CABEZA_YELMO = ("cabeza", "pelo", "flequillo", "mechon", "ceja", "nariz")


def seleccion(prefijos):
    return np.array([p.startswith(prefijos) for p in NOMBRE])


def bvh_de(prefijos, lado=0):
    """BVH de las partes que empiezan con prefijos; lado = +1/-1 se queda solo con ese costado
    (una pierna no debe medirse contra la otra: el rayo que entra por adentro chocaría con ella)."""
    sel = seleccion(prefijos)
    if lado:
        sel = sel & (co[:, 0] * lado > 0)
    polys = [list(p.vertices) for p in me.polygons if all(sel[i] for i in p.vertices)]
    return BVHTree.FromPolygons([Vector(c) for c in co], polys)


BVH_TP = bvh_de(TRONCO + ("pierna", "bota"))
BVH_TRONCO = bvh_de(TRONCO)
BVH_PIERNA = bvh_de(("pierna",))
BVH_BOTA = bvh_de(("bota",))
BVH_BOTA_PIERNA = bvh_de(("bota", "pierna"))  # botas altas: por encima de la bota siguen la pierna
# las mismas, por costado (para medir cada pierna sin la otra)
POR_LADO = {}
for _clave, _pref in (("pierna", ("pierna",)), ("bota", ("bota",)), ("bota_pierna", ("bota", "pierna"))):
    for _s in (1, -1):
        POR_LADO[(_clave, _s)] = bvh_de(_pref, _s)
BVH_CAB = bvh_de(CABEZA)
BVH_YELMO = bvh_de(CABEZA_YELMO)
BVH_BRAZO = bvh_de(("manga", "brazo"))
BVH_MANO = bvh_de(("mano", "pulgar"))
st = seleccion(TRONCO)
Z_TOP = float(co[st, 2].max())
CY = float(co[st, 1].mean())
sf = seleccion(("vestido", "falda"))
Z_FALDA = float(co[sf, 2].min()) if sf.any() else 0.0
sc_ = seleccion(("cabeza",))
CAB_MIN, CAB_MAX = Vector(co[sc_].min(0)), Vector(co[sc_].max(0))
CAB_C = (CAB_MIN + CAB_MAX) / 2
Z_CAD = J["Hips"].z
Z_BRAZO = J["LeftArm"].z
X_HOMBRO, X_CODO, X_MUNECA = abs(J["LeftArm"].x), abs(J["LeftForeArm"].x), abs(J["LeftHand"].x)
spi = seleccion(("pierna",)) & (co[:, 0] > 0)
X_PIERNA = float(co[spi, 0].mean())
sbo = seleccion(("bota",)) & (co[:, 0] > 0)
BOTA_MIN, BOTA_MAX = Vector(co[sbo].min(0)), Vector(co[sbo].max(0))
ESC = X_HOMBRO / 0.19  # tamaño relativo al gnomo (para medidas de adornos)
NA = 48
ANG = [TAU * i / NA for i in range(NA)]
TR, BR, HO, CA, CU, CP, PI, BO, MA, CO, AL = range(11)  # CO cola, AL alas (huesos propios)


def cola_anillos(n=10):
    """Secciones de la cola del cuerpo (de la raíz a la punta): [(centro, radio)]. La cola va hacia +y."""
    sel = seleccion(("cola_tubo",))
    if not sel.any():
        return []
    pts = co[sel]
    y0, y1 = float(pts[:, 1].min()), float(pts[:, 1].max())
    out = []
    for k in range(n):
        a, b = y0 + (y1 - y0) * k / n, y0 + (y1 - y0) * (k + 1) / n
        m = (pts[:, 1] >= a) & (pts[:, 1] <= b)
        if m.sum() < 3:
            continue
        c = pts[m].mean(0)
        r = float(np.sqrt(((pts[m][:, [0, 2]] - c[[0, 2]]) ** 2).sum(1)).mean())
        out.append((Vector(c), r))
    return out


def horiz(a):
    return Vector((math.cos(a), math.sin(a), 0.0))


def rayos(bvh, centro, dirs, lejos=1.0):
    out = np.full(len(dirs), np.nan)
    for i, d in enumerate(dirs):
        h = bvh.ray_cast(centro + d * lejos, -d, lejos)[0]
        if h is not None:
            out[i] = (h - centro).length
    return out


def rellenar(R):
    """Filas sin dato copian la más cercana; huecos dentro de una fila, el máximo de la fila."""
    valid = [i for i in range(len(R)) if np.isfinite(R[i]).any()]
    for i in range(len(R)):
        if not np.isfinite(R[i]).any():
            R[i] = R[min(valid, key=lambda j: abs(j - i))]
        R[i][np.isnan(R[i])] = np.nanmax(R[i])
    return R


def alisar(R, it=3):
    for _ in range(it):
        up = np.vstack([R[:1], R[:-1]]); dn = np.vstack([R[1:], R[-1:]])
        R = np.maximum(R, (np.roll(R, 1, 1) + np.roll(R, -1, 1) + up + dn) / 4)
    return R


def cadena(c, chain, b):
    k = max(i for i, (_, s) in enumerate(chain) if c >= s)
    w = {chain[k][0]: 1.0}
    if k + 1 < len(chain) and c > chain[k + 1][1] - b:
        u = (c - (chain[k + 1][1] - b)) / (2 * b)
        w = {chain[k][0]: 1 - u, chain[k + 1][0]: u}
    if k > 0 and c < chain[k][1] + b:
        u = (c - (chain[k][1] - b)) / (2 * b)
        w = {chain[k - 1][0]: 1 - u, chain[k][0]: u}
    return w


TORSO = [("Hips", -INF), ("Spine02", J["Spine02"].z), ("Spine01", J["Spine01"].z), ("Spine", J["Spine"].z)]


def frente(a, ancho):
    return abs((a - FRENTE + math.pi) % TAU - math.pi) < ancho


class Armadura:
    def __init__(self, grado):
        self.grado = grado
        self.bm = bmesh.new()
        self.tipo = self.bm.verts.layers.int.new("tipo")
        self.mats = []
        self.z_hem = Z_CAD
        self.cubre_cabeza = False
        self.robe = None
        self.tubos = {}  # superficies de mangas y piernas para poner adornos

    def M(self, nombre, rgb, brilla=False):
        for i, (n, _, _) in enumerate(self.mats):
            if n == nombre:
                return i
        self.mats.append((nombre, rgb, brilla))
        return len(self.mats) - 1

    # ------------------------------------------------------------ geometría básica
    def quad(self, vs, m):
        try:
            f = self.bm.faces.new(vs); f.material_index = m
            return f
        except ValueError:
            return None

    def cascara(self, P, Dg, grosor, tipo, mat, wrap=True, skip=None, mat_in=None):
        bm = self.bm
        R, C = len(P), len(P[0])
        vo = [[bm.verts.new(P[r][c]) for c in range(C)] for r in range(R)]
        vi = [[bm.verts.new(P[r][c] - Dg[r][c] * grosor) for c in range(C)] for r in range(R)]
        for fila in vo + vi:
            for v in fila:
                v[self.tipo] = tipo
        cols = C if wrap else C - 1
        celdas = {(r, c) for r in range(R - 1) for c in range(cols) if not (skip and skip(r, c))}
        mi = mat_in or mat
        for (r, c) in celdas:
            c2 = (c + 1) % C
            self.quad((vo[r][c], vo[r][c2], vo[r + 1][c2], vo[r + 1][c]), mat(r, c))
            self.quad((vi[r + 1][c], vi[r + 1][c2], vi[r][c2], vi[r][c]), mi(r, c))

        def hay(r, c):
            if wrap:
                c %= C
            elif c < 0 or c >= cols:
                return False
            return (r, c) in celdas

        for (r, c) in celdas:
            c2 = (c + 1) % C
            m = mat(r, c)
            if not hay(r - 1, c):
                self.quad((vo[r][c2], vo[r][c], vi[r][c], vi[r][c2]), m)
            if not hay(r + 1, c):
                self.quad((vo[r + 1][c], vo[r + 1][c2], vi[r + 1][c2], vi[r + 1][c]), m)
            if not hay(r, c - 1):
                self.quad((vo[r][c], vo[r + 1][c], vi[r + 1][c], vi[r][c]), m)
            if not hay(r, c + 1):
                self.quad((vo[r + 1][c2], vo[r][c2], vi[r][c2], vi[r + 1][c2]), m)

    def solido(self, verts, caras, m, tipo):
        vs = [self.bm.verts.new(v) for v in verts]
        for v in vs:
            v[self.tipo] = tipo
        for f in caras:
            self.quad([vs[k] for k in f], m)
        return vs

    def caja(self, centro, ejes, medidas, m, tipo):
        t, u, n = ejes
        verts = []
        for k in range(8):
            sx, sy, sz = (k & 1) - 0.5, ((k >> 1) & 1) - 0.5, ((k >> 2) & 1) - 0.5
            verts.append(centro + t * sx * medidas[0] + u * sy * medidas[1] + n * sz * medidas[2])
        return self.solido(verts, [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)], m, tipo)

    def gema(self, centro, n, r, largo, m, tipo, lados=4, giro=0.0):
        """Bipirámide a lo largo de n (gema facetada, cristal corto)."""
        n = n.normalized(); t = n.orthogonal().normalized(); u = n.cross(t)
        verts = [centro - n * largo * 0.35, centro + n * largo * 0.65]
        for k in range(lados):
            a = TAU * k / lados + giro
            verts.append(centro + (t * math.cos(a) + u * math.sin(a)) * r)
        caras = []
        for k in range(lados):
            a, b = 2 + k, 2 + (k + 1) % lados
            caras += [(0, b, a), (1, a, b)]
        return self.solido(verts, caras, m, tipo)

    def gema_cara(self, p, normal, arriba, ancho, alto, m, tipo, relieve=0.4):
        """Gema plana tipo rombo sobre una superficie (normal hacia afuera, arriba = eje largo)."""
        n = normal.normalized(); u = (arriba - n * arriba.dot(n)).normalized(); t = u.cross(n)
        verts = [p + u * alto / 2, p + t * ancho / 2, p - u * alto / 2, p - t * ancho / 2, p + n * ancho * relieve, p - n * ancho * 0.15]
        caras = [(0, 1, 4), (1, 2, 4), (2, 3, 4), (3, 0, 4), (1, 0, 5), (2, 1, 5), (3, 2, 5), (0, 3, 5)]
        return self.solido(verts, caras, m, tipo)

    def cristal(self, base, n, r, largo, m, tipo, lados=6):
        n = n.normalized(); t = n.orthogonal().normalized(); u = n.cross(t)
        anillo = lambda h, rr: [base + n * h + (t * math.cos(TAU * k / lados) + u * math.sin(TAU * k / lados)) * rr for k in range(lados)]
        verts = [base] + anillo(largo * 0.12, r) + anillo(largo * 0.72, r) + [base + n * largo]
        caras = []
        for k in range(lados):
            a, b = k, (k + 1) % lados
            caras += [(0, 1 + b, 1 + a), (1 + a, 1 + b, 1 + lados + b, 1 + lados + a), (1 + lados + a, 1 + lados + b, 1 + 2 * lados)]
        return self.solido(verts, caras, m, tipo)

    def hoja(self, centro, abajo, normal, largo, ancho, m, tipo, grosor=None):
        """Hoja (o pluma) plana en rombo: la punta hacia 'abajo', apoyada sobre la superficie."""
        n = normal.normalized(); d = (abajo - n * abajo.dot(n)).normalized(); t = d.cross(n)
        g = grosor or ancho * 0.12
        verts = [centro - d * largo * 0.25, centro + d * largo * 0.75, centro + t * ancho / 2 + d * largo * 0.15,
                 centro - t * ancho / 2 + d * largo * 0.15, centro + n * g + d * largo * 0.1, centro - n * g * 0.5 + d * largo * 0.1]
        caras = [(0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)]
        return self.solido(verts, caras, m, tipo)

    def ovoide(self, centro, radios, m, tipo, seg=14, anillos=8, ejes=None):
        t, u, n = ejes or (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)))
        verts = [centro - n * radios[2]]
        for i in range(1, anillos):
            la = -math.pi / 2 + math.pi * i / anillos
            for k in range(seg):
                a = TAU * k / seg
                verts.append(centro + t * math.cos(la) * math.cos(a) * radios[0] + u * math.cos(la) * math.sin(a) * radios[1] + n * math.sin(la) * radios[2])
        verts.append(centro + n * radios[2])
        top = len(verts) - 1
        caras = []
        for k in range(seg):
            caras.append((0, 1 + (k + 1) % seg, 1 + k))
            caras.append((top, 1 + (anillos - 2) * seg + k, 1 + (anillos - 2) * seg + (k + 1) % seg))
        for i in range(anillos - 2):
            for k in range(seg):
                a, b = 1 + i * seg + k, 1 + i * seg + (k + 1) % seg
                caras.append((a, b, b + seg, a + seg))
        return self.solido(verts, caras, m, tipo)

    # ------------------------------------------------------------ cuerpo (chaqueta / túnica)
    def cuerpo(self, z_hem, abre=1.1, mat=None, sep=0.012, grosor=0.014, filas=16, cuello=0.8, abierto=None):
        """abierto: (ancho_angular, z_hasta): abre el frente por debajo de z_hasta (abrigo abierto)."""
        if FEM and Z_FALDA:
            z_hem = min(z_hem, Z_FALDA - 0.025)
        self.z_hem = z_hem
        zs = list(np.linspace(z_hem, Z_TOP + 0.004, filas))
        dirs = [horiz(a) for a in ANG]
        cadera = rayos(BVH_TP, Vector((0, CY, Z_CAD + 0.02)), dirs)
        cadera[np.isnan(cadera)] = np.nanmean(cadera)
        R = np.array([rayos(BVH_TP, Vector((0, CY, z)), dirs) for z in zs])
        for i in range(len(zs)):
            prev = cadera if i == 0 else R[i - 1]
            R[i][np.isnan(R[i])] = prev[np.isnan(R[i])]
        R = R + sep
        for i, z in enumerate(zs):
            if z < Z_CAD:
                t = (Z_CAD - z) / max(1e-3, Z_CAD - z_hem)
                R[i] = np.maximum(R[i], (cadera + sep) * (1 + (abre - 1) * t ** 1.3))
        R = alisar(R, 4)
        zs.append(Z_TOP + 0.03 * ESC)
        R = np.vstack([R, R[-1:] * cuello])
        self.robe = (np.array(zs), R)
        P = [[Vector((R[r, c] * math.cos(a), CY + R[r, c] * math.sin(a), zs[r])) for c, a in enumerate(ANG)] for r in range(len(zs))]
        Dg = [[horiz(a) for a in ANG] for _ in zs]
        skip = None
        if abierto:
            ancho, z_hasta = abierto
            skip = lambda r, c: zs[r + 1] <= z_hasta + 1e-6 and frente(ANG[c] + TAU / NA / 2, ancho)
        self.cascara(P, Dg, grosor, TR, lambda r, c: mat(zs[r], ANG[c], r, len(zs)), skip=skip)

    def en_tunica(self, z, a, extra=0.0):
        zs, R = self.robe
        f = (a % TAU) / TAU * NA
        c0 = int(f) % NA; c1 = (c0 + 1) % NA; w = f - int(f)
        r = (1 - w) * np.interp(z, zs, R[:, c0]) + w * np.interp(z, zs, R[:, c1])
        return Vector(((r + extra) * math.cos(a), CY + (r + extra) * math.sin(a), z))

    def banda(self, z0, z1, m, extra=0.006, a0=0.0, a1=TAU, grosor=0.01, tipo=TR, filas=2):
        cerrada = abs(a1 - a0 - TAU) < 1e-6
        n = NA if cerrada else max(3, int(NA * (a1 - a0) / TAU) + 2)
        angs = [a0 + (a1 - a0) * k / (n if cerrada else n - 1) for k in range(n)]
        zz = list(np.linspace(z0, z1, filas))
        P = [[self.en_tunica(z, a, extra) for a in angs] for z in zz]
        Dg = [[horiz(a) for a in angs] for _ in zz]
        self.cascara(P, Dg, grosor, tipo, lambda r, c: m, wrap=cerrada)

    def tira(self, a_centro, ancho, z0, z1, m, extra=0.007, grosor=0.01, filas=10):
        self.banda(z0, z1, m, extra, a_centro - ancho, a_centro + ancho, grosor, filas=filas)

    def runa(self, z, a, alto, m, semilla, extra=0.009, tipo=TR):
        rnd = random.Random(semilla)
        p = self.en_tunica(z, a, extra)
        n = horiz(a); t = Vector((-math.sin(a), math.cos(a), 0)); u = Vector((0, 0, 1))
        g = alto * 0.16
        trazos = [((0, 0), (0, 1)), ((-0.4, 0.2), (0.4, 0.8)), ((-0.4, 0.5), (0.4, 0.5)), ((0.4, 0.1), (-0.4, 0.9)), ((-0.4, 1.0), (0.4, 1.0)), ((-0.4, 0.0), (0.4, 0.0))]
        for (x0, y0), (x1, y1) in [trazos[0]] + rnd.sample(trazos[1:], 2):
            c = p + t * (x0 + x1) / 2 * alto * 0.6 + u * ((y0 + y1) / 2 - 0.5) * alto
            d = t * (x1 - x0) * alto * 0.6 + u * (y1 - y0) * alto
            dd = d.normalized() if d.length > 1e-6 else u
            self.caja(c, (dd, n.cross(dd).normalized(), n), (max(d.length, g) + g, g, g * 0.8), m, tipo)

    # ------------------------------------------------------------ tubos: mangas, guantes, piernas, botas
    def manga(self, s, x1, r_fin, mat, sep=0.02, grosor=0.012, anillos=12, x0=0.12, bvh=None, nombre=None):
        xs = list(np.linspace(x0 * ESC if x0 == 0.12 else x0, x1, anillos))
        NM = 24
        angs = [TAU * k / NM for k in range(NM)]
        dirs = [Vector((0, math.cos(a), math.sin(a))) for a in angs]
        R = rellenar(np.array([rayos(bvh or BVH_BRAZO, Vector((s * x, 0, Z_BRAZO)), dirs, 0.5) for x in xs])) + sep
        base = float(np.median(R[0]))
        for i, x in enumerate(xs):
            t = (x - xs[0]) / (xs[-1] - xs[0])
            R[i] = np.maximum(R[i], base + (r_fin - base) * t ** 2.5)
        R = alisar(R, 2)
        P = [[Vector((s * x, R[r, c] * math.cos(a), Z_BRAZO + R[r, c] * math.sin(a))) for c, a in enumerate(angs)] for r, x in enumerate(xs)]
        Dg = [[Vector((0, math.cos(a), math.sin(a))) for a in angs] for _ in xs]
        self.cascara(P, Dg, grosor, BR if bvh is not BVH_MANO else MA, lambda r, c: mat(r, len(xs)))
        if nombre:
            self.tubos[(nombre, s)] = ("x", s, np.array(xs), R, angs)

    def mangas(self, x1, r_fin, mat, **kw):
        for s in (1, -1):
            self.manga(s, x1, r_fin, mat, **kw)

    def guantes(self, mat, sep=0.008, grosor=0.01):
        """Guantes sin dedos: de la muñeca a la mitad de la mano."""
        for s in (1, -1):
            self.manga(s, X_MUNECA + 0.075 * ESC, 0.0, lambda r, n: mat, sep=sep, grosor=grosor, anillos=7, x0=X_MUNECA - 0.02, bvh=BVH_MANO)

    def pierna(self, s, z0, z1, mat, sep=0.012, grosor=0.012, filas=10, bvh=None, nombre="pierna", tipo=PI, ensancha=0.0):
        """Tubo alrededor de la pierna (pantalón) o de la bota, de z0 a z1."""
        bvh = bvh or BVH_PIERNA
        cy = float(BOTA_MIN.y + BOTA_MAX.y) / 2 if bvh in (BVH_BOTA, BVH_BOTA_PIERNA) else 0.0
        clave = {id(BVH_PIERNA): "pierna", id(BVH_BOTA): "bota", id(BVH_BOTA_PIERNA): "bota_pierna"}.get(id(bvh))
        if clave:
            bvh = POR_LADO[(clave, s)]
        cx = s * X_PIERNA
        zs = list(np.linspace(z0, z1, filas))
        dirs = [horiz(a) for a in ANG]
        R = rellenar(np.array([rayos(bvh, Vector((cx, cy, z)), dirs, 0.5) for z in zs])) + sep
        if ensancha:
            for i in range(len(zs)):
                R[i] *= 1 + ensancha * (1 - i / (len(zs) - 1))
        R = alisar(R, 2)
        P = [[Vector((cx + R[r, c] * math.cos(a), cy + R[r, c] * math.sin(a), zs[r])) for c, a in enumerate(ANG)] for r in range(len(zs))]
        Dg = [[horiz(a) for a in ANG] for _ in zs]
        self.cascara(P, Dg, grosor, tipo, lambda r, c: mat(r, len(zs), ANG[c]))
        self.tubos[(nombre, s)] = ("z", s, np.array(zs), R, (cx, cy))

    def pantalon(self, mat, z0=None, **kw):
        z0 = BOTA_MAX.z - 0.02 if z0 is None else z0
        for s in (1, -1):
            self.pierna(s, z0, Z_CAD + 0.03 * ESC, mat, **kw)

    def botas(self, mat, z1=None, sep=0.01, **kw):
        z1 = BOTA_MAX.z + 0.012 if z1 is None else z1
        for s in (1, -1):
            self.pierna(s, 0.004, z1, mat, sep=sep, bvh=BVH_BOTA_PIERNA, nombre="bota", tipo=BO, **kw)

    def en_tubo(self, nombre, s, h, a, extra=0.0):
        """Punto sobre una manga (h = x) o pierna/bota (h = z) en el ángulo a; devuelve (punto, normal)."""
        eje, _, hs, R, info = self.tubos[(nombre, s)]
        n = R.shape[1]
        f = (a % TAU) / TAU * n
        c0 = int(f) % n; c1 = (c0 + 1) % n; w = f - int(f)
        r = (1 - w) * np.interp(h, hs, R[:, c0]) + w * np.interp(h, hs, R[:, c1]) + extra
        if eje == "x":
            d = Vector((0, math.cos(a), math.sin(a)))
            return Vector((s * h, 0, Z_BRAZO)) + d * r, d
        cx, cy = info
        return Vector((cx, cy, h)) + horiz(a) * r, horiz(a)

    def rodilleras(self, m, m_gema=None, ancho=0.07, alto=0.08):
        for s in (1, -1):
            p, n = self.en_tubo("pierna", s, J["LeftLeg"].z, FRENTE, 0.006)
            self.gema_cara(p, n, Vector((0, 0, 1)), ancho * ESC, alto * ESC, m, PI, relieve=0.3)
            if m_gema is not None:
                self.gema_cara(p + n * 0.012, n, Vector((0, 0, 1)), ancho * 0.5 * ESC, alto * 0.55 * ESC, m_gema, PI, relieve=0.5)

    # ------------------------------------------------------------ adornos de superficie
    def hojas_tronco(self, z0, z1, filas, por_fila, mats, largo, ancho, semilla=1, extra=0.012, a0=0.0, a1=TAU):
        rnd = random.Random(semilla)
        for i in range(filas):
            z = z1 - (z1 - z0) * i / max(1, filas - 1)
            for k in range(por_fila):
                a = a0 + (a1 - a0) * (k + 0.5 * (i % 2)) / por_fila + rnd.uniform(-0.05, 0.05)
                p = self.en_tunica(z, a, extra + 0.004 * (i % 2))
                abajo = Vector((0, 0, -1)) + horiz(a) * 0.35
                self.hoja(p, abajo, horiz(a), largo * rnd.uniform(0.85, 1.15), ancho * rnd.uniform(0.85, 1.1), rnd.choice(mats), TR)

    def hojas_tubo(self, nombre, h0, h1, filas, por_fila, mats, largo, ancho, semilla=2, extra=0.01):
        rnd = random.Random(semilla)
        for s in (1, -1):
            if (nombre, s) not in self.tubos:
                continue
            eje = self.tubos[(nombre, s)][0]
            for i in range(filas):
                h = h0 + (h1 - h0) * i / max(1, filas - 1)
                for k in range(por_fila):
                    a = TAU * (k + 0.5 * (i % 2)) / por_fila + rnd.uniform(-0.08, 0.08)
                    p, n = self.en_tubo(nombre, s, h, a, extra)
                    abajo = Vector((s, 0, 0)) if eje == "x" else Vector((0, 0, -1))
                    self.hoja(p, abajo + n * 0.3, n, largo * rnd.uniform(0.85, 1.15), ancho, rnd.choice(mats), BR if eje == "x" else PI)

    def estrellas(self, cantidad, colores, semilla=7, z0=None, z1=None, a_ok=None):
        rnd = random.Random(semilla)
        z0 = self.z_hem + 0.02 if z0 is None else z0
        z1 = Z_TOP - 0.02 if z1 is None else z1
        hechas = 0
        while hechas < cantidad:
            z = rnd.uniform(z0, z1); a = rnd.uniform(0, TAU)
            if a_ok and not a_ok(a):
                continue
            p = self.en_tunica(z, a, 0.008)
            self.gema(p, horiz(a), rnd.uniform(0.005, 0.009) * ESC, rnd.uniform(0.014, 0.022) * ESC, rnd.choice(colores), TR)
            hechas += 1

    # ------------------------------------------------------------ hombros, cuello, capa
    def hombreras(self, m, m2=None, capas=2, grande=1.0, puas=None, cristales=None):
        for s in (1, -1):
            h = J[("Left" if s > 0 else "Right") + "Arm"]
            for k in range(capas):
                c = h + Vector((s * (0.035 + 0.02 * k), 0, 0.06 - 0.028 * k)) * ESC
                self.ovoide(c, tuple(v * grande * ESC for v in (0.085, 0.1, 0.05)), m if k == 0 else (m2 or m), HO)
            for j, mp in enumerate(puas or []):
                c = h + Vector((s * (0.03 + 0.03 * j), 0.0, 0.1)) * ESC
                self.cristal(c, Vector((s * 0.3, 0, 1)), 0.018 * ESC, (0.09 - 0.015 * j) * ESC, mp, HO)
            for j, (mp, dx, dy, alto, incl) in enumerate(cristales or []):
                c = h + Vector((s * dx, dy, 0.085)) * ESC
                self.cristal(c, Vector((s * incl, dy * 2, 1)), 0.022 * ESC, alto * ESC, mp, HO)

    def cuello_alto(self, m, m_dentro, m_borde, alto=0.22, r0=0.2, r1=0.27):
        zs = list(np.linspace(Z_TOP - 0.01, Z_TOP + alto * ESC, 6))
        a0, a1 = math.radians(-35), math.radians(215)
        n = 30
        angs = [a0 + (a1 - a0) * k / (n - 1) for k in range(n)]
        P, Dg = [], []
        for i, z in enumerate(zs):
            t = i / (len(zs) - 1)
            r = (r0 + (r1 - r0) * t ** 1.4) * ESC
            P.append([Vector((r * math.cos(a), CY + 0.01 + r * math.sin(a), z)) for a in angs])
            Dg.append([horiz(a) for a in angs])
        self.cascara(P, Dg, 0.016, CU, lambda r, c: m_borde if r >= len(zs) - 2 else m, wrap=False,
                     mat_in=lambda r, c: m_borde if r >= len(zs) - 2 else m_dentro)

    def capa(self, m_fuera, m_dentro, m_borde=None, z_bajo=0.07, mat_col=None):
        zs = list(np.linspace(z_bajo, Z_TOP - 0.015, 14))
        n = 26
        P, Dg = [], []
        for i, z in enumerate(zs):
            t = (z - z_bajo) / (zs[-1] - z_bajo)
            media = math.radians(80 - 32 * t)
            angs = [math.pi / 2 - media + 2 * media * k / (n - 1) for k in range(n)]
            # la de ella va por encima de la trenza (cuelga en la espalda)
            extra = (0.03 + 0.05 * (1 - t) ** 2) * ESC + (0.11 if FEM else 0.0)
            P.append([self.en_tunica(z, a, extra) for a in angs])
            Dg.append([horiz(a) for a in angs])
        if mat_col:
            fuera = lambda r, c: m_borde if (m_borde is not None and (c in (0, n - 2) or r == 0)) else mat_col(c, n)
        elif m_borde is not None:
            fuera = lambda r, c: m_borde if (c in (0, n - 2) or r == 0) else m_fuera
        else:
            fuera = lambda r, c: m_fuera
        self.cascara(P, Dg, 0.012, CP, fuera, wrap=False, mat_in=lambda r, c: m_dentro)

    # ------------------------------------------------------------ cabeza
    def casco(self, m, m_borde, lat_min=-12, cara=48, sep=0.022, grosor=0.016, alto_cara=40):
        """Yelmo: cubre arriba, atrás y los costados; deja la cara al aire. Las orejas lo atraviesan."""
        self.cubre_cabeza = True
        lats = list(np.linspace(math.radians(90), math.radians(lat_min), 12))
        lons = [TAU * k / NA for k in range(NA)]
        dir_ = lambda la, lo: Vector((math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)))
        R = rellenar(np.array([rayos(BVH_YELMO, CAB_C, [dir_(la, lo) for lo in lons], 0.8) for la in lats]))
        R = alisar(R + sep, 3)
        P = [[CAB_C + dir_(la, lo) * R[i, k] for k, lo in enumerate(lons)] for i, la in enumerate(lats)]
        Dg = [[dir_(la, lo) for lo in lons] for la in lats]
        media = math.radians(cara)

        def abierta(r, c):
            la = (lats[r] + lats[r + 1]) / 2
            dlo = abs((lons[c] + TAU / NA / 2 - FRENTE + math.pi) % TAU - math.pi)
            return dlo < media and la < math.radians(alto_cara)

        def mat(r, c):
            borde = r >= len(lats) - 3 or any(abierta(r, (c + k) % NA) for k in (-1, 1)) or (r + 1 < len(lats) - 1 and abierta(r + 1, c))
            return m_borde if borde else m

        self.cascara(P, Dg, grosor, CA, mat, skip=abierta)
        self.yelmo = (lats, lons, R)

    def en_casco(self, la_g, lo, extra=0.0):
        lats, lons, R = self.yelmo
        la = math.radians(la_g)
        i = int(np.argmin([abs(l - la) for l in lats]))
        k = int(round((lo % TAU) / TAU * NA)) % NA
        d = Vector((math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)))
        return CAB_C + d * (R[i, k] + extra), d

    def alas(self, centro_fn, m, m2=None, plumas=5, largo=0.2, abre=1.0, tipo=CA, ancho=0.085):
        """Alas de plumas a los dos lados: centro_fn(s) -> (punto, dirección hacia afuera). Las plumas
        se abren en abanico hacia arriba y atrás, de la más corta (abajo) a la más larga."""
        for s in (1, -1):
            p0, afuera = centro_fn(s)
            for j in range(plumas):
                u = j / max(1, plumas - 1)
                d = (afuera * (0.6 + 0.6 * abre) * (1.1 - u) + Vector((0, 0.35, 0.25 + 1.1 * u))).normalized()
                # el ancho de la pluma va hacia afuera: de frente se ve el ala abierta (no de canto)
                n = d.cross(afuera).normalized()
                if n.length < 0.5:
                    n = Vector((0, -1, 0))
                if n.y > 0:
                    n = -n
                self.hoja(p0 + d * 0.015, d, n, largo * ESC * (0.6 + 0.55 * u), ancho * ESC, m if j % 2 == 0 or m2 is None else m2, tipo, grosor=0.01 * ESC)

    # ------------------------------------------------------------ pesos y salida
    def pesos(self, t, p):
        S = "Left" if p.x > 0 else "Right"
        if t == CA:
            return {"Head": 1.0}
        if t == CU:
            return {"Spine": 1.0}
        if t == HO:
            return {S + "Arm": 0.75, "Spine": 0.25}
        if t == MA:
            return {S + "Hand": 1.0}
        if t == BR:
            return cadena(abs(p.x), [("Spine", -INF), (S + "Arm", X_HOMBRO), (S + "ForeArm", X_CODO), (S + "Hand", X_MUNECA)], 0.03 * ESC)
        if t == CP:
            return cadena(p.z, TORSO, 0.05)
        if t == CO:
            if "TailA" not in J:
                return {"Hips": 1.0}
            return cadena(p.y, [("Hips", -INF), ("TailA", J["TailA"].y + 0.02), ("TailB", J["TailB"].y)], 0.04)
        if t == AL:
            return {("WingL" if p.x > 0 else "WingR"): 1.0} if "WingL" in J else {"Spine": 1.0}
        if t == PI:
            return cadena(-p.z, [("Hips", -INF), (S + "UpLeg", -Z_CAD), (S + "Leg", -J[S + "Leg"].z), (S + "Foot", -J[S + "Foot"].z)], 0.03 * ESC)
        if t == BO:
            if p.z > J[S + "Foot"].z + 0.02:
                return cadena(p.z, [(S + "Foot", -INF), (S + "Leg", J[S + "Foot"].z + 0.04)], 0.02)
            return cadena(-p.y, [(S + "Foot", -INF), (S + "ToeBase", -J[S + "ToeBase"].y)], 0.025)
        if p.z >= Z_CAD:
            return cadena(p.z, TORSO, 0.04)
        u = min(1.0, (Z_CAD - p.z) / max(1e-3, Z_CAD - self.z_hem))
        w = 0.75 * u * min(1.0, abs(p.x) / (0.1 * ESC))
        return {"Hips": 1 - w, S + "UpLeg": w} if w > 1e-4 else {"Hips": 1.0}

    def terminar(self):
        bm = self.bm
        bmesh.ops.delete(bm, geom=[v for v in bm.verts if not v.link_faces], context="VERTS")
        bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
        for f in bm.faces:
            f.smooth = True
        for e in bm.edges:
            if len(e.link_faces) == 2 and e.calc_face_angle(0) > math.radians(40):
                e.smooth = False
        nombre = f"{C_NAME}_{FAMILIA}_{self.grado}"
        viejo = D.objects.get(nombre)
        if viejo:
            m0 = viejo.data; D.objects.remove(viejo); D.meshes.remove(m0)
        am = D.meshes.new(nombre)
        bm.to_mesh(am)
        tipos = np.empty(len(am.vertices), dtype=np.int32); am.attributes["tipo"].data.foreach_get("value", tipos)
        bm.free()
        for nom, rgb, brilla in self.mats:
            mt = D.materials.get("arm_" + nom) or D.materials.new("arm_" + nom)
            nd = next(n for n in mt.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
            lin = [c ** 2.2 for c in rgb]
            nd.inputs["Base Color"].default_value = (*lin, 1); nd.inputs["Roughness"].default_value = 0.6
            if brilla:
                nd.inputs["Emission Color"].default_value = (*lin, 1); nd.inputs["Emission Strength"].default_value = 2.0
            mt.diffuse_color = (*lin, 1)
            am.materials.append(mt)
        coll = D.collections.get(f"{C_NAME}_{FAMILIA}")
        if not coll:
            coll = D.collections.new(f"{C_NAME}_{FAMILIA}"); bpy.context.scene.collection.children.link(coll)
        ob = D.objects.new(nombre, am); coll.objects.link(ob)
        ob.location = cuerpo.location
        HUESOS = list(J.keys()); HI = {n: i for i, n in enumerate(HUESOS)}
        vc = np.empty(len(am.vertices) * 3, dtype=np.float32); am.vertices.foreach_get("co", vc); vc = vc.reshape(-1, 3)
        W = np.zeros((len(vc), len(HUESOS)))
        for i, (p, t) in enumerate(zip(vc, tipos)):
            for n, w in self.pesos(int(t), Vector(p)).items():
                W[i, HI[n]] += w
        W /= W.sum(1, keepdims=True)
        for n in HUESOS:
            g = ob.vertex_groups.new(name=n)
            for i in np.nonzero(W[:, HI[n]] > 1e-4)[0]:
                g.add([int(i)], float(W[i, HI[n]]), "REPLACE")
        ob.modifiers.new("esqueleto", "ARMATURE").object = arm
        ob["cubre_cabeza"] = self.cubre_cabeza
        ob.hide_set(True); ob.hide_render = True
        am.calc_loop_triangles()
        nt = len(am.loop_triangles)
        tl = np.empty(nt * 3, dtype=np.int32); am.loop_triangles.foreach_get("loops", tl)
        tm = np.empty(nt, dtype=np.int32); am.loop_triangles.foreach_get("material_index", tm)
        lv = np.empty(len(am.loops), dtype=np.int32); am.loops.foreach_get("vertex_index", lv)
        cn = np.empty(len(am.loops) * 3, dtype=np.float32); am.corner_normals.foreach_get("vector", cn); cn = cn.reshape(-1, 3)
        cv = lv[tl]; cm = np.repeat(tm, 3); cnor = cn[tl]
        key = np.column_stack([cv, cm, np.round(cnor * 1000).astype(np.int32)])
        uniq, inv = np.unique(key, axis=0, return_inverse=True); inv = inv.ravel()
        first = np.zeros(len(uniq), dtype=np.int64); first[inv] = np.arange(len(inv))
        uv, um, un = cv[first], cm[first], cnor[first]
        to_gl = lambda a: np.column_stack([a[:, 0], a[:, 2], -a[:, 1]]).astype(np.float32)
        colmat = np.array([m[1] for m in self.mats], dtype=np.float32)
        brilla = np.array([m[2] for m in self.mats])
        order = np.argsort(-W, axis=1)[:, :4]
        wt = np.take_along_axis(W, order, 1); wt /= wt.sum(1, keepdims=True)
        tri = inv.reshape(-1, 3); bt = brilla[tm]
        idx = np.concatenate([tri[~bt].ravel(), tri[bt].ravel()]).astype(np.uint32)
        sexo = "f" if FEM else "m"
        base = os.path.join(SALIDA, f"{RAZA}_{sexo}_armadura_{FAMILIA}_{self.grado}")
        os.makedirs(SALIDA, exist_ok=True)
        with open(base + ".bin", "wb") as f:
            for a in (to_gl(vc[uv]), to_gl(un), colmat[um], order[uv].astype(np.uint16), wt[uv].astype(np.float32), idx):
                f.write(np.ascontiguousarray(a).tobytes())
        info = {"huesos": HUESOS, "posiciones": {n: [J[n].x, J[n].z, -J[n].y] for n in HUESOS},
                "vertices": int(len(uniq)), "indices": int(len(idx)), "cubre_cabeza": self.cubre_cabeza,
                "extras": [{"nombre": b.name, "padre": b.parent.name} for b in arm.data.bones if b.name in ("TailA", "TailB", "WingL", "WingR")],
                "primitivas": [{"nombre": "tela", "indices": int((~bt).sum() * 3)},
                               {"nombre": "brillo", "indices": int(bt.sum() * 3), "brilla": True}]}
        with open(base + ".json", "w", encoding="utf-8") as f:
            json.dump(info, f, indent=1)
        return {"objeto": nombre, "triangulos": nt, "vertices_glb": int(len(uniq)), "cubre_cabeza": self.cubre_cabeza}
