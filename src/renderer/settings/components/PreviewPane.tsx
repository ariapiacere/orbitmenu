// Interactive preview of the ring being edited, drawn by the same renderer as
// the real overlay. Click an item to edit it, click a selected submenu (or
// double-click) to go inside, click the hub or the back slot to go up.
import { useEffect, useLayoutEffect, useRef } from 'react';
import type { AppearanceSettings, MenuDefinition, Vec2 } from '@shared/types';
import { NONE, PARENT, angleOf, pickByAngle } from '@shared/geometry';
import { childrenAtPath, itemAtPath } from '@shared/tree';
import { RadialRenderer, type LevelSpec } from '../../radial/RadialRenderer';
import { buildLevel, levelExtent } from '../../radial/levels';
import { ops, useEditor } from '../store';

interface Props {
  menu: MenuDefinition;
  appearance: AppearanceSettings;
  path: string[];
  selectedId: string | null;
  interactive?: boolean;
  onSelect?: (id: string | null) => void;
  onUp?: () => void;
}

export function PreviewPane({ menu, appearance, path, selectedId, interactive = true, onSelect, onUp }: Props) {
  const stageRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const rendererRef = useRef<RadialRenderer | null>(null);
  const levelRef = useRef<LevelSpec | null>(null);
  const scaleRef = useRef(1);
  const lastPathKey = useRef('');
  const icons = useEditor((s) => s.icons);
  const menuNames = useEditor((s) => s.config.menus);

  useLayoutEffect(() => {
    const root = document.createElement('div');
    canvasRef.current!.appendChild(root);
    rendererRef.current = new RadialRenderer(root, { preview: true });
    return () => {
      root.remove();
      rendererRef.current = null;
    };
  }, []);

  const items = childrenAtPath(menu, path) ?? [];
  const selectedIndex = items.findIndex((i) => i.id === selectedId);

  // Rebuild the ring whenever its content or the appearance changes.
  useEffect(() => {
    const r = rendererRef.current;
    const stage = stageRef.current;
    if (!r || !stage) return;
    const owner = path.length ? itemAtPath(menu, path) : null;
    const names = Object.fromEntries(menuNames.map((m) => [m.id, m.name]));
    const level = buildLevel(owner?.name ?? menu.name, owner?.icon ?? menu.icon, items, { x: 0, y: 0 }, path.length ? 180 : null, appearance, names);
    levelRef.current = level;
    // Scale the ring down when the pane is too small for it.
    const render = (animate: boolean) => {
      const ext = levelExtent(level, { ...appearance, scale: 1 });
      const avail = Math.min(stage.clientWidth / 2 / ext.x, stage.clientHeight / 2 / ext.y);
      const scale = Math.min(appearance.scale, Math.max(0.35, avail));
      scaleRef.current = scale;
      r.setAppearance({ ...appearance, scale, showTrail: false });
      r.setResolvedIcons(icons);
      r.clear();
      r.push(level, undefined, animate);
      r.setHover(selectedIndex);
    };
    const key = `${menu.id}/${path.join('/')}`;
    render(key !== lastPathKey.current);
    lastPathKey.current = key;
    let size = `${stage.clientWidth}x${stage.clientHeight}`;
    const ro = new ResizeObserver(() => {
      const next = `${stage.clientWidth}x${stage.clientHeight}`;
      if (next === size) return;
      size = next;
      render(false);
    });
    ro.observe(stage);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [menu, path.join('/'), appearance, icons, menuNames]);

  useEffect(() => {
    rendererRef.current?.setHover(selectedIndex);
  }, [selectedIndex]);

  const hitTest = (e: React.PointerEvent | React.MouseEvent): number => {
    const level = levelRef.current;
    const canvas = canvasRef.current;
    if (!level || !canvas) return NONE;
    const rect = canvas.getBoundingClientRect();
    const p: Vec2 = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    const dist = Math.hypot(p.x, p.y);
    if (dist < appearance.innerRadius * scaleRef.current) return NONE;
    if (dist > (level.ringRadius + appearance.itemSize) * scaleRef.current + 40) return Number.NaN;
    return pickByAngle(angleOf(p.x, p.y), level.angles, level.parentAngle);
  };

  if (!interactive) {
    return (
      <div className="preview-stage" ref={stageRef} style={{ background: 'transparent' }}>
        <div className="preview-canvas" ref={canvasRef} />
      </div>
    );
  }

  return (
    <div
      className="preview-stage"
      ref={stageRef}
      onPointerMove={(e) => {
        const idx = hitTest(e);
        rendererRef.current?.setHover(Number.isNaN(idx) ? selectedIndex : idx);
      }}
      onPointerLeave={() => rendererRef.current?.setHover(selectedIndex)}
      onClick={(e) => {
        const idx = hitTest(e);
        if (Number.isNaN(idx)) return onSelect?.(null);
        if (idx === NONE || idx === PARENT) return onUp?.();
        const item = items[idx];
        if (!item) return;
        if (item.id === selectedId && item.action.type === 'submenu') ops.enterSubmenu(item.id);
        else onSelect?.(item.id);
      }}
      onDoubleClick={(e) => {
        const idx = hitTest(e);
        const item = idx >= 0 ? items[idx] : undefined;
        if (item?.action.type === 'submenu') ops.enterSubmenu(item.id);
      }}
    >
      <div className="preview-canvas" ref={canvasRef} />
    </div>
  );
}
