import React from 'react';
import { Task, TaskArea, TaskType, MultiplierLogic } from '../types';
import { ListTodo, RotateCcw, Plus, Trash2 } from 'lucide-react';
import { DEFAULT_TASKS } from '../constants';

interface TasksProps {
  tasks: Task[];
  setTasks: (tasks: Task[]) => void;
}

const Tasks: React.FC<TasksProps> = ({ tasks, setTasks }) => {
  const handleTaskChange = (id: string, field: keyof Task, value: any) => {
    let processedValue = value;
    if (field === 'defaultTimeMinutes' || field === 'defaultFrequencyPerYear') {
      processedValue = parseInt(value, 10) || 0; // Garante que é sempre um número
    }
    const updatedTasks = tasks.map(task =>
      task.id === id ? { ...task, [field]: processedValue } : task
    );
    setTasks(updatedTasks);
  };

  const handleReset = () => {
    if (confirm("Tem a certeza que deseja repor as tarefas para os valores padrão? Todas as suas alterações serão perdidas.")) {
      setTasks(DEFAULT_TASKS);
    }
  };

  const handleAddTask = () => {
    const newTask: Task = {
      id: crypto.randomUUID(),
      name: 'Nova Tarefa (editar)',
      area: TaskArea.CONTABILIDADE,
      type: TaskType.OBRIGACAO,
      defaultTimeMinutes: 15,
      defaultFrequencyPerYear: 1,
      multiplierLogic: 'manual',
    };
    setTasks([...tasks, newTask]);
  };

  const handleDeleteTask = (id: string) => {
    if (confirm("Tem a certeza que deseja apagar esta tarefa? Esta ação não pode ser desfeita.")) {
      setTasks(tasks.filter(task => task.id !== id));
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      <section className="rounded-2xl border border-slate-700/20 bg-gradient-to-r from-slate-900 via-slate-800 to-indigo-900 p-3 text-white shadow-sm md:p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div>
            <h1 className="flex items-center gap-3 text-xl font-bold md:text-2xl">
              <ListTodo size={22} /> Catálogo de Tarefas
            </h1>
            <p className="mt-1 text-xs text-slate-200 md:text-sm">Defina as tarefas padrão, os seus tempos e a lógica de cálculo. As alterações são guardadas automaticamente.</p>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleReset} className="flex items-center gap-2 rounded-lg border border-white/15 bg-white/10 px-3 py-2 text-xs font-bold text-white hover:bg-white/20">
              <RotateCcw size={14} /> Repor Padrões
            </button>
            <button onClick={handleAddTask} className="flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-bold text-indigo-900 hover:bg-indigo-50">
              <Plus size={14} /> Nova Tarefa
            </button>
          </div>
        </div>
      </section>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-slate-500 uppercase bg-slate-50">
              <tr>
                <th className="px-4 py-3">Tarefa</th>
                <th className="px-4 py-3">Área</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3 text-center">Tempo Padrão (min)</th>
                <th className="px-4 py-3 text-center">Freq. Padrão (ano)</th>
                <th className="px-4 py-3">Lógica do Multiplicador</th>
                <th className="px-4 py-3 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-50">
              {tasks.map(task => (
                <tr key={task.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-slate-800">
                    <input
                      type="text"
                      value={task.name}
                      onChange={e => handleTaskChange(task.id, 'name', e.target.value)}
                      className="w-full border rounded py-1 px-2 text-sm"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={task.area}
                      onChange={e => handleTaskChange(task.id, 'area', e.target.value as TaskArea)}
                      className="w-full px-2 py-1 border rounded-lg text-xs bg-white"
                    >
                      {Object.values(TaskArea).map(area => <option key={area} value={area}>{area}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={task.type}
                      onChange={e => handleTaskChange(task.id, 'type', e.target.value as TaskType)}
                      className="w-full px-2 py-1 border rounded-lg text-xs bg-white"
                    >
                      {Object.values(TaskType).map(type => <option key={type} value={type}>{type}</option>)}
                    </select>
                  </td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="number"
                      value={task.defaultTimeMinutes}
                      onChange={e => handleTaskChange(task.id, 'defaultTimeMinutes', e.target.value)}
                      className="w-20 text-center border rounded py-1 text-sm"
                    />
                  </td>
                  <td className="px-4 py-3 text-center">
                    <input
                      type="number"
                      value={task.defaultFrequencyPerYear}
                      onChange={e => handleTaskChange(task.id, 'defaultFrequencyPerYear', e.target.value)}
                      className="w-20 text-center border rounded py-1 text-sm"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <select
                      value={task.multiplierLogic || 'manual'}
                      onChange={(e) => handleTaskChange(task.id, 'multiplierLogic', e.target.value as MultiplierLogic)}
                      className="w-full px-2 py-1 border rounded-lg text-xs bg-white min-w-[150px]"
                    >
                      <option value="manual">Manual (Padrão)</option>
                      <option value="employeeCount">Nº Funcionários</option>
                      <option value="documentCount">Nº Documentos</option>
                      <option value="establishments">Nº Estabelecimentos</option>
                      <option value="banks">Nº Bancos</option>
                    </select>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => handleDeleteTask(task.id)} className="p-2 text-slate-400 hover:text-red-600">
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};

export default Tasks;