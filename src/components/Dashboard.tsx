import React, { useEffect, useMemo, useState } from 'react';
import { Client, Task, Staff, TaskArea } from '../types';
import { calculateClientProfitability, calculateStaffStats } from '../services/calculator';
import { ensureStoreClient } from '../services/supabaseClient';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { TrendingUp, AlertTriangle, DollarSign, UserCheck, Wallet, BadgeEuro } from 'lucide-react';

interface DashboardProps {
  clients: Client[];
  tasks: Task[];
  areaCosts: Record<string, number>;
  staff: Staff[];
}

const money = new Intl.NumberFormat('pt-PT', { style: 'currency', currency: 'EUR' });
const cleanNif = (value: unknown) => String(value ?? '').replace(/\D/g, '');

interface PendingBalanceRow {
  nif: string;
  total_pendente: number;
}

const Dashboard: React.FC<DashboardProps> = ({ clients, tasks, areaCosts, staff }) => {
  const [pendingBalances, setPendingBalances] = useState<PendingBalanceRow[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const client = ensureStoreClient();
        const { data } = await client.rpc('get_visible_primavera_pending_balances');
        if (!cancelled && Array.isArray(data)) setPendingBalances(data as PendingBalanceRow[]);
      } catch {
        // Painel meramente informativo — uma falha aqui não deve impedir o resto do dashboard.
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const { metrics, staffMetrics, topRevenueClients, topDebts } = useMemo(() => {
    let totalRev = 0;
    let totalCost = 0;
    let profitable = 0;
    let risk = 0;

    // Inactive clients (company ceased activity) are excluded from profitability analyses.
    const activeClients = clients.filter(c => c.status !== 'Inativo');

    const clientData = activeClients.map(c => {
      const analysis = calculateClientProfitability(c, tasks, areaCosts as Record<TaskArea, number>, staff);
      totalRev += analysis.totalAnnualRevenue;
      totalCost += analysis.totalAnnualCost;

      if (analysis.profitability < 15) risk++;
      else profitable++;

      return {
        name: c.name,
        nif: c.nif,
        // Avença mensal configurada, não a estimativa anual (essa já está
        // nos cartões do topo) — evita inflar clientes ainda por faturar.
        monthlyFee: Number(c.monthlyFee || 0),
      };
    });

    const topRevenueClients = [...clientData].sort((a, b) => b.monthlyFee - a.monthlyFee).slice(0, 8);

    const balanceByNif = new Map(pendingBalances.map(row => [cleanNif(row.nif), Number(row.total_pendente || 0)]));
    const topDebts = activeClients
      .map(c => ({ name: c.name, debt: balanceByNif.get(cleanNif(c.nif)) ?? 0 }))
      .filter(entry => entry.debt > 0.005)
      .sort((a, b) => b.debt - a.debt)
      .slice(0, 8);

    const staffPerformance = staff
      .filter(s => (s.status || 'Ativo') !== 'Inativo')
      .map(s => calculateStaffStats(s, activeClients, tasks))
      .sort((a, b) => b.profitability - a.profitability);

    return {
      metrics: { totalRev, totalCost, profitable, risk },
      staffMetrics: staffPerformance,
      topRevenueClients,
      topDebts,
    };
  }, [clients, tasks, areaCosts, staff, pendingBalances]);

  const totalMarginPercent = metrics.totalRev > 0 ? ((metrics.totalRev - metrics.totalCost) / metrics.totalRev) * 100 : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      <section className="rounded-2xl border border-slate-700/20 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-900 p-4 text-white shadow-sm md:p-5">
        <h1 className="text-xl font-bold md:text-2xl">Dashboard</h1>
        <p className="mt-1 text-xs text-slate-200 md:text-sm">Visão geral da rentabilidade e da carteira de clientes.</p>
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {/* KPI Cards */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-slate-500">Receita Anual Estimada</p>
              <h3 className="text-2xl font-bold text-slate-800 mt-1">{(metrics.totalRev / 1000).toFixed(1)}k €</h3>
            </div>
            <div className="p-2 bg-green-50 rounded-lg text-green-600">
              <TrendingUp size={20} />
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-2">Baseado nas avenças atuais</p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-slate-500">Custo Operacional</p>
              <h3 className="text-2xl font-bold text-slate-800 mt-1">{(metrics.totalCost / 1000).toFixed(1)}k €</h3>
            </div>
            <div className="p-2 bg-blue-50 rounded-lg text-blue-600">
              <DollarSign size={20} />
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-2">Calculado com custos de staff</p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-slate-500">Margem Global</p>
              <h3 className={`text-2xl font-bold mt-1 ${totalMarginPercent < 20 ? 'text-orange-500' : 'text-green-600'}`}>
                {totalMarginPercent.toFixed(1)}%
              </h3>
            </div>
            <div className={`p-2 rounded-lg ${totalMarginPercent < 20 ? 'bg-orange-50 text-orange-600' : 'bg-green-50 text-green-600'}`}>
              <TrendingUp size={20} />
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-2">Lucro líquido operacional</p>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <div className="flex justify-between items-start">
            <div>
              <p className="text-sm font-medium text-slate-500">Clientes em Risco</p>
              <h3 className="text-2xl font-bold text-red-600 mt-1">{metrics.risk}</h3>
            </div>
            <div className="p-2 bg-red-50 rounded-lg text-red-600">
              <AlertTriangle size={20} />
            </div>
          </div>
          <p className="text-xs text-slate-400 mt-2">Margem inferior a 15%</p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <Wallet size={20} className="text-red-500" /> Maiores Dívidas (Primavera)
          </h3>
          {topDebts.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">Sem dívidas pendentes registadas.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {topDebts.map(entry => (
                <li key={entry.name} className="flex items-center justify-between py-2.5">
                  <span className="text-sm font-medium text-slate-700 truncate pr-3">{entry.name}</span>
                  <span className="text-sm font-bold text-red-600 whitespace-nowrap">{money.format(entry.debt)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <BadgeEuro size={20} className="text-green-600" /> Top Clientes por Avença Mensal
          </h3>
          {topRevenueClients.length === 0 ? (
            <p className="text-sm text-slate-400 py-8 text-center">Sem avenças configuradas.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {topRevenueClients.map(entry => {
                const maxFee = topRevenueClients[0].monthlyFee || 1;
                const widthPercent = Math.max(4, (entry.monthlyFee / maxFee) * 100);
                return (
                  <li key={entry.name} className="py-2.5">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium text-slate-700 truncate">{entry.name}</span>
                      <span className="text-sm font-bold text-green-700 whitespace-nowrap">{money.format(entry.monthlyFee)}</span>
                    </div>
                    <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-100">
                      <div className="h-1.5 rounded-full bg-green-500" style={{ width: `${widthPercent}%` }} />
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>

      {/* Staff Performance */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <UserCheck size={20} className="text-blue-600" /> Rentabilidade por Funcionário
          </h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={staffMetrics} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" domain={['dataMin - 10', 'dataMax + 10']} tickFormatter={(value) => `${value}%`} />
                <YAxis dataKey="staffName" type="category" width={100} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(value) => `${Number(value).toFixed(1)}%`} cursor={{ fill: '#f1f5f9' }} />
                <Bar dataKey="profitability" name="Rentabilidade" radius={[0, 4, 4, 0]}>
                  {staffMetrics.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.profitability < 20 ? '#ef4444' : '#22c55e'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <UserCheck size={20} className="text-blue-600" /> Funcionários — Valor e Nº de Empresas
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-[10px] font-bold uppercase text-slate-400 border-b border-slate-100">
                <tr>
                  <th className="py-2 pr-2">Funcionário</th>
                  <th className="py-2 pr-2 text-right">Nº Empresas</th>
                  <th className="py-2 text-right">Receita Gerida</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {staffMetrics.map(entry => (
                  <tr key={entry.staffName}>
                    <td className="py-2 pr-2 font-medium text-slate-700">{entry.staffName}</td>
                    <td className="py-2 pr-2 text-right text-slate-600">{entry.clientCount}</td>
                    <td className="py-2 text-right font-bold text-slate-800">{money.format(entry.totalRevenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
