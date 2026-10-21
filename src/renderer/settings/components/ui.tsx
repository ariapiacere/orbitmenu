// Small, dependency-free UI primitives for the editor.
import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import type { ActionConfig, IconSpec } from '@shared/types';
import type { Issue } from '@shared/validation';
import { lucideSvg, renderIcon } from '../../common/icons';
import { useEditor } from '../store';

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(' ');
}

export function Icon({ name, size = 16, stroke = 1.8, className }: { name: string; size?: number; stroke?: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    ref.current?.replaceChildren(lucideSvg(name, stroke) ?? '');
  }, [name, stroke]);
  return <span ref={ref} className={cx('ui-icon', className)} style={{ width: size, height: size }} aria-hidden="true" />;
}

/** Renders an item icon exactly as the overlay would (lucide, emoji, image, shell icon). */
export function ItemIcon({ spec, action, label, className }: { spec: IconSpec; action?: ActionConfig; label?: string; className?: string }) {
  const resolved = useEditor((s) => s.icons);
  const ref = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    ref.current?.replaceChildren(renderIcon(spec, { resolved, action, label }));
  }, [spec, action, label, resolved]);
  return <span ref={ref} className={className} aria-hidden="true" />;
}

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: string;
  variant?: 'primary' | 'ghost' | 'danger' | 'default';
  small?: boolean;
}

export function Button({ icon, variant = 'default', small, children, className, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={cx('btn', variant !== 'default' && variant, small && 'small', !children && 'icon-only', className)}
      {...rest}
    >
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

export function Field({ label, hint, aside, children, className }: { label?: ReactNode; hint?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('field', className)}>
      {(label || aside) && (
        <span className="field-label">
          <span>{label}</span>
          {aside}
        </span>
      )}
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function Switch({ checked, onChange, label, description, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: ReactNode; description?: ReactNode; disabled?: boolean }) {
  return (
    <label className="switch" style={disabled ? { opacity: 0.5, pointerEvents: 'none' } : undefined}>
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} disabled={disabled} />
      <span className="switch-track" />
      {(label || description) && (
        <span className="switch-text">
          {label && <span>{label}</span>}
          {description && <small>{description}</small>}
        </span>
      )}
    </label>
  );
}

export function Segmented<T extends string>({ value, options, onChange }: { value: T; options: { value: T; label: string; icon?: string }[]; onChange: (v: T) => void }) {
  return (
    <div className="segmented" role="radiogroup">
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={o.value === value} className={cx(o.value === value && 'is-active')} onClick={() => onChange(o.value)}>
          {o.icon && <Icon name={o.icon} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Slider({ label, value, min, max, step = 1, unit = '', hint, onChange, format }: { label: ReactNode; value: number; min: number; max: number; step?: number; unit?: string; hint?: ReactNode; onChange: (v: number) => void; format?: (v: number) => string }) {
  const id = useId();
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        <span>{label}</span>
      </label>
      <div className="slider-row">
        <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
        <span className="slider-value">{format ? format(value) : `${value}${unit}`}</span>
      </div>
      {hint && <span className="field-hint">{hint}</span>}
    </div>
  );
}

export function Badge({ kind, icon, children }: { kind?: 'ok' | 'warn' | 'danger' | 'accent'; icon?: string; children: ReactNode }) {
  return (
    <span className={cx('badge', kind)}>
      {icon && <Icon name={icon} />}
      {children}
    </span>
  );
}

export function Callout({ kind, icon = 'Info', children }: { kind?: 'warn' | 'danger'; icon?: string; children: ReactNode }) {
  return (
    <div className={cx('callout', kind)}>
      <Icon name={icon} />
      <div>{children}</div>
    </div>
  );
}

export function Issues({ issues }: { issues: Issue[] }) {
  if (!issues.length) return null;
  return (
    <div className="issues">
      {issues.map((i, n) => (
        <Callout key={n} kind={i.level === 'error' ? 'danger' : 'warn'} icon={i.level === 'error' ? 'CircleAlert' : 'TriangleAlert'}>
          {i.message}
        </Callout>
      ))}
    </div>
  );
}

export function Keys({ combo }: { combo: string }) {
  if (!combo) return <span className="muted">—</span>;
  return (
    <span className="keys">
      {combo.split('+').filter(Boolean).map((k, i) => (
        <kbd key={i} className="key">
          {k === 'Super' ? 'Win' : k}
        </kbd>
      ))}
    </span>
  );
}

/** A text input that keeps local state while typing and commits on every change. */
export function TextInput({ value, onChange, className, invalid, ...rest }: Omit<React.InputHTMLAttributes<HTMLInputElement>, 'onChange' | 'value'> & { value: string; onChange: (v: string) => void; invalid?: boolean }) {
  return <input {...rest} className={cx('input', invalid && 'invalid', className)} value={value} onChange={(e) => onChange(e.target.value)} spellCheck={false} />;
}

/** Floating panel anchored to an element, closed by clicking outside or Escape. */
export function Popover({ anchor, onClose, children, width = 380 }: { anchor: HTMLElement | null; onClose: () => void; children: ReactNode; width?: number }) {
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  useLayoutEffect(() => {
    if (!anchor) return;
    const r = anchor.getBoundingClientRect();
    const left = Math.min(Math.max(8, r.left), window.innerWidth - width - 8);
    const below = r.bottom + 6;
    const top = below + 420 > window.innerHeight ? Math.max(48, r.top - 6 - Math.min(520, window.innerHeight - 100)) : below;
    setPos({ left, top });
  }, [anchor, width]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  if (!pos) return null;
  return createPortal(
    <>
      <div className="popover-backdrop" onMouseDown={onClose} />
      <div className="popover" style={{ left: pos.left, top: pos.top, width }}>
        {children}
      </div>
    </>,
    document.body,
  );
}
