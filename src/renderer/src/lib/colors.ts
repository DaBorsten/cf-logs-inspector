/** Deterministic, well-separated hue per app name so the same app always gets the same colour tag. */
export function appHue(name: string): number {
  let h = 2166136261;
  for (let i = 0; i < name.length; i++) {
    h ^= name.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Golden-angle spread keeps neighbouring hashes visually apart.
  return Math.abs(h % 360);
}

export function appColor(name: string): string {
  return `hsl(${appHue(name)} 65% 45%)`;
}

export function appColorSoft(name: string): string {
  return `hsl(${appHue(name)} 70% 92%)`;
}
