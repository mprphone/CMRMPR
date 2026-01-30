import React, { useState } from 'react';
import { GlobalSettings, TurnoverBracket, TaskArea } from '../types';
import { Database, Mail, DollarSign, TrendingUp, Trash2, Save, RefreshCcw } from 'lucide-react';
import { turnoverBracketService } from '../services/supabase';

interface SettingsProps {
  areaCosts: Record<string, number>;
  setAreaCosts: (costs: Record<string, number>) => void;
  turnoverBrackets: TurnoverBracket[];
  setTurnoverBrackets: (brackets: TurnoverBracket[]) => void;
  globalSettings: GlobalSettings;
  setGlobalSettings: (settings: GlobalSettings) => void;
  logo: string;
  setLogo: (logo: string) => void;
}

const Settings: React.FC<SettingsProps> = ({ globalSettings, setGlobalSettings, areaCosts, setAreaCosts, logo, turnoverBrackets, setTurnoverBrackets, setLogo }) => {
  const [isSavingBrackets, setIsSavingBrackets] = useState(false);
  const handleGlobalChange = (field: keyof GlobalSettings, value: string | number) => {
    setGlobalSettings({ ...globalSettings, [field]: value });
  };

  const handleAreaCostChange = (area: string, value: string) => {
    setAreaCosts({ ...areaCosts, [area]: parseFloat(value) || 0 });
  };

  const handleBracketChange = (id: string, field: keyof TurnoverBracket, value: string) => {
    const newValue = parseFloat(value) || 0;
    setTurnoverBrackets(
      turnoverBrackets.map(b => b.id === id ? { ...b, [field]: newValue } : b)
    );
  };

  const addBracket = () => {
    setTurnoverBrackets([
      ...turnoverBrackets,
      { id: crypto.randomUUID(), minTurnover: 0, maxTurnover: 0, minPercent: 0, maxPercent: 0 }
    ]);
  };

  const removeBracket = (id: string) => {
    setTurnoverBrackets(turnoverBrackets.filter(b => b.id !== id));
  };

  const handleSaveBrackets = async () => {
    setIsSavingBrackets(true);
    try {
      await turnoverBracketService.replaceAll(turnoverBrackets);
      alert('Patamares de faturação salvos com sucesso!');
    } catch (err: any) {
      alert('Erro ao salvar os patamares: ' + err.message);
    } finally {
      setIsSavingBrackets(false);
    }
  };

  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h2 className="text-2xl font-bold text-slate-800">Configurações Gerais</h2>
        <p className="text-sm text-slate-500">Ajuste os parâmetros da aplicação.</p>
      </div>

      {/* Email Settings */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><Mail size={18} /> Configuração de Email (Resend)</h3>
        <div className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Nome do Remetente</label>
              <input
                type="text"
                placeholder="O seu nome ou nome da empresa"
                value={globalSettings.fromName || ''}
                onChange={(e) => handleGlobalChange('fromName', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
            <div>
              <label className="block text-xs font-bold text-slate-500 mb-1">Email do Remetente</label>
              <input
                type="email"
                placeholder="email@seudominio.com"
                value={globalSettings.fromEmail || ''}
                onChange={(e) => handleGlobalChange('fromEmail', e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
          </div>
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="block text-xs font-bold text-slate-500">Assinatura de Email (suporta HTML)</label>
              {logo && (
                <button
                  type="button"
                  onClick={() => handleGlobalChange('emailSignature', (globalSettings.emailSignature || '') + `<br><img src="${logo}" alt="Logotipo" style="max-width: 150px; height: auto;" />`)}
                  className="text-xs bg-slate-100 text-slate-600 px-3 py-1 rounded hover:bg-slate-200 font-medium"
                >
                  Inserir Logotipo
                </button>
              )}
            </div>
            <textarea
              placeholder="Com os melhores cumprimentos,&#10;A sua equipa"
              value={globalSettings.emailSignature || ''}
              onChange={(e) => handleGlobalChange('emailSignature', e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-sm font-mono h-24"
            />
            {logo && (
              <div className="mt-2 p-2 border rounded-lg bg-slate-50">
                <p className="text-[10px] font-bold text-slate-400 uppercase mb-2">Logotipo Atual para Assinatura</p>
                <img src={logo} alt="Logotipo" className="max-h-12" />
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Cost Settings */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <h3 className="font-bold text-slate-800 mb-4 flex items-center gap-2"><DollarSign size={18} /> Custos Operacionais</h3>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
          {Object.keys(areaCosts).map(area => (
            <div key={area}>
              <label className="block text-xs font-bold text-slate-500 mb-1">Custo/Hora {area}</label>
              <input
                type="number"
                value={areaCosts[area]}
                onChange={(e) => handleAreaCostChange(area, e.target.value)}
                className="w-full px-3 py-2 border rounded-lg text-sm"
              />
            </div>
          ))}
        </div>
      </div>

      {/* Turnover Brackets Settings */}
      <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-100">
        <div className="flex justify-between items-center mb-4">
            <h3 className="font-bold text-slate-800 flex items-center gap-2"><TrendingUp size={18} /> Patamares de Faturação (Fair Value)</h3>
            <div className="flex gap-2">
              <button onClick={addBracket} className="bg-blue-100 text-blue-700 px-3 py-1 rounded text-xs font-bold hover:bg-blue-200">
                  Adicionar Patamar
              </button>
              <button onClick={handleSaveBrackets} disabled={isSavingBrackets} className="bg-green-600 text-white px-4 py-1 rounded text-xs font-bold hover:bg-green-700 flex items-center gap-1 disabled:opacity-50">
                  {isSavingBrackets ? <RefreshCcw size={14} className="animate-spin" /> : <Save size={14} />} Salvar
              </button>
            </div>
        </div>
        <div className="space-y-2">
            <div className="grid grid-cols-5 gap-2 text-xs font-bold text-slate-400 px-2">
                <span>Vol. Mínimo (€)</span>
                <span>Vol. Máximo (€)</span>
                <span>% Mín.</span>
                <span>% Máx.</span>
            </div>
            {turnoverBrackets.map(bracket => (
                <div key={bracket.id} className="grid grid-cols-5 gap-2 items-center">
                    <input type="number" value={bracket.minTurnover} onChange={e => handleBracketChange(bracket.id, 'minTurnover', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
                    <input type="number" value={bracket.maxTurnover} onChange={e => handleBracketChange(bracket.id, 'maxTurnover', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
                    <input type="number" value={bracket.minPercent} onChange={e => handleBracketChange(bracket.id, 'minPercent', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
                    <input type="number" value={bracket.maxPercent} onChange={e => handleBracketChange(bracket.id, 'maxPercent', e.target.value)} className="w-full px-3 py-2 border rounded-lg text-sm" />
                    <button onClick={() => removeBracket(bracket.id)} className="text-red-400 hover:text-red-600 p-2"><Trash2 size={16} /></button>
                </div>
            ))}
        </div>
      </div>
    </div>
  );
};

export default Settings;