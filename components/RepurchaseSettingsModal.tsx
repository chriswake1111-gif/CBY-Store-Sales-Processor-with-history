
import React, { useState } from 'react';
import { X, CheckSquare, Square, Save, Plus, Trash2, Edit2, Check } from 'lucide-react';
import { RepurchaseOption } from '../types';

interface RepurchaseSettingsModalProps {
  options: RepurchaseOption[];
  onSave: (newOptions: RepurchaseOption[]) => void;
  onClose: () => void;
}

const RepurchaseSettingsModal: React.FC<RepurchaseSettingsModalProps> = ({ options, onSave, onClose }) => {
  const [localOptions, setLocalOptions] = useState<RepurchaseOption[]>(JSON.parse(JSON.stringify(options)));
  
  // Editing State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const toggleOption = (id: string) => {
    if (editingId === id) return; // Prevent toggle while editing
    setLocalOptions(prev => prev.map(opt => 
      opt.id === id ? { ...opt, isEnabled: !opt.isEnabled } : opt
    ));
  };

  const handleAddOption = (group: 'GENERAL' | 'SPECIAL') => {
    const newId = `custom_${Date.now()}_${Math.floor(Math.random()*1000)}`;
    const newOption: RepurchaseOption = {
        id: newId,
        label: '新活動',
        group: group,
        isEnabled: true
    };
    setLocalOptions([...localOptions, newOption]);
    // Automatically start editing the new item
    setEditingId(newId);
    setEditValue('新活動');
  };

  const handleDeleteOption = (id: string) => {
    if (window.confirm('確定要刪除此活動選項嗎？')) {
        setLocalOptions(prev => prev.filter(o => o.id !== id));
    }
  };

  const startEditing = (opt: RepurchaseOption, e: React.MouseEvent) => {
    e.stopPropagation();
    setEditingId(opt.id);
    setEditValue(opt.label);
  };

  const saveEditing = (id: string) => {
    if (!editValue.trim()) {
        alert("名稱不能為空");
        return;
    }
    setLocalOptions(prev => prev.map(opt => 
        opt.id === id ? { ...opt, label: editValue.trim() } : opt
    ));
    setEditingId(null);
    setEditValue('');
  };

  const cancelEditing = () => {
    setEditingId(null);
    setEditValue('');
  };

  const renderSection = (title: string, group: 'GENERAL' | 'SPECIAL', cols: number, colorClass: string) => {
    const groupOptions = localOptions.filter(o => o.group === group);
    
    return (
      <div className="mb-8">
        <div className={`flex justify-between items-center mb-3 pb-1 border-b ${colorClass.replace('bg-', 'border-').replace('50', '200')}`}>
            <h4 className={`font-bold text-sm ${colorClass.replace('bg-', 'text-').replace('50', '800')}`}>{title}</h4>
            <button 
                onClick={() => handleAddOption(group)}
                className={`text-xs flex items-center gap-1 px-2 py-1 rounded bg-white border shadow-sm hover:bg-gray-50 transition-colors ${colorClass.replace('bg-', 'text-').replace('50', '600')}`}
            >
                <Plus size={12}/> 新增選項
            </button>
        </div>
        
        <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
            {groupOptions.map(opt => {
                const isEditing = editingId === opt.id;
                return (
                    <div 
                        key={opt.id}
                        onClick={() => !isEditing && toggleOption(opt.id)}
                        className={`
                            relative group flex items-center justify-between p-2 border rounded transition-all
                            ${isEditing ? 'bg-white ring-2 ring-blue-400 border-blue-400 z-10' : 'cursor-pointer hover:shadow-sm'}
                            ${!isEditing && opt.isEnabled ? 'bg-blue-50 border-blue-200 text-blue-900' : 'bg-white border-gray-200 text-gray-400'}
                        `}
                    >
                        {isEditing ? (
                            <div className="flex items-center w-full gap-1" onClick={e => e.stopPropagation()}>
                                <input 
                                    autoFocus
                                    value={editValue}
                                    onChange={e => setEditValue(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && saveEditing(opt.id)}
                                    className="w-full text-sm px-1 py-0.5 outline-none border-b border-blue-300 text-slate-800 font-bold bg-transparent"
                                />
                                <button onClick={() => saveEditing(opt.id)} className="p-1 text-green-600 hover:bg-green-50 rounded"><Check size={14}/></button>
                                <button onClick={cancelEditing} className="p-1 text-red-400 hover:bg-red-50 rounded"><X size={14}/></button>
                            </div>
                        ) : (
                            <>
                                <div className="flex items-center gap-2 overflow-hidden">
                                    {opt.isEnabled ? <CheckSquare size={16} className="shrink-0 text-blue-600"/> : <Square size={16} className="shrink-0 text-gray-300"/>}
                                    <span className={`text-sm font-medium truncate ${opt.isEnabled ? 'text-slate-700' : 'text-gray-400'}`}>{opt.label}</span>
                                </div>
                                
                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white/80 backdrop-blur-sm rounded px-1 absolute right-1">
                                    <button 
                                        onClick={(e) => startEditing(opt, e)} 
                                        className="p-1 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                                        title="編輯名稱"
                                    >
                                        <Edit2 size={12}/>
                                    </button>
                                    <button 
                                        onClick={(e) => { e.stopPropagation(); handleDeleteOption(opt.id); }} 
                                        className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded"
                                        title="刪除"
                                    >
                                        <Trash2 size={12}/>
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                );
            })}
            
            {groupOptions.length === 0 && (
                <div className="col-span-full text-center py-4 text-xs text-gray-400 border border-dashed border-gray-300 rounded">
                    暫無選項，請點擊上方按鈕新增
                </div>
            )}
        </div>
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="bg-slate-800 text-white px-6 py-4 flex justify-between items-center shrink-0">
          <h3 className="text-lg font-bold">回購狀態與活動設定</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={24}/></button>
        </div>

        <div className="p-6 overflow-y-auto bg-slate-50 flex-1">
          <div className="text-xs text-gray-500 mb-4 bg-white p-3 rounded border border-gray-200 shadow-sm flex gap-2">
             <div className="font-bold text-blue-600 shrink-0">提示：</div>
             <div>
                勾選項目會顯示在列表選單中。您可以自由新增、編輯名稱或刪除舊活動。<br/>
                將滑鼠移至選項上即可看到編輯與刪除按鈕。
             </div>
          </div>

          {renderSection('一般搭贈活動 (顯示於選單第一區)', 'GENERAL', 3, 'bg-blue-50')}
          {renderSection('特殊/節慶活動 (顯示於選單第二區)', 'SPECIAL', 3, 'bg-purple-50')}
        </div>

        <div className="p-4 border-t bg-white flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded">取消</button>
          <button onClick={() => onSave(localOptions)} className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white font-bold rounded hover:bg-blue-700 shadow-md transition-all">
            <Save size={16}/> 儲存設定
          </button>
        </div>
      </div>
    </div>
  );
};

export default RepurchaseSettingsModal;
