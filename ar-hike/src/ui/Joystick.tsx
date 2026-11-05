import { useRef, useState } from 'react';
import type { MoveInput } from '../sim/SimRuntime';

const RADIUS = 48;

/** Виртуальный джойстик для симуляции на сенсорных экранах. */
export function Joystick({ onChange }: { onChange: (input: MoveInput) => void }) {
  const origin = useRef<{ x: number; y: number; id: number } | null>(null);
  const [knob, setKnob] = useState({ x: 0, y: 0 });

  const update = (clientX: number, clientY: number) => {
    const o = origin.current;
    if (!o) return;
    let dx = clientX - o.x;
    let dy = clientY - o.y;
    const len = Math.hypot(dx, dy);
    if (len > RADIUS) {
      dx = (dx / len) * RADIUS;
      dy = (dy / len) * RADIUS;
    }
    setKnob({ x: dx, y: dy });
    onChange({ x: dx / RADIUS, z: dy / RADIUS });
  };

  const end = () => {
    origin.current = null;
    setKnob({ x: 0, y: 0 });
    onChange({ x: 0, z: 0 });
  };

  return (
    <div
      className="joystick"
      data-testid="joystick"
      onPointerDown={(e) => {
        const rect = e.currentTarget.getBoundingClientRect();
        e.currentTarget.setPointerCapture(e.pointerId);
        origin.current = { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, id: e.pointerId };
        update(e.clientX, e.clientY);
      }}
      onPointerMove={(e) => update(e.clientX, e.clientY)}
      onPointerUp={end}
      onPointerCancel={end}
    >
      <div className="joystick-knob" style={{ transform: `translate(${knob.x}px, ${knob.y}px)` }} />
    </div>
  );
}
