import { Material, Mesh, Object3D, Texture } from 'three';

function disposeMaterial(material: Material): void {
  for (const value of Object.values(material)) {
    if (value instanceof Texture) value.dispose();
  }
  material.dispose();
}

/** Освободить геометрии, материалы и текстуры всего поддерева. */
export function disposeObject(root: Object3D): void {
  root.traverse((obj) => {
    if (obj instanceof Mesh) {
      obj.geometry.dispose();
      const materials: Material[] = Array.isArray(obj.material) ? obj.material : [obj.material];
      materials.forEach(disposeMaterial);
    }
  });
}
