import { useLayoutEffect, useRef } from 'react';
import geometry from './geometry.json';
import birch from './birch.webp';

export type Cell = [number, number];
export type Placement = {
  id: string;
  anchor: Cell | null;
  rotation: number;
  flipped: boolean;
  cells: Cell[];
};
export type Snapshot = {
  date: string;
  steps: number;
  complete: boolean;
  used: number;
  remaining: number;
  targets: Cell[];
  pieces: Placement[];
};

export const config = JSON.stringify(geometry);
export const versions = {
  boardVersion: geometry.boardVersion,
  pieceSetVersion: geometry.pieceSetVersion,
};
export const columns = Math.max(...geometry.boardMask.map(([x]) => x)) + 1;
export const rows = Math.max(...geometry.boardMask.map(([, y]) => y)) + 1;

export function bounds(cells: Cell[]) {
  return {
    width: Math.max(...cells.map(([x]) => x)) + 1,
    height: Math.max(...cells.map(([, y]) => y)) + 1,
  };
}

const unit = 72;
const inset = geometry.visualConfig.gapRatio * unit / 2;
const depth = geometry.visualConfig.depthRatio * unit;
const radius = geometry.visualConfig.bevelRatio * unit;
const texture = new Image();
texture.src = birch;
const key = ([x, y]: Cell) => `${x},${y}`;
const directions: Cell[] = [[1, 0], [0, 1], [-1, 0], [0, -1]];

function outline(cells: Cell[]) {
  const occupied = new Set(cells.map(key));
  const edges = new Map<string, Array<{ start: Cell; dir: number }>>();
  for (const [x, y] of cells) {
    const corners: Cell[] = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
    for (let dir = 0; dir < 4; dir++) {
      const [dx, dy] = directions[(dir + 3) % 4];
      if (occupied.has(key([x + dx, y + dy]))) continue;
      const start = corners[dir];
      const existing = edges.get(key(start)) ?? [];
      existing.push({ start, dir });
      edges.set(key(start), existing);
    }
  }
  const path = new Path2D();
  while (edges.size) {
    const first = edges.values().next().value![0];
    let current = first;
    const vertices: Array<{ from: number; to: number; point: Cell }> = [];
    for (;;) {
      const outgoing = edges.get(key(current.start))!;
      outgoing.splice(outgoing.indexOf(current), 1);
      if (!outgoing.length) edges.delete(key(current.start));
      const [dx, dy] = directions[current.dir];
      const end: Cell = [current.start[0] + dx, current.start[1] + dy];
      const nextEdges = edges.get(key(end)) ?? [];
      const closed = key(end) === key(first.start);
      const next = closed ? first : [1, 0, 3, 2]
        .map(turn => nextEdges.find(edge => edge.dir === (current.dir + turn) % 4))
        .find(Boolean);
      if (!next) break;
      if (next.dir !== current.dir) vertices.push({ from: current.dir, to: next.dir, point: end });
      if (closed) break;
      current = next;
    }
    vertices.forEach(({ from, to, point: [x, y] }, i) => {
      const [dx, dy] = directions[from];
      const [ex, ey] = directions[to];
      const px = x * unit - inset * (dy + ey);
      const py = y * unit + inset * (dx + ex);
      const start: Cell = [px - dx * radius, py - dy * radius];
      if (i === 0) path.moveTo(...start);
      else path.lineTo(...start);
      path.quadraticCurveTo(px, py, px + ex * radius, py + ey * radius);
    });
    path.closePath();
  }
  return path;
}

const sides = { natural: '#a47045', honey: '#966027', cherry: '#85422e', walnut: '#54372c' };
const tones = { natural: '', honey: '#b96e2f', cherry: '#9b523d', walnut: '#574031' };
type Skin = keyof typeof sides;
const silhouettes = new Map<string, Path2D>();

export function PieceFace({ piece, skin, shadow = true }: {
  piece: Placement; skin: Skin; shadow?: boolean;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const { width, height } = bounds(piece.cells);
  const logicalWidth = width * unit;
  const logicalHeight = height * unit;

  useLayoutEffect(() => {
    function draw() {
      const surface = canvas.current;
      const ctx = surface?.getContext('2d');
      if (!ctx || !surface) return;
      const base = geometry.pieceDefinitions.find(item => item.id === piece.id)!;
      const original = bounds(base.cells as Cell[]);
      const shapeKey = piece.cells.map(key).join('/');
      let path = silhouettes.get(shapeKey);
      if (!path) {
        path = outline(piece.cells);
        silhouettes.set(shapeKey, path);
      }
      const seed = piece.id.codePointAt(0)!;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, surface.width, surface.height);
      ctx.save();
      ctx.translate(0, depth * 0.75);
      ctx.fillStyle = sides[skin];
      ctx.fill(path, 'evenodd');
      ctx.restore();
      ctx.save();
      ctx.clip(path, 'evenodd');
      ctx.fillStyle = '#e2be91';
      ctx.fillRect(0, 0, logicalWidth, logicalHeight);
      if (texture.complete && texture.naturalWidth) {
        ctx.save();
        ctx.translate(logicalWidth / 2, logicalHeight / 2);
        ctx.rotate(piece.rotation * Math.PI / 2);
        ctx.scale(piece.flipped ? -1 : 1, 1);
        const w = original.width * unit;
        const h = original.height * unit;
        ctx.drawImage(texture, (seed * 93) % 390, (seed * 131 + (piece.flipped ? 161 : 0)) % 380,
          w * 1.25, h * 1.25, -w / 2, -h / 2, w, h);
        ctx.restore();
      }
      if (tones[skin]) {
        ctx.fillStyle = tones[skin] + (skin === 'walnut' ? 'c4' : '70');
        ctx.fillRect(0, 0, logicalWidth, logicalHeight);
      }
      ctx.fillStyle = ['#fff4d319', '#a65c2315', '#a84e271d'][seed % 3];
      ctx.fillRect(0, 0, logicalWidth, logicalHeight);
      const light = ctx.createLinearGradient(0, 0, logicalWidth * 0.3, logicalHeight);
      light.addColorStop(0, '#fff7dc59');
      light.addColorStop(1, '#90501a21');
      ctx.fillStyle = light;
      ctx.fillRect(0, 0, logicalWidth, logicalHeight);
      const edge = ctx.createLinearGradient(0, 0, 0, logicalHeight);
      edge.addColorStop(0, '#fff4cbb8');
      edge.addColorStop(0.55, '#e7bf8c75');
      edge.addColorStop(1, '#9b633453');
      ctx.strokeStyle = edge;
      ctx.lineWidth = 4.5;
      ctx.stroke(path);
      ctx.restore();
    }
    draw();
    texture.addEventListener('load', draw);
    return () => texture.removeEventListener('load', draw);
  }, [piece, skin, logicalWidth, logicalHeight]);

  return <canvas aria-hidden="true" ref={canvas} width={logicalWidth} height={logicalHeight + Math.ceil(depth)}
    className={shadow ? 'cal-piece-face cal-piece-shadow' : 'cal-piece-face'}
    style={{ height: `${100 * (logicalHeight + Math.ceil(depth)) / logicalHeight}%` }} />;
}

export { geometry };
