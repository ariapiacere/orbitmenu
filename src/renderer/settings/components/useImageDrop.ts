// Drag-and-drop of image files (from Explorer, a browser, or another app)
// onto an icon. The bytes go to the main process, which checks the content,
// stores a copy in OrbitMenu's icon folder and returns the reference.
import { useRef, useState } from 'react';
import type { IconSpec } from '@shared/types';
import { api } from '../api';
import { useEditor } from '../store';

const MAX_BYTES = 2 * 1024 * 1024;

function carriesFiles(e: React.DragEvent): boolean {
  return Array.from(e.dataTransfer.types).includes('Files');
}

export interface ImageDropHandlers {
  onDragEnter: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragLeave: (e: React.DragEvent) => void;
  onDrop: (e: React.DragEvent) => void;
}

/** Handlers for an element that accepts a dropped image, plus whether one is over it. */
export function useImageDrop(onIcon: (icon: IconSpec) => void): { over: boolean; busy: boolean; handlers: ImageDropHandlers } {
  const [over, setOver] = useState(false);
  const [busy, setBusy] = useState(false);
  // dragenter/dragleave fire for every child element; count to know when the pointer really left.
  const depth = useRef(0);
  const toast = useEditor((s) => s.toast);

  const handlers: ImageDropHandlers = {
    onDragEnter: (e) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      depth.current++;
      setOver(true);
    },
    onDragOver: (e) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    },
    onDragLeave: (e) => {
      if (!carriesFiles(e)) return;
      depth.current = Math.max(0, depth.current - 1);
      if (depth.current === 0) setOver(false);
    },
    onDrop: (e) => {
      if (!carriesFiles(e)) return;
      e.preventDefault();
      e.stopPropagation();
      depth.current = 0;
      setOver(false);
      const file = Array.from(e.dataTransfer.files)[0];
      if (!file) return;
      if (file.size > MAX_BYTES) {
        toast('The image is larger than 2 MB.', 'error');
        return;
      }
      setBusy(true);
      void file
        .arrayBuffer()
        .then((buf) => api().importIconData(new Uint8Array(buf)))
        .then((r) => {
          if (r.path) onIcon({ kind: 'image', path: r.path });
          else if (r.error) toast(r.error, 'error');
        })
        .catch((err: unknown) => toast(`Could not read the dropped file: ${(err as Error).message}`, 'error'))
        .finally(() => setBusy(false));
    },
  };
  return { over, busy, handlers };
}
