/**
 * Layout geometry types for the terminal UI rendering framework.
 * Pure data types for positions, sizes, and rectangles.
 */

export interface Point {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Create a point at (x, y) */
export function point(x: number, y: number): Point {
  return { x, y };
}

/** Create a size with given dimensions */
export function size(width: number, height: number): Size {
  return { width, height };
}

/** Create a zero-size rect at origin */
export function zeroRect(): Rect {
  return { x: 0, y: 0, width: 0, height: 0 };
}

/** Create a rect from position and size */
export function rectFrom(position: Point, dims: Size): Rect {
  return { ...position, ...dims };
}

/** Check if a point is inside a rect */
export function rectContains(r: Rect, p: Point): boolean {
  return (
    p.x >= r.x &&
    p.x < r.x + r.width &&
    p.y >= r.y &&
    p.y < r.y + r.height
  );
}

/** Return a new rect inset by the given amounts */
export function rectInset(
  r: Rect,
  top: number,
  right: number,
  bottom: number,
  left: number,
): Rect {
  return {
    x: r.x + left,
    y: r.y + top,
    width: Math.max(0, r.width - left - right),
    height: Math.max(0, r.height - top - bottom),
  };
}
