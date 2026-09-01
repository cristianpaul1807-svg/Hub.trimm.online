import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';

/**
 * Barras para distribuciones: franjas horarias, días de la semana.
 *
 * Se resalta la barra más alta porque en estos gráficos lo que se busca casi
 * siempre es exactamente eso: dónde está el pico y dónde el hueco.
 */

interface Punto {
  label: string;
  value: number;
  extra?: number;
}

interface Props {
  data: Punto[];
  loading?: boolean;
  /** Sufijo del valor en el globo de ayuda: '€', 'citas'… */
  unit?: string;
  emptyLabel: string;
}

const Globo = ({ active, payload, label, unit }: any) => {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-white border border-slate-200 rounded-xl p-3 shadow-lg text-xs">
      <p className="font-black text-slate-400 mb-1">{label}</p>
      <p className="text-slate-900 font-black">
        {payload[0].value} {unit ?? ''}
      </p>
    </div>
  );
};

export default function DistributionChart({ data, loading, unit, emptyLabel }: Props) {
  if (loading) {
    return <div className="h-64 bg-white border border-slate-200 rounded-2xl animate-pulse" />;
  }

  const total = data.reduce((s, d) => s + d.value, 0);
  if (!total) {
    return (
      <div className="h-64 bg-white border border-slate-200 rounded-2xl flex items-center justify-center">
        <p className="text-sm font-bold text-slate-400">{emptyLabel}</p>
      </div>
    );
  }

  const max = Math.max(...data.map((d) => d.value));

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6">
      <ResponsiveContainer width="100%" height={240}>
        <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fontWeight: 700, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 11, fontWeight: 700, fill: '#94a3b8' }}
            axisLine={false}
            tickLine={false}
            allowDecimals={false}
          />
          <Tooltip content={<Globo unit={unit} />} cursor={{ fill: '#f1f5f9' }} />
          <Bar dataKey="value" radius={[6, 6, 0, 0]}>
            {data.map((d, i) => (
              <Cell key={i} fill={d.value === max ? '#1d4ed8' : '#bfdbfe'} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
