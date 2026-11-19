"""Las 6 armaduras de escamas del lagarto y la lagarta (MEDIUM_SCALE, una por grado).

Se ejecuta dentro de Blender con lagartos.blend abierto, después de gnomos_malla_unica.py y
gnomos_rig.py:
    g = {"CHAR": "Lagarto_M"}          # opcional: "SOLO": ["azul"]
    exec(open(r".../lagartos_armaduras.py", encoding="utf-8").read(), g)

Grados (data.js): madera Escamas de Corteza · cobre Cota de Escamas de Cobre · azul Escamas de
Cristal Azul · morado Escamas de Oro Encantado · dorado Escamas de Diamante con Capa · arcoiris
Escamas Celestiales del Dragón. Los cascos de cobre, de cristal y la corona de oro reemplazan los
cuernos; la tiara y la cresta del dragón los dejan a la vista. Las escamas de la cola siguen sus
huesos (TailA/TailB) y las alas de dragón aletean con las del lagarto (WingL/WingR).
Usa kit_armaduras.py; escribe lagarto_<m|f>_armadura_escamas_<grado>.json/.bin (tools/make_raza.js).
"""
import math, random
from mathutils import Vector

CHAR = globals().get("CHAR", "Lagarto_M")
FAMILIA = "escamas"
exec(open(r"G:\Mi unidad\Juego\blender\scripts\kit_armaduras.py", encoding="utf-8").read(), globals())

GRADOS = ["madera", "cobre", "azul", "morado", "dorado", "arcoiris"]
SOLO = globals().get("SOLO") or GRADOS
ORO, ORO_OSC = (0.93, 0.74, 0.3), (0.7, 0.5, 0.18)
ARRIBA = Vector((0, 0, 1))
Z_PECHO = (J["Spine01"].z + J["Spine"].z) / 2
COLA = cola_anillos(10)


def escamas(A, z0, z1, filas, por_fila, mats, largo, ancho, semilla=1, extra=0.012, a0=0.0, a1=TAU):
    A.hojas_tronco(z0, z1, filas, por_fila, mats, largo * ESC, ancho * ESC, semilla=semilla, extra=extra, a0=a0, a1=a1)


def escamas_cola(A, mats, largo=0.07, ancho=0.07, por_anillo=5, semilla=3, desde=1):
    """Escamas sobre la mitad de arriba de la cola, apuntando hacia la punta."""
    rnd = random.Random(semilla)
    for i, (c, r) in enumerate(COLA[desde:]):
        for k in range(por_anillo):
            a = math.radians(20 + 140 * k / max(1, por_anillo - 1))
            n = Vector((math.cos(a), 0.0, math.sin(a)))
            atras = Vector((0, 1, -0.25)).normalized()
            A.hoja(c + n * (r + 0.008), atras, n, largo * ESC * (1 - 0.05 * i), ancho * ESC * (1 - 0.05 * i), rnd.choice(mats), CO)


def puas_cola(A, m, alto=0.09, cada=2):
    for i, (c, r) in enumerate(COLA[1::cada]):
        A.cristal(c + Vector((0, 0, r * 0.8)), Vector((0, 0.5, 1)), 0.022 * ESC, alto * ESC * (1 - 0.08 * i), m, CO)


def piernas_escamas(A, mat_tubo, mats, filas=4, por_fila=7, semilla=11):
    A.pantalon(mat_tubo, z0=BOTA_MAX.z + 0.01)
    A.hojas_tubo("pierna", BOTA_MAX.z + 0.04, Z_CAD - 0.03, filas, por_fila, mats, 0.065 * ESC, 0.065 * ESC, semilla=semilla)


def alas_dragon(A, m_borde, membranas, envergadura=0.55):
    """Alas grandes de murciélago a la espalda: borde de un color y la membrana en gajos de colores."""
    for s in (1, -1):
        o = Vector((s * 0.1, CY + 0.17 * ESC, Z_TOP - 0.06))
        U = Vector((s * 1.0, 0.5, 0.15)).normalized(); V = Vector((0, 0.15, 1.0)).normalized(); N = U.cross(V).normalized()
        e = envergadura * ESC
        # puntas del borde (u, v) y el centro desde donde salen los gajos
        borde = [(0.0, 0.0), (0.15 * e, 0.3 * e), (0.45 * e, 0.42 * e), (0.8 * e, 0.36 * e), (1.0 * e, 0.18 * e),
                 (0.82 * e, 0.02 * e), (0.66 * e, -0.12 * e), (0.48 * e, -0.02 * e), (0.32 * e, -0.16 * e), (0.16 * e, -0.06 * e), (0.04 * e, -0.12 * e)]
        P = [o + U * u + V * v for u, v in borde]
        for k in range(1, len(P) - 1):
            m = membranas[(k - 1) % len(membranas)]
            tri = [P[0], P[k], P[k + 1]]
            vs = [x + N * 0.006 for x in tri] + [x - N * 0.006 for x in tri]
            A.solido(vs, [(0, 1, 2), (5, 4, 3), (0, 3, 4, 1), (1, 4, 5, 2), (2, 5, 3, 0)], m, AL)
        # huesos del ala (borde de arriba y dedos)
        for k in (1, 2, 3, 4):
            d = P[k] - P[0] if k == 1 else P[k] - P[k - 1]
            c = (P[k] + (P[0] if k == 1 else P[k - 1])) / 2
            A.caja(c, (d.normalized(), N, d.normalized().cross(N)), (d.length, 0.022 * ESC, 0.022 * ESC), m_borde, AL)
        for k in (6, 8):
            d = P[k] - P[0]
            A.caja(P[0] + d / 2, (d.normalized(), N, d.normalized().cross(N)), (d.length, 0.014 * ESC, 0.014 * ESC), m_borde, AL)


def casco_lagarto(A, m, m_borde, **kw):
    A.casco(m, m_borde, lat_min=kw.pop("lat_min", -5), cara=kw.pop("cara", 58), alto_cara=kw.pop("alto_cara", 32), sep=kw.pop("sep", 0.02), **kw)


# --------------------------------------------------------------------------- diseños
def madera():
    A = Armadura("madera")
    c1, c2, c3 = A.M("corteza", (0.42, 0.29, 0.17)), A.M("corteza_osc", (0.3, 0.2, 0.12)), A.M("corteza_clara", (0.5, 0.36, 0.2))
    tabla, cuerda, bota = A.M("tabla", (0.55, 0.38, 0.22)), A.M("cuerda", (0.75, 0.62, 0.42)), A.M("bota_corteza", (0.38, 0.24, 0.14))
    A.cuerpo(Z_CAD - 0.09 * ESC, abre=1.12, mat=lambda z, a, r, n: c2)
    escamas(A, A.z_hem + 0.015, Z_TOP - 0.005, 8, 16, [c1, c2, c3], 0.07, 0.07, semilla=3)
    for s in (1, -1):  # hombreras de tablas con cuerda
        h = J[("Left" if s > 0 else "Right") + "Arm"]
        for k in range(3):
            c = h + Vector((s * 0.05, -0.05 + 0.05 * k, 0.07)) * ESC
            A.caja(c, (Vector((s, 0, -0.35)).normalized(), Vector((0, 1, 0)), Vector((s * 0.35, 0, 1)).normalized()), (0.13 * ESC, 0.045 * ESC, 0.025 * ESC), tabla if k != 1 else c3, HO)
        A.caja(h + Vector((s * 0.05, 0, 0.09)) * ESC, (Vector((0, 1, 0)), Vector((s, 0, -0.35)).normalized(), Vector((s * 0.35, 0, 1)).normalized()), (0.17 * ESC, 0.02 * ESC, 0.03 * ESC), cuerda, HO)
    brazales(A, lambda r, n: cuerda if r in (2, n - 3) else tabla, sep=0.02)
    A.botas(lambda r, n, a: c2 if r == n - 1 else bota, z1=BOTA_MAX.z + 0.07 * ESC)
    escamas_cola(A, [c1, c2, c3], semilla=4)
    return A


def cobre():
    A = Armadura("cobre")
    c1, c2, c3 = A.M("cobre", (0.88, 0.48, 0.24)), A.M("cobre_osc", (0.66, 0.32, 0.15)), A.M("cobre_claro", (0.96, 0.62, 0.32))
    m_cinto = A.M("cinto_cobre", (0.4, 0.24, 0.14))
    A.cuerpo(Z_CAD - 0.08 * ESC, abre=1.12, mat=lambda z, a, r, n: c2)
    escamas(A, A.z_hem + 0.015, Z_TOP - 0.005, 8, 15, [c1, c2, c3], 0.075, 0.08, semilla=5)
    A.hombreras(c1, c2, capas=3, grande=1.0)
    brazales(A, lambda r, n: c3 if r in (0, n - 1) else c1, sep=0.02)
    cinto(A, m_cinto, c3, z=Z_CAD + 0.02)
    casco_lagarto(A, c1, c2)
    lats, lons, R = A.yelmo
    rnd = random.Random(6)
    for la in (75, 58, 42, 26, 10):
        for k in range(0, NA, 3):
            lo = lons[k] + (math.radians(4) if la % 2 else 0)
            if frente(lo, math.radians(62)) and la < 34:
                continue
            p, n = A.en_casco(la, lo, 0.006)
            A.hoja(p, -ARRIBA + n * 0.2, n, 0.06 * ESC, 0.06 * ESC, rnd.choice([c1, c2, c3]), CA)
    escamas_cola(A, [c1, c2, c3], semilla=7)
    return A


def brazales(A, mat, sep=0.02, anillos=8):
    for s in (1, -1):
        A.manga(s, X_MUNECA + 0.005, 0.0, mat, sep=sep, x0=X_CODO + 0.015 * ESC, anillos=anillos, nombre="brazal")


def cinto(A, m, m_hebilla, z=None, alto=0.035):
    z = Z_CAD + 0.03 * ESC if z is None else z
    A.banda(z - alto / 2, z + alto / 2, m, extra=0.014)
    A.caja(A.en_tunica(z, FRENTE, 0.026), (Vector((1, 0, 0)), ARRIBA, Vector((0, -1, 0))), (0.06 * ESC, 0.05 * ESC, 0.014), m_hebilla, TR)


def azul():
    A = Armadura("azul")
    base, gris, gris2 = A.M("azul_base", (0.15, 0.32, 0.45)), A.M("metal_gris", (0.42, 0.45, 0.5)), A.M("metal_osc", (0.28, 0.3, 0.34))
    cr = [A.M("cristal_azul", (0.32, 0.72, 1.0), True), A.M("cristal_celeste", (0.55, 0.88, 1.0), True), A.M("cristal_hondo", (0.22, 0.5, 0.95), True)]
    A.cuerpo(Z_CAD - 0.07 * ESC, abre=1.1, mat=lambda z, a, r, n: base)
    rnd = random.Random(8)
    for i in range(7):  # esquirlas de cristal que salen hacia afuera y abajo
        z = Z_TOP - 0.02 - (Z_TOP - A.z_hem - 0.04) * i / 6
        for k in range(14):
            a = TAU * (k + 0.5 * (i % 2)) / 14
            p = A.en_tunica(z, a, 0.006)
            A.cristal(p, horiz(a) * 0.8 - ARRIBA * 0.6, 0.02 * ESC, rnd.uniform(0.06, 0.1) * ESC, rnd.choice(cr), TR, lados=4)
    A.hombreras(gris, gris2, capas=1, grande=1.0, cristales=[(cr[0], 0.02, -0.025, 0.12, 0.6), (cr[1], 0.06, 0.02, 0.1, 1.0), (cr[2], 0.0, 0.035, 0.09, 0.3), (cr[0], 0.05, -0.04, 0.08, 1.2)])
    brazales(A, lambda r, n: gris2 if r in (0, n - 1) else gris, sep=0.022)
    A.pantalon(lambda r, n, a: base, z0=BOTA_MAX.z + 0.01)
    for s in (1, -1):
        for zz in (Z_CAD - 0.04, (Z_CAD + BOTA_MAX.z) / 2):
            for a in (FRENTE, FRENTE + 1.6, FRENTE - 1.6):
                p, n = A.en_tubo("pierna", s, zz, a, 0.004)
                A.cristal(p, n * 0.8 - ARRIBA * 0.5, 0.018 * ESC, 0.06 * ESC, rnd.choice(cr), PI, lados=4)
    casco_lagarto(A, gris, gris2)
    for la in (80, 62, 44, 26):  # cresta de cristal
        p, n = A.en_casco(la, math.pi / 2 if la < 85 else FRENTE, 0.004)
        A.cristal(p, n + ARRIBA * 0.6, 0.026 * ESC, 0.12 * ESC, cr[0] if la % 2 else cr[1], CA, lados=4)
    for s in (1, -1):
        p, n = A.en_casco(30, 0.0 if s > 0 else math.pi, 0.004)
        A.cristal(p, n + ARRIBA, 0.024 * ESC, 0.1 * ESC, cr[2], CA, lados=4)
    puas_cola(A, cr[0], alto=0.1, cada=1)
    return A


def morado():
    A = Armadura("morado")
    mor, mor2, oro, oro2 = A.M("morado", (0.42, 0.2, 0.55)), A.M("morado_claro", (0.56, 0.3, 0.68)), A.M("oro", ORO), A.M("oro_osc", ORO_OSC)
    gema = A.M("gema_morada", (0.85, 0.4, 1.0), True)
    cr = [A.M("cristal_morado", (0.7, 0.42, 1.0), True), A.M("cristal_lila", (0.85, 0.62, 1.0), True)]
    A.cuerpo(Z_CAD - 0.08 * ESC, abre=1.12, mat=lambda z, a, r, n: oro if r == 0 else mor)
    escamas(A, A.z_hem + 0.02, Z_CAD + 0.02, 3, 16, [mor, mor2], 0.07, 0.07, semilla=12)
    A.banda(J["Spine02"].z, Z_TOP - 0.01, oro, extra=0.012, a0=FRENTE - 0.5, a1=FRENTE + 0.5, filas=6)
    A.banda(J["Spine02"].z + 0.02, Z_TOP - 0.03, mor2, extra=0.022, a0=FRENTE - 0.32, a1=FRENTE + 0.32, filas=5)
    for zz in (Z_PECHO + 0.02, J["Spine02"].z + 0.04):
        p = A.en_tunica(zz, FRENTE, 0.03)
        A.gema_cara(p, horiz(FRENTE), ARRIBA, 0.045 * ESC, 0.065 * ESC, gema, TR, relieve=0.5)
    A.hombreras(oro, oro2, capas=2, grande=1.0, cristales=[(cr[0], 0.02, -0.02, 0.11, 0.5), (cr[1], 0.06, 0.02, 0.09, 1.0), (cr[0], 0.0, 0.035, 0.08, 0.2)])
    brazales(A, lambda r, n: oro, sep=0.022)
    cinto(A, oro, oro2, z=Z_CAD + 0.02)
    piernas_escamas(A, lambda r, n, a: mor, [mor, mor2])
    A.rodilleras(oro, gema)
    # tiara de oro con gema (los cuernos quedan a la vista)
    zt = CAB_C.z + 0.09 * ESC
    dirs = [horiz(a) for a in ANG]
    R = rayos(BVH_YELMO, Vector((CAB_C.x, CAB_C.y, zt)), dirs, 0.8)
    R[np.isnan(R)] = np.nanmax(R)
    P = [[Vector((CAB_C.x + (R[k] + 0.012) * math.cos(a), CAB_C.y + (R[k] + 0.012) * math.sin(a), z)) for k, a in enumerate(ANG)] for z in (zt - 0.025, zt + 0.025)]
    A.cascara(P, [[horiz(a) for a in ANG] for _ in range(2)], 0.014, CA, lambda r, c: oro)
    kf = int(round((FRENTE % TAU) / TAU * NA)) % NA
    pf = Vector((CAB_C.x, CAB_C.y, zt)) + horiz(FRENTE) * (R[kf] + 0.03)
    A.gema_cara(pf, horiz(FRENTE), ARRIBA, 0.05 * ESC, 0.08 * ESC, gema, CA, relieve=0.55)
    puas_cola(A, cr[0], alto=0.08)
    escamas_cola(A, [mor, mor2], semilla=13)
    return A


def dorado():
    A = Armadura("dorado")
    oro, oro2, rojo, rojo2 = A.M("oro", ORO), A.M("oro_osc", ORO_OSC), A.M("rojo_capa", (0.66, 0.1, 0.12)), A.M("rojo_osc", (0.45, 0.06, 0.08))
    brillo = A.M("destello_oro", (1.0, 0.9, 0.55), True)
    A.cuerpo(Z_CAD - 0.08 * ESC, abre=1.1, mat=lambda z, a, r, n: oro2)
    rnd = random.Random(14)
    for i, zz in enumerate(np.linspace(A.z_hem + 0.04, Z_TOP - 0.03, 6)):
        for k in range(12):
            a = TAU * (k + 0.5 * (i % 2)) / 12
            A.gema_cara(A.en_tunica(zz, a, 0.008), horiz(a), ARRIBA, 0.075 * ESC, 0.09 * ESC, oro if (i + k) % 3 else brillo, TR, relieve=0.4)
    A.hombreras(oro, oro2, capas=3, grande=1.15)
    brazales(A, lambda r, n: oro, sep=0.022)
    A.capa(rojo, rojo2, oro2)
    cinto(A, rojo, oro, z=Z_CAD + 0.02)
    A.pantalon(lambda r, n, a: oro2, z0=BOTA_MAX.z + 0.01)
    for s in (1, -1):
        for zz in (Z_CAD - 0.05, (Z_CAD + BOTA_MAX.z) / 2 - 0.01):
            for a in (FRENTE, FRENTE + 1.2, FRENTE - 1.2):
                p, n = A.en_tubo("pierna", s, zz, a, 0.004)
                A.gema_cara(p, n, ARRIBA, 0.05 * ESC, 0.07 * ESC, oro, PI, relieve=0.4)
    # corona-casco de oro con almenas (reemplaza los cuernos)
    casco_lagarto(A, oro, oro2)
    for k in range(10):
        lo = TAU * k / 10
        p, n = A.en_casco(52, lo, 0.0)
        A.caja(p + ARRIBA * 0.05 * ESC, (horiz(lo).cross(ARRIBA).normalized(), ARRIBA, horiz(lo)), (0.06 * ESC, 0.1 * ESC, 0.04 * ESC), oro if k % 2 else oro2, CA)
    p, n = A.en_casco(30, FRENTE, 0.01)
    A.gema_cara(p, n, ARRIBA, 0.05 * ESC, 0.075 * ESC, brillo, CA, relieve=0.5)
    escamas_cola(A, [oro, oro2], semilla=15)
    return A


def arcoiris():
    A = Armadura("arcoiris")
    tonos = [A.M("dragon_rojo", (0.86, 0.22, 0.24)), A.M("dragon_rosa", (0.95, 0.42, 0.5)), A.M("dragon_naranja", (0.98, 0.55, 0.28)), A.M("dragon_morado", (0.55, 0.25, 0.6))]
    brillo = [A.M("iris_rosa", (1.0, 0.7, 0.85), True), A.M("iris_cian", (0.6, 0.95, 1.0), True), A.M("iris_oro", (1.0, 0.9, 0.5), True)]
    arco = [A.M(f"membrana_{i}", c, True) for i, c in enumerate([(1.0, 0.45, 0.5), (1.0, 0.7, 0.4), (1.0, 0.92, 0.5), (0.55, 0.95, 0.6), (0.5, 0.85, 1.0), (0.62, 0.62, 1.0), (0.85, 0.55, 1.0)])]
    base = A.M("dragon_base", (0.6, 0.14, 0.2))
    A.cuerpo(Z_CAD - 0.07 * ESC, abre=1.1, mat=lambda z, a, r, n: base)
    escamas(A, A.z_hem + 0.015, Z_TOP - 0.005, 9, 16, tonos, 0.07, 0.07, semilla=21)
    p = A.en_tunica(Z_PECHO, FRENTE, 0.03)
    A.gema_cara(p, horiz(FRENTE), ARRIBA, 0.07 * ESC, 0.11 * ESC, brillo[1], TR, relieve=0.55)
    A.mangas(X_MUNECA - 0.02, 0.0, lambda r, n: base, nombre="manga")
    A.hojas_tubo("manga", X_HOMBRO, X_MUNECA - 0.03, 4, 7, tonos, 0.06 * ESC, 0.06 * ESC, semilla=22)
    A.hombreras(tonos[0], tonos[3], capas=2, grande=1.05, cristales=[(brillo[0], 0.03, -0.02, 0.1, 0.8), (brillo[1], 0.06, 0.02, 0.08, 1.1)])
    piernas_escamas(A, lambda r, n, a: base, tonos, semilla=23)
    alas_dragon(A, tonos[0], arco)
    # cresta de dragón (los cuernos quedan a la vista)
    for k, (dz, dy, alto) in enumerate(((0.2, 0.0, 0.12), (0.15, 0.12, 0.11), (0.06, 0.2, 0.1), (-0.04, 0.23, 0.09), (-0.14, 0.24, 0.08))):
        base_p = Vector((CAB_C.x, CAB_C.y + dy * ESC, CAB_C.z + dz * ESC + 0.02))
        A.cristal(base_p, Vector((0, 0.5 + dy, 1 - dy)), 0.03 * ESC, alto * ESC, tonos[k % 2] if k else brillo[2], CA, lados=4)
    for s in (1, -1):  # aletas a los lados de la cara
        for j in range(3):
            pb = Vector((CAB_C.x + s * 0.24 * ESC, CAB_C.y + (0.05 + 0.06 * j) * ESC, CAB_C.z - 0.02 * ESC + 0.03 * j))
            A.cristal(pb, Vector((s, 0.6, 0.4)), 0.02 * ESC, (0.09 - 0.015 * j) * ESC, tonos[j % 3], CA, lados=4)
    escamas_cola(A, tonos, semilla=24, por_anillo=6)
    puas_cola(A, brillo[0], alto=0.09, cada=1)
    A.estrellas(25, brillo, semilla=25)
    return A


DISENOS = {"madera": madera, "cobre": cobre, "azul": azul, "morado": morado, "dorado": dorado, "arcoiris": arcoiris}
result = {g: DISENOS[g]().terminar() for g in SOLO}
