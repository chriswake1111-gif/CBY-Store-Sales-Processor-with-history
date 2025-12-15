
import React, { useState, useEffect } from 'react';
import { StaffRole } from '../types';
import { Users, Save } from 'lucide-react';

interface StaffClassificationModalProps {
  names: string[];
  initialRoles: Record<string, StaffRole>;
  onConfirm: (roles: Record<string, StaffRole>) => void;
  onCancel: () => void;
}

const StaffClassificationModal: React.FC<StaffClassificationModalProps> = ({ names, initialRoles, onConfirm, onCancel }) => {
  const [roleMap, setRoleMap] = useState<Record<string, StaffRole>>({});

  useEffect(() => {
    // Initialize with existing roles or default to SALES
    const newMap: Record<string, StaffRole> = {};
    names.forEach(name => {
      newMap[name] = initialRoles[name] || 'SALES';
    });
    setRoleMap(newMap);
  }, [names, initialRoles]);

  const setAll = (role: StaffRole) => {
    const newMap = { ...roleMap };
    names.forEach(name => newMap[name] = role);
    setRoleMap(newMap);
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl flex flex-col max-h-[90vh]">
        <div className="p-6 border-b flex justify-between items-center bg-gray-50 rounded-t-xl">
          <div className="flex items-center gap-3">
            <div className="bg-blue-100 p-2 rounded-lg text-blue-600">
              <Users size={24} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-800">職務分類設定</h2>
              <p className="text-sm text-gray-500">請確認每一位人員的職位，無獎金人員將不進行計算。</p>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => setAll('SALES')} className="text-xs px-3 py-1.5 bg-green-50 text-green-700 rounded hover:bg-green-100 font-medium border border-green-200">全設門市</button>
            <button onClick={() => setAll('PHARMACIST')} className="text-xs px-3 py-1.5 bg-blue-50 text-blue-700 rounded hover:bg-blue-100 font-medium border border-blue-200">全設藥師</button>
            <button onClick={() => setAll('NO_BONUS')} className="text-xs px-3 py-1.5 bg-red-50 text-red-700 rounded hover:bg-red-100 font-medium border border-red-200">全設無獎金</button>
          </div>
        </div>
        
        <div className="overflow-y-auto flex-1 p-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {names.map(name => (
              <div key={name} className="flex items-center justify-between p-3 border rounded-lg hover:bg-gray-50 transition-colors">
                <span className="font-medium text-gray-700 truncate mr-2" title={name}>{name}</span>
                <div className="flex bg-gray-100 rounded-lg p-1 shrink-0 gap-1">
                  <button
                    onClick={() => setRoleMap(prev => ({ ...prev, [name]: 'SALES' }))}
                    className={`px-2 py-1 rounded text-xs font-bold transition-all ${
                      roleMap[name] === 'SALES' 
                        ? 'bg-green-100 text-green-700 shadow-sm border border-green-200' 
                        : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    門市
                  </button>
                  <button
                    onClick={() => setRoleMap(prev => ({ ...prev, [name]: 'PHARMACIST' }))}
                    className={`px-2 py-1 rounded text-xs font-bold transition-all ${
                      roleMap[name] === 'PHARMACIST' 
                        ? 'bg-blue-100 text-blue-700 shadow-sm border border-blue-200' 
                        : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    藥師
                  </button>
                  <button
                    onClick={() => setRoleMap(prev => ({ ...prev, [name]: 'NO_BONUS' }))}
                    className={`px-2 py-1 rounded text-xs font-bold transition-all ${
                      roleMap[name] === 'NO_BONUS' 
                        ? 'bg-red-100 text-red-700 shadow-sm border border-red-200' 
                        : 'text-gray-400 hover:text-gray-600'
                    }`}
                  >
                    無獎金
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="p-4 border-t bg-gray-50 rounded-b-xl flex justify-end gap-3">
          <button 
            onClick={onCancel}
            className="px-5 py-2.5 text-gray-600 font-medium hover:bg-gray-200 rounded-lg transition-colors"
          >
            取消
          </button>
          <button 
            onClick={() => onConfirm(roleMap)}
            className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 text-white font-bold rounded-lg hover:bg-blue-700 shadow-sm hover:shadow transition-all"
          >
            <Save size={18} />
            確認並計算
          </button>
        </div>
      </div>
    </div>
  );
};

export default StaffClassificationModal;
