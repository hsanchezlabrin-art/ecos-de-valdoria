"""Lagarto y Lagarta por piezas (estilo de bloques, como la hoja de referencia del usuario).

Se ejecuta dentro de Blender: crea blender/proyectos/lagartos.blend con los dos personajes. Después se
usan gnomos_malla_unica.py, gnomos_rig.py (CHAR = "Lagarto_M" / "Lagarta_F") y lagartos_armaduras.py.

Piezas con nombre especial: los cuernos y las flores de ella son "copete_*" (los reemplaza el
casco); la cola es "cola_tubo" + "cola_espina_*" y las alas "ala_*": gnomos_rig.py les crea huesos
propios (TailA/TailB, WingL/WingR) que el juego mueve por código, como en la hada.
"""
import math
from mathutils import Vector

exec(open(r"G:\Mi unidad\Juego\blender\scripts\piezas_comun.py", encoding="utf-8").read(), globals())
SALIDA_BLEND = r"G:\Mi unidad\Juego\blender\proyectos\lagartos.blend"

mat("verde", (0.4, 0.56, 0.27)); mat("verde_osc", (0.32, 0.47, 0.21)); mat("panza", (0.84, 0.76, 0.5))
mat("cuerno", (0.76, 0.63, 0.41)); mat("espina", (0.72, 0.6, 0.37)); mat("dedo", (0.8, 0.72, 0.48))
mat("short", (0.56, 0.37, 0.2)); mat("ojos", (0.08, 0.07, 0.06), 0.4); mat("boca", (0.16, 0.2, 0.12))
mat("membrana", (0.8, 0.74, 0.47)); mat("flor", (0.96, 0.66, 0.54)); mat("flor_centro", (1.0, 0.84, 0.45))


def cuerno(nombre, parent, s):
    base = Vector((s * 0.19, 0.07, 1.16))
    pts = [base + Vector((s * 0.06 * t, 0.07 * t * t, 0.19 * t)) for t in (0, 0.25, 0.5, 0.75, 1.0)]
    tubo(nombre, parent, pts, [0.068, 0.062, 0.05, 0.034, 0.012], "cuerno", segs=8)


def ala(nombre, parent, s):
    # ala de murciélago: hueso de arriba que sube y borde de abajo con tres puntas
    k = 1.45
    contorno = [(u * k, v * k) for u, v in ((0.0, 0.0), (0.05, 0.1), (0.15, 0.16), (0.27, 0.13), (0.26, 0.05), (0.21, 0.0), (0.18, -0.07), (0.13, -0.01), (0.09, -0.08), (0.05, -0.02), (0.01, -0.06))]
    o = Vector((s * 0.15, 0.12, 0.6))
    U = Vector((s * 1.0, 0.45, 0.0)); V = Vector((0, 0.1, 1.0))
    plano(nombre, parent, contorno, o, U, V, 0.022, "verde")
    # membrana clara por delante
    mem = [(u * k, v * k) for u, v in ((0.04, 0.01), (0.07, 0.08), (0.15, 0.12), (0.23, 0.1), (0.22, 0.04), (0.18, 0.01), (0.16, -0.04), (0.12, 0.01), (0.09, -0.04), (0.06, 0.0))]
    Ud = U.normalized(); N = Ud.cross(V.normalized()).normalized()
    plano(nombre + "_membrana", parent, mem, o - N * 0.012 * s, U, V, 0.008, "membrana")


def personaje(cname, x, fem):
    coll = D.collections.new(cname); SC.collection.children.link(coll)
    root = D.objects.new(cname, None); coll.objects.link(root)
    root.location = (x, 0, 0); root.empty_display_size = 0.4
    root["raza"] = "lagarto"
    root["hombro"] = (0.21, 0.0, 0.65)
    P = lambda n: f"{cname}_{n}"
    for s, L in ((-1, "D"), (1, "I")):
        # patas: pie con dedos, pierna verde
        box(P(f"bota_{L}"), root, (0.17, 0.225, 0.09), (s * 0.1, -0.03, 0.045), "verde", top=(0.97, 0.9))
        box(P(f"bota_borde_{L}"), root, (0.155, 0.165, 0.03), (s * 0.1, 0.0, 0.1), "verde", bevel=0.01)
        for k, dx in enumerate((-0.05, 0.0, 0.05)):
            box(P(f"bota_dedo_{L}_{k}"), root, (0.03, 0.02, 0.045), (s * 0.1 + dx, -0.144, 0.03), "dedo", sub=0, bevel=0.005)
        box(P(f"pierna_{L}"), root, (0.15, 0.16, 0.27), (s * 0.1, 0, 0.215), "verde")
        if not fem:
            box(P(f"pierna_short_{L}"), root, (0.185, 0.2, 0.13), (s * 0.1, 0, 0.29), "short", bottom=(1.05, 1.05))
        # brazos: todo verde (manga = brazo de arriba)
        box(P(f"manga_{L}"), root, (0.13, 0.14, 0.15), (s * 0.262, 0, 0.62), "verde", rot=(0, -s * 7, 0))
        box(P(f"manga_puno_{L}"), root, (0.132, 0.142, 0.02), (s * 0.268, 0, 0.545), "verde", rot=(0, -s * 7, 0), bevel=0.006)
        box(P(f"brazo_{L}"), root, (0.12, 0.13, 0.17), (s * 0.272, 0, 0.46), "verde", rot=(0, -s * 5, 0))
        box(P(f"mano_{L}"), root, (0.13, 0.13, 0.1), (s * 0.278, -0.005, 0.35), "verde")
        box(P(f"pulgar_{L}"), root, (0.045, 0.05, 0.055), (s * 0.255, -0.07, 0.375), "verde", bevel=0.01)
        # cara
        box(P(f"ojo_{L}"), root, (0.045, 0.014, 0.075), (s * 0.13, -0.213, 1.0), "ojos", sub=0, bevel=0.008)
        box(P(f"fosa_{L}"), root, (0.03, 0.012, 0.016), (s * 0.06, -0.362, 0.905), "boca", sub=0, bevel=0.004)
        if fem:
            for k, (dx, dz, rz) in enumerate(((0.03, 0.045, 30), (0.045, 0.03, 55))):
                box(P(f"pestana_{L}_{k}"), root, (0.028, 0.012, 0.008), (s * (0.13 + dx), -0.214, 1.0 + dz), "ojos", rot=(0, -s * rz, 0), sub=0, bevel=0.002)
        # cuernos (con flores en ella) y alas
        cuerno(P(f"copete_cuerno_{L}"), root, s)
        ala(P(f"ala_{L}"), root, s)
        if fem:
            c = Vector((s * 0.25, 0.02, 1.2))
            n = Vector((s, -0.4, 0.2)).normalized()
            ball(P(f"copete_flor_{L}_c"), root, 0.022, c + n * 0.01, "flor_centro", subdiv=1)
            t = n.cross(Vector((0, 0, 1))).normalized(); u = n.cross(t).normalized()
            for j in range(5):
                a = 2 * math.pi * j / 5
                ball(P(f"copete_flor_{L}_p{j}"), root, 0.026, c + (t * math.cos(a) + u * math.sin(a)) * 0.034, "flor", scale=(1, 1, 1), subdiv=1)
    box(P("cabeza"), root, (0.5, 0.46, 0.46), (0, 0.02, 0.95), "verde", bevel=0.05)
    box(P("hocico"), root, (0.32, 0.17, 0.15), (0, -0.275, 0.865), "verde", bevel=0.03)
    box(P("boca"), root, (0.27, 0.012, 0.012), (0, -0.362, 0.835), "boca", sub=0, bevel=0.003)
    # espinas: una arriba entre los cuernos y una fila por la nuca
    punta(P("espina_arriba"), root, (0, 0.12, 1.17), (0, 0.4, 1), 0.12, 0.09, 0.09, "espina", sub=1)
    for k, z in enumerate((1.08, 0.97, 0.86)):
        punta(P(f"espina_{k}"), root, (0, 0.24, z), (0, 1, 0.3), 0.11, 0.09, 0.08, "espina", sub=1)
    # tronco con panza
    box(P("camisa"), root, (0.4, 0.27, 0.36), (0, 0, 0.52), "verde", top=(0.95, 0.95), bottom=(1.05, 1.05), bevel=0.04)
    box(P("panza"), root, (0.25, 0.03, 0.27), (0, -0.13, 0.525), "panza", top=(0.92, 1), bevel=0.012)
    # cola con espinas
    pts = [Vector((0, 0.1, 0.36)), Vector((0, 0.28, 0.27)), Vector((0, 0.44, 0.19)), Vector((0, 0.58, 0.13)), Vector((0, 0.7, 0.1))]
    tubo(P("cola_tubo"), root, pts, [0.1, 0.08, 0.06, 0.04, 0.015], "verde", segs=8, aplastar=0.9)
    for k, (p, alto) in enumerate(zip(pts[1:4], (0.1, 0.085, 0.07))):
        r = (0.08, 0.06, 0.04)[k]
        punta(P(f"cola_espina_{k}"), root, p + Vector((0, 0, r * 0.7)), (0, 0.5, 1), alto, 0.08, 0.07, "espina", sub=1)
    if fem:
        loft(P("vestido"), root, [(0.19, 0.29, 0.21, 0), (0.33, 0.25, 0.185, 0), (0.45, 0.215, 0.152, 0)], "short", segs=8)
        box(P("panel_peto"), root, (0.27, 0.025, 0.03), (0, -0.138, 0.64), "short", bevel=0.006)
        for s in (-1, 1):
            L = "I" if s > 0 else "D"
            box(P(f"cordon_tirante_f_{L}"), root, (0.035, 0.02, 0.2), (s * 0.115, -0.138, 0.55), "short", sub=0, bevel=0.005)
            box(P(f"cordon_tirante_h_{L}"), root, (0.035, 0.27, 0.02), (s * 0.115, 0, 0.7), "short", sub=0, bevel=0.005)
            box(P(f"cordon_tirante_a_{L}"), root, (0.035, 0.02, 0.27), (s * 0.115, 0.138, 0.56), "short", sub=0, bevel=0.005)
    else:
        box(P("camisa_short"), root, (0.42, 0.275, 0.09), (0, 0, 0.355), "short", bevel=0.015)
    return root


personaje("Lagarto_M", -0.55, False)
personaje("Lagarta_F", 0.55, True)
escena(SALIDA_BLEND)
result = {"archivo": SALIDA_BLEND, "objetos": len(D.objects)}
