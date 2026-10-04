export const money = (cents: number, opts: { cents?: boolean } = {}) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency", currency: "USD",
    minimumFractionDigits: opts.cents ? 2 : 0, maximumFractionDigits: opts.cents ? 2 : 0,
  });

export const num = (n: number) => Math.round(n).toLocaleString("en-US");

export const plural = (n: number, one: string, many = `${one}s`) => `${num(n)} ${n === 1 ? one : many}`;
