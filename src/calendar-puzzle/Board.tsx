import { useDraggable } from '@dnd-kit/core';
import { bounds, columns, geometry, PieceFace, rows } from './wood';
import type { Cell, Placement, Snapshot } from './wood';
import type { CSSProperties, PointerEvent, RefObject } from 'react';
import type { WoodSkin } from './session';

type PieceEvents = {
  focus: (id: string) => void;
  press: (event: PointerEvent<HTMLButtonElement>, piece: Placement) => boolean;
};
type Preview = { piece: Placement; anchor: Cell; legal: boolean; pointer?: { x: number; y: number; size: number; grab: Cell } };

function cellStyle(x: number, y: number, w = 1, h = 1): CSSProperties {
  return { left: `${x / columns * 100}%`, top: `${y / rows * 100}%`,
    width: `${w / columns * 100}%`, height: `${h / rows * 100}%` };
}

export function WorkPiece({ piece, skin, disabled, hidden, selected, events, style }: {
  piece: Placement; skin: WoodSkin; disabled: boolean; hidden: boolean;
  selected: boolean; events: PieceEvents; style: CSSProperties;
}) {
  const { setNodeRef, listeners } = useDraggable({ id: piece.id, disabled });
  const { width, height } = bounds(piece.cells);
  return <button type="button" ref={setNodeRef} className="cal-piece" data-piece={piece.id}
    data-rotation={piece.rotation} data-flipped={piece.flipped} data-placed={Boolean(piece.anchor)}
    data-lifted={hidden} style={style} disabled={disabled} aria-label={`拼图块 ${piece.id}`}
    aria-pressed={selected} onFocus={() => events.focus(piece.id)} onPointerDown={event => {
      if (events.press(event, piece)) listeners?.onPointerDown?.(event);
    }} onContextMenu={event => event.preventDefault()}>
    <PieceFace piece={piece} skin={skin} />
    {piece.cells.map(([x, y]) => <span className="cal-piece-hit" aria-hidden="true" key={`${x},${y}`}
      style={{ left: `${x / width * 100}%`, top: `${y / height * 100}%`, width: `${100 / width}%`, height: `${100 / height}%` }} />)}
  </button>;
}

export function Board({ board, snapshot, skin, enabled, selection, preview, events, aimAt }: {
  board: RefObject<HTMLDivElement | null>; snapshot: Snapshot; skin: WoodSkin;
  enabled: boolean; selection: string | null; preview: Preview | null;
  events: PieceEvents; aimAt: (anchor: Cell) => void;
}) {
  const targets = new Set(snapshot.targets.map(cell => cell.join(',')));
  return <div className="cal-board" data-wood={skin} aria-label="日历拼图棋盘">
    <div className="cal-board-title" aria-hidden="true">日历拼图</div>
    <div className="cal-grid" ref={board} style={{ aspectRatio: `${columns} / ${rows}` }}>
      {geometry.cellLabels.map(({ x, y, type, text }) => <div
        key={`${x},${y}`} data-cell={`${x},${y}`} data-type={type} data-target={targets.has(`${x},${y}`)}
        style={cellStyle(x, y)} className="cal-cell" onClick={() => aimAt([x, y])}>{text}</div>)}
      {preview?.piece.cells.map(([x, y]) => {
        const [sx, sy] = [x + preview.anchor[0], y + preview.anchor[1]];
        return <div key={`${x},${y}`} className="cal-candidate" data-legal={preview.legal}
          data-candidate-cell={`${sx},${sy}`} aria-hidden="true" style={cellStyle(sx, sy)} />;
      })}
      {snapshot.pieces.filter(piece => piece.anchor).map(piece => {
        const { width, height } = bounds(piece.cells);
        return <WorkPiece key={piece.id} piece={piece} skin={skin} disabled={!enabled}
          hidden={preview?.piece.id === piece.id && Boolean(preview.pointer)} selected={selection === piece.id}
          events={events} style={cellStyle(...piece.anchor!, width, height)} />;
      })}
    </div>
    <div className="cal-board-motto" aria-hidden="true">每天都要拼一拼</div>
  </div>;
}

export function Tray({ snapshot, enabled, selection, preview, skin, events }: {
  snapshot: Snapshot; enabled: boolean; selection: string | null; preview: Preview | null;
  skin: WoodSkin; events: PieceEvents;
}) {
  return <div className="cal-tray">
    {snapshot.pieces.map(piece => {
      const { width, height } = bounds(piece.cells);
      return <div className="cal-slot" key={piece.id} data-empty={Boolean(piece.anchor)}>
        {!piece.anchor && <WorkPiece piece={piece} skin={skin} disabled={!enabled}
          hidden={preview?.piece.id === piece.id && Boolean(preview.pointer)} selected={selection === piece.id}
          events={events} style={{ '--piece-w': width, '--piece-h': height } as CSSProperties} />}
      </div>;
    })}
  </div>;
}

export function LiftedPiece({ preview, skin }: { preview: Preview | null; skin: WoodSkin }) {
  if (!preview?.pointer) return null;
  const { x, y, size, grab } = preview.pointer;
  const { width, height } = bounds(preview.piece.cells);
  return <div className="cal-lifted" aria-hidden="true" style={{
    transform: `translate3d(${x - size * grab[0]}px,${y - size * grab[1]}px,0)`,
    width: width * size, height: height * size,
  }}><PieceFace piece={preview.piece} skin={skin} /></div>;
}
