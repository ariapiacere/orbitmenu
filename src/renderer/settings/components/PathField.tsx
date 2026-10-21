import type { PickKind } from '@shared/ipc';
import { api } from '../api';
import { Button, TextInput } from './ui';

interface Props {
  value: string;
  onChange: (v: string) => void;
  kinds: { kind: PickKind; label: string; icon: string }[];
  placeholder?: string;
  invalid?: boolean;
  ariaLabel?: string;
}

/** Path input with one or more "Browse" buttons that open native file dialogs. */
export function PathField({ value, onChange, kinds, placeholder, invalid, ariaLabel }: Props) {
  const browse = async (kind: PickKind, title: string) => {
    const picked = await api().pickPath({ kind, title, defaultPath: value || undefined });
    if (picked) onChange(picked);
  };
  return (
    <div className="input-row">
      <TextInput className="mono" value={value} onChange={onChange} placeholder={placeholder} invalid={invalid} aria-label={ariaLabel} />
      {kinds.map((k) => (
        <Button key={k.kind} icon={k.icon} onClick={() => void browse(k.kind, k.label)} title={k.label}>
          {kinds.length > 1 ? k.label.replace('Choose ', '') : 'Browse'}
        </Button>
      ))}
    </div>
  );
}
