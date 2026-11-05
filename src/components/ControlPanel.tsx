import { useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { HOLD_DELAY_MS } from '../config';
import type { ModelAction, ModelController } from '../model/ModelController';
import { clipLabel } from '../utils/clipNames';

interface ControlPanelProps {
  controller: ModelController;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  autoRotate: boolean;
  onToggleAutoRotate: () => void;
  onReset: () => void;
  clips: string[];
  activeClip: string | null;
  onSelectClip: (name: string) => void;
  paused: boolean;
  onTogglePaused: () => void;
  dance: boolean;
  onToggleDance: () => void;
}

/**
 * Кнопка с поддержкой удержания: тап = один шаг, удержание = непрерывное движение.
 */
function HoldButton({
  controller,
  action,
  label,
  children,
}: {
  controller: ModelController;
  action: ModelAction;
  label: string;
  children: ReactNode;
}) {
  const timer = useRef<number | null>(null);

  const end = () => {
    if (timer.current !== null) window.clearTimeout(timer.current);
    timer.current = null;
    controller.release(action);
  };

  useEffect(() => end, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <button
      type="button"
      className="ctrl-btn"
      aria-label={label}
      title={label}
      data-action={action}
      onPointerDown={(e) => {
        if (e.pointerType === 'mouse' && e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        controller.step(action);
        timer.current = window.setTimeout(() => controller.press(action), HOLD_DELAY_MS);
      }}
      onPointerUp={end}
      onPointerCancel={end}
      onLostPointerCapture={end}
      onClick={(e) => {
        // Клавиатура (Enter/Space) даёт click без pointerdown, detail === 0.
        if (e.detail === 0) controller.step(action);
      }}
    >
      {children}
    </button>
  );
}

function ToggleButton({
  active,
  label,
  onClick,
  children,
  testId,
}: {
  active?: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <button
      type="button"
      className={`ctrl-btn${active ? ' is-active' : ''}`}
      aria-label={label}
      aria-pressed={active}
      title={label}
      onClick={onClick}
      data-testid={testId}
    >
      {children}
    </button>
  );
}

const Icon = {
  up: <path d="M12 5l-6 7h4v7h4v-7h4z" />,
  down: <path d="M12 19l6-7h-4V5h-4v7H6z" />,
  left: <path d="M5 12l7-6v4h7v4h-7v4z" />,
  right: <path d="M19 12l-7 6v-4H5v-4h7V6z" />,
};

function Svg({ children }: { children: ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="currentColor" aria-hidden="true">
      {children}
    </svg>
  );
}

function Stroke({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={d} />
    </svg>
  );
}

export function ControlPanel(props: ControlPanelProps) {
  const { controller, collapsed } = props;
  const hasClips = props.clips.length > 0;

  return (
    <div className={`panel${collapsed ? ' is-collapsed' : ''}`} data-testid="control-panel">
      <button
        type="button"
        className="panel-handle"
        onClick={props.onToggleCollapsed}
        aria-label={collapsed ? 'Показать панель' : 'Скрыть панель'}
        aria-expanded={!collapsed}
      >
        <span className="panel-handle-bar" />
      </button>

      {!collapsed && (
        <div className="panel-body">
          <div className="ctrl-row">
            <div className="ctrl-group" aria-label="Перемещение">
              <HoldButton controller={controller} action="left" label="Влево"><Svg>{Icon.left}</Svg></HoldButton>
              <HoldButton controller={controller} action="right" label="Вправо"><Svg>{Icon.right}</Svg></HoldButton>
              <HoldButton controller={controller} action="up" label="Вверх"><Svg>{Icon.up}</Svg></HoldButton>
              <HoldButton controller={controller} action="down" label="Вниз"><Svg>{Icon.down}</Svg></HoldButton>
            </div>
            <div className="ctrl-group" aria-label="Глубина">
              <HoldButton controller={controller} action="forward" label="Вперёд (ближе)">
                <span className="txt">Ближе</span>
              </HoldButton>
              <HoldButton controller={controller} action="back" label="Назад (дальше)">
                <span className="txt">Дальше</span>
              </HoldButton>
            </div>
          </div>

          <div className="ctrl-row">
            <div className="ctrl-group" aria-label="Масштаб и поворот">
              <HoldButton controller={controller} action="scaleUp" label="Увеличить"><Stroke d="M12 5v14M5 12h14" /></HoldButton>
              <HoldButton controller={controller} action="scaleDown" label="Уменьшить"><Stroke d="M5 12h14" /></HoldButton>
              <HoldButton controller={controller} action="rotateLeft" label="Повернуть влево"><Stroke d="M4 9a8 8 0 1 1 1 7M4 4v5h5" /></HoldButton>
              <HoldButton controller={controller} action="rotateRight" label="Повернуть вправо"><Stroke d="M20 9a8 8 0 1 0-1 7M20 4v5h-5" /></HoldButton>
            </div>
            <div className="ctrl-group">
              <ToggleButton active={props.autoRotate} label="Авто-вращение" onClick={props.onToggleAutoRotate} testId="auto-rotate">
                <Stroke d="M12 3a9 9 0 1 0 9 9M21 3v6h-6" />
              </ToggleButton>
              <ToggleButton label="Сброс" onClick={props.onReset} testId="reset">
                <span className="txt">Сброс</span>
              </ToggleButton>
            </div>
          </div>

          <div className="ctrl-row anim-row">
            {hasClips ? (
              <>
                <ToggleButton
                  label={props.paused ? 'Воспроизвести' : 'Пауза'}
                  onClick={props.onTogglePaused}
                  testId="play-pause"
                >
                  {props.paused ? <Svg><path d="M7 5l12 7-12 7z" /></Svg> : <Svg><path d="M6 5h4v14H6zM14 5h4v14h-4z" /></Svg>}
                </ToggleButton>
                <div className="chips" role="listbox" aria-label="Анимации">
                  {props.clips.map((name) => (
                    <button
                      key={name}
                      type="button"
                      role="option"
                      aria-selected={props.activeClip === name}
                      className={`chip${props.activeClip === name ? ' is-active' : ''}`}
                      onClick={() => props.onSelectClip(name)}
                      title={name}
                    >
                      {clipLabel(name)}
                    </button>
                  ))}
                </div>
              </>
            ) : (
              <ToggleButton active={props.dance} label="Танец" onClick={props.onToggleDance} testId="dance">
                <span className="txt">{props.dance ? '■ Стоп танец' : '♪ Танец'}</span>
              </ToggleButton>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
