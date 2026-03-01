import { AreaChart, Area } from 'recharts';

type SparklinePoint = { ts: number; value: number };

export function Sparkline({
  data,
  color = 'var(--color-success-400)',
  height = 28,
  width = 100,
}: {
  data: SparklinePoint[];
  color?: string;
  height?: number;
  width?: number;
}) {
  if (data.length < 2) {return null;}

  return (
    <AreaChart
      width={width}
      height={height}
      data={data}
      margin={{ top: 2, right: 0, bottom: 2, left: 0 }}
    >
      <defs>
        <linearGradient id={`sparkGrad-${color.replace(/[^a-zA-Z0-9]/g, '')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="5%" stopColor={color} stopOpacity={0.3} />
          <stop offset="95%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <Area
        type="monotone"
        dataKey="value"
        stroke={color}
        strokeWidth={1.5}
        fill={`url(#sparkGrad-${color.replace(/[^a-zA-Z0-9]/g, '')})`}
        isAnimationActive={false}
      />
    </AreaChart>
  );
}
