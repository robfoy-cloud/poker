// Chip denominations and how a pile of chips is made up.
// Colours follow the common casino convention.

export const DENOMS = [
  { v: 1, name: 'white', color: '#f4f1ea', edge: '#3b6fb6' },
  { v: 5, name: 'red', color: '#c8312b', edge: '#ffffff' },
  { v: 25, name: 'green', color: '#1f8a4c', edge: '#ffffff' },
  { v: 100, name: 'black', color: '#1d1d1f', edge: '#e8e8e8' },
  { v: 500, name: 'purple', color: '#6b3fa0', edge: '#f2d34b' },
];

// How a player's stack would realistically look: a working supply of small
// chips plus the rest in bigger ones. Returns counts per denomination (ascending).
export function stackComposition(amount, target = 10) {
  const counts = DENOMS.map(() => 0);
  let a = amount;
  for (let i = 0; i < DENOMS.length - 1; i++) {
    const d = DENOMS[i].v, next = DENOMS[i + 1].v;
    const per = next / d;
    const r = (a % next) / d; // chips needed to make the odd remainder
    let count = r;
    while (count + per <= target && (count + per) * d <= a) count += per;
    counts[i] = count;
    a -= count * d;
  }
  counts[DENOMS.length - 1] = a / DENOMS[DENOMS.length - 1].v;
  return counts;
}

// A bet pushed forward: fewest chips (what a player would actually slide out).
export function betComposition(amount) {
  const counts = DENOMS.map(() => 0);
  let a = amount;
  for (let i = DENOMS.length - 1; i >= 0; i--) {
    counts[i] = Math.floor(a / DENOMS[i].v);
    a -= counts[i] * DENOMS[i].v;
  }
  return counts;
}

export function totalOf(counts) {
  return counts.reduce((t, c, i) => t + c * DENOMS[i].v, 0);
}

// Break one chip of denomination index i into the next smaller denomination.
export function breakChip(counts, i) {
  if (i <= 0 || counts[i] <= 0) return false;
  counts[i]--;
  counts[i - 1] += DENOMS[i].v / DENOMS[i - 1].v;
  return true;
}

// HTML for chips seen edge-on: one column per colour, chips stacked up.
// size: 'lg' | 'md' | 'sm'
export function chipsHTML(counts, { size = 'md', interactive = false, maxPerColumn = 20, attr = '' } = {}) {
  let html = `<div class="chips chips-${size}" ${attr}>`;
  counts.forEach((n, i) => {
    if (!n) return;
    const d = DENOMS[i];
    let left = n;
    while (left > 0) {
      const inCol = Math.min(left, maxPerColumn);
      left -= inCol;
      html += `<div class="chipcol${interactive ? ' tap' : ''}" data-denom="${i}" title="${d.name}">`;
      for (let k = 0; k < inCol; k++) {
        html += `<span class="chip" style="--c:${d.color};--e:${d.edge}"></span>`;
      }
      html += `</div>`;
    }
  });
  html += `</div>`;
  return html;
}

export function legendHTML() {
  return `<div class="legend">` + DENOMS.map(d =>
    `<span class="legend-item"><span class="chip chip-face" style="--c:${d.color};--e:${d.edge}"></span>${d.name} = ${d.v}</span>`
  ).join('') + `</div>`;
}
