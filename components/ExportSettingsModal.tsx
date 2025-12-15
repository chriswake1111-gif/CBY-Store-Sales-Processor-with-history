
import React, { useState, useEffect } from 'react';
import { FileSpreadsheet, Save, Trash2, X, Upload, CheckCircle2, LayoutTemplate, ArrowRight } from 'lucide-react';
import { saveTemplate, getTemplate, deleteTemplate, saveTemplateConfig, TemplateRecord, TemplateMapping } from '../utils/db';

interface ExportSettingsModalProps {
  onClose: () => void;
}

const DEFAULT_MAPPING: TemplateMapping = {
  startRow: 2,
  category: 'A',
  date: 'B',
  customerID: 'C',
  itemID: 'D',
  itemName: 'E',
  quantity: 'F',
  amount: 'G', // Default G
  note: 'H',
  points: 'I'
};

const ExportSettingsModal: React.FC<ExportSettingsModalProps> = ({ onClose }) => {
  const [currentTemplate, setCurrentTemplate] = useState<TemplateRecord | null>(null);
  const [mapping, setMapping] = useState<TemplateMapping>(DEFAULT_MAPPING);
  const [message, setMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'FILE' | 'MAPPING'>('FILE');

  useEffect(() => {
    loadInfo();
  }, []);

  const loadInfo = async () => {
    const t = await getTemplate();
    if (t) {
        setCurrentTemplate(t);
        if (t.config) {
            setMapping(t.config);
        }
    } else {
        setCurrentTemplate(null);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0]) return;
    const file = e.target.files[0];
    try {
      await saveTemplate(file);
      await loadInfo();
      setMessage("範本匯入成功！");
      setActiveTab('MAPPING'); // Switch to mapping tab to encourage setup
    } catch (err) {
      setMessage("匯入失敗");
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("確定要刪除範本嗎？刪除後匯出將恢復為預設格式。")) return;
    await deleteTemplate();
    await loadInfo();
    setMessage("範本已移除");
  };

  const handleSaveConfig = async () => {
    try {
        await saveTemplateConfig(mapping);
        setMessage("欄位設定已儲存！");
        setTimeout(onClose, 1000);
    } catch (e) {
        setMessage("儲存失敗");
    }
  };

  const handleMappingChange = (key: keyof TemplateMapping, value: string) => {
    // If it's startRow, allow numbers. If it's columns, allow letters only.
    if (key === 'startRow') {
        setMapping(prev => ({ ...prev, [key]: Number(value) }));
    } else {
        const letters = value.toUpperCase().replace(/[^A-Z]/g, '').substring(0, 2);
        setMapping(prev => ({ ...prev, [key]: letters }));
    }
  };

  const renderInput = (label: string, field: keyof TemplateMapping, placeholder: string) => (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
        <label className="text-sm font-medium text-slate-700 w-24">{label}</label>
        <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">對應 Excel 欄位</span>
            <ArrowRight size={12} className="text-gray-300"/>
            <input 
                type="text" 
                value={mapping[field]} 
                onChange={(e) => handleMappingChange(field, e.target.value)}
                className="w-16 text-center border border-gray-300 rounded px-2 py-1 font-mono font-bold text-blue-600 focus:ring-2 focus:ring-blue-200 focus:border-blue-500 outline-none uppercase placeholder:text-gray-200"
                placeholder={placeholder}
            />
        </div>
    </div>
  );

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden flex flex-col max-h-[90vh]">
        
        <div className="bg-slate-800 text-white px-6 py-4 flex justify-between items-center shrink-0">
            <h3 className="text-lg font-bold flex items-center gap-2">
                <FileSpreadsheet size={20} className="text-emerald-400"/> 
                匯出報表設定
            </h3>
            <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={24}/></button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-200 bg-gray-50 shrink-0">
            <button onClick={() => setActiveTab('FILE')} className={`flex-1 py-3 text-sm font-bold ${activeTab === 'FILE' ? 'bg-white text-blue-600 border-t-2 border-t-blue-600' : 'text-gray-500 hover:bg-gray-100'}`}>
                1. 範本檔案
            </button>
            <button onClick={() => setActiveTab('MAPPING')} disabled={!currentTemplate} className={`flex-1 py-3 text-sm font-bold ${activeTab === 'MAPPING' ? 'bg-white text-emerald-600 border-t-2 border-t-emerald-600' : 'text-gray-400'}`}>
                2. 欄位對應
            </button>
        </div>

        <div className="p-6 overflow-y-auto">
            {activeTab === 'FILE' && (
                <div className="space-y-6">
                    <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                        <h4 className="text-sm font-bold text-slate-700 mb-2">目前的匯出範本</h4>
                        {currentTemplate ? (
                            <div className="flex items-center justify-between bg-white p-3 rounded border border-emerald-200 shadow-sm">
                                <div className="flex items-center gap-3">
                                    <div className="bg-emerald-100 p-2 rounded text-emerald-600">
                                        <FileSpreadsheet size={24} />
                                    </div>
                                    <div>
                                        <div className="font-bold text-slate-800 text-sm truncate max-w-[150px]">{currentTemplate.name}</div>
                                        <div className="text-[10px] text-gray-500">
                                            {new Date(currentTemplate.updatedAt).toLocaleString()}
                                        </div>
                                    </div>
                                </div>
                                <button onClick={handleDelete} className="text-red-400 hover:text-red-600 p-2 hover:bg-red-50 rounded">
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        ) : (
                            <div className="text-sm text-gray-400 italic text-center py-4 border border-dashed border-gray-300 rounded bg-white">
                                尚未設定範本 (使用系統預設格式)
                            </div>
                        )}
                    </div>

                    <div className="space-y-2">
                        <label className="block w-full cursor-pointer group">
                            <div className="flex items-center justify-center w-full h-12 bg-blue-50 text-blue-700 border border-blue-200 rounded-lg group-hover:bg-blue-100 transition-colors font-bold gap-2">
                                <Upload size={18} />
                                上傳 Excel 範本 (.xlsx)
                            </div>
                            <input type="file" className="hidden" accept=".xlsx" onChange={handleUpload} />
                        </label>
                        <p className="text-xs text-gray-500 leading-relaxed px-1">
                            <strong>說明：</strong> 上傳範本後，請切換至「欄位對應」頁籤，指定資料要填入哪一欄。
                        </p>
                    </div>
                </div>
            )}

            {activeTab === 'MAPPING' && (
                <div className="space-y-4">
                    <div className="bg-blue-50 p-3 rounded border border-blue-100 text-blue-800 text-xs mb-4">
                         設定系統資料要填入 Excel 的哪一欄 (例如 A, B, AA)。
                         <br/>未填寫欄位代號的資料將不會被匯出。
                    </div>

                    <div className="flex items-center justify-between py-2 border-b border-gray-200">
                        <label className="text-sm font-bold text-slate-800">資料起始列 (Start Row)</label>
                        <input 
                            type="number" 
                            value={mapping.startRow} 
                            onChange={(e) => handleMappingChange('startRow', e.target.value)}
                            className="w-20 text-center border border-gray-300 rounded px-2 py-1 font-bold text-slate-800"
                        />
                    </div>

                    <div className="space-y-1">
                        {renderInput('分類', 'category', 'A')}
                        {renderInput('日期', 'date', 'B')}
                        {renderInput('客戶編號', 'customerID', 'C')}
                        {renderInput('品項編號', 'itemID', 'D')}
                        {renderInput('品名', 'itemName', 'E')}
                        {renderInput('數量', 'quantity', 'F')}
                        {renderInput('金額', 'amount', 'G')}
                        {renderInput('備註', 'note', 'H')}
                        {renderInput('點數', 'points', 'I')}
                    </div>

                    <div className="flex justify-end pt-4">
                        <button onClick={handleSaveConfig} className="flex items-center gap-2 bg-slate-800 text-white px-6 py-2 rounded font-bold hover:bg-slate-700 shadow-md">
                            <Save size={16}/> 儲存設定
                        </button>
                    </div>
                </div>
            )}

            {message && (
                <div className="mt-4 bg-emerald-50 text-emerald-700 px-4 py-2 rounded text-sm font-bold flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2">
                    <CheckCircle2 size={16} /> {message}
                </div>
            )}
            
        </div>
      </div>
    </div>
  );
};

export default ExportSettingsModal;
