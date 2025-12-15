
import React from 'react';
import { X, CheckSquare, Square, Save } from 'lucide-react';
import { RepurchaseOption } from '../types';

interface RepurchaseSettingsModalProps {
  options: RepurchaseOption[];
  onSave: (newOptions: RepurchaseOption[]) => void;
  onClose: () => void;
}

const RepurchaseSettingsModal: React.FC<RepurchaseSettingsModalProps> = ({ options, onSave, onClose }) => {
  const [localOptions, setLocalOptions] = React.useState<RepurchaseOption[]>(JSON.parse(JSON.stringify(options)));

  const toggleOption = (id: string) => {
    setLocalOptions(prev => prev.map(opt => 
      opt.id === id ? { ...opt, isEnabled: !opt.isEnabled } : opt
    ));
  };

  const renderGrid = (group: 'GENERAL' | 'SPECIAL', cols: number) => {
    const groupOptions = localOptions.filter(o => o.group === group);
    return (
      <div className={`grid gap-2 mb-6`} style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {groupOptions.map(opt => (
          <div 
            key={opt.id} 
            onClick={() => opt.label ? toggleOption(opt.id) : null}
            className={`
              flex items-center gap-2 p-2 border rounded cursor-pointer transition-colors select-none
              ${!opt.label ? 'opacity-0 pointer-events-none' : ''}
              ${opt.isEnabled ? 'bg-blue-50 border-blue-300 text-blue-800' : 'bg-white border-gray-200 text-gray-400 hover:bg-gray-50'}
            `}
          >
             {opt.label && (
                <>
                  {opt.isEnabled ? <CheckSquare size={16} className="shrink-0"/> : <Square size={16} className="shrink-0"/>}
                  <span className="text-sm font-medium">{opt.label}</span>
                </>
             )}
          </div>
        ))}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="bg-slate-800 text-white px-6 py-4 flex justify-between items-center shrink-0">
          <h3 className="text-lg font-bold">回購狀態表設定</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={24}/></button>
        </div>

        <div className="p-6 overflow-y-auto bg-slate-50">
          <div className="mb-2 font-bold text-slate-700 border-l-4 border-blue-500 pl-2">一般搭贈活動 (1排3格)</div>
          {renderGrid('GENERAL', 3)}

          <div className="mb-2 font-bold text-slate-700 border-l-4 border-purple-500 pl-2">特殊搭贈活動 (1排2格)</div>
          {renderGrid('SPECIAL', 2)}
          
          <div className="text-xs text-gray-500 mt-4">
             * 勾選的項目才會顯示在資料列表的「回購狀態」選單中。
          </div>
        </div>

        <div className="p-4 border-t bg-white flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded">取消</button>
          <button onClick={() => onSave(localOptions)} className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white font-bold rounded hover:bg-blue-700">
            <Save size={16}/> 儲存設定
          </button>
        </div>
      </div>
    </div>
  );
};

export default RepurchaseSettingsModal;
