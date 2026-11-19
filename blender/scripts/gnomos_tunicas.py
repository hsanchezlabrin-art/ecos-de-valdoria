"""Las 6 túnicas del gnomo (armadura de tela, una por grado) hechas sobre su cuerpo.

Se ejecuta dentro de Blender con gnomos.blend abierto, después de gnomos_rig.py:
    g = {"CHAR": "Gnomo_M"}            # opcional: "SOLO": ["azul"] para hacer solo algunas
    exec(open(r".../gnomos_tunicas.py", encoding="utf-8").read(), g)

Grados (data.js, CLOTH_ROBE): madera Ropa de Tela Simple · cobre Túnica de Cobre · azul Túnica de
Cristal Azul · morado Túnica de Oro Encantado · dorado Túnica de Diamante con Capa · arcoiris Túnica
Prismática Celestial.

Cada túnica se arma con piezas medidas sobre el cuerpo en pose T (con rayos desde afuera, así no
depende de cómo quedó triangulado): el cuerpo de la túnica sigue el tronco y se abre en faldón; las
mangas siguen el brazo y se acampanan; la capucha, el sombrero y la corona se miden sobre la cabeza.
Los colores van por cara (un material por color) y las partes que brillan (runas, gemas, estrellas)
van en una primitiva aparte que el juego dibuja sin sombra.

Pesos: el tronco por la columna y, debajo de la cadera, mezclado con cada pierna (así el faldón
acompaña el paso); las mangas por el brazo; capucha, sombrero y corona con la cabeza; el cuello
alto con el pecho; la capa del pecho a la cadera.

Escribe blender/salida/gnomo_<m|f>_armadura_tela_<grado>.json + .bin; tools/make_gnomo.js los
convierte en juego/assets/models/armaduras/tela_<grado>_gnomo_<m|f>.glb. "cubre_cabeza" indica al
juego que oculte el gorro del gnomo.
"""
import bpy, bmesh, math, json, os, random
import numpy as np
from mathutils import Vector, Matrix
from mathutils.bvhtree import BVHTree

C_NAME = globals().get("CHAR", "Gnomo_M")
GRADOS = ["madera", "cobre", "azul", "morado", "dorado", "arcoiris"]
SOLO = globals().get("SOLO") or GRADOS
SALIDA = r"G:\Mi unidad\Juego\blender\salida"
D = bpy.data
cuerpo = D.objects[C_NAME + "_malla"]
arm = D.objects[C_NAME + "_esqueleto"]
me = cuerpo.data
J = {b.name: b.head_local.copy() for b in arm.data.bones}
PARTES = list(me["partes"])
FEM = C_NAME.endswith("_F")
INF = float("inf")
TAU = 2 * math.pi
FRENTE = -math.pi / 2  # el frente del gnomo es -y

nv = len(me.vertices)
co = np.empty(nv * 3, dtype=np.float32); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
pid = np.empty(nv, dtype=np.int32); me.attributes["parte"].data.foreach_get("value", pid)
NOMBRE = np.array(PARTES, dtype=object)[pid]
TRONCO = ("camisa", "cinturon", "borde_camisa", "torso_camisa", "vestido", "cuello")
PIERNAS = ("pierna", "bota")
CABEZA = ("cabeza", "oreja", "pelo_nuca", "flequillo", "mechon", "patilla", "ceja", "nariz", "ojo")
BRAZO = ("manga", "brazo")


def seleccion(prefijos):
    return np.array([p.startswith(prefijos) for p in NOMBRE])


def bvh_de(prefijos):
    sel = seleccion(prefijos)
    polys = [list(p.vertices) for p in me.polygons if all(sel[i] for i in p.vertices)]
    return BVHTree.FromPolygons([Vector(c) for c in co], polys)


BVH_TP = bvh_de(TRONCO + PIERNAS)
BVH_CAB = bvh_de(CABEZA)
BVH_BRAZO = bvh_de(BRAZO)
st = seleccion(TRONCO)
Z_TOP = float(co[st, 2].max())          # arriba del tronco (hombros)
CY = float(co[st, 1].mean())            # eje vertical del tronco
sc_ = seleccion(("cabeza",))
CAB_MIN, CAB_MAX = Vector(co[sc_].min(0)), Vector(co[sc_].max(0))
CAB_C = (CAB_MIN + CAB_MAX) / 2
Z_CAD = J["Hips"].z
Z_BRAZO = J["LeftArm"].z
X_HOMBRO, X_CODO, X_MUNECA = abs(J["LeftArm"].x), abs(J["LeftForeArm"].x), abs(J["LeftHand"].x)
NA = 48
ANG = [TAU * i / NA for i in range(NA)]

# tipos de pieza (deciden los pesos)
TR, BR, HO, CA, CU, CP = range(6)


# ---------------------------------------------------------------- utilidades
def horiz(a):
    return Vector((math.cos(a), math.sin(a), 0.0))


def rayos(bvh, centro, dirs, lejos=1.0):
    out = np.full(len(dirs), np.nan)
    for i, d in enumerate(dirs):
        h = bvh.ray_cast(centro + d * lejos, -d, lejos)[0]
        if h is not None:
            out[i] = (h - centro).length
    return out


def alisar(R, it=3):
    """Promedia con los vecinos sin meterse nunca hacia adentro."""
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


class Tunica:
    def __init__(self, grado):
        self.grado = grado
        self.bm = bmesh.new()
        self.tipo = self.bm.verts.layers.int.new("tipo")
        self.mats = []          # (nombre, rgb srgb, brilla)
        self.z_hem = Z_CAD
        self.cubre_cabeza = False
        self.robe = None        # (zs, R) de la superficie del cuerpo de la túnica

    # ---- materiales
    def M(self, nombre, rgb, brilla=False):
        for i, (n, _, _) in enumerate(self.mats):
            if n == nombre:
                return i
        self.mats.append((nombre, rgb, brilla))
        return len(self.mats) - 1

    # ---- geometría básica
    def quad(self, vs, m):
        try:
            f = self.bm.faces.new(vs)
            f.material_index = m
            return f
        except ValueError:
            return None

    def cascara(self, P, Dg, grosor, tipo, mat, wrap=True, skip=None, mat_in=None):
        """Cáscara con grosor sobre una grilla (filas x columnas): cara de afuera P, de adentro
        P - Dg*grosor, y bordes cerrados donde termina la grilla o hay celdas salteadas."""
        bm = self.bm
        R, C = len(P), len(P[0])
        vo = [[bm.verts.new(P[r][c]) for c in range(C)] for r in range(R)]
        vi = [[bm.verts.new(P[r][c] - Dg[r][c] * grosor) for c in range(C)] for r in range(R)]
        for fila in vo + vi:
            for v in fila:
                v[self.tipo] = tipo
        cols = C if wrap else C - 1
        celdas = set()
        for r in range(R - 1):
            for c in range(cols):
                if skip and skip(r, c):
                    continue
                celdas.add((r, c))
        mi = mat_in or mat
        for (r, c) in celdas:
            c2 = (c + 1) % C
            m = mat(r, c)
            self.quad((vo[r][c], vo[r][c2], vo[r + 1][c2], vo[r + 1][c]), m)
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

    def solido(self, verts, caras, m, tipo, mat_de_cara=None):
        vs = [self.bm.verts.new(v) for v in verts]
        for v in vs:
            v[self.tipo] = tipo
        for i, f in enumerate(caras):
            self.quad([vs[k] for k in f], mat_de_cara(i) if mat_de_cara else m)
        return vs

    def caja(self, centro, ejes, medidas, m, tipo):
        """Caja orientada: ejes = (t, u, n) unitarios, medidas = (ancho, alto, fondo)."""
        t, u, n = ejes
        verts = []
        for k in range(8):
            sx, sy, sz = (k & 1) - 0.5, ((k >> 1) & 1) - 0.5, ((k >> 2) & 1) - 0.5
            verts.append(centro + t * sx * medidas[0] + u * sy * medidas[1] + n * sz * medidas[2])
        caras = [(0, 1, 3, 2), (4, 6, 7, 5), (0, 4, 5, 1), (2, 3, 7, 6), (0, 2, 6, 4), (1, 5, 7, 3)]
        return self.solido(verts, caras, m, tipo)

    def gema(self, centro, n, r, largo, m, tipo, lados=4):
        """Bipirámide (gema o cristal) a lo largo de n."""
        n = n.normalized()
        t = n.orthogonal().normalized(); u = n.cross(t)
        verts = [centro - n * largo * 0.35, centro + n * largo * 0.65]
        for k in range(lados):
            a = TAU * k / lados
            verts.append(centro + (t * math.cos(a) + u * math.sin(a)) * r)
        caras = []
        for k in range(lados):
            a, b = 2 + k, 2 + (k + 1) % lados
            caras += [(0, b, a), (1, a, b)]
        return self.solido(verts, caras, m, tipo)

    def cristal(self, base, n, r, largo, m, tipo, lados=6):
        """Prisma hexagonal con punta (cristal de la corona)."""
        n = n.normalized()
        t = n.orthogonal().normalized(); u = n.cross(t)
        anillo = lambda h, rr: [base + n * h + (t * math.cos(TAU * k / lados) + u * math.sin(TAU * k / lados)) * rr for k in range(lados)]
        verts = [base] + anillo(largo * 0.12, r) + anillo(largo * 0.72, r) + [base + n * largo]
        caras = []
        for k in range(lados):
            a, b = k, (k + 1) % lados
            caras += [(0, 1 + b, 1 + a), (1 + a, 1 + b, 1 + lados + b, 1 + lados + a), (1 + lados + a, 1 + lados + b, 1 + 2 * lados)]
        return self.solido(verts, caras, m, tipo)

    def ovoide(self, centro, radios, m, tipo, seg=12, anillos=8, ejes=None):
        t, u, n = ejes or (Vector((1, 0, 0)), Vector((0, 1, 0)), Vector((0, 0, 1)))
        verts = [centro - n * radios[2]]
        for i in range(1, anillos):
            la = -math.pi / 2 + math.pi * i / anillos
            for k in range(seg):
                a = TAU * k / seg
                verts.append(centro + t * math.cos(la) * math.cos(a) * radios[0] + u * math.cos(la) * math.sin(a) * radios[1] + n * math.sin(la) * radios[2])
        verts.append(centro + n * radios[2])
        caras = []
        top = len(verts) - 1
        for k in range(seg):
            caras.append((0, 1 + (k + 1) % seg, 1 + k))
            caras.append((top, 1 + (anillos - 2) * seg + k, 1 + (anillos - 2) * seg + (k + 1) % seg))
        for i in range(anillos - 2):
            for k in range(seg):
                a, b = 1 + i * seg + k, 1 + i * seg + (k + 1) % seg
                caras.append((a, b, b + seg, a + seg))
        return self.solido(verts, caras, m, tipo)

    def toro(self, centro, n, R, r, m, tipo, seg=20, seg2=8):
        n = n.normalized(); t = n.orthogonal().normalized(); u = n.cross(t)
        verts = []
        for i in range(seg):
            a = TAU * i / seg
            d = t * math.cos(a) + u * math.sin(a)
            for k in range(seg2):
                b = TAU * k / seg2
                verts.append(centro + d * (R + r * math.cos(b)) + n * r * math.sin(b))
        caras = []
        for i in range(seg):
            for k in range(seg2):
                a = i * seg2 + k; b = i * seg2 + (k + 1) % seg2
                c = ((i + 1) % seg) * seg2 + (k + 1) % seg2; d = ((i + 1) % seg) * seg2 + k
                caras.append((a, d, c, b))
        return self.solido(verts, caras, m, tipo)

    # ---- cuerpo de la túnica
    def cuerpo(self, z_hem, abre=1.2, mat=None, sep=0.012, grosor=0.014, filas=16, cuello=0.8):
        if FEM:
            z_hem = min(z_hem, 0.12)  # tapa el vestido
        self.z_hem = z_hem
        zs = list(np.linspace(z_hem, Z_TOP + 0.004, filas))
        dirs = [horiz(a) for a in ANG]
        cadera = rayos(BVH_TP, Vector((0, CY, Z_CAD + 0.02)), dirs)
        cadera[np.isnan(cadera)] = np.nanmean(cadera)
        R = np.array([rayos(BVH_TP, Vector((0, CY, z)), dirs) for z in zs])
        for i in range(len(zs)):  # sin dato: la fila de abajo (la primera, la cadera)
            prev = cadera if i == 0 else R[i - 1]
            R[i][np.isnan(R[i])] = prev[np.isnan(R[i])]
        R = R + sep
        for i, z in enumerate(zs):
            fila = R[i]
            if z < Z_CAD:
                t = (Z_CAD - z) / max(1e-3, Z_CAD - z_hem)
                R[i] = np.maximum(fila, (cadera + sep) * (1 + (abre - 1) * t ** 1.3))
        R = alisar(R, 4)
        zs.append(Z_TOP + 0.03)
        R = np.vstack([R, R[-1:] * cuello])
        self.robe = (np.array(zs), R)
        P = [[Vector((R[r, c] * math.cos(a), CY + R[r, c] * math.sin(a), zs[r])) for c, a in enumerate(ANG)] for r in range(len(zs))]
        Dg = [[horiz(a) for a in ANG] for _ in zs]
        self.cascara(P, Dg, grosor, TR, lambda r, c: mat(zs[r], ANG[c], r, len(zs)))

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
        """Tira vertical sobre la túnica (bordes del frente, paneles)."""
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
            largo = max(d.length, g)
            dd = d.normalized() if d.length > 1e-6 else u
            self.caja(c, (dd, n.cross(dd).normalized(), n), (largo + g, g, g * 0.8), m, tipo)

    # ---- mangas
    def manga(self, s, x1, r_fin, mat, sep=0.012, grosor=0.012, anillos=12, x0=0.12):
        xs = list(np.linspace(x0, x1, anillos))
        NM = 24
        angs = [TAU * k / NM for k in range(NM)]
        dirs = [Vector((0, math.cos(a), math.sin(a))) for a in angs]
        R = np.array([rayos(BVH_BRAZO, Vector((s * x, 0, Z_BRAZO)), dirs, 0.5) for x in xs])
        valid = [i for i in range(len(xs)) if np.isfinite(R[i]).any()]
        for i in range(len(xs)):  # anillos sin brazo: copian el más cercano
            if not np.isfinite(R[i]).any():
                R[i] = R[min(valid, key=lambda j: abs(j - i))]
            R[i][np.isnan(R[i])] = np.nanmax(R[i])
        R = R + sep
        base = float(np.median(R[valid[0]]))
        for i, x in enumerate(xs):
            t = (x - x0) / (x1 - x0)
            R[i] = np.maximum(R[i], base + (r_fin - base) * t ** 2.5)
        R = alisar(R, 2)
        P = [[Vector((s * x, R[r, c] * math.cos(a), Z_BRAZO + R[r, c] * math.sin(a))) for c, a in enumerate(angs)] for r, x in enumerate(xs)]
        Dg = [[Vector((0, math.cos(a), math.sin(a))) for a in angs] for _ in xs]
        self.cascara(P, Dg, grosor, BR, lambda r, c: mat(r, len(xs)))
        return xs, R, angs

    def mangas(self, x1, r_fin, mat, **kw):
        for s in (1, -1):
            self.manga(s, x1, r_fin, mat, **kw)

    # ---- cabeza
    def capucha(self, m, m_borde, sep=0.032, grosor=0.014, pico=0.6):
        self.cubre_cabeza = True
        lats = list(np.linspace(math.radians(90), math.radians(-72), 16))
        lons = [TAU * k / NA for k in range(NA)]
        dir_ = lambda la, lo: Vector((math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)))
        R = np.array([rayos(BVH_CAB, CAB_C, [dir_(la, lo) for lo in lons], 0.7) for la in lats])
        for i in range(len(lats)):
            if i == 0:
                R[0][np.isnan(R[0])] = np.nanmean(R[0])
            else:  # debajo de la cabeza: se abre sobre los hombros (capa corta)
                R[i] = np.where(np.isnan(R[i]), R[i - 1] * 1.07, R[i])
        R = alisar(R + sep, 3)
        pk = Vector((0, 0.3, 0.95)).normalized()
        P, Dg = [], []
        for i, la in enumerate(lats):
            fila, dfila = [], []
            for k, lo in enumerate(lons):
                d = dir_(la, lo)
                r = R[i, k] * (1 + pico * max(0.0, d.dot(pk)) ** 8)
                fila.append(CAB_C + d * r); dfila.append(d)
            P.append(fila); Dg.append(dfila)
        media = math.radians(66 if FEM else 58)

        def abierta(r, c):
            la = (lats[r] + lats[r + 1]) / 2
            lo = (lons[c] + TAU / NA / 2)
            dlo = abs((lo - FRENTE + math.pi) % TAU - math.pi)
            return dlo < media and la < math.radians(62)

        def mat(r, c):
            vecina = any(abierta(r, (c + k) % NA) for k in (-1, 1)) or (r + 1 < len(lats) - 1 and abierta(r + 1, c))
            return m_borde if vecina else m

        self.cascara(P, Dg, grosor, CA, mat, skip=abierta)

    def sombrero_mago(self, m_som, m_banda, m_gema, m_marco, m_lente):
        self.cubre_cabeza = True
        zb = CAB_MAX.z - 0.03
        r_in, r_out = 0.17, 0.33
        # ala
        filas = list(np.linspace(r_in, r_out, 5))
        P = [[Vector((r * math.cos(a), CY + r * math.sin(a), zb - 0.035 * ((r - r_in) / (r_out - r_in)) ** 2)) for a in ANG] for r in filas]
        Dg = [[Vector((0, 0, 1)) for _ in ANG] for _ in filas]
        self.cascara([[p + Vector((0, 0, 0.018)) for p in f] for f in P], Dg, 0.018, CA, lambda r, c: m_som)
        # cono, inclinado hacia atrás y un poco de lado
        anillos = []
        n = 12
        for k in range(n + 1):
            t = k / n
            r = 0.205 * (1 - t) ** 0.9 + 0.012
            off = Vector((0.03 * t ** 3, CY + 0.13 * t ** 2.2, zb + 0.55 * t))
            anillos.append([off + Vector((r * math.cos(a), r * math.sin(a), 0)) for a in ANG])
        verts = [v for an in anillos for v in an] + [Vector((0.03, CY + 0.13, zb + 0.56))]
        caras = []
        for k in range(n):
            for c in range(NA):
                a, b = k * NA + c, k * NA + (c + 1) % NA
                caras.append((a, b, b + NA, a + NA))
        punta = len(verts) - 1
        for c in range(NA):
            caras.append((n * NA + c, n * NA + (c + 1) % NA, punta))
        caras.append(tuple(reversed(range(NA))))
        self.solido(verts, caras, m_som, CA)
        # banda, gema y gafas
        P = [[Vector((0.214 * math.cos(a), CY + 0.214 * math.sin(a), z)) for a in ANG] for z in (zb + 0.005, zb + 0.05)]
        self.cascara(P, [[horiz(a) for a in ANG] for _ in range(2)], 0.012, CA, lambda r, c: m_banda)
        fr = horiz(FRENTE)
        self.gema(Vector((0, CY, zb + 0.028)) + fr * 0.222, fr, 0.03, 0.05, m_gema, CA)
        for s in (1, -1):
            c = Vector((s * 0.068, CY, zb + 0.105)) + fr * 0.19
            self.toro(c, fr, 0.046, 0.012, m_marco, CA)
            self.ovoide(c, (0.04, 0.04, 0.012), m_lente, CA, ejes=(Vector((1, 0, 0)), Vector((0, 0, 1)), fr))
        self.caja(Vector((0, CY, zb + 0.105)) + fr * 0.19, (Vector((1, 0, 0)), Vector((0, 0, 1)), fr), (0.04, 0.015, 0.015), m_marco, CA)

    def corona(self, m_tela, m_oro, cristales, m_gema, m_estrella):
        self.cubre_cabeza = True
        # casquete de tela sobre la cabeza
        lats = list(np.linspace(math.radians(90), math.radians(34), 7))  # termina sobre la frente
        dir_ = lambda la, lo: Vector((math.cos(la) * math.cos(lo), math.cos(la) * math.sin(lo), math.sin(la)))
        R = np.array([rayos(BVH_CAB, CAB_C, [dir_(la, a) for a in ANG], 0.7) for la in lats])
        for i in range(len(lats)):
            R[i][np.isnan(R[i])] = np.nanmean(R[i]) if np.isfinite(R[i]).any() else 0.17
        R = alisar(R + 0.014, 3)
        P = [[CAB_C + dir_(la, a) * R[i, k] for k, a in enumerate(ANG)] for i, la in enumerate(lats)]
        Dg = [[dir_(la, a) for a in ANG] for la in lats]
        self.cascara(P, Dg, 0.012, CA, lambda r, c: m_tela)
        # aro de oro al borde del casquete
        zb = float(np.mean([p.z for p in P[-1]]))
        rb = R[-1] * math.cos(lats[-1])
        P = [[Vector(((rb[k] + 0.012) * math.cos(a), CAB_C.y + (rb[k] + 0.012) * math.sin(a), z)) for k, a in enumerate(ANG)] for z in (zb - 0.02, zb + 0.035)]
        self.cascara(P, [[horiz(a) for a in ANG] for _ in range(2)], 0.016, CA, lambda r, c: m_oro)
        # cristales en abanico detrás de la cabeza: el del centro, el más alto
        n = len(cristales)
        for i, mc in enumerate(cristales):
            u = i / (n - 1) - 0.5                      # -0.5 … 0.5
            a = math.pi / 2 + u * math.radians(150)    # atrás (+y) y hacia los lados
            k = int(round((a % TAU) / TAU * NA)) % NA
            base = Vector(((rb[k] * 0.85) * math.cos(a), CAB_C.y + (rb[k] * 0.85) * math.sin(a), zb + 0.02))
            alto = 0.44 * (1 - 1.1 * abs(u)) + 0.1
            n_ = (Vector((0, 0, 1)) + horiz(a) * 0.25 + Vector((u * 0.9, 0, 0))).normalized()
            self.cristal(base, n_, 0.036 + 0.016 * (1 - 2 * abs(u)), alto, mc, CA)
        fr = horiz(FRENTE)
        kf = int(round((FRENTE % TAU) / TAU * NA)) % NA
        self.gema(Vector((0, CAB_C.y, zb + 0.008)) + fr * (rb[kf] + 0.03), fr, 0.03, 0.055, m_gema, CA)

    # ---- adornos
    def cuello_alto(self, m, m_dentro, m_borde, alto=0.22, r0=0.2, r1=0.27):
        zs = list(np.linspace(Z_TOP - 0.01, Z_TOP + alto, 6))
        a0, a1 = math.radians(-35), math.radians(215)
        n = 30
        angs = [a0 + (a1 - a0) * k / (n - 1) for k in range(n)]
        P, Dg = [], []
        for i, z in enumerate(zs):
            t = i / (len(zs) - 1)
            r = r0 + (r1 - r0) * t ** 1.4
            P.append([Vector((r * math.cos(a), CY + 0.01 + r * math.sin(a), z)) for a in angs])
            Dg.append([horiz(a) for a in angs])
        self.cascara(P, Dg, 0.016, CU, lambda r, c: m_borde if r >= len(zs) - 2 else m, wrap=False,
                     mat_in=lambda r, c: m_borde if r >= len(zs) - 2 else m_dentro)

    def hombreras(self, m, m2=None, capas=2, grande=1.0, puas=None):
        for s in (1, -1):
            h = J[("Left" if s > 0 else "Right") + "Arm"]
            for k in range(capas):
                c = h + Vector((s * (0.035 + 0.02 * k), 0, 0.06 - 0.028 * k))
                self.ovoide(c, (0.085 * grande, 0.1 * grande, 0.05 * grande), m if k == 0 else (m2 or m), HO)
            if puas:
                for j, mp in enumerate(puas):
                    c = h + Vector((s * (0.03 + 0.03 * j), 0.0, 0.1))
                    self.cristal(c, Vector((s * 0.3, 0, 1)), 0.018, 0.09 - 0.015 * j, mp, HO)

    def capa(self, m_fuera, m_dentro, m_borde=None, z_bajo=0.07):
        zs = list(np.linspace(z_bajo, Z_TOP - 0.015, 14))
        n = 26
        P, Dg = [], []
        for i, z in enumerate(zs):
            t = (z - z_bajo) / (zs[-1] - z_bajo)          # 0 abajo, 1 arriba
            media = math.radians(80 - 32 * t)
            angs = [math.pi / 2 - media + 2 * media * k / (n - 1) for k in range(n)]
            extra = 0.03 + 0.05 * (1 - t) ** 2
            P.append([self.en_tunica(z, a, extra) for a in angs])
            Dg.append([horiz(a) for a in angs])
        borde = (lambda r, c: m_borde if (c in (0, n - 2) or r == 0) else m_fuera) if m_borde else (lambda r, c: m_fuera)
        self.cascara(P, Dg, 0.012, CP, borde, wrap=False, mat_in=lambda r, c: m_dentro)

    def estrellas(self, cantidad, colores, semilla=7, z0=None, z1=None):
        rnd = random.Random(semilla)
        z0 = self.z_hem + 0.02 if z0 is None else z0
        z1 = Z_TOP - 0.02 if z1 is None else z1
        for _ in range(cantidad):
            z = rnd.uniform(z0, z1); a = rnd.uniform(0, TAU)
            p = self.en_tunica(z, a, 0.008)
            self.gema(p, horiz(a), rnd.uniform(0.005, 0.009), rnd.uniform(0.014, 0.022), rnd.choice(colores), TR)

    # ---- pesos y salida
    def pesos(self, t, p):
        S = "Left" if p.x > 0 else "Right"
        if t == CA:
            return {"Head": 1.0}
        if t == CU:
            return {"Spine": 1.0}
        if t == HO:
            return {S + "Arm": 0.75, "Spine": 0.25}
        if t == BR:
            return cadena(abs(p.x), [("Spine", -INF), (S + "Arm", X_HOMBRO), (S + "ForeArm", X_CODO), (S + "Hand", X_MUNECA)], 0.03)
        if t == CP:
            return cadena(p.z, TORSO, 0.05)
        if p.z >= Z_CAD:
            return cadena(p.z, TORSO, 0.04)
        u = min(1.0, (Z_CAD - p.z) / max(1e-3, Z_CAD - self.z_hem))
        w = 0.75 * u * min(1.0, abs(p.x) / 0.1)
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
        nombre = f"{C_NAME}_tunica_{self.grado}"
        viejo = D.objects.get(nombre)
        if viejo:
            m0 = viejo.data; D.objects.remove(viejo); D.meshes.remove(m0)
        am = D.meshes.new(nombre)
        bm.to_mesh(am)
        tipos = np.empty(len(am.vertices), dtype=np.int32); am.attributes["tipo"].data.foreach_get("value", tipos)
        bm.free()
        for nom, rgb, brilla in self.mats:
            mt = D.materials.get("tun_" + nom) or D.materials.new("tun_" + nom)
            nd = next(n for n in mt.node_tree.nodes if n.type == "BSDF_PRINCIPLED")
            lin = [c ** 2.2 for c in rgb]
            nd.inputs["Base Color"].default_value = (*lin, 1)
            nd.inputs["Roughness"].default_value = 0.6
            if brilla:
                nd.inputs["Emission Color"].default_value = (*lin, 1)
                nd.inputs["Emission Strength"].default_value = 2.0
            mt.diffuse_color = (*lin, 1)
            am.materials.append(mt)
        coll = D.collections.get(C_NAME + "_tunicas")
        if not coll:
            coll = D.collections.new(C_NAME + "_tunicas")
            bpy.context.scene.collection.children.link(coll)
        ob = D.objects.new(nombre, am)
        coll.objects.link(ob)
        ob.location = cuerpo.location
        # pesos
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
        ob.hide_set(True); ob.hide_render = True  # se ven en la colección Vitrina
        # datos para el .glb: vértices separados por material y normal; primitivas tela y brillo
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
        base = os.path.join(SALIDA, f"gnomo_{sexo}_armadura_tela_{self.grado}")
        os.makedirs(SALIDA, exist_ok=True)
        with open(base + ".bin", "wb") as f:
            for a in (to_gl(vc[uv]), to_gl(un), colmat[um], order[uv].astype(np.uint16), wt[uv].astype(np.float32), idx):
                f.write(np.ascontiguousarray(a).tobytes())
        info = {"huesos": HUESOS, "posiciones": {n: [J[n].x, J[n].z, -J[n].y] for n in HUESOS},
                "vertices": int(len(uniq)), "indices": int(len(idx)), "cubre_cabeza": self.cubre_cabeza,
                "primitivas": [{"nombre": "tela", "indices": int((~bt).sum() * 3)},
                               {"nombre": "brillo", "indices": int(bt.sum() * 3), "brilla": True}]}
        with open(base + ".json", "w", encoding="utf-8") as f:
            json.dump(info, f, indent=1)
        return {"objeto": nombre, "triangulos": nt, "vertices_glb": int(len(uniq)), "cubre_cabeza": self.cubre_cabeza}


# ---------------------------------------------------------------- los 6 diseños
ORO = (0.93, 0.74, 0.3)
ORO_OSC = (0.72, 0.52, 0.18)
ARCOIRIS = [(1.0, 0.35, 0.4), (1.0, 0.62, 0.25), (1.0, 0.9, 0.35), (0.45, 0.95, 0.5), (0.35, 0.9, 1.0), (0.45, 0.55, 1.0), (0.8, 0.45, 1.0)]


def frente(a, ancho):
    return abs((a - FRENTE + math.pi) % TAU - math.pi) < ancho


def madera():
    T = Tunica("madera")
    tela, osc = T.M("lino", (0.8, 0.7, 0.52)), T.M("lino_osc", (0.6, 0.5, 0.35))
    cuerda = T.M("cuerda", (0.48, 0.34, 0.2))
    T.cuerpo(0.16, abre=1.15, mat=lambda z, a, r, n: osc if r == 0 else tela)
    T.mangas(X_MUNECA + 0.005, 0.1, lambda r, n: osc if r >= n - 2 else tela)
    T.capucha(tela, osc)
    zc = Z_CAD + 0.035
    T.banda(zc - 0.01, zc + 0.01, cuerda, extra=0.008, grosor=0.012)
    p = T.en_tunica(zc, FRENTE + 0.25, 0.02)
    T.ovoide(p, (0.022, 0.016, 0.018), cuerda, TR)
    for k, (dx, largo) in enumerate(((-0.01, 0.09), (0.015, 0.07))):
        q = T.en_tunica(zc - largo / 2 - 0.01, FRENTE + 0.25 + dx * 3, 0.018)
        T.caja(q, (Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, -1, 0))), (0.012, largo, 0.012), cuerda, TR)
    # cordón cruzado en el pecho
    for s in (1, -1):
        c = T.en_tunica(Z_TOP - 0.06, FRENTE, 0.006)
        d = Vector((s * 0.6, 0, 1)).normalized()
        T.caja(c, (d, Vector((0, -1, 0)).cross(d), Vector((0, -1, 0))), (0.09, 0.008, 0.008), osc, TR)
    return T


def cobre():
    T = Tunica("cobre")
    cuero, osc = T.M("cuero_cobre", (0.66, 0.36, 0.2)), T.M("cuero_osc", (0.4, 0.22, 0.12))
    cinto, metal = T.M("cinto", (0.3, 0.19, 0.11)), T.M("cobre_metal", (0.88, 0.58, 0.32))
    T.cuerpo(0.2, abre=1.12, mat=lambda z, a, r, n: osc if (r == 0 or frente(a, 0.07)) else cuero)
    T.mangas(X_CODO + 0.01, 0.105, lambda r, n: osc if r >= n - 2 else cuero)
    for s in (1, -1):  # brazaletes de cuero con remaches
        T.manga(s, X_MUNECA - 0.005, 0.0, lambda r, n: metal if r in (1, n - 2) else cinto, sep=0.008, x0=X_CODO + 0.015, anillos=8)
    T.hombreras(osc, capas=1, grande=0.85)
    zc = Z_CAD + 0.04
    T.banda(zc - 0.022, zc + 0.022, cinto, extra=0.008)
    T.caja(T.en_tunica(zc, FRENTE, 0.02), (Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, -1, 0))), (0.06, 0.05, 0.014), metal, TR)
    for a in (FRENTE + 0.55, FRENTE - 0.7, FRENTE + math.pi):
        T.ovoide(T.en_tunica(zc - 0.025, a, 0.03), (0.035, 0.03, 0.04), osc, TR, ejes=(Vector((-math.sin(a), math.cos(a), 0)), horiz(a), Vector((0, 0, 1))))
    for k in range(3):  # cordones del escote
        c = T.en_tunica(Z_TOP - 0.025 - 0.028 * k, FRENTE, 0.008)
        T.caja(c, (Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, -1, 0))), (0.05, 0.008, 0.008), osc, TR)
    return T


def azul():
    T = Tunica("azul")
    tela, cian = T.M("azul_cristal", (0.16, 0.27, 0.62)), T.M("cian", (0.22, 0.74, 0.78))
    runa, cinto, hebilla = T.M("runa_cian", (0.45, 1.0, 1.0), True), T.M("cinto_az", (0.34, 0.22, 0.13)), T.M("plata", (0.75, 0.8, 0.85))
    T.cuerpo(0.06, abre=1.3, mat=lambda z, a, r, n: cian if (r <= 1 or r == n - 1 or frente(a, 0.06)) else tela)
    T.mangas(X_MUNECA + 0.03, 0.13, lambda r, n: cian if r >= n - 2 else tela)
    T.sombrero_mago(T.M("azul_noche", (0.13, 0.19, 0.45)), cian, runa, T.M("marco", (0.56, 0.49, 0.33)), T.M("lente", (0.58, 0.8, 0.84)))
    zc = Z_CAD + 0.05
    T.banda(zc - 0.02, zc + 0.02, cinto, extra=0.008)
    T.caja(T.en_tunica(zc, FRENTE, 0.02), (Vector((1, 0, 0)), Vector((0, 0, 1)), Vector((0, -1, 0))), (0.055, 0.055, 0.014), hebilla, TR)
    T.runa(zc - 0.018, FRENTE, 0.035, runa, 3, extra=0.03)
    for k in range(10):
        a = FRENTE + (k - 4.5) * 0.3
        T.runa(T.z_hem + 0.07, a, 0.04, runa, k)
    return T


def morado():
    T = Tunica("morado")
    tela, panel, oro = T.M("morado", (0.46, 0.24, 0.62)), T.M("morado_osc", (0.3, 0.14, 0.42)), T.M("oro", ORO)
    runa, gema = T.M("runa_magenta", (1.0, 0.5, 1.0), True), T.M("gema_rosa", (1.0, 0.45, 0.85), True)
    T.cuerpo(0.06, abre=1.3, mat=lambda z, a, r, n: oro if r <= 1 else (panel if frente(a, 0.3) else tela))
    for s in (1, -1):
        T.tira(FRENTE + s * 0.33, 0.045, T.z_hem + 0.02, Z_TOP + 0.01, oro)
    T.mangas(X_MUNECA + 0.035, 0.14, lambda r, n: oro if r >= n - 2 else tela)
    T.cuello_alto(tela, panel, oro)
    T.hombreras(oro, T.M("oro_osc", ORO_OSC))
    zc = Z_CAD + 0.05
    T.banda(zc - 0.018, zc + 0.018, oro, extra=0.012)
    fr = horiz(FRENTE)
    T.gema(T.en_tunica(zc, FRENTE, 0.03), fr, 0.026, 0.06, gema, TR)
    T.gema(T.en_tunica(Z_TOP - 0.05, FRENTE, 0.03), fr, 0.03, 0.075, gema, TR)
    for k in range(5):
        T.runa(T.z_hem + 0.06 + 0.05 * k, FRENTE, 0.035, runa, 10 + k, extra=0.012)
    for k in range(8):
        T.runa(T.z_hem + 0.05, FRENTE + math.pi + (k - 3.5) * 0.32, 0.035, runa, 30 + k)
    return T


def dorado():
    T = Tunica("dorado")
    negro, oro, oro_osc = T.M("negro", (0.17, 0.16, 0.19)), T.M("oro", ORO), T.M("oro_osc", ORO_OSC)
    gema, brillo = T.M("diamante", (1.0, 0.92, 0.5), True), T.M("destello", (1.0, 0.85, 0.45), True)
    T.cuerpo(0.06, abre=1.25, mat=lambda z, a, r, n: oro if r <= 1 else negro)
    for s in (1, -1):
        T.tira(FRENTE + s * 0.12, 0.035, T.z_hem + 0.02, Z_CAD + 0.03, oro)
    T.banda(J["Spine02"].z, Z_TOP - 0.02, oro, extra=0.012, a0=FRENTE - 0.55, a1=FRENTE + 0.55, filas=6)  # peto de oro
    T.mangas(X_MUNECA + 0.03, 0.13, lambda r, n: oro if r >= n - 2 else negro)
    T.cuello_alto(negro, negro, oro, alto=0.24)
    T.hombreras(oro, oro_osc, capas=3, grande=1.05)
    T.capa(negro, T.M("capa_dentro", (0.42, 0.3, 0.12)), oro)
    zc = Z_CAD + 0.04
    T.banda(zc - 0.02, zc + 0.02, oro_osc, extra=0.014)
    fr = horiz(FRENTE)
    T.gema(T.en_tunica((J["Spine02"].z + Z_TOP) / 2, FRENTE, 0.03), fr, 0.045, 0.1, gema, TR)
    T.gema(T.en_tunica(zc, FRENTE, 0.034), fr, 0.026, 0.06, gema, TR)
    for k in range(6):
        T.runa(T.z_hem + 0.06, FRENTE + (k - 2.5) * 0.4, 0.03, brillo, 50 + k)
    return T


def arcoiris():
    T = Tunica("arcoiris")
    cosmos, oro, panel = T.M("cosmos", (0.27, 0.17, 0.55)), T.M("oro", ORO), T.M("cosmos_osc", (0.16, 0.1, 0.38))
    estrellas = [T.M("estrella", (1, 1, 1), True), T.M("estrella_rosa", (1.0, 0.7, 0.95), True), T.M("estrella_cian", (0.6, 0.95, 1.0), True)]
    cris = [T.M(f"cristal_{i}", c, True) for i, c in enumerate(ARCOIRIS)]
    T.cuerpo(0.06, abre=1.35, mat=lambda z, a, r, n: oro if r <= 1 else (panel if frente(a, 0.25) else cosmos))
    for s in (1, -1):
        T.tira(FRENTE + s * 0.28, 0.04, T.z_hem + 0.02, Z_TOP + 0.01, oro)
    T.mangas(X_MUNECA + 0.04, 0.15, lambda r, n: oro if r >= n - 2 else cosmos)
    T.cuello_alto(cosmos, panel, oro, alto=0.26, r1=0.29)
    T.hombreras(oro, T.M("oro_osc", ORO_OSC), puas=cris[2:5])
    T.capa(cosmos, panel, oro)
    T.corona(cosmos, oro, cris, estrellas[0], estrellas[0])
    zc = Z_CAD + 0.05
    T.banda(zc - 0.018, zc + 0.018, oro, extra=0.012)
    fr = horiz(FRENTE)
    T.gema(T.en_tunica(Z_TOP - 0.06, FRENTE, 0.03), fr, 0.04, 0.09, cris[4], TR)
    for k, m in enumerate(cris):
        T.gema(T.en_tunica(T.z_hem + 0.045, FRENTE + (k - 3) * 0.32, 0.015), horiz(FRENTE + (k - 3) * 0.32), 0.016, 0.035, m, TR)
    T.estrellas(70, estrellas)
    return T


DISENOS = {"madera": madera, "cobre": cobre, "azul": azul, "morado": morado, "dorado": dorado, "arcoiris": arcoiris}
result = {}
for g in SOLO:
    result[g] = DISENOS[g]().terminar()
