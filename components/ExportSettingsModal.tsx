
import React, { useState, useEffect } from 'react';
import { FileSpreadsheet, Save, Trash2, X, Upload, CheckCircle2, ArrowRight, User, Stethoscope, RefreshCcw, Table2, LayoutGrid } from 'lucide-react';
import { saveTemplate, getTemplate, deleteTemplate, saveTemplateConfig, TemplateRecord, TemplateMapping, TEMPLATE_IDS } from '../utils/db';

interface ExportSettingsModalProps {
  onClose: () => void;
}

const DEFAULT_MAPPING: TemplateMapping = {
  startRow: 2,
  
  // New Staff Info Defaults
  storeName: '',
  staffID: '',
  staffName: '',

  // Stage 1
  category: 'A',
  date: 'B',
  customerID: 'C',
  itemID: 'D',
  itemName: 'E',
  quantity: 'F',
  amount: 'G', 
  note: 'H',
  points: 'I',
  
  // Stage 2 Defaults (matches default template)
  reward_category: 'A',
  reward_date: 'B',
  reward_customerID: 'C',
  reward_itemID: 'D',
  reward_itemName: 'E',
  reward_quantity: 'F',
  reward_note: 'G',
  reward_amount: 'H',

  // Repurchase Defaults
  repurchasePoints: 'G',
  originalDeveloper: 'H',
  devPoints: 'I',

  // Pharmacist fixed defaults
  cell_pharm_qty_1727: '',
  cell_pharm_qty_1345: '',
  cell_pharm_bonus: '',
  cell_pharm_points_dev: '',
  cell_pharm_points_table_dev: '',
  cell_pharm_points_rep: ''
};

const ExportSettingsModal: React.FC<ExportSettingsModalProps> = ({ onClose }) => {
  const [activeTypeId, setActiveTypeId] = useState<number>(TEMPLATE_IDS.SALES);
  const [currentTemplate, setCurrentTemplate] = useState<TemplateRecord | null>(null);
  const [mapping, setMapping] = useState<TemplateMapping>(DEFAULT_MAPPING);
  const [message, setMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'FILE' | 'MAPPING' | 'STATS'>('FILE');

  useEffect(() => {
    loadInfo(activeTypeId);
  }, [activeTypeId]);

  // Clean message when tab or person changes
  useEffect(() => {
    setMessage('');
  }, [activeTab, activeTypeId]);

  // Auto dismiss message after 3 seconds
  useEffect(() => {
    if (message) {
      const timer = setTimeout(() => setMessage(''), 3000);
      return () => clearTimeout(timer);
    }
  }, [message]);

  const loadInfo = async (id: number) => {
    const t = await getTemplate(id);
    if (t) {
        setCurrentTemplate(t);
        // Merge with defaults to ensure new fields exist even for old templates
        if (t.config) {
            setMapping({ ...DEFAULT_MAPPING, ...t.config });
        } else {
            setMapping(DEFAULT_MAPPING);
        }
    } else {
        setCurrentTemplate(null);
        setMapping(DEFAULT_MAPPING);
    }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0]) return;
    const file = e.target.files[0];
    try {
      await saveTemplate(file, activeTypeId);
      await loadInfo(activeTypeId);
      setMessage("範本匯入成功！");
      setActiveTab('MAPPING'); 
    } catch (err) {
      setMessage("匯入失敗");
    }
  };

  const handleDelete = async () => {
    if (!window.confirm("確定要刪除此範本嗎？刪除後匯出將恢復為預設格式。")) return;
    await deleteTemplate(activeTypeId);
    await loadInfo(activeTypeId);
    setMessage("範本已移除");
  };

  const handleSaveConfig = async () => {
    if (!currentTemplate) {
        setMessage("請先上傳範本檔案");
        return;
    }
    try {
        await saveTemplateConfig(mapping, activeTypeId);
        setMessage("欄位設定已儲存！");
    } catch (e) {
        setMessage("儲存失敗");
    }
  };

  const handleMappingChange = (key: keyof TemplateMapping, value: string) => {
    if (key === 'startRow') {
        setMapping(prev => ({ ...prev, [key]: Number(value) }));
    } else {
        // For Stats cells, we allow number (e.g., A5, B10), so only strip special chars
        const cleaned = value.toUpperCase().replace(/[^A-Z0-9]/g, '');
        setMapping(prev => ({ ...prev, [key]: cleaned }));
    }
  };

  // Helper for List Column Input (Letters only)
  const renderColInput = (label: string, field: keyof TemplateMapping, placeholder: string) => (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0">
        <label className="text-sm font-medium text-slate-700 w-32">{label}</label>
        <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Excel 欄位</span>
            <ArrowRight size={12} className="text-gray-300"/>
            <input 
                type="text" 
                value={mapping[field] || ''} 
                onChange={(e) => {
                    const letters = e.target.value.toUpperCase().replace(/[^A-Z]/g, '').substring(0, 2);
                    setMapping(prev => ({ ...prev, [field]: letters }));
                }}
                className="w-16 text-center border border-gray-300 rounded px-2 py-1 font-mono font-bold text-blue-600 focus:ring-2 focus:ring-blue-200 focus:border-blue-500 outline-none uppercase placeholder:text-gray-200"
                placeholder={placeholder}
            />
        </div>
    </div>
  );

  // Helper for Cell Coordinate Input (e.g. A4)
  const renderCellInput = (label: string, field: keyof TemplateMapping, placeholder: string = "例如 D4") => (
    <div className="flex items-center justify-between py-2 border-b border-gray-100 last:border-0 hover:bg-slate-50">
        <label className="text-sm font-medium text-slate-700">{label}</label>
        <div className="flex items-center gap-2">
            <input 
                type="text" 
                value={mapping[field] || ''} 
                onChange={(e) => handleMappingChange(field, e.target.value)}
                className="w-20 text-center border border-gray-300 rounded px-2 py-1 font-mono font-bold text-emerald-600 focus:ring-2 focus:ring-emerald-200 focus:border-emerald-500 outline-none uppercase placeholder:text-gray-200 text-xs"
                placeholder={placeholder}
            />
        </div>
    </div>
  );

  const getTitle = () => {
      switch(activeTypeId) {
          case TEMPLATE_IDS.PHARMACIST: return "藥師分頁範本";
          case TEMPLATE_IDS.REPURCHASE: return "回購總表範本";
          default: return "門市人員範本";
      }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden flex max-h-[90vh]">
        
        {/* Sidebar */}
        <div className="w-48 bg-slate-50 border-r border-gray-200 flex flex-col shrink-0">
            <div className="p-4 border-b border-gray-200 bg-slate-100">
                <h3 className="font-bold text-slate-700 flex items-center gap-2">
                    <FileSpreadsheet size={18}/> 匯出設定
                </h3>
            </div>
            <div className="p-2 space-y-1">
                <button 
                    onClick={() => { setActiveTypeId(TEMPLATE_IDS.SALES); setActiveTab('FILE'); setMessage(''); }}
                    className={`w-full text-left px-3 py-2 rounded text-sm font-bold flex items-center gap-2 ${activeTypeId === TEMPLATE_IDS.SALES ? 'bg-white text-blue-600 shadow-sm border border-gray-200' : 'text-gray-500 hover:bg-gray-100'}`}
                >
                    <User size={16}/> 門市人員
                </button>
                <button 
                    onClick={() => { setActiveTypeId(TEMPLATE_IDS.PHARMACIST); setActiveTab('FILE'); setMessage(''); }}
                    className={`w-full text-left px-3 py-2 rounded text-sm font-bold flex items-center gap-2 ${activeTypeId === TEMPLATE_IDS.PHARMACIST ? 'bg-white text-blue-600 shadow-sm border border-gray-200' : 'text-gray-500 hover:bg-gray-100'}`}
                >
                    <Stethoscope size={16}/> 藥師人員
                </button>
                <button 
                    onClick={() => { setActiveTypeId(TEMPLATE_IDS.REPURCHASE); setActiveTab('FILE'); setMessage(''); }}
                    className={`w-full text-left px-3 py-2 rounded text-sm font-bold flex items-center gap-2 ${activeTypeId === TEMPLATE_IDS.REPURCHASE ? 'bg-white text-blue-600 shadow-sm border border-gray-200' : 'text-gray-500 hover:bg-gray-100'}`}
                >
                    <RefreshCcw size={16}/> 回購總表
                </button>
            </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 flex flex-col">
            <div className="bg-slate-800 text-white px-6 py-4 flex justify-between items-center shrink-0">
                <h3 className="text-lg font-bold">{getTitle()}</h3>
                <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={24}/></button>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-gray-200 bg-gray-50 shrink-0">
                <button onClick={() => setActiveTab('FILE')} className={`flex-1 py-3 text-sm font-bold ${activeTab === 'FILE' ? 'bg-white text-blue-600 border-t-2 border-t-blue-600' : 'text-gray-500 hover:bg-gray-100'}`}>
                    1. 範本檔案
                </button>
                <button onClick={() => setActiveTab('MAPPING')} disabled={!currentTemplate} className={`flex-1 py-3 text-sm font-bold ${activeTab === 'MAPPING' ? 'bg-white text-blue-600 border-t-2 border-t-blue-600' : 'text-gray-400'}`}>
                    2. 列表欄位對應
                </button>
                <button onClick={() => setActiveTab('STATS')} disabled={!currentTemplate} className={`flex-1 py-3 text-sm font-bold ${activeTab === 'STATS' ? 'bg-white text-emerald-600 border-t-2 border-t-emerald-600' : 'text-gray-400'}`}>
                    3. 統計/固定欄位
                </button>
            </div>

            <div className="p-6 overflow-y-auto flex-1 relative bg-white">
                {activeTab === 'FILE' && (
                    <div className="space-y-6">
                        <div className="bg-slate-50 p-4 rounded-lg border border-slate-200">
                            <h4 className="text-sm font-bold text-slate-700 mb-2">目前的{getTitle()}</h4>
                            {currentTemplate ? (
                                <div className="flex items-center justify-between bg-white p-3 rounded border border-emerald-200 shadow-sm">
                                    <div className="flex items-center gap-3">
                                        <div className="bg-emerald-100 p-2 rounded text-emerald-600">
                                            <FileSpreadsheet size={24} />
                                        </div>
                                        <div>
                                            <div className="font-bold text-slate-800 text-sm truncate max-w-[250px]">{currentTemplate.name}</div>
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
                                <strong>說明：</strong> 上傳後請切換至「欄位對應」指定資料欄位。
                            </p>
                        </div>
                    </div>
                )}

                {activeTab === 'MAPPING' && (
                    <div className="space-y-4">
                        <div className="bg-blue-50 p-3 rounded border border-blue-100 text-blue-800 text-xs mb-4">
                            <Table2 size={16} className="inline mr-1 mb-0.5"/>
                            設定系統資料要填入 Excel 的哪一欄 (例如 A, B)。這是針對「流水帳明細」的設定。
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

                        {activeTypeId === TEMPLATE_IDS.REPURCHASE ? (
                            <div className="space-y-1">
                                {renderColInput('分類', 'category', 'A')}
                                {renderColInput('日期', 'date', 'B')}
                                {renderColInput('客戶編號', 'customerID', 'C')}
                                {renderColInput('品項編號', 'itemID', 'D')}
                                {renderColInput('品名', 'itemName', 'E')}
                                {renderColInput('數量', 'quantity', 'F')}
                                {renderColInput('回購點數', 'repurchasePoints', 'G')}
                                {renderColInput('原開發者', 'originalDeveloper', 'H')}
                                {renderColInput('開發點數', 'devPoints', 'I')}
                            </div>
                        ) : (
                            <>
                            <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-2 mb-1 border-b pb-1">第一階段：點數表</div>
                            <div className="space-y-1">
                                {renderColInput('分類', 'category', 'A')}
                                {renderColInput('日期', 'date', 'B')}
                                {renderColInput('客戶編號', 'customerID', 'C')}
                                {renderColInput('品項編號', 'itemID', 'D')}
                                {renderColInput('品名', 'itemName', 'E')}
                                {renderColInput('數量', 'quantity', 'F')}
                                {renderColInput('金額', 'amount', 'G')}
                                {renderColInput('備註 (狀態)', 'note', 'H')}
                                {renderColInput(activeTypeId === TEMPLATE_IDS.PHARMACIST ? '藥師點數' : '計算點數', 'points', 'I')}
                            </div>

                            {activeTypeId !== TEMPLATE_IDS.PHARMACIST && (
                                <>
                                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wider mt-6 mb-1 border-b pb-1">第二階段：現金獎勵/調劑</div>
                                    <div className="space-y-1">
                                        {renderColInput('分類', 'reward_category', 'A')}
                                        {renderColInput('日期', 'reward_date', 'B')}
                                        {renderColInput('客戶編號', 'reward_customerID', 'C')}
                                        {renderColInput('品項編號', 'reward_itemID', 'D')}
                                        {renderColInput('品名', 'reward_itemName', 'E')}
                                        {renderColInput('數量', 'reward_quantity', 'F')}
                                        {renderColInput('備註', 'reward_note', 'G')}
                                        {renderColInput('獎勵/金額', 'reward_amount', 'H')}
                                    </div>
                                </>
                            )}
                            </>
                        )}

                        <div className="flex justify-end pt-4">
                            <button onClick={handleSaveConfig} className="flex items-center gap-2 bg-slate-800 text-white px-6 py-2 rounded font-bold hover:bg-slate-700 shadow-md">
                                <Save size={16}/> 儲存設定
                            </button>
                        </div>
                    </div>
                )}

                {activeTab === 'STATS' && (
                     <div className="space-y-4">
                        <div className="bg-emerald-50 p-3 rounded border border-emerald-100 text-emerald-800 text-xs mb-4">
                            <LayoutGrid size={16} className="inline mr-1 mb-0.5"/>
                            設定固定數值要填入 Excel 的哪一格 (例如 D4, G10)。未設定則不填入。
                        </div>
                        
                        <div className="grid grid-cols-2 gap-x-8 gap-y-1">
                            {/* Basic Info - Available for all types (Sales/Pharm) except maybe Repurchase */}
                            {activeTypeId !== TEMPLATE_IDS.REPURCHASE && (
                                <>
                                    <div className="col-span-2 text-xs font-bold text-slate-400 uppercase tracking-wider mt-2 mb-1 border-b pb-1">基本資訊 (填入特定儲存格)</div>
                                    {renderCellInput('店名 (分店)', 'storeName', '例如 B2')}
                                    {renderCellInput('編號 (ID)', 'staffID', '例如 D2')}
                                    {renderCellInput('姓名', 'staffName', '例如 F2')}
                                </>
                            )}

                            {/* Sales Only Sections */}
                            {activeTypeId === TEMPLATE_IDS.SALES && (
                                <>
                                    {/* Points Section */}
                                    <div className="col-span-2 text-xs font-bold text-slate-400 uppercase tracking-wider mt-4 mb-1 border-b pb-1">點數相關</div>
                                    {renderCellInput('點數標準 (來自員工設定)', 'cell_pointsStd')}
                                    {renderCellInput('點數總計 (不填入)', 'cell_pointsTotal')}
                                    {renderCellInput('個人開發 (除回購外總和)', 'cell_pointsDev')}
                                    {renderCellInput('總表回購 (個人回購總和)', 'cell_pointsRep')}
                                    {renderCellInput('總表開發 (他店回購差額)', 'cell_pointsTableDev')}
                                    {renderCellInput('奶粉開發 (不填入)', 'cell_pointsMilkDev')}

                                    {/* Cosmetic Section */}
                                    <div className="col-span-2 text-xs font-bold text-slate-400 uppercase tracking-wider mt-4 mb-1 border-b pb-1">美妝品牌金額</div>
                                    {renderCellInput('美妝標準 (來自員工設定)', 'cell_cosmeticStd')}
                                    {renderCellInput('美妝總計', 'cell_cosmeticTotal')}
                                    {renderCellInput('理膚 (LRP)', 'cell_amtLrp')}
                                    {renderCellInput('適樂膚 (CeraVe)', 'cell_amtCerave')}
                                    {renderCellInput('Dr.Satin', 'cell_amtDrSatin')}
                                    {renderCellInput('舒特膚 (Cetaphil)', 'cell_amtCetaphil')}
                                    {renderCellInput('芙樂思 (Flora)', 'cell_amtFlora')}
                                    {renderCellInput('員購 (不填入)', 'cell_amtEmployee')}

                                    {/* Rewards Section */}
                                    <div className="col-span-2 text-xs font-bold text-slate-400 uppercase tracking-wider mt-4 mb-1 border-b pb-1">其他獎勵合計</div>
                                    {renderCellInput('現金獎勵總額', 'cell_rewardCash')}
                                    {renderCellInput('小兒奶粉 (不填入)', 'cell_rewardMilk')}
                                    {renderCellInput('7-11 禮卷張數', 'cell_reward711')}
                                    {renderCellInput('全家 禮卷張數', 'cell_rewardFamily')}
                                    {renderCellInput('全聯 禮卷張數', 'cell_rewardPx')}
                                </>
                            )}

                            {/* Pharmacist Stats */}
                            {activeTypeId === TEMPLATE_IDS.PHARMACIST && (
                                <>
                                    <div className="col-span-2 text-xs font-bold text-slate-400 uppercase tracking-wider mt-4 mb-1 border-b pb-1">藥師點數 (預覽介面數值)</div>
                                    {renderCellInput('個人點數 (開發+半+退)', 'cell_pharm_points_dev', '例如 G2')}
                                    {renderCellInput('總表回購 (個人回購)', 'cell_pharm_points_rep', '例如 G3')}
                                    {renderCellInput('總表開發 (他店回購差額)', 'cell_pharm_points_table_dev', '例如 G4')}

                                    <div className="col-span-2 text-xs font-bold text-slate-400 uppercase tracking-wider mt-4 mb-1 border-b pb-1">調劑件數與獎金</div>
                                    {renderCellInput('自費調劑 (001727) 數量', 'cell_pharm_qty_1727', '例如 F4')}
                                    {renderCellInput('調劑藥事服務費 (001345) 數量', 'cell_pharm_qty_1345', '例如 F6')}
                                    {renderCellInput('調劑獎金總額', 'cell_pharm_bonus', '例如 H4')}
                                </>
                            )}
                        </div>

                         <div className="flex justify-end pt-4">
                            <button onClick={handleSaveConfig} className="flex items-center gap-2 bg-slate-800 text-white px-6 py-2 rounded font-bold hover:bg-slate-700 shadow-md">
                                <Save size={16}/> 儲存設定
                            </button>
                        </div>
                     </div>
                )}

                {message && (
                    <div className="absolute bottom-4 left-6 right-6 bg-emerald-50 text-emerald-700 px-4 py-2 rounded text-sm font-bold flex items-center gap-2 animate-in fade-in slide-in-from-bottom-2 border border-emerald-200 shadow-sm">
                        <CheckCircle2 size={16} /> {message}
                    </div>
                )}
                
            </div>
        </div>
      </div>
    </div>
  );
};

export default ExportSettingsModal;
