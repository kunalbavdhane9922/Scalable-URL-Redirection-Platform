import { useMemo, useState } from 'react';

const WIDTH = 720;
const HEIGHT = 240;
const PAD = { top: 18, right: 16, bottom: 34, left: 42 };

function localKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * API day buckets are already `YYYY-MM-DD` (or ISO midnight UTC). Only Date
 * objects are normalised locally, so a positive UTC offset cannot shift the
 * key by a day (which previously hid today's clicks).
 */
function rowKey(value) {
  if (value instanceof Date) return localKey(value);
  const match = /^(\d{4}-\d{2}-\d{2})/.exec(String(value ?? ''));
  return match ? match[1] : '';
}

function buildSeries(rows) {
  const byDate = new Map(
    (rows || []).map((row) => [rowKey(row.date), Number(row.clicks) || 0]),
  );
  const days = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  for (let i = 13; i >= 0; i -= 1) {
    const day = new Date(today);
    day.setDate(today.getDate() - i);
    const key = localKey(day);
    days.push({
      key,
      label: day.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
      clicks: byDate.get(key) || 0,
    });
  }
  return days;
}

export default function ClicksChart({ rows }) {
  const data = useMemo(() => buildSeries(rows), [rows]);
  const [hover, setHover] = useState(null);

  const max = Math.max(4, ...data.map((d) => d.clicks));
  const innerW = WIDTH - PAD.left - PAD.right;
  const innerH = HEIGHT - PAD.top - PAD.bottom;
  const step = innerW / (data.length - 1);

  const points = data.map((d, i) => ({
    ...d,
    x: PAD.left + i * step,
    y: PAD.top + innerH - (d.clicks / max) * innerH,
  }));

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L${points[points.length - 1].x},${PAD.top + innerH} L${points[0].x},${PAD.top + innerH} Z`;

  const ticks = [0, 0.5, 1].map((f) => Math.round(max * f));

  return (
    <div className="chart">
      <div className="chart-head">
        <div>
          <h3>Clicks, last 14 days</h3>
          <p className="muted">Aggregated asynchronously from redirect events.</p>
        </div>
        <div className="chart-total">
          <strong>{data.reduce((sum, d) => sum + d.clicks, 0).toLocaleString()}</strong>
          <span>in range</span>
        </div>
      </div>

      <div className="chart-plot">
        <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} role="img" aria-label="Clicks over the last 14 days">
          <defs>
            <linearGradient id="clicksFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#6366f1" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#6366f1" stopOpacity="0" />
            </linearGradient>
          </defs>

          {ticks.map((tick, i) => {
            const y = PAD.top + innerH - (tick / max) * innerH;
            return (
              <g key={tick + i}>
                <line x1={PAD.left} x2={WIDTH - PAD.right} y1={y} y2={y} className="chart-gridline" />
                <text x={PAD.left - 10} y={y + 4} textAnchor="end" className="chart-axis">{tick}</text>
              </g>
            );
          })}

          <path d={area} fill="url(#clicksFill)" />
          <path d={line} className="chart-line" />

          {points.map((p) => (
            <g key={p.key}>
              <rect
                x={p.x - step / 2}
                y={PAD.top}
                width={step}
                height={innerH}
                fill="transparent"
                onMouseEnter={() => setHover(p)}
                onMouseLeave={() => setHover(null)}
              />
              {hover?.key === p.key ? (
                <line x1={p.x} x2={p.x} y1={PAD.top} y2={PAD.top + innerH} className="chart-hover-line" />
              ) : null}
              <circle cx={p.x} cy={p.y} r={hover?.key === p.key ? 5 : 3} className="chart-dot" />
              <text x={p.x} y={HEIGHT - 12} textAnchor="middle" className="chart-axis">
                {p.label}
              </text>
            </g>
          ))}
        </svg>

        {hover ? (
          <div
            className="chart-tooltip"
            style={{
              left: `${(hover.x / WIDTH) * 100}%`,
              top: `${(hover.y / HEIGHT) * 100}%`,
            }}
          >
            <strong>{hover.clicks.toLocaleString()} clicks</strong>
            <span>{hover.label}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}
