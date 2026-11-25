import { useCallback, useEffect, useRef, useState } from 'react';
import { PointerSensor, useSensor, useSensors } from '@dnd-kit/core';
import type { DragStartEvent } from '@dnd-kit/core';
import type { PointerEvent as ReactPointerEvent, RefObject } from 'react';
import type { Puzzle } from '../generated/calendar-puzzle/calendar_puzzle.js';
import { bounds, columns, rows } from './wood';
import type { Cell, Placement, Snapshot } from './wood';
import type { WoodSound } from './sound';

type Preview = {
  piece: Placement;
  anchor: Cell;
  legal: boolean;
  pointer?: { x: number; y: number; size: number; grab: Cell };
};
type Press = {
  id: string; pointerId: number; x: number; y: number; grab: Cell;
  kind: 'press' | 'hold' | 'drag'; timer: number;
};

const arrows: Record<string, Cell> = {
  ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0],
};

export function usePuzzleInput({
  board, engine, snapshot, enabled, sound, enableSound, commit, notify,
}: {
  board: RefObject<HTMLDivElement | null>;
  engine: Puzzle;
  snapshot: Snapshot;
  enabled: boolean;
  sound: WoodSound;
  enableSound: () => void;
  commit: (message?: string) => void;
  notify: (message: string) => void;
}) {
  const [selection, setSelection] = useState<string | null>(null);
  const [preview, renderPreview] = useState<Preview | null>(null);
  const current = useRef<Preview | null>(null);
  const press = useRef<Press | null>(null);
  const lastMove = useRef({ x: 0, y: 0, at: 0 });
  const pointer = useRef<Cell>([0, 0]);
  const scrollFrame = useRef(0);
  const rotated = (piece: Placement, flip: boolean) => {
    const rotation = flip ? (4 - piece.rotation) % 4 : (piece.rotation + 1) % 4;
    const flipped = flip ? !piece.flipped : piece.flipped;
    return { ...piece, rotation, flipped, cells: JSON.parse(engine.oriented(piece.id, rotation, flipped)) as Cell[] };
  };

  const show = useCallback((value: Preview | null) => {
    current.current = value;
    renderPreview(value);
  }, []);

  const cancel = useCallback(() => {
    window.clearTimeout(press.current?.timer);
    press.current = null;
    window.cancelAnimationFrame(scrollFrame.current);
    scrollFrame.current = 0;
    show(null);
    sound.stop();
  }, [show, sound]);

  const clear = useCallback(() => {
    cancel();
    setSelection(null);
  }, [cancel]);

  function select(id: string) {
    if (current.current && current.current.piece.id !== id && !current.current.pointer) show(null);
    setSelection(id);
  }

  function candidate(piece: Placement, anchor: Cell, pointer?: Preview['pointer']) {
    const [x, y] = anchor;
    return {
      piece, anchor, pointer,
      legal: engine.fits(piece.id, x, y, piece.rotation, piece.flipped),
    };
  }

  function dragCandidate(piece: Placement, x: number, y: number, grab: Cell) {
    const rect = board.current?.getBoundingClientRect();
    if (!rect) return;
    const size = rect.width / columns;
    const anchor: Cell = [Math.round((x - rect.left) / size - grab[0]), Math.round((y - rect.top) / size - grab[1])];
    const draft = candidate(piece, anchor, { x, y, size, grab });
    draft.legal &&= x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
    show(draft);
  }

  function orient(id: string | null, flip: boolean) {
    if (!enabled || !id) return;
    const active = current.current;
    if (active?.piece.id === id) {
      const piece = rotated(active.piece, flip);
      if (active.pointer) {
        const { x, y, grab } = active.pointer;
        const { width, height } = bounds(active.piece.cells);
        const nextGrab: Cell = flip ? [width - grab[0], grab[1]] : [height - grab[1], grab[0]];
        if (press.current) press.current.grab = nextGrab;
        dragCandidate(piece, x, y, nextGrab);
      } else show(candidate(piece, active.anchor));
      return;
    }
    const piece = snapshot.pieces.find(item => item.id === id);
    if (!piece) return;
    const result = rotated(piece, flip);
    if (engine.orient(id, result.rotation, result.flipped)) {
      sound.tap();
      commit(flip ? '已翻转' : '已顺时针旋转');
    } else notify('原地调整会碰到边界或其他拼图块。');
  }

  function handlePress(event: ReactPointerEvent<HTMLButtonElement>, piece: Placement) {
    if (!enabled || !event.isPrimary || event.button !== 0) return false;
    enableSound();
    cancel();
    select(piece.id);
    const rect = event.currentTarget.getBoundingClientRect();
    const { width, height } = bounds(piece.cells);
    const next: Press = {
      id: piece.id, pointerId: event.pointerId, x: event.clientX, y: event.clientY,
      grab: [(event.clientX - rect.left) / rect.width * width, (event.clientY - rect.top) / rect.height * height],
      kind: 'press', timer: 0,
    };
    next.timer = window.setTimeout(() => {
      if (press.current === next && next.kind === 'press') {
        next.kind = 'hold';
        orient(piece.id, true);
      }
    }, 450);
    pointer.current = [next.x, next.y];
    press.current = next;
    return true;
  }

  function handlePointerUp(event: PointerEvent) {
    const active = press.current;
    if (active?.pointerId !== event.pointerId || active.kind === 'drag') return;
    const wasClick = active.kind === 'press' && Math.hypot(event.clientX - active.x, event.clientY - active.y) <= 8;
    cancel();
    if (wasClick) orient(active.id, false);
  }

  useEffect(() => {
    window.addEventListener('pointerup', handlePointerUp);
    return () => window.removeEventListener('pointerup', handlePointerUp);
  });

  useEffect(() => {
    function readPointer(event: PointerEvent) {
      if (event.pointerId === press.current?.pointerId) pointer.current = [event.clientX, event.clientY];
    }
    function stopPointer(event: PointerEvent) {
      if (event.pointerId === press.current?.pointerId) cancel();
    }
    window.addEventListener('pointermove', readPointer, true);
    window.addEventListener('pointerup', readPointer, true);
    window.addEventListener('pointercancel', stopPointer, true);
    window.addEventListener('blur', cancel);
    return () => {
      window.removeEventListener('pointermove', readPointer, true);
      window.removeEventListener('pointerup', readPointer, true);
      window.removeEventListener('pointercancel', stopPointer, true);
      window.removeEventListener('blur', cancel);
      window.clearTimeout(press.current?.timer);
      window.cancelAnimationFrame(scrollFrame.current);
      sound.stop();
    };
  }, [cancel, sound]);

  function onDragStart({ active }: DragStartEvent) {
    const pending = press.current;
    const piece = snapshot.pieces.find(item => item.id === active.id);
    if (!enabled || pending?.kind !== 'press' || !piece) return;
    window.clearTimeout(pending.timer);
    pending.kind = 'drag';
    lastMove.current = { x: pending.x, y: pending.y, at: performance.now() };
    dragCandidate(piece, ...pointer.current, pending.grab);
    function followScroll() {
      const dragging = press.current;
      const active = current.current;
      if (dragging?.kind !== 'drag' || !active) return;
      const [x, y] = pointer.current;
      const margin = 52;
      const direction = y < margin ? y - margin : Math.max(0, y - (window.innerHeight - margin));
      if (direction) {
        const before = window.scrollY;
        window.scrollBy(0, Math.max(-12, Math.min(12, direction * 0.25)));
        if (window.scrollY !== before) dragCandidate(active.piece, x, y, dragging.grab);
      }
      scrollFrame.current = window.requestAnimationFrame(followScroll);
    }
    scrollFrame.current = window.requestAnimationFrame(followScroll);
  }

  function onDragMove() {
    const pending = press.current;
    const active = current.current;
    if (!enabled || pending?.kind !== 'drag' || !active) return;
    const [x, y] = pointer.current;
    const now = performance.now();
    const prior = lastMove.current;
    const speed = Math.hypot(x - prior.x, y - prior.y) / Math.max(now - prior.at, 8);
    lastMove.current = { x, y, at: now };
    sound.slide(speed * 7);
    dragCandidate(active.piece, x, y, pending.grab);
  }

  function onDragEnd() {
    if (enabled && press.current?.kind === 'drag') {
      onDragMove();
      const active = current.current;
      cancel();
      if (!active) return;
      const { piece, anchor } = active;
      const success = active.legal
        ? engine.release(piece.id, piece.rotation, piece.flipped, ...anchor)
        : engine.release(piece.id, piece.rotation, piece.flipped);
      sound.tap();
      commit(success ? '已放入棋盘' : '拼图块已回到图库。');
    } else cancel();
  }

  function aimAt(anchor: Cell) {
    if (!enabled || current.current?.pointer) return;
    const piece = current.current?.piece ?? snapshot.pieces.find(item => item.id === selection);
    if (piece) show(candidate(piece, anchor));
  }

  function confirm() {
    const active = current.current;
    if (!enabled || !active || active.pointer) return;
    const { piece, anchor } = active;
    if (!engine.place(piece.id, ...anchor, piece.rotation, piece.flipped)) {
      notify('这个落点会碰到边界或其他拼图块。');
      return;
    }
    show(null);
    sound.tap();
    commit('已放入棋盘');
  }

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey) return;
      const active = current.current;
      if (event.key === 'Escape' && (press.current || active)) {
        cancel();
        return;
      }
      if (!enabled || !selection || event.target instanceof HTMLElement
          && event.target.closest('input, select, textarea, [contenteditable], dialog')) return;
      if (event.key.toLowerCase() === 'r' || event.key.toLowerCase() === 'f') {
        event.preventDefault();
        orient(selection, event.key.toLowerCase() === 'f');
      } else if (arrows[event.key] && !active?.pointer) {
        const piece = snapshot.pieces.find(item => item.id === selection);
        if (!piece) return;
        event.preventDefault();
        const [x, y] = active?.anchor ?? piece.anchor ?? [0, 0];
        const [dx, dy] = arrows[event.key];
        aimAt([Math.max(0, Math.min(columns - 1, x + dx)), Math.max(0, Math.min(rows - 1, y + dy))]);
      } else if (event.key === 'Enter' && !active?.pointer
          && !(event.target instanceof HTMLElement && event.target.closest('button:not([data-piece]), a'))) {
        event.preventDefault();
        if (active) confirm();
        else aimAt(snapshot.pieces.find(item => item.id === selection)?.anchor ?? [0, 0]);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 8 } }));
  return {
    preview, selection, select, clear, cancel, handlePress, aimAt, confirm, orient,
    dnd: { sensors, onDragStart, onDragMove, onDragEnd, onDragCancel: cancel },
  };
}
