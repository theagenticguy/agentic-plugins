import { useEffect, useRef } from "react";
import { echarts, type EChartsOption } from "../charts";

/**
 * One ECharts panel: init once, setOption on change, resize with the box.
 *
 * `notMerge: true` replaces the whole option, so builders stay pure functions
 * of the region rows — a fresh object identity per render is the update
 * mechanism. Width comes from the container; height is a fixed prop.
 *
 * ECharts paints to a canvas, which exposes no text to assistive tech: without
 * `ariaLabel` the panel is a blank box in the accessibility tree. The caller
 * passes the same numbers the bars encode, so the label is the chart's text
 * alternative rather than a restatement of its title.
 */
export function Chart({
  option,
  height = 260,
  testid,
  ariaLabel,
}: {
  readonly option: EChartsOption;
  readonly height?: number;
  readonly testid?: string;
  readonly ariaLabel: string;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (ref.current === null) return;
    const chart = echarts.init(ref.current);
    chartRef.current = chart;
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);
    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return (
    <div
      ref={ref}
      role="img"
      aria-label={ariaLabel}
      data-testid={testid}
      style={{ width: "100%", height }}
    />
  );
}
