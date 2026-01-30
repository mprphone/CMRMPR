import React, { useState } from 'react';
import { Task, TaskArea, TaskType } from '../types';
import { Clock, Tag, Plus, Edit2, X, Save } from 'lucide-react';

interface TasksProps {
  tasks: Task[];
  setTasks: (tasks: Task[]) => void;
}

const Tasks: React.FC<TasksProps> = ({ tasks, setTasks }) => {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingTask, setEditingTask] = useState<Task | null>(null);

  // Form State
  const [name, setName] = useState('');
  const [area, setArea] = useState<TaskArea>(TaskArea.CONTABILIDADE);
  const [type, setType] = useState<TaskType>(TaskType.OBRIGACAO);
  const [time, setTime] = useState(0);
  const [freq, setFreq] = useState(0);

  const handleOpenModal = (task?: Task) => {
    if (task) {
      setEditingTask(task);
      setName(task.name);
      setArea(task.area);
      setType(task.type);
      setTime(task.defaultTimeMinutes);
      setFreq(task.defaultFrequencyPerYear);
    } else {
      setEditingTask(null);
      setName('');
      setArea(TaskArea.CONTABILIDADE);
      setType(TaskType.OBRIGACAO);
      setTime(15);
      setFreq(12);
    }
    setIsModalOpen(true);
  };

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    if (editingTask) {
      // Update
      const updatedTasks = tasks.map(t => t.id === editingTask.id ? {
        ...t,
        name, area, type, defaultTimeMinutes: time, defaultFrequencyPerYear: freq
      } : t);
      setTasks(updatedTasks);
    } else {
      // Create
      const newTask: Task = {
        id: Math.random().toString(36).substr(2, 9),
        name,
        area,
        type,
        defaultTimeMinutes: time,
        defaultFrequencyPerYear: freq
      };
      setTasks([...tasks, newTask]);
    }
    setIsModalOpen(false);
  };

  // Group by Area
  const tasksByArea = tasks.reduce((acc, task) => {
    if (!acc[task.area]) acc[task.area] = [];
    acc[task.area].push(task);
    return acc;
  }, {} as Record<string, Task[]>);

  return (
    <div className="space-y-6 relative">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-bold text-slate-800">Catálogo de Tarefas Standard</h2>
        <button 
          onClick={() => handleOpenModal()}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 flex items-center gap-2"
        >
          <Plus size={16}/> Nova Tarefa
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {Object.entries(tasksByArea).map(([area, areaTasks]: [string, Task[]]) => (
          <div key={area} className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
            <div className="bg-slate-50 px-4 py-3 border-b border-slate-100 font-semibold text-slate-700 flex justify-between">
              <span>{area}</span>
              <span className="text-xs bg-slate-200 text-slate-600 px-2 py-0.5 rounded-full">{areaTasks.length}</span>
            </div>
            <div className="divide-y divide-slate-50">
              {areaTasks.map(task => (
                <div key={task.id} className="p-4 hover:bg-slate-50 transition-colors group">
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-medium text-slate-800 text-sm">{task.name}</h4>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 border border-slate-200 px-1.5 py-0.5 rounded">
                        {task.type}
                      </span>
                      <button 
                        onClick={() => handleOpenModal(task)}
                        className="text-slate-300 hover:text-blue-600 opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <Edit2 size={14} />
                      </button>
                    </div>
                  </div>
                  <div className="flex gap-4 text-xs text-slate-500">
                    <div className="flex items-center gap-1">
                      <Clock size={12} /> {task.defaultTimeMinutes} min
                    </div>
                    <div className="flex items-center gap-1">
                      <Tag size={12} /> {task.defaultFrequencyPerYear}x / ano
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* Edit/Add Modal Overlay */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6 animate-fade-in">
            <div className="flex justify-between items-center mb-6">
              <h3 className="text-lg font-bold text-slate-800">
                {editingTask ? 'Editar Tarefa' : 'Nova Tarefa'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-slate-600">
                <X size={20} />
              </button>
            </div>
            
            <form onSubmit={handleSave} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-slate-500 mb-1">Nome da Tarefa</label>
                <input 
                  type="text" 
                  value={name} 
                  onChange={e => setName(e.target.value)}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Área</label>
                  <select 
                    value={area} 
                    onChange={e => setArea(e.target.value as TaskArea)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  >
                    {Object.values(TaskArea).map(a => <option key={a} value={a}>{a}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Tipo</label>
                  <select 
                    value={type} 
                    onChange={e => setType(e.target.value as TaskType)}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                  >
                    {Object.values(TaskType).map(t => <option key={t} value={t}>{t}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                 <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Tempo Padrão (min)</label>
                  <input 
                    type="number" 
                    value={time} 
                    onChange={e => setTime(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                    min="1"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1">Freq. Anual</label>
                  <input 
                    type="number" 
                    value={freq} 
                    onChange={e => setFreq(Number(e.target.value))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm"
                    min="1"
                  />
                </div>
              </div>

              <div className="pt-4 flex gap-3">
                 <button 
                  type="button" 
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-50"
                 >
                   Cancelar
                 </button>
                 <button 
                  type="submit"
                  className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-700 flex items-center justify-center gap-2"
                 >
                   <Save size={16} /> Salvar
                 </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};

export default Tasks;