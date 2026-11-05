import { Vector3 } from 'three';

/**
 * Якоря WebXR для станций и скамеек.
 * Anchor можно создать только внутри XR-кадра, поэтому запросы вне кадра (кнопка «Скамейка»)
 * ставятся в очередь и выполняются в следующем кадре. Если устройство не поддерживает anchors,
 * объект остаётся в исходной точке local/local-floor-пространства.
 */
export class AnchorManager {
  private readonly anchors = new Map<string, XRAnchor>();
  private readonly pending = new Map<string, Vector3>();
  /** Версия набора: если якорь удалили, пока он создавался, результат выбрасываем. */
  private readonly generation = new Map<string, number>();
  private readonly tmp = new Vector3();

  /** Создать якорь в текущем кадре (например, в обработчике select, где есть event.frame). */
  createNow(id: string, position: Vector3, frame: XRFrame, space: XRReferenceSpace): void {
    this.remove(id);
    const gen = (this.generation.get(id) ?? 0) + 1;
    this.generation.set(id, gen);
    const create = frame.createAnchor;
    if (typeof create !== 'function') return;
    try {
      create
        .call(frame, new XRRigidTransform({ x: position.x, y: position.y, z: position.z }), space)
        ?.then((anchor) => {
          if (this.generation.get(id) === gen) this.anchors.set(id, anchor);
          else anchor.delete();
        })
        .catch(() => undefined);
    } catch {
      // anchors не поддерживаются: объект просто стоит в исходных координатах
    }
  }

  /** Создать якорь в следующем XR-кадре. */
  request(id: string, position: Vector3): void {
    this.pending.set(id, position.clone());
  }

  remove(id: string): void {
    this.pending.delete(id);
    this.generation.set(id, (this.generation.get(id) ?? 0) + 1);
    const anchor = this.anchors.get(id);
    this.anchors.delete(id);
    try {
      anchor?.delete();
    } catch {
      // сессия уже закрыта
    }
  }

  clear(): void {
    for (const id of [...this.anchors.keys(), ...this.pending.keys()]) this.remove(id);
  }

  /** Вызывать каждый кадр: создаёт отложенные якоря и возвращает актуальные позиции отслеживаемых. */
  process(frame: XRFrame, space: XRReferenceSpace): Map<string, Vector3> {
    for (const [id, pos] of this.pending) {
      this.pending.delete(id);
      this.createNow(id, pos, frame, space);
    }
    const positions = new Map<string, Vector3>();
    for (const [id, anchor] of this.anchors) {
      if (frame.trackedAnchors && !frame.trackedAnchors.has(anchor)) continue;
      const pose = frame.getPose(anchor.anchorSpace, space);
      if (!pose) continue;
      const p = pose.transform.position;
      positions.set(id, this.tmp.set(p.x, p.y, p.z).clone());
    }
    return positions;
  }
}
