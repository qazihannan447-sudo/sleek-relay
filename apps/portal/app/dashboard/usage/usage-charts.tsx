import type { UsageNamedValue, UsageSeriesPoint } from '../../../lib/usage/types';

type LineChartProps = {
  points: UsageSeriesPoint[];
  valueSuffix?: string;
};

type BarChartProps = {
  items: UsageNamedValue[];
  valueSuffix?: string;
  horizontal?: boolean;
};

type DonutChartProps = {
  used: number;
  remaining: number;
  centerLabel: string;
  centerDetail: string;
};

function niceMax(value: number): number {
  if (value <= 0) {
    return 1;
  }

  const padded = value * 1.15;
  const magnitude = 10 ** Math.floor(Math.log10(padded));
  const normalized = padded / magnitude;

  if (normalized <= 1) {
    return magnitude;
  }
  if (normalized <= 2) {
    return 2 * magnitude;
  }
  if (normalized <= 5) {
    return 5 * magnitude;
  }

  return 10 * magnitude;
}

export function UsageLineChart({ points, valueSuffix = ' min' }: LineChartProps) {
  const width = 640;
  const height = 220;
  const padding = { top: 18, right: 16, bottom: 36, left: 40 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const maxValue = niceMax(Math.max(...points.map((point) => point.value), 0));

  const coordinates = points.map((point, index) => {
    const x =
      points.length === 1
        ? padding.left + plotWidth / 2
        : padding.left + (index / (points.length - 1)) * plotWidth;
    const y = padding.top + plotHeight - (point.value / maxValue) * plotHeight;
    return { ...point, x, y };
  });

  const linePath = coordinates
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${point.x} ${point.y}`)
    .join(' ');

  const areaPath =
    coordinates.length > 0
      ? [
          `M ${coordinates[0].x} ${padding.top + plotHeight}`,
          ...coordinates.map((point) => `L ${point.x} ${point.y}`),
          `L ${coordinates[coordinates.length - 1].x} ${padding.top + plotHeight}`,
          'Z',
        ].join(' ')
      : '';

  const gridLines = [0, 0.25, 0.5, 0.75, 1].map((ratio) => {
    const y = padding.top + plotHeight - ratio * plotHeight;
    const value = Math.round(maxValue * ratio);
    return { y, value };
  });

  return (
    <svg
      aria-label="Connected minutes over time"
      className="usage-chart-svg"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
    >
      {gridLines.map((line) => (
        <g key={line.y}>
          <line
            className="usage-chart-grid"
            x1={padding.left}
            x2={width - padding.right}
            y1={line.y}
            y2={line.y}
          />
          <text
            className="usage-chart-axis-label"
            textAnchor="end"
            x={padding.left - 8}
            y={line.y + 4}
          >
            {line.value}
            {valueSuffix === ' min' ? '' : valueSuffix}
          </text>
        </g>
      ))}

      <path className="usage-chart-area" d={areaPath} />
      <path className="usage-chart-line" d={linePath} fill="none" />

      {coordinates.map((point, index) => {
        const labelStride = Math.max(1, Math.ceil(coordinates.length / 8));
        const showLabel =
          coordinates.length <= 10 ||
          index % labelStride === 0 ||
          index === coordinates.length - 1;

        return (
          <g key={`${point.label}-${point.x}`}>
            <circle className="usage-chart-dot" cx={point.x} cy={point.y} r="3.5" />
            {showLabel ? (
              <text
                className="usage-chart-axis-label"
                textAnchor="middle"
                x={point.x}
                y={height - 12}
              >
                {point.label}
              </text>
            ) : null}
          </g>
        );
      })}
    </svg>
  );
}

export function UsageBarChart({
  items,
  valueSuffix = ' min',
  horizontal = false,
}: BarChartProps) {
  const maxValue = niceMax(Math.max(...items.map((item) => item.value), 0));

  if (horizontal) {
    return (
      <div className="usage-hbar-list" role="img" aria-label="Session outcomes">
        {items.map((item) => {
          const widthPercent = Math.max(4, (item.value / maxValue) * 100);
          return (
            <div className="usage-hbar-row" key={item.label}>
              <div className="usage-hbar-label">{item.label}</div>
              <div className="usage-hbar-track">
                <div
                  className="usage-hbar-fill"
                  style={{ width: `${widthPercent}%` }}
                />
              </div>
              <div className="usage-hbar-value">
                {item.value}
                {valueSuffix === ' min' ? '' : ''}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  const width = 520;
  const height = 220;
  const padding = { top: 16, right: 12, bottom: 40, left: 36 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const gap = 14;
  const barWidth =
    items.length > 0 ? (plotWidth - gap * (items.length - 1)) / items.length : 0;

  return (
    <svg
      aria-label="Minutes by agent"
      className="usage-chart-svg"
      role="img"
      viewBox={`0 0 ${width} ${height}`}
    >
      {[0, 0.5, 1].map((ratio) => {
        const y = padding.top + plotHeight - ratio * plotHeight;
        return (
          <g key={ratio}>
            <line
              className="usage-chart-grid"
              x1={padding.left}
              x2={width - padding.right}
              y1={y}
              y2={y}
            />
            <text
              className="usage-chart-axis-label"
              textAnchor="end"
              x={padding.left - 8}
              y={y + 4}
            >
              {Math.round(maxValue * ratio)}
            </text>
          </g>
        );
      })}

      {items.map((item, index) => {
        const barHeight = (item.value / maxValue) * plotHeight;
        const x = padding.left + index * (barWidth + gap);
        const y = padding.top + plotHeight - barHeight;
        return (
          <g key={item.label}>
            <rect
              className="usage-chart-bar"
              height={Math.max(barHeight, 2)}
              rx="8"
              width={barWidth}
              x={x}
              y={y}
            />
            <text
              className="usage-chart-axis-label"
              textAnchor="middle"
              x={x + barWidth / 2}
              y={height - 14}
            >
              {item.label.length > 12
                ? `${item.label.slice(0, 11)}…`
                : item.label}
            </text>
            <title>
              {item.label}: {item.value}
              {valueSuffix}
            </title>
          </g>
        );
      })}
    </svg>
  );
}

export function UsageDonutChart({
  used,
  remaining,
  centerLabel,
  centerDetail,
}: DonutChartProps) {
  const size = 200;
  const stroke = 22;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = Math.max(used + remaining, 1);
  const usedLength = (used / total) * circumference;
  const remainingLength = circumference - usedLength;

  return (
    <div className="usage-donut">
      <svg
        aria-label="Monthly connected-minute budget"
        className="usage-donut-svg"
        role="img"
        viewBox={`0 0 ${size} ${size}`}
      >
        <circle
          className="usage-donut-track"
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={radius}
          strokeWidth={stroke}
        />
        <circle
          className="usage-donut-used"
          cx={size / 2}
          cy={size / 2}
          fill="none"
          r={radius}
          strokeDasharray={`${usedLength} ${remainingLength}`}
          strokeLinecap="round"
          strokeWidth={stroke}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
        />
      </svg>
      <div className="usage-donut-center">
        <div className="usage-donut-center-value">{centerLabel}</div>
        <div className="usage-donut-center-detail">{centerDetail}</div>
      </div>
    </div>
  );
}
