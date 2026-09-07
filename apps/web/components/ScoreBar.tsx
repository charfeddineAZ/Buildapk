export function ScoreBar({ label, value }: { label: string; value: number }) {
  const color = value >= 85 ? "bg-emerald-400" : value >= 60 ? "bg-amber-400" : "bg-rose-400";
  return (
    <div className="mb-2">
      <div className="flex justify-between text-xs text-slate-300">
        <span>{label}</span>
        <span className="tabular-nums">{value}</span>
      </div>
      <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-white/10">
        <div className={`h-full ${color}`} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}
