/**
 * Terminal output helpers: ANSI color (honouring `NO_COLOR` and non-TTY output)
 * plus column-aligned table and JSON rendering — no external dependencies.
 */

/** Color is on only for a real TTY with `NO_COLOR` unset. */
const COLOR = process.env.NO_COLOR === undefined && process.stdout.isTTY === true;

function wrap(code: string, text: string): string {
  return COLOR ? `[${code}m${text}[0m` : text;
}

export const bold = (t: string): string => wrap('1', t);
export const dim = (t: string): string => wrap('2', t);
export const red = (t: string): string => wrap('31', t);
export const green = (t: string): string => wrap('32', t);
export const cyan = (t: string): string => wrap('36', t);

/** Pretty-print a value as JSON to stdout. */
export function printJson(value: unknown): void {
  process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

/** Visible width of a string, ignoring ANSI escape sequences. */
function visibleWidth(text: string): number {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\[[0-9;]*m/g, '').length;
}

function pad(text: string, width: number): string {
  return text + ' '.repeat(Math.max(0, width - visibleWidth(text)));
}

/**
 * Render a simple left-aligned table. Column widths fit the widest cell; the
 * header row is emphasized. The final column is not padded (no trailing space).
 */
export function printTable(headers: string[], rows: string[][]): void {
  const widths = headers.map((h, col) =>
    Math.max(visibleWidth(h), ...rows.map((r) => visibleWidth(r[col] ?? ''))),
  );

  const render = (cells: string[]): string =>
    cells
      .map((cell, col) => (col === cells.length - 1 ? cell : pad(cell, widths[col] ?? 0)))
      .join('  ')
      .replace(/\s+$/, '');

  process.stdout.write(`${bold(render(headers))}\n`);
  for (const row of rows) {
    process.stdout.write(`${render(row)}\n`);
  }
}

/** Render key/value pairs as an aligned two-column list (used by `rp status`). */
export function printKeyValues(pairs: [string, string][]): void {
  const width = Math.max(0, ...pairs.map(([k]) => visibleWidth(k)));
  for (const [key, value] of pairs) {
    process.stdout.write(`${pad(bold(key), width)}  ${value}\n`);
  }
}
