'use client';

import { useId, useState } from 'react';

import { shouldShowUsageAxisLabel } from '../../../lib/usage/axis-labels';
import { formatMinutes } from '../../../lib/usage/format';
import type {
  UsageNamedValue,
  UsagePeriodId,
  UsageSeriesPoint,
} from '../../../lib/usage/types';

type LineChartProps = {
  periodId: UsagePeriodId;
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

type ShareDonutChartProps = {
  items: UsageNamedValue[];
  centerLabel: string;
  centerDetail: string;
  ariaLabel?: string;
};

const SHARE_DONUT_COLORS = [
  '#0f2744',
  '#1d4f8c',
  '#2563eb',
  '#3b82f6',
  '#60a5fa',
  '#93c5fd',
  '#64748b',
  '#94a3b8',
];

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

export function UsageLineChart({
  periodId,
  points,
  valueSuffix = ' min',
}: LineChartProps) {
  const tooltipId = useId();
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);
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

  const hovered =
    hoverIndex === null ? null : (coordinates[hoverIndex] ?? null);

  const labelStride =
    periodId === '30d'
      ? null
      : Math.max(1, Math.ceil(coordinates.length / 8));

  return (
    <div
      className="usage-line-chart"
      onMouseLeave={() => setHoverIndex(null)}
    >
      <svg
        aria-describedby={hovered ? tooltipId : undefined}
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

        {hovered ? (
          <line
            className="usage-chart-hover-guide"
            x1={hovered.x}
            x2={hovered.x}
            y1={padding.top}
            y2={padding.top + plotHeight}
          />
        ) : null}

        {coordinates.map((point, index) => {
          const showLabel =
            periodId === '30d'
              ? shouldShowUsageAxisLabel(point.dayKey, periodId)
              : coordinates.length <= 10 ||
                index % (labelStride ?? 1) === 0 ||
                index === coordinates.length - 1;

          return (
            <g key={point.dayKey}>
              <circle
                className={
                  hoverIndex === index
                    ? 'usage-chart-dot usage-chart-dot-active'
                    : 'usage-chart-dot'
                }
                cx={point.x}
                cy={point.y}
                r={hoverIndex === index ? 5 : 3.5}
              />
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
              <rect
                aria-hidden="true"
                fill="transparent"
                height={plotHeight}
                onMouseEnter={() => setHoverIndex(index)}
                width={Math.max(
                  12,
                  points.length > 1 ? plotWidth / (points.length - 1) : plotWidth,
                )}
                x={
                  point.x -
                  Math.max(
                    6,
                    points.length > 1
                      ? plotWidth / (points.length - 1) / 2
                      : plotWidth / 2,
                  )
                }
                y={padding.top}
              />
            </g>
          );
        })}
      </svg>

      {hovered ? (
        <div
          className="usage-chart-tooltip"
          id={tooltipId}
          style={{
            left: `${(hovered.x / width) * 100}%`,
          }}
        >
          <div className="usage-chart-tooltip-label">{hovered.label}</div>
          <div className="usage-chart-tooltip-value">
            {formatMinutes(hovered.value)}
            {valueSuffix}
          </div>
        </div>
      ) : null}
    </div>
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

export function UsageShareDonutChart({
  items,
  centerLabel,
  centerDetail,
  ariaLabel = 'Session outcomes',
}: ShareDonutChartProps) {
  const size = 200;
  const stroke = 24;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  const total = Math.max(
    items.reduce((sum, item) => sum + Math.max(item.value, 0), 0),
    1,
  );

  let offset = 0;
  const segments = items.map((item, index) => {
    const value = Math.max(item.value, 0);
    const length = (value / total) * circumference;
    const segment = {
      color: SHARE_DONUT_COLORS[index % SHARE_DONUT_COLORS.length]!,
      label: item.label,
      length,
      offset,
      value,
    };
    offset += length;
    return segment;
  });

  return (
    <div className="usage-share-donut">
      <div className="usage-donut usage-share-donut-chart">
        <svg
          aria-label={ariaLabel}
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
          {segments.map((segment) =>
            segment.length > 0 ? (
              <circle
                key={segment.label}
                cx={size / 2}
                cy={size / 2}
                fill="none"
                r={radius}
                stroke={segment.color}
                strokeDasharray={`${segment.length} ${circumference - segment.length}`}
                strokeDashoffset={-segment.offset}
                strokeWidth={stroke}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
              >
                <title>
                  {segment.label}: {segment.value}
                </title>
              </circle>
            ) : null,
          )}
        </svg>
        <div className="usage-donut-center">
          <div className="usage-donut-center-value">{centerLabel}</div>
          <div className="usage-donut-center-detail">{centerDetail}</div>
        </div>
      </div>

      <ul className="usage-share-legend">
        {segments.map((segment) => (
          <li className="usage-share-legend-item" key={segment.label}>
            <span
              aria-hidden="true"
              className="usage-share-legend-swatch"
              style={{ background: segment.color }}
            />
            <span className="usage-share-legend-label">{segment.label}</span>
            <span className="usage-share-legend-value">{segment.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
