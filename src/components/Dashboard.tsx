import React, { useMemo } from 'react';
import { Client, Task, Staff, TaskArea, StaffStats } from '../types';
import { calculateClientProfitability, calculateStaffStats } from '../services/calculator';
import { generateNotifications } from '../services/notificationService';
import AlertsPanel from './AlertsPanel';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { TrendingUp, Users, AlertTriangle, DollarSign, UserCheck } from 'lucide-react';

interface DashboardProps {
  clients: Client[];
  tasks: Task[];
  areaCosts: Record<string, number>;
  staff: Staff[];
}

const Dashboard: React.FC<DashboardProps> = ({ clients, tasks, areaCosts, staff }) => {
  const notifications = useMemo(() => generateNotifications(clients, tasks, areaCosts, staff), [clients, tasks, areaCosts, staff]);

  const { metrics, staffMetrics } = useMemo(() => {
    let totalRev = 0;
    let totalCost = 0;
    let profitable = 0;
    let risk = 0;
    
    const clientData = clients.map(c => {
      // Pass the staff list and global cost to calculation
      const analysis = calculateClientProfitability(c, tasks, areaCosts as Record<TaskArea, number>, staff);
      totalRev += analysis.totalAnnualRevenue;
      totalCost += analysis.totalAnnualCost;
      
      if (analysis.profitability < 15) risk++;
      else profitable++;

      return {
        name: c.name,
        revenue: analysis.totalAnnualRevenue,
        cost: analysis.totalAnnualCost,
        margin: analysis.profitability
      };
    }).sort((a, b) => a.margin - b.margin); // Sort by lowest margin first

    const staffPerformance = staff
      .map(s => calculateStaffStats(s, clients, tasks))
      .sort((a, b) => a.profitability - b.profitability);

    return { 
      metrics: { totalRev, totalCost, profitable, risk, clientData },
      staffMetrics: staffPerformance
    };
  }, [clients, tasks, areaCosts, staff]);

  const totalMarginPercent = metrics.totalRev > 0 ? ((metrics.totalRev - metrics.totalCost) / metrics.totalRev) * 100 : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Notifications Area */}
      <AlertsPanel notifications={notifications} />

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
        {/* Charts */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Top Clientes: Receita vs Custo</h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metrics.clientData} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" />
                <YAxis dataKey="name" type="category" width={100} tick={{fontSize: 12}} />
                <Tooltip formatter={(value) => `${Number(value).toFixed(0)}€`} />
                <Bar dataKey="revenue" name="Receita" fill="#3b82f6" radius={[0, 4, 4, 0]} />
                <Bar dataKey="cost" name="Custo" fill="#ef4444" radius={[0, 4, 4, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-semibold text-slate-800 mb-4 flex items-center gap-2">
            <UserCheck size={20} className="text-blue-600" />
            Rentabilidade por Funcionário
          </h3>
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={staffMetrics} layout="vertical" margin={{ top: 5, right: 30, left: 20, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                <XAxis type="number" domain={[-50, 100]} tickFormatter={(value) => `${value}%`} />
                <YAxis dataKey="staffName" type="category" width={100} tick={{fontSize: 12}} />
                <Tooltip formatter={(value) => `${Number(value).toFixed(1)}%`} />
                <Bar dataKey="profitability" name="Rentabilidade">
                  {staffMetrics.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.profitability < 20 ? '#ef4444' : '#22c55e'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-slate-100">
          <h3 className="text-lg font-semibold text-slate-800 mb-4">Análise de Margem por Cliente</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm text-left">
              <thead className="text-xs text-slate-500 uppercase bg-slate-50">
                <tr>
                  <th className="px-4 py-3">Cliente</th>
                  <th className="px-4 py-3 text-right">Margem %</th>
                  <th className="px-4 py-3 text-right">Lucro Anual</th>
                </tr>
              </thead>
              <tbody>
                {metrics.clientData.map((client) => (
                  <tr key={client.name} className="border-b border-slate-50 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-900">{client.name}</td>
                    <td className={`px-4 py-3 text-right font-bold ${client.margin < 15 ? 'text-red-500' : 'text-green-600'}`}>
                      {client.margin.toFixed(1)}%
                    </td>
                    <td className="px-4 py-3 text-right">{(client.revenue - client.cost).toFixed(0)}€</td>
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