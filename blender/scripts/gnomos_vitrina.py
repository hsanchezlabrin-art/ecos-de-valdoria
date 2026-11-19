"""Vitrina: el gnomo seis veces en fila, cada uno con una túnica (madera → arcoíris).

Se ejecuta dentro de Blender con gnomos.blend abierto, después de gnomos_tunicas.py:
    g = {"CHAR": "Gnomo_M", "RENDER": r"C:\\ruta\\vitrina.png"}   # RENDER es opcional
    exec(open(r".../gnomos_vitrina.py", encoding="utf-8").read(), g)

Crea la colección "Vitrina_<CHAR>" con copias enlazadas (comparten la malla: si se regeneran las
túnicas, se vuelve a ejecutar). Las túnicas que traen capucha, sombrero o corona ocultan el gorro
del gnomo con un modificador Máscara, igual que en el juego.
"""
import bpy, math
from mathutils import Vector

C_NAME = globals().get("CHAR", "Gnomo_M")
RENDER = globals().get("RENDER")
GRADOS = ["madera", "cobre", "azul", "morado", "dorado", "arcoiris"]
SEP = 0.8
D = bpy.data
sc = bpy.context.scene
cuerpo = D.objects[C_NAME + "_malla"]
arm = D.objects[C_NAME + "_esqueleto"]
nombre_col = "Vitrina_" + C_NAME
col = D.collections.get(nombre_col)
if col:
    for o in list(col.objects):
        D.objects.remove(o)
else:
    col = D.collections.new(nombre_col)
    sc.collection.children.link(col)
base = Vector((cuerpo.location.x, 4.0 if C_NAME.endswith("_F") else 2.5, 0))
for i, g in enumerate(GRADOS):
    tun = D.objects.get(f"{C_NAME}_tunica_{g}")
    if not tun:
        continue
    pos = base + Vector(((i - 2.5) * SEP, 0, 0))
    a = arm.copy(); a.name = f"vit_{C_NAME}_{g}_esqueleto"; col.objects.link(a); a.location = pos
    for o, nom in ((cuerpo, "cuerpo"), (tun, "tunica")):
        c = o.copy(); c.name = f"vit_{C_NAME}_{g}_{nom}"; col.objects.link(c)
        c.location = pos; c.hide_render = False
        for m in c.modifiers:
            if m.type == "ARMATURE":
                m.object = a
        if nom == "cuerpo" and tun.get("cubre_cabeza"):
            mk = c.modifiers.new("sin_gorro", "MASK"); mk.vertex_group = "GORRO"; mk.invert_vertex_group = True
    a.hide_set(True)
for o in col.objects:
    if o.type == "MESH":
        o.hide_set(False)

result = {"vitrina": nombre_col, "objetos": len(col.objects)}
if RENDER:
    cam = D.objects.get("camara_vitrina")
    if not cam:
        cam = D.objects.new("camara_vitrina", D.cameras.new("camara_vitrina"))
        sc.collection.objects.link(cam)
    cam.location = base + Vector((0, -7.4, 0.78))
    cam.rotation_euler = (math.radians(88), 0, 0)
    cam.data.lens = 50
    # se ocultan los demás para el render
    otros = [o for o in sc.objects if o.type in ("MESH", "ARMATURE") and o.name not in col.objects and o.name != "suelo" and not o.hide_render]
    for o in otros:
        o.hide_render = True
    prev = sc.camera, sc.render.resolution_x, sc.render.resolution_y, sc.render.filepath
    sc.camera = cam; sc.render.resolution_x, sc.render.resolution_y = 2000, 760
    sc.render.filepath = RENDER
    bpy.ops.render.render(write_still=True)
    sc.camera, sc.render.resolution_x, sc.render.resolution_y, sc.render.filepath = prev
    for o in otros:
        o.hide_render = False
    result["render"] = RENDER
