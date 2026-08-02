import { useEffect, useRef } from 'react';
import Chart from 'chart.js/auto';
import { fmtINR } from '../lib/format.js';

export default function ValueChart({ data }) {
  const canvasRef = useRef(null);
  const chartRef = useRef(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    if (chartRef.current) chartRef.current.destroy();
    chartRef.current = new Chart(canvasRef.current, {
      type: 'line',
      data: {
        labels: data.map(d => new Date(d.week).toLocaleDateString('en-IN', { month: 'short', day: 'numeric' })),
        datasets: [{ data: data.map(d => d.value), borderColor: '#2f6fed', backgroundColor: 'rgba(47,111,237,0.1)',
                     fill: true, tension: 0.3, pointRadius: 3 }],
      },
      options: {
        plugins: { legend: { display: false } },
        scales: { y: { ticks: { callback: (v) => fmtINR(v) } } },
      },
    });
    return () => { if (chartRef.current) chartRef.current.destroy(); };
  }, [data]);

  return <div className="card" style={{ height: 240 }}><canvas ref={canvasRef} /></div>;
}
