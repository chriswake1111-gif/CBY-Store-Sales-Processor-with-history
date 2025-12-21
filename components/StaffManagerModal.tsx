
import React, { useState } from 'react';
import { X, Save, Upload, Plus, Trash2, UserCog, FileSpreadsheet } from 'lucide-react';
import { StaffRecord, StaffRole } from '../types';
import { readExcelFile } from '../utils/excelHelper';
import { COL_HEADERS } from '../constants';

interface StaffManagerModalProps {
  staffList: StaffRecord[];
  onSave: (list: StaffRecord[]) => void;
  onClose: () => void;
}

const StaffManagerModal: React.FC<StaffManagerModalProps> = ({ staffList, onSave, onClose }) => {
  const [localList, setLocalList] = useState<StaffRecord[]>(JSON.parse(JSON.stringify(staffList)));
  const [searchTerm, setSearchTerm] = useState('');

  const handleImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0]) return;
    try {
      const json = await readExcelFile(e.target.files[0]);
      // Expect columns: 員工編號(optional), 員工姓名, 職位(門市/藥師/無獎金), 分店, 員工客戶編號, 點數標準, 美妝標準
      const newStaff: StaffRecord[] = [];
      const currentIds = new Set(localList.map(s => s.name)); // Using Name as unique key primarily

      json.forEach((row: any) => {
         const name = String(row['員工姓名'] || row['姓名'] || row[COL_HEADERS.SALES_PERSON] || '').trim();
         if (!name) return;
         
         const rawRole = String(row['職位'] || row['Role'] || '').trim();
         let role: StaffRole = 'SALES';
         if (rawRole.includes('藥師')) role = 'PHARMACIST';
         else if (rawRole.includes('無') || rawRole.includes('No')) role = 'NO_BONUS';
         
         // Use existing ID if available, otherwise generated one or from file
         const id = String(row['員工編號'] || row['ID'] || Date.now() + Math.random().toString().slice(2,6)).trim();

         // New Fields
         const branch = String(row['分店'] || row['Branch'] || row['Store'] || '').trim();
         const cid = String(row['員工客戶編號'] || row['客戶編號'] || row['CID'] || '').trim();
         const pointsStd = Number(row['點數標準'] || row['Points Std'] || 0);
         const cosmeticStd = Number(row['美妝標準'] || row['Cosmetic Std'] || 0);

         // If exists, skip (or logic to update could go here, but prompt implies adding)
         if (!currentIds.has(name)) {
             newStaff.push({ 
                 id, name, role, 
                 branch: branch || undefined, 
                 customerID: cid || undefined,
                 pointsStandard: pointsStd || undefined,
                 cosmeticStandard: cosmeticStd || undefined
             });
             currentIds.add(name);
         }
      });
      
      setLocalList(prev => [...prev, ...newStaff]);
      if (e.target) e.target.value = '';
      alert(`已成功匯入 ${newStaff.length} 位新員工資料。`);
    } catch (err) {
      alert("匯入失敗，請檢查 Excel 格式。");
    }
  };

  const addRow = () => {
    setLocalList(prev => [{ id: '', name: '', role: 'SALES' }, ...prev]);
  };

  const handleClearAll = () => {
    if (localList.length === 0) return;
    if (window.confirm("確定要清空目前列表中的所有員工資料嗎？\n此動作將移除列表中的所有人員，方便您重新匯入。")) {
        setLocalList([]);
    }
  };

  const updateRow = (idx: number, field: keyof StaffRecord, value: any) => {
    setLocalList(prev => {
       const next = [...prev];
       next[idx] = { ...next[idx], [field]: value };
       return next;
    });
  };

  const removeRow = (idx: number) => {
    setLocalList(prev => prev.filter((_, i) => i !== idx));
  };

  const filteredList = localList.filter(s => s.name.includes(searchTerm) || s.id.includes(searchTerm));

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-7xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="bg-slate-800 text-white px-6 py-4 flex justify-between items-center shrink-0">
          <h3 className="text-lg font-bold flex items-center gap-2"><UserCog size={20}/> 員工職位設定表</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={24}/></button>
        </div>

        {/* Toolbar */}
        <div className="bg-slate-50 p-4 border-b border-gray-200 flex flex-wrap gap-3 justify-between items-center shrink-0">
            <div className="flex gap-2">
                <label className="flex items-center gap-2 px-3 py-2 bg-emerald-600 text-white rounded cursor-pointer hover:bg-emerald-700 transition-colors shadow-sm text-sm font-bold">
                    <FileSpreadsheet size={16} /> 匯入 Excel
                    <input type="file" className="hidden" accept=".xlsx, .xls" onChange={handleImport} />
                </label>
                <button onClick={addRow} className="flex items-center gap-2 px-3 py-2 bg-white border border-gray-300 text-slate-700 rounded hover:bg-blue-50 hover:text-blue-600 transition-colors shadow-sm text-sm font-bold">
                    <Plus size={16} /> 新增人員
                </button>
                <button onClick={handleClearAll} className="flex items-center gap-2 px-3 py-2 bg-white border border-red-300 text-red-600 rounded hover:bg-red-50 hover:text-red-700 transition-colors shadow-sm text-sm font-bold">
                    <Trash2 size={16} /> 全部清空
                </button>
            </div>
            <input 
                type="text" 
                placeholder="搜尋姓名或編號..." 
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="px-3 py-2 border border-gray-300 rounded text-sm w-64 focus:outline-none focus:ring-2 focus:ring-blue-400"
            />
        </div>

        <div className="flex-1 overflow-y-auto p-4 bg-gray-100">
            <div className="bg-white border border-gray-200 rounded shadow-sm overflow-hidden">
                <table className="w-full text-sm text-left">
                    <thead className="bg-slate-100 text-slate-700 font-bold uppercase border-b border-gray-200">
                        <tr>
                            <th className="px-4 py-3 w-24">員工編號</th>
                            <th className="px-4 py-3 w-32">員工姓名</th>
                            <th className="px-4 py-3 w-32">員工客戶編號</th>
                            <th className="px-4 py-3 w-32">職位</th>
                            <th className="px-4 py-3 w-32">分店</th>
                            <th className="px-4 py-3 w-24 text-right">點數標準</th>
                            <th className="px-4 py-3 w-24 text-right">美妝標準</th>
                            <th className="px-4 py-3 w-16 text-center">刪除</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                        {filteredList.map((staff, idx) => (
                            <tr key={idx} className="hover:bg-blue-50 group">
                                <td className="px-4 py-2">
                                    <input type="text" value={staff.id} onChange={e => updateRow(idx, 'id', e.target.value)} 
                                        className="w-full bg-transparent border-b border-transparent focus:border-blue-500 focus:outline-none py-1" placeholder="ID" />
                                </td>
                                <td className="px-4 py-2">
                                    <input type="text" value={staff.name} onChange={e => updateRow(idx, 'name', e.target.value)} 
                                        className="w-full bg-transparent border-b border-transparent focus:border-blue-500 focus:outline-none py-1 font-bold text-slate-700" placeholder="姓名" />
                                </td>
                                <td className="px-4 py-2">
                                    <input type="text" value={staff.customerID || ''} onChange={e => updateRow(idx, 'customerID', e.target.value)} 
                                        className="w-full bg-transparent border-b border-transparent focus:border-blue-500 focus:outline-none py-1 text-purple-600 font-mono" placeholder="CID" />
                                </td>
                                <td className="px-4 py-2">
                                    <select value={staff.role} onChange={e => updateRow(idx, 'role', e.target.value as StaffRole)}
                                        className={`w-full py-1 rounded text-xs font-bold border border-transparent focus:border-blue-300 outline-none cursor-pointer
                                            ${staff.role === 'SALES' ? 'text-green-700 bg-green-50' : 
                                              staff.role === 'PHARMACIST' ? 'text-blue-700 bg-blue-50' : 'text-red-700 bg-red-50'}
                                        `}
                                    >
                                        <option value="SALES">門市</option>
                                        <option value="PHARMACIST">藥師</option>
                                        <option value="NO_BONUS">無獎金</option>
                                    </select>
                                </td>
                                <td className="px-4 py-2">
                                     <input type="text" value={staff.branch || ''} onChange={e => updateRow(idx, 'branch', e.target.value)} 
                                        className="w-full bg-transparent border-b border-transparent focus:border-blue-500 focus:outline-none py-1 text-slate-600" placeholder="分店" />
                                </td>
                                <td className="px-4 py-2">
                                     <input type="number" value={staff.pointsStandard || ''} onChange={e => updateRow(idx, 'pointsStandard', Number(e.target.value))} 
                                        className="w-full bg-transparent border-b border-transparent focus:border-blue-500 focus:outline-none py-1 text-right font-mono" placeholder="-" />
                                </td>
                                <td className="px-4 py-2">
                                     <input type="number" value={staff.cosmeticStandard || ''} onChange={e => updateRow(idx, 'cosmeticStandard', Number(e.target.value))} 
                                        className="w-full bg-transparent border-b border-transparent focus:border-blue-500 focus:outline-none py-1 text-right font-mono" placeholder="-" />
                                </td>
                                <td className="px-4 py-2 text-center">
                                    <button onClick={() => removeRow(idx)} className="text-gray-300 hover:text-red-500 transition-colors">
                                        <Trash2 size={16} />
                                    </button>
                                </td>
                            </tr>
                        ))}
                        {filteredList.length === 0 && (
                            <tr><td colSpan={8} className="p-8 text-center text-gray-400">無符合資料</td></tr>
                        )}
                    </tbody>
                </table>
            </div>
        </div>

        <div className="p-4 border-t bg-white flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 text-gray-600 font-medium hover:bg-gray-100 rounded">取消</button>
          <button onClick={() => onSave(localList)} className="flex items-center gap-2 px-6 py-2 bg-blue-600 text-white font-bold rounded hover:bg-blue-700">
            <Save size={16}/> 儲存並更新
          </button>
        </div>
      </div>
    </div>
  );
};

export default StaffManagerModal;
