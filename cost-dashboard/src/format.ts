// Money + number formatting helpers.

export function money(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// A price/rate that may be tiny (e.g. $0.0104/hr or $0.0000002/request): keep enough precision
// without trailing-zero noise. $0.0104, $0.096, $0.023, $2e-7 — not a rounded-to-cents $0.01.
export function rate(n: number): string {
  if (n === 0) return "$0";
  if (n >= 1) return `$${n.toFixed(2)}`;
  return `$${parseFloat(n.toPrecision(3))}`;
}

export function int(n: number): string {
  return n.toLocaleString("en-US");
}
