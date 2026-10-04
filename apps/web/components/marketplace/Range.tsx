"use client";

export function Range({ label, value, min, max, step = 1, onChange, format = String, hint }: {
  label: string; value: number; min: number; max: number; step?: number;
  onChange: (v: number) => void; format?: (v: number) => string; hint?: string;
}) {
  const p = max > min ? ((value - min) / (max - min)) * 100 : 100;
  return (
    <label className="mp-range">
      <div className="mp-range-top"><span className="mp-label">{label}</span><b>{format(value)}</b></div>
      <input
        type="range" min={min} max={max} step={step} value={value}
        style={{ "--p": `${p}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <div className="mp-range-ends"><span>{format(min)}</span>{hint && <span>{hint}</span>}<span>{format(max)}</span></div>
    </label>
  );
}
