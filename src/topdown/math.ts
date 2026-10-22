// 2D Vector & collision math utilities

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * clamp(t, 0, 1);
}

export function angleDist(a: number, b: number): number {
  let diff = (b - a) % (Math.PI * 2);
  if (diff < -Math.PI) diff += Math.PI * 2;
  if (diff > Math.PI) diff -= Math.PI * 2;
  return diff;
}

export function rotateAngle(current: number, target: number, maxStep: number): number {
  const diff = angleDist(current, target);
  if (Math.abs(diff) <= maxStep) return target;
  return current + Math.sign(diff) * maxStep;
}

export function dist(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  return Math.hypot(dx, dy);
}

export function pointInCircle(px: number, py: number, cx: number, cy: number, r: number): boolean {
  return dist(px, py, cx, cy) <= r;
}

export function circleCircleCollision(
  c1x: number,
  c1y: number,
  r1: number,
  c2x: number,
  c2y: number,
  r2: number
): boolean {
  return dist(c1x, c1y, c2x, c2y) < r1 + r2;
}

// Check circle against axis-aligned bounding box (tile or obstacle)
export function circleAABBCollision(
  cx: number,
  cy: number,
  r: number,
  rx: number,
  ry: number,
  rw: number,
  rh: number
): { hit: boolean; normalX: number; normalY: number; depth: number } {
  const nearestX = clamp(cx, rx, rx + rw);
  const nearestY = clamp(cy, ry, ry + rh);

  const dx = cx - nearestX;
  const dy = cy - nearestY;
  const d = Math.hypot(dx, dy);

  if (d === 0) {
    // Circle center inside box: push out along shortest axis
    const left = cx - rx;
    const right = rx + rw - cx;
    const top = cy - ry;
    const bottom = ry + rh - cy;
    const minEdge = Math.min(left, right, top, bottom);

    if (minEdge === left) return { hit: true, normalX: -1, normalY: 0, depth: left + r };
    if (minEdge === right) return { hit: true, normalX: 1, normalY: 0, depth: right + r };
    if (minEdge === top) return { hit: true, normalX: 0, normalY: -1, depth: top + r };
    return { hit: true, normalX: 0, normalY: 1, depth: bottom + r };
  }

  if (d < r) {
    return {
      hit: true,
      normalX: dx / d,
      normalY: dy / d,
      depth: r - d,
    };
  }

  return { hit: false, normalX: 0, normalY: 0, depth: 0 };
}
