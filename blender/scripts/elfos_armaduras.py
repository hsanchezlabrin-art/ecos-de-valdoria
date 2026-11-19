"""Las 6 armaduras de cuero del elfo y la elfa (LIGHT_LEATHER, una por grado).

Se ejecuta dentro de Blender con elfos.blend abierto, después de gnomos_malla_unica.py y
gnomos_rig.py:
    g = {"CHAR": "Elfo_M"}            # opcional: "SOLO": ["azul"]
    exec(open(r".../elfos_armaduras.py", encoding="utf-8").read(), g)

Grados (data.js): madera Chaleco de Hojas · cobre Armadura de Cuero · azul Cuero de Cristal Azul ·
morado Cuero de Oro Encantado · dorado Capa de Diamante del Explorador · arcoiris Atuendo Celestial
del Viento. El yelmo alado (morado) y el tocado celestial (arcoiris) reemplazan el pelo de arriba.
Usa kit_armaduras.py; escribe <raza>_<m|f>_armadura_cuero_<grado>.json/.bin para tools/make_elfo.js.
"""
import math, random
from mathutils import Vector

CHAR = globals().get("CHAR", "Elfo_M")
FAMILIA = "cuero"
exec(open(r"G:\Mi unidad\Juego\blender\scripts\kit_armaduras.py", encoding="utf-8").read(), globals())

GRADOS = ["madera", "cobre", "azul", "morado", "dorado", "arcoiris"]
SOLO = globals().get("SOLO") or GRADOS
ORO, ORO_OSC = (0.93, 0.74, 0.3), (0.7, 0.5, 0.18)
ARCOIRIS = [(1.0, 0.55, 0.6), (1.0, 0.75, 0.5), (1.0, 0.93, 0.55), (0.6, 0.95, 0.65), (0.55, 0.88, 1.0), (0.62, 0.68, 1.0), (0.85, 0.62, 1.0)]
ARRIBA = Vector((0, 0, 1))
Z_RODILLA = J["LeftLeg"].z
Z_PECHO = (J["Spine01"].z + J["Spine"].z) / 2


def cinto(A, m, m_hebilla, alto=0.035, z=None, hebilla=True):
    z = Z_CAD + 0.035 * ESC if z is None else z
    A.banda(z - alto / 2, z + alto / 2, m, extra=0.01)
    if hebilla:
        A.caja(A.en_tunica(z, FRENTE, 0.022), (Vector((1, 0, 0)), ARRIBA, Vector((0, -1, 0))), (0.06 * ESC, 0.05 * ESC, 0.014), m_hebilla, TR)
    return z


def bolsas(A, m, z, angs):
    for a in angs:
        A.ovoide(A.en_tunica(z - 0.03 * ESC, a, 0.035 * ESC), (0.04 * ESC, 0.032 * ESC, 0.045 * ESC), m, TR,
                 ejes=(Vector((-math.sin(a), math.cos(a), 0)), horiz(a), ARRIBA))


def brazales(A, mat, sep=0.02, anillos=8):
    for s in (1, -1):
        A.manga(s, X_MUNECA + 0.005, 0.0, mat, sep=sep, x0=X_CODO + 0.02 * ESC, anillos=anillos, nombre="brazal")


def gema_brazal(A, m, m_base=None, tam=0.03):
    for s in (1, -1):
        p, n = A.en_tubo("brazal", s, (X_CODO + X_MUNECA) / 2, math.pi / 2, 0.006)
        if m_base is not None:
            A.gema_cara(p, n, Vector((s, 0, 0)), tam * 1.5 * ESC, tam * 2.0 * ESC, m_base, BR, relieve=0.25)
        A.gema_cara(p + n * 0.008, n, Vector((s, 0, 0)), tam * ESC, tam * 1.4 * ESC, m, BR, relieve=0.5)


def gema_pecho(A, z, a, m, m_base=None, tam=0.04, lados=None):
    p = A.en_tunica(z, a, 0.008); n = horiz(a)
    if m_base is not None:
        A.gema_cara(p, n, ARRIBA, tam * 1.5 * ESC, tam * 1.9 * ESC, m_base, TR, relieve=0.2)
    if lados:
        A.gema(p + n * 0.012, n, tam * 0.55 * ESC, tam * 0.7 * ESC, m, TR, lados=lados, giro=math.pi / lados)
    else:
        A.gema_cara(p + n * 0.01, n, ARRIBA, tam * ESC, tam * 1.35 * ESC, m, TR, relieve=0.5)


# --------------------------------------------------------------------------- diseños
def madera():
    A = Armadura("madera")
    h1, h2, h3 = A.M("hoja", (0.38, 0.64, 0.22)), A.M("hoja_osc", (0.24, 0.48, 0.16)), A.M("hoja_clara", (0.52, 0.74, 0.3))
    rama, gris = A.M("rama", (0.45, 0.3, 0.16)), A.M("rodilla", (0.62, 0.64, 0.64))
    A.cuerpo(Z_CAD - 0.07 * ESC, abre=1.12, mat=lambda z, a, r, n: h2)
    A.hojas_tronco(A.z_hem + 0.02, Z_TOP - 0.005, 8, 18, [h1, h2, h3], 0.085 * ESC, 0.07 * ESC, semilla=3)
    A.hojas_tronco(A.z_hem - 0.005, A.z_hem + 0.01, 1, 22, [h1, h2], 0.11 * ESC, 0.075 * ESC, semilla=4, extra=0.016)
    A.mangas(X_HOMBRO + 0.11 * ESC, 0.0, lambda r, n: h2, nombre="manga")
    A.hojas_tubo("manga", X_HOMBRO + 0.0, X_HOMBRO + 0.1 * ESC, 2, 8, [h1, h3], 0.08 * ESC, 0.065 * ESC, semilla=5)
    brazales(A, lambda r, n: rama if r in (1, n - 2) else h2, sep=0.014)
    A.hojas_tubo("brazal", X_CODO + 0.04 * ESC, X_MUNECA - 0.03 * ESC, 2, 7, [h1, h2, h3], 0.07 * ESC, 0.06 * ESC, semilla=6)
    A.pantalon(lambda r, n, a: h2)
    A.hojas_tubo("pierna", BOTA_MAX.z + 0.03, Z_CAD - 0.02, 4, 8, [h1, h2, h3], 0.075 * ESC, 0.065 * ESC, semilla=7)
    A.rodilleras(gris, ancho=0.06, alto=0.06)
    A.botas(lambda r, n, a: rama if r in (n // 3, 2 * n // 3) else h2, z1=BOTA_MAX.z + 0.05 * ESC)
    A.hojas_tubo("bota", BOTA_MAX.z + 0.02 * ESC, BOTA_MAX.z + 0.045 * ESC, 1, 9, [h1, h3], 0.07 * ESC, 0.06 * ESC, semilla=8)
    cinto(A, rama, rama, alto=0.02 * ESC, hebilla=False)
    return A


def cobre():
    A = Armadura("cobre")
    cuero, osc, metal = A.M("cuero", (0.52, 0.31, 0.17)), A.M("cuero_osc", (0.34, 0.2, 0.1)), A.M("cobre", (0.88, 0.55, 0.32))
    pant, guante = A.M("pantalon_cuero", (0.3, 0.2, 0.14)), A.M("guante", (0.2, 0.15, 0.12))
    costura = lambda a: frente(a, 0.035) or abs(((a % TAU) + 0.05) % math.pi - 0.05) < 0.05
    A.cuerpo(Z_CAD - 0.08 * ESC, abre=1.08, mat=lambda z, a, r, n: osc if (r == 0 or r == n - 1 or costura(a)) else cuero)
    A.mangas(X_MUNECA - 0.02, 0.0, lambda r, n: osc if r == n - 1 else cuero)
    brazales(A, lambda r, n: metal if r in (1, n - 2) else osc)
    A.guantes(guante)
    A.hombreras(cuero, osc, capas=2, grande=0.9)
    z = cinto(A, osc, metal)
    bolsas(A, osc, z, (FRENTE + 0.75, FRENTE - 0.8))
    for a in (FRENTE + 0.45, FRENTE - 0.45):
        for zz in (Z_PECHO - 0.06 * ESC, Z_PECHO + 0.02 * ESC):
            gema_pecho(A, zz, a, metal, tam=0.02)
    A.pantalon(lambda r, n, a: pant)
    A.rodilleras(metal)
    A.botas(lambda r, n, a: osc if r >= n - 2 else cuero, z1=BOTA_MAX.z + 0.07 * ESC)
    return A


def azul():
    A = Armadura("azul")
    negro, plata, cinto_m = A.M("cuero_negro", (0.14, 0.14, 0.17)), A.M("plata", (0.74, 0.78, 0.84)), A.M("cinto_az", (0.32, 0.22, 0.15))
    cr1, cr2 = A.M("cristal_azul", (0.35, 0.75, 1.0), True), A.M("cristal_celeste", (0.6, 0.9, 1.0), True)
    A.cuerpo(Z_CAD - 0.06 * ESC, abre=1.06, mat=lambda z, a, r, n: plata if (r == 0 or r == n - 1) else negro)
    A.mangas(X_MUNECA - 0.02, 0.0, lambda r, n: negro)
    brazales(A, lambda r, n: plata if r in (0, n - 1) else negro, sep=0.022)
    gema_brazal(A, cr1, plata)
    A.guantes(negro)
    A.hombreras(plata, negro, capas=1, grande=1.05, cristales=[(cr1, 0.02, -0.025, 0.12, 0.5), (cr2, 0.06, 0.02, 0.09, 1.0), (cr1, 0.0, 0.035, 0.08, 0.2)])
    for k, zz in enumerate((Z_PECHO + 0.04 * ESC, Z_PECHO - 0.05 * ESC, J["Spine02"].z)):
        gema_pecho(A, zz, FRENTE, cr1 if k != 1 else cr2, plata, tam=0.045 if k < 2 else 0.035, lados=6)
    cinto(A, cinto_m, plata)
    A.pantalon(lambda r, n, a: negro)
    A.rodilleras(plata, cr1)
    A.botas(lambda r, n, a: plata if r == n - 1 else negro, z1=BOTA_MAX.z + 0.06 * ESC)
    return A


def morado():
    A = Armadura("morado")
    mor, mor2, oro, oro_osc = A.M("morado", (0.38, 0.17, 0.44)), A.M("morado_claro", (0.5, 0.26, 0.56)), A.M("oro", ORO), A.M("oro_osc", ORO_OSC)
    vid, gem, negro = A.M("vid", (0.4, 0.66, 0.26)), A.M("gema_morada", (0.85, 0.4, 1.0), True), A.M("guante_neg", (0.16, 0.13, 0.16))
    abre = 0.32
    A.cuerpo(Z_RODILLA - 0.02, abre=1.2, mat=lambda z, a, r, n: oro if r <= 0 else mor, abierto=(abre, Z_CAD - 0.01))
    for s in (1, -1):
        A.tira(FRENTE + s * (abre + 0.04), 0.04, A.z_hem + 0.01, Z_CAD + 0.0, oro)
    A.banda(Z_PECHO - 0.08 * ESC, Z_TOP - 0.01, oro, extra=0.012, a0=FRENTE - 0.42, a1=FRENTE + 0.42, filas=6)  # peto
    A.banda(Z_PECHO - 0.06 * ESC, Z_TOP - 0.03, mor2, extra=0.022, a0=FRENTE - 0.3, a1=FRENTE + 0.3, filas=5)
    gema_pecho(A, Z_PECHO, FRENTE, gem, oro, tam=0.04)
    A.hojas_tronco(A.z_hem + 0.03, Z_CAD - 0.03, 3, 10, [vid], 0.05 * ESC, 0.03 * ESC, semilla=9, extra=0.01, a0=FRENTE + abre + 0.3, a1=FRENTE + TAU - abre - 0.3)
    A.mangas(X_MUNECA - 0.02, 0.0, lambda r, n: oro if r == n - 1 else mor)
    brazales(A, lambda r, n: oro, sep=0.022)
    gema_brazal(A, gem)
    A.guantes(negro)
    A.hombreras(oro, oro_osc, capas=3, grande=1.05)
    z = cinto(A, oro, oro_osc)
    gema_pecho(A, z, FRENTE, gem, tam=0.025)
    A.pantalon(lambda r, n, a: mor2)
    A.rodilleras(oro, gem)
    A.botas(lambda r, n, a: oro if r == n - 1 else mor, z1=BOTA_MAX.z + 0.06 * ESC)
    # yelmo alado
    A.casco(oro, oro_osc, lat_min=-8, cara=50, alto_cara=35)
    p, n = A.en_casco(38, FRENTE, 0.012)
    A.gema_cara(p, n, ARRIBA, 0.04 * ESC, 0.06 * ESC, gem, CA, relieve=0.5)
    A.alas(lambda s: (A.en_casco(25, 0.0 if s > 0 else math.pi, 0.0)[0], Vector((s, 0, 0))), oro, oro_osc, plumas=5, largo=0.24)
    return A


def dorado():
    A = Armadura("dorado")
    oliva, oliva2, cuero = A.M("oliva", (0.44, 0.36, 0.22)), A.M("oliva_osc", (0.34, 0.27, 0.17)), A.M("cuero_exp", (0.4, 0.26, 0.15))
    oro, oro_osc, guante = A.M("oro", ORO), A.M("oro_osc", ORO_OSC), A.M("guante_exp", (0.22, 0.17, 0.12))
    A.cuerpo(Z_CAD - 0.07 * ESC, abre=1.08, mat=lambda z, a, r, n: oliva2 if (r == 0 or frente(a, 0.03)) else oliva)
    for i, zz in enumerate(np.linspace(J["Spine02"].z + 0.01, Z_TOP - 0.06 * ESC, 3)):
        for k in range(3 - (i % 2)):
            a = FRENTE + (k - (2 - (i % 2)) / 2) * 0.42
            A.gema_cara(A.en_tunica(zz, a, 0.01), horiz(a), ARRIBA, 0.06 * ESC, 0.085 * ESC, oro, TR, relieve=0.45)
    A.mangas(X_MUNECA - 0.02, 0.0, lambda r, n: oliva)
    brazales(A, lambda r, n: oro if r in (0, n - 1) else oro_osc, sep=0.022)
    A.guantes(guante)
    A.hombreras(oro, oro_osc, capas=3, grande=1.15)
    A.capa(oro, oro_osc, oro_osc)
    z = cinto(A, cuero, oro)
    bolsas(A, cuero, z, (FRENTE + 0.7, FRENTE - 0.7, FRENTE + 1.3))
    A.pantalon(lambda r, n, a: oliva2)
    A.rodilleras(oro, ancho=0.06, alto=0.09)
    A.botas(lambda r, n, a: oro_osc if r == n - 1 else cuero, z1=BOTA_MAX.z + 0.07 * ESC)
    return A


def arcoiris():
    A = Armadura("arcoiris")
    perla, perla2, cosmos, oro = A.M("perla", (0.94, 0.93, 0.99)), A.M("perla_azul", (0.8, 0.84, 0.96)), A.M("cosmos", (0.3, 0.18, 0.56)), A.M("oro", ORO)
    estr = [A.M("estrella", (1, 1, 1), True), A.M("estrella_rosa", (1.0, 0.75, 0.95), True), A.M("estrella_cian", (0.65, 0.95, 1.0), True)]
    cris = [A.M(f"cristal_{i}", c, True) for i, c in enumerate(ARCOIRIS)]
    guante = A.M("guante_cel", (0.25, 0.2, 0.35))
    abre = 0.3
    A.cuerpo(BOTA_MAX.z + 0.04, abre=1.25, mat=lambda z, a, r, n: oro if r <= 0 else (cosmos if frente(a, 0.28) else perla), abierto=(abre, Z_CAD - 0.01))
    for s in (1, -1):
        A.tira(FRENTE + s * 0.3, 0.035, A.z_hem + 0.01, Z_TOP + 0.005, oro)
    A.estrellas(45, estr, a_ok=lambda a: frente(a, 0.27), z0=Z_CAD)
    gema_pecho(A, Z_PECHO + 0.02 * ESC, FRENTE, cris[4], oro, tam=0.05)
    A.mangas(X_MUNECA - 0.01, 0.12 * ESC, lambda r, n: oro if r == n - 1 else perla)
    brazales(A, lambda r, n: oro if r in (0, n - 1) else perla2, sep=0.024)
    gema_brazal(A, cris[6], oro)
    A.guantes(guante)
    A.hombreras(perla, oro, capas=2, grande=1.05, cristales=[(cris[1], 0.02, -0.02, 0.09, 0.6), (cris[5], 0.05, 0.02, 0.07, 1.0)])
    A.capa(perla, perla2, oro, mat_col=lambda c, n: cris[min(6, int(c / max(1, n - 2) * 7))])
    A.alas(lambda s: (A.en_tunica(Z_CAD + 0.02, 0.0 if s > 0 else math.pi, 0.02), Vector((s, 0, 0))), perla, perla2, plumas=4, largo=0.17, tipo=TR)
    z = cinto(A, oro, oro)
    gema_pecho(A, z, FRENTE, cris[2], tam=0.025)
    A.pantalon(lambda r, n, a: perla2)
    A.rodilleras(oro, cris[4])
    A.botas(lambda r, n, a: oro if r == n - 1 else perla, z1=BOTA_MAX.z + 0.07 * ESC)
    # tocado celestial: casco corto con cresta de cristal y alitas
    A.casco(perla, oro, lat_min=18, cara=60, alto_cara=60, sep=0.018)
    p, n = A.en_casco(55, FRENTE, 0.01)
    A.cristal(p, (n + ARRIBA * 1.2), 0.03 * ESC, 0.16 * ESC, cris[4], CA)
    A.gema_cara(A.en_casco(40, FRENTE, 0.012)[0], horiz(FRENTE), ARRIBA, 0.035 * ESC, 0.05 * ESC, cris[0], CA)
    A.alas(lambda s: (A.en_casco(35, 0.0 if s > 0 else math.pi, 0.0)[0], Vector((s, 0, 0))), perla, perla2, plumas=4, largo=0.15)
    return A


DISENOS = {"madera": madera, "cobre": cobre, "azul": azul, "morado": morado, "dorado": dorado, "arcoiris": arcoiris}
result = {g: DISENOS[g]().terminar() for g in SOLO}
