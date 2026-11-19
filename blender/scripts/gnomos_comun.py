"""Datos compartidos por los scripts de personajes hechos por piezas (gnomos, elfos): malla única,
esqueleto y armaduras.

Pose T: el esqueleto del juego (el de Meshy, copiado de elfo_f.glb) está en pose T y las
animaciones compartidas solo giran los huesos. Por eso la malla que se exporta se arma con los
brazos horizontales: las piezas del brazo giran alrededor del hombro hasta quedar en el eje X.

Cada personaje es un objeto vacío (raíz) con sus piezas como hijos: <raíz>_<pieza>_<I|D>. La raíz
puede traer la propiedad "hombro" (x, y, z) con el pivote del brazo izquierdo; si no, se usa el del
gnomo.
"""
from mathutils import Matrix, Vector

ARM_KEYS = ("_manga_", "_brazo_", "_mano_", "_pulgar_")
HOMBRO = (0.19, 0.0, 0.545)  # pivote del brazo del gnomo (lado izquierdo; el derecho es el espejo en X)
# piezas que una armadura de cabeza (capucha, sombrero, yelmo) reemplaza: van en una cáscara aparte
QUITABLES = ("gorro", "copete")


def lado(nombre):
    """+1 = izquierda del personaje (x positiva), -1 = derecha. Las piezas terminan en _I / _D."""
    return 1 if nombre.endswith("_I") else -1


def es_brazo(nombre):
    return any(k in nombre for k in ARM_KEYS)


def hombro(root):
    h = root.get("hombro") if root is not None else None
    return Vector(tuple(h)) if h else Vector(HOMBRO)


def pivote(s, root=None):
    h = hombro(root)
    return Vector((s * h.x, h.y, h.z))


def matrices_pose_t(root):
    """{lado: matriz} que gira cada brazo (en el espacio del objeto raíz) hasta la horizontal."""
    import bpy
    rinv = root.matrix_world.inverted()
    out = {}
    for s, L in ((1, "I"), (-1, "D")):
        mano = bpy.data.objects[f"{root.name}_mano_{L}"]
        p = pivote(s, root)
        d = (rinv @ mano.matrix_world.translation) - p
        d.y = 0.0
        R = d.normalized().rotation_difference(Vector((s, 0.0, 0.0))).to_matrix().to_4x4()
        out[s] = Matrix.Translation(p) @ R @ Matrix.Translation(-p)
    return out


def matriz_pieza(ob, root, pose_t):
    """Matriz de la pieza en el espacio de la raíz, con el brazo en pose T si corresponde."""
    M = root.matrix_world.inverted() @ ob.matrix_world
    if pose_t and es_brazo(ob.name):
        M = pose_t[lado(ob.name)] @ M
    return M
