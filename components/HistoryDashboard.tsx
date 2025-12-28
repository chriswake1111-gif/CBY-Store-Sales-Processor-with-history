
import React, { useState, useEffect } from 'react';
import { 
  LayoutDashboard, Database, Upload, Store, Settings, 
  ArrowLeft, HardDrive, PieChart, RefreshCw, Trash2, 
  Plus, Save, Edit2, X, FolderOpen, Calendar, ChevronRight, 
  ChevronDown, FileText, CheckCircle2, AlertTriangle, Search
} from 'lucide-react';
import { 
  getHistoryCount, clearHistory, bulkAddHistory, HistoryRecord, 
  getHistoryStatsByStore, deleteStoreHistory, getStores, 
  addStore, updateStore, deleteStore, getAvailableYearsByStore, 
  deleteHistoryByYear, getMonthlyStatsByStoreAndYear, deleteHistoryByMonth 
} from '../utils/db';
import { readExcelFile } from '../utils/excelHelper';
import { COL_HEADERS } from '../constants';
import { StoreRecord } from '../types';

interface HistoryDashboardProps {
  onBack: () => void;
}

const CHUNK_SIZE = 2000;

type DashboardView = 'OVERVIEW' | 'EXPLORER' | 'IMPORT' | 'STORES';

const HistoryDashboard: React.FC<HistoryDashboardProps> = ({ onBack }) => {
  const [activeView, setActiveView] = useState<DashboardView>('OVERVIEW');
  const [totalRecords, setTotalRecords] = useState(0);
  const [storeStats, setStoreStats] = useState<{ storeName: string; count: number }[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [availableStores, setAvailableStores] = useState<StoreRecord[]>([]);

  // Explorer State
  const [selectedStore, setSelectedStore] = useState<string | null>(null);
  const [explorerYears, setExplorerYears] = useState<string[]>([]);
  const [expandedYear, setExpandedYear] = useState<string | null>(null);
  const [monthlyStats, setMonthlyStats] = useState<{ month: string, count: number }[]>([]);

  // Import State
  const [importTargetStore, setImportTargetStore] = useState('');
  const [importProgress, setImportProgress] = useState(0);
  const [importMessage, setImportMessage] = useState('');
  const [importStatus, setImportStatus] = useState<'idle' | 'processing' | 'success' | 'error'>('idle');

  // Store Management State
  const [newStoreName, setNewStoreName] = useState('');
  const [editingStoreId, setEditingStoreId] = useState<number | null>(null);
  const [editingStoreName, setEditingStoreName] = useState('');

  useEffect(() => {
    refreshGlobalStats();
    loadStores();
  }, []);

  useEffect(() => {
     if (selectedStore) {
         loadExplorerYears(selectedStore);
         setExpandedYear(null);
     }
  }, [selectedStore]);

  useEffect(() => {
      if (selectedStore && expandedYear) {
          loadMonthlyStats(selectedStore, expandedYear);
      }
  }, [selectedStore, expandedYear]);

  const refreshGlobalStats = async () => {
    const total = await getHistoryCount();
    const stats = await getHistoryStatsByStore();
    setTotalRecords(total);
    setStoreStats(stats);
  };

  const loadStores = async () => {
    const list = await getStores();
    setAvailableStores(list);
  };

  const loadExplorerYears = async (store: string) => {
      const years = await getAvailableYearsByStore(store);
      setExplorerYears(years);
  };

  const loadMonthlyStats = async (store: string, year: string) => {
      const stats = await getMonthlyStatsByStoreAndYear(store, year);
      setMonthlyStats(stats);
  };

  // --- ACTIONS ---

  const handleDeleteStoreData = async (storeName: string) => {
      if (!window.confirm(`確定要刪除「${storeName}」的所有歷史資料嗎？此動作無法復原。`)) return;
      setIsProcessing(true);
      await deleteStoreHistory(storeName);
      await refreshGlobalStats();
      if (selectedStore === storeName) setSelectedStore(null);
      setIsProcessing(false);
  };

  const handleDeleteYearData = async (storeName: string, year: string) => {
      if (!window.confirm(`確定要刪除「${storeName} ${year}年」的所有資料嗎？`)) return;
      setIsProcessing(true);
      await deleteHistoryByYear(storeName, year);
      await loadExplorerYears(storeName);
      await refreshGlobalStats();
      setExpandedYear(null);
      setIsProcessing(false);
  };

  const handleDeleteMonthData = async (storeName: string, year: string, month: string) => {
      if (!window.confirm(`確定要刪除「${storeName} ${year}年${month}月」的資料嗎？`)) return;
      setIsProcessing(true);
      await deleteHistoryByMonth(storeName, year, month);
      await loadMonthlyStats(storeName, year);
      await refreshGlobalStats();
      setIsProcessing(false);
  };

  const handleClearAll = async () => {
      const confirmStr = prompt("警告：此操作將清空整個資料庫！若確定請輸入「DELETE」");
      if (confirmStr !== 'DELETE') return;
      setIsProcessing(true);
      await clearHistory();
      await refreshGlobalStats();
      setSelectedStore(null);
      setIsProcessing(false);
  };

  // --- IMPORT LOGIC ---
  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
        const file = e.target.files[0];
        // Auto-detect store
        const found = availableStores.find(s => file.name.includes(s.name));
        if (found) setImportTargetStore(found.name);
        handleImport(file);
    }
    e.target.value = '';
  };

  const handleImport = async (file: File) => {
      if (!importTargetStore) {
          alert("請先選擇目標分店！");
          return;
      }
      setImportStatus('processing');
      setImportMessage(`正在讀取檔案：${file.name}`);
      setImportProgress(0);

      try {
        const json = await readExcelFile(file);
        const storeName = importTargetStore;
        
        let processed = 0;
        let buffer: HistoryRecord[] = [];

        for (let i = 0; i < json.length; i++) {
            const row = json[i] as any;
            const cid = String(row[COL_HEADERS.CUSTOMER_ID] || '').trim();
            const itemID = String(row[COL_HEADERS.ITEM_ID] || '').trim();

            if (cid && itemID && cid !== 'undefined' && itemID !== 'undefined') {
                 // Basic Fields
                 const qty = Number(row[COL_HEADERS.QUANTITY]) || 0;
                 const price = Number(row[COL_HEADERS.UNIT_PRICE] || row['單價'] || 0);
                 const unit = String(row[COL_HEADERS.UNIT] || row['單位'] || '').trim();
                 const dateStr = String(row[COL_HEADERS.SALES_DATE] || row[COL_HEADERS.TICKET_NO] || '').trim();
                 const salesPerson = String(row[COL_HEADERS.SALES_PERSON] || '').trim();

                 // Enhanced Fields for Analytics
                 const itemName = String(row[COL_HEADERS.ITEM_NAME] || row['品項名稱'] || row['品名'] || '').trim();
                 const cost = Number(row['成本'] || row['Cost'] || 0);
                 const profit = Number(row['毛利'] || row['Profit'] || 0);
                 const amount = Number(row[COL_HEADERS.SUBTOTAL] || row['小計'] || row['Amount'] || 0);
                 const category = String(row[COL_HEADERS.CAT_1] || row['品類一'] || row['Category'] || '').trim();
                 const points = Number(row[COL_HEADERS.POINTS] || row['點數'] || row['Points'] || 0);

                 buffer.push({
                    customerID: cid, itemID, date: dateStr, quantity: qty,
                    price, unit, storeName, salesPerson,
                    // New fields
                    itemName, cost, profit, amount, category, points
                 });
            }

            if (buffer.length >= CHUNK_SIZE || i === json.length - 1) {
                if (buffer.length > 0) {
                    await bulkAddHistory(buffer);
                    processed += buffer.length;
                    buffer = [];
                }
                setImportProgress(Math.round(((i+1) / json.length) * 100));
                await new Promise(r => setTimeout(r, 0));
            }
        }
        
        await refreshGlobalStats();
        setImportStatus('success');
        setImportMessage(`匯入完成！成功寫入 ${processed.toLocaleString()} 筆資料`);
      } catch (err: any) {
          setImportStatus('error');
          setImportMessage(`匯入失敗：${err.message}`);
      }
  };

  // --- STORE SETTINGS LOGIC ---
  const handleAddStore = async () => {
      if (newStoreName.trim()) {
          await addStore(newStoreName.trim());
          setNewStoreName('');
          loadStores();
      }
  };
  const handleUpdateStore = async (id: number) => {
      if (editingStoreName.trim()) {
          await updateStore(id, editingStoreName.trim());
          setEditingStoreId(null);
          loadStores();
      }
  };
  const handleDeleteStore = async (id: number, name: string) => {
      if(confirm(`確定移除「${name}」？此操作不會刪除歷史資料。`)) {
          await deleteStore(id);
          loadStores();
      }
  };

  // --- RENDERERS ---

  const SidebarItem = ({ view, label, icon: Icon }: { view: DashboardView, label: string, icon: any }) => (
      <button 
        onClick={() => setActiveView(view)}
        className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-bold rounded-lg transition-colors
            ${activeView === view ? 'bg-blue-600 text-white shadow-md' : 'text-slate-400 hover:bg-slate-800 hover:text-white'}
        `}
      >
          <Icon size={18} /> {label}
      </button>
  );

  const StatCard = ({ title, value, icon: Icon, colorClass }: any) => (
      <div className="bg-white p-6 rounded-xl border border-gray-100 shadow-sm flex items-center justify-between">
          <div>
              <div className="text-slate-500 text-xs font-bold uppercase tracking-wider mb-1">{title}</div>
              <div className="text-2xl font-black text-slate-800 font-mono">{value}</div>
          </div>
          <div className={`p-3 rounded-full ${colorClass} opacity-80`}>
              <Icon size={24} />
          </div>
      </div>
  );

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden font-sans">
        
        {/* Sidebar */}
        <div className="w-64 bg-slate-900 text-slate-300 flex flex-col shrink-0">
            <div className="p-6 border-b border-slate-800">
                <h1 className="text-white font-black text-xl tracking-tight flex items-center gap-2">
                    <Database className="text-blue-500"/> 資料管理中心
                </h1>
                <p className="text-xs text-slate-500 mt-1 font-mono">History Data Center</p>
            </div>
            
            <div className="flex-1 p-4 space-y-2 overflow-y-auto">
                <SidebarItem view="OVERVIEW" label="總覽儀表板" icon={LayoutDashboard} />
                <SidebarItem view="EXPLORER" label="資料瀏覽與管理" icon={FolderOpen} />
                <SidebarItem view="IMPORT" label="匯入歷史資料" icon={Upload} />
                <SidebarItem view="STORES" label="分店設定" icon={Store} />
            </div>

            <div className="p-4 border-t border-slate-800">
                <button onClick={onBack} className="w-full flex items-center justify-center gap-2 px-4 py-2 border border-slate-700 rounded-lg text-slate-400 hover:bg-slate-800 hover:text-white transition-colors text-sm font-bold">
                    <ArrowLeft size={16}/> 返回計算器
                </button>
            </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 overflow-y-auto p-8">
            <div className="max-w-6xl mx-auto">
                
                {/* Header */}
                <div className="mb-8 flex justify-between items-center">
                    <div>
                        <h2 className="text-2xl font-black text-slate-800">
                            {activeView === 'OVERVIEW' && '總覽儀表板'}
                            {activeView === 'EXPLORER' && '資料瀏覽器'}
                            {activeView === 'IMPORT' && '資料匯入'}
                            {activeView === 'STORES' && '分店設定'}
                        </h2>
                        <p className="text-slate-500 text-sm mt-1">管理與分析您的歷史銷售紀錄</p>
                    </div>
                    {isProcessing && (
                         <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg animate-pulse font-bold text-sm">
                             <RefreshCw size={16} className="animate-spin"/> 系統處理中...
                         </div>
                    )}
                </div>

                {/* --- OVERVIEW --- */}
                {activeView === 'OVERVIEW' && (
                    <div className="space-y-6">
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <StatCard title="總資料筆數" value={totalRecords.toLocaleString()} icon={HardDrive} colorClass="bg-blue-100 text-blue-600" />
                            <StatCard title="已建檔分店" value={availableStores.length} icon={Store} colorClass="bg-purple-100 text-purple-600" />
                            <StatCard title="資料庫狀態" value="Online" icon={CheckCircle2} colorClass="bg-emerald-100 text-emerald-600" />
                        </div>

                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
                                <h3 className="font-bold text-slate-700 flex items-center gap-2"><PieChart size={18}/> 各分店資料分佈</h3>
                                <button onClick={handleClearAll} className="text-xs text-red-500 hover:text-red-700 hover:underline">清空所有資料</button>
                            </div>
                            <div className="divide-y divide-gray-100">
                                {storeStats.map((stat, idx) => (
                                    <div key={idx} className="px-6 py-4 flex items-center justify-between hover:bg-slate-50 transition-colors">
                                        <div className="flex items-center gap-3">
                                            <div className="w-8 h-8 rounded-full bg-slate-100 flex items-center justify-center font-bold text-slate-500 text-xs">
                                                {stat.storeName.substring(0, 1)}
                                            </div>
                                            <div>
                                                <div className="font-bold text-slate-800">{stat.storeName}</div>
                                                <div className="text-xs text-slate-400">上次更新：-</div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4">
                                            <div className="text-right">
                                                <div className="font-mono font-bold text-slate-700">{stat.count.toLocaleString()}</div>
                                                <div className="text-[10px] text-slate-400 uppercase">Records</div>
                                            </div>
                                            <button onClick={() => handleDeleteStoreData(stat.storeName)} className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-full transition-colors">
                                                <Trash2 size={16} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                                {storeStats.length === 0 && (
                                    <div className="p-12 text-center text-gray-300">目前無資料</div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* --- EXPLORER --- */}
                {activeView === 'EXPLORER' && (
                    <div className="flex h-[600px] bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                        {/* Column 1: Stores */}
                        <div className="w-1/3 border-r border-gray-200 flex flex-col">
                            <div className="p-3 bg-slate-50 border-b border-gray-200 font-bold text-xs text-slate-500 uppercase tracking-wider">
                                1. 選擇分店
                            </div>
                            <div className="flex-1 overflow-y-auto">
                                {storeStats.map(s => (
                                    <button 
                                        key={s.storeName} 
                                        onClick={() => setSelectedStore(s.storeName)}
                                        className={`w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-slate-50 flex justify-between items-center
                                            ${selectedStore === s.storeName ? 'bg-blue-50 text-blue-700 font-bold border-l-4 border-l-blue-600' : 'text-slate-600'}
                                        `}
                                    >
                                        <span>{s.storeName}</span>
                                        <span className="text-xs bg-gray-100 px-2 py-0.5 rounded text-gray-500">{s.count.toLocaleString()}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Column 2: Years */}
                        <div className="w-1/3 border-r border-gray-200 flex flex-col">
                            <div className="p-3 bg-slate-50 border-b border-gray-200 font-bold text-xs text-slate-500 uppercase tracking-wider">
                                2. 選擇年份
                            </div>
                            <div className="flex-1 overflow-y-auto bg-gray-50/30">
                                {!selectedStore ? (
                                    <div className="p-8 text-center text-gray-400 text-sm">請先選擇分店</div>
                                ) : explorerYears.length === 0 ? (
                                    <div className="p-8 text-center text-gray-400 text-sm">此分店無資料</div>
                                ) : (
                                    explorerYears.map(year => (
                                        <div key={year} className={`group flex flex-col border-b border-gray-100 bg-white ${expandedYear === year ? 'ring-2 ring-inset ring-blue-100' : ''}`}>
                                            <div 
                                                onClick={() => setExpandedYear(expandedYear === year ? null : year)}
                                                className="px-4 py-3 cursor-pointer hover:bg-slate-50 flex justify-between items-center"
                                            >
                                                <div className="flex items-center gap-2">
                                                    <Calendar size={16} className="text-slate-400"/>
                                                    <span className="font-bold text-slate-700 text-lg">{year} 年</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); handleDeleteYearData(selectedStore, year); }}
                                                        className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                                                        title="刪除整年資料"
                                                    >
                                                        <Trash2 size={14}/>
                                                    </button>
                                                    <ChevronRight size={16} className={`text-slate-300 transition-transform ${expandedYear === year ? 'rotate-90' : ''}`}/>
                                                </div>
                                            </div>
                                            
                                            {/* Nested Months (Only visible if expanded) */}
                                            {expandedYear === year && (
                                                <div className="bg-slate-50 border-t border-gray-100 px-4 py-2 space-y-1 animate-in slide-in-from-top-1">
                                                    {monthlyStats.length === 0 ? (
                                                        <div className="text-xs text-gray-400 text-center py-2">讀取中...</div>
                                                    ) : (
                                                        monthlyStats.map(m => (
                                                            <div key={m.month} className="flex justify-between items-center py-1.5 px-2 rounded hover:bg-white border border-transparent hover:border-gray-200">
                                                                <div className="flex items-center gap-2 text-sm text-slate-600 font-mono">
                                                                    <div className="w-1.5 h-1.5 rounded-full bg-blue-400"></div>
                                                                    {m.month} 月
                                                                </div>
                                                                <div className="flex items-center gap-3">
                                                                    <span className="text-xs text-slate-400 font-mono">{m.count.toLocaleString()} 筆</span>
                                                                    <button 
                                                                        onClick={() => handleDeleteMonthData(selectedStore, year, m.month)}
                                                                        className="text-gray-300 hover:text-red-500"
                                                                        title="刪除此月資料"
                                                                    >
                                                                        <Trash2 size={12}/>
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        ))
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    ))
                                )}
                            </div>
                        </div>

                        {/* Column 3: Details (Placeholder) */}
                         <div className="w-1/3 flex flex-col items-center justify-center p-8 text-center bg-slate-50/50 text-slate-400">
                             <FileText size={48} className="mb-4 text-slate-200"/>
                             <h4 className="font-bold text-slate-500">資料明細預覽</h4>
                             <p className="text-xs mt-2 max-w-[200px]">選擇年份與月份後，未來可在此處預覽前 50 筆資料 (開發中)</p>
                         </div>
                    </div>
                )}

                {/* --- IMPORT --- */}
                {activeView === 'IMPORT' && (
                    <div className="max-w-2xl mx-auto">
                        <div className="bg-white p-8 rounded-xl shadow-sm border border-gray-200">
                            <h3 className="text-lg font-bold text-slate-800 mb-6 flex items-center gap-2">
                                <Upload className="text-blue-500"/> 匯入歷史銷售資料
                            </h3>
                            
                            <div className="mb-6">
                                <label className="block text-sm font-bold text-slate-600 mb-2">1. 選擇歸屬分店</label>
                                <div className="relative">
                                    <select 
                                        value={importTargetStore} 
                                        onChange={(e) => setImportTargetStore(e.target.value)}
                                        className="w-full p-3 border border-gray-300 rounded-lg appearance-none font-bold text-slate-700 focus:ring-2 focus:ring-blue-500 outline-none"
                                    >
                                        <option value="">請下拉選擇分店...</option>
                                        {availableStores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                                    </select>
                                    <ChevronDown className="absolute right-3 top-3.5 text-gray-400 pointer-events-none" size={20}/>
                                </div>
                            </div>

                            <div className="mb-8">
                                <label className="block text-sm font-bold text-slate-600 mb-2">2. 上傳 Excel 檔案</label>
                                <label className={`
                                    flex flex-col items-center justify-center w-full h-40 border-2 border-dashed rounded-xl cursor-pointer transition-all
                                    ${importStatus === 'processing' ? 'bg-gray-50 border-gray-300' : 'bg-blue-50 border-blue-300 hover:bg-blue-100'}
                                `}>
                                    <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                        {importStatus === 'processing' ? (
                                            <RefreshCw className="w-10 h-10 mb-3 text-blue-500 animate-spin" />
                                        ) : (
                                            <Upload className="w-10 h-10 mb-3 text-blue-500" />
                                        )}
                                        <p className="mb-2 text-sm text-slate-600 font-bold">點擊上傳或拖曳檔案至此</p>
                                        <p className="text-xs text-slate-400">支援 .xlsx, .xls 格式</p>
                                    </div>
                                    <input type="file" className="hidden" accept=".xlsx, .xls" onChange={handleFileSelect} disabled={importStatus === 'processing'} />
                                </label>
                            </div>

                            {importStatus !== 'idle' && (
                                <div className={`p-4 rounded-lg flex items-start gap-3 ${
                                    importStatus === 'error' ? 'bg-red-50 text-red-800 border border-red-200' : 
                                    importStatus === 'success' ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' : 
                                    'bg-blue-50 text-blue-800 border border-blue-200'
                                }`}>
                                    {importStatus === 'error' ? <AlertTriangle className="shrink-0 mt-0.5" size={18}/> : 
                                     importStatus === 'success' ? <CheckCircle2 className="shrink-0 mt-0.5" size={18}/> : 
                                     <RefreshCw className="shrink-0 mt-0.5 animate-spin" size={18}/>}
                                    <div className="flex-1">
                                        <div className="font-bold text-sm">{importMessage}</div>
                                        {importStatus === 'processing' && (
                                            <div className="w-full bg-blue-200 rounded-full h-1.5 mt-2">
                                                <div className="bg-blue-600 h-1.5 rounded-full transition-all duration-300" style={{ width: `${importProgress}%` }}></div>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* --- STORES --- */}
                {activeView === 'STORES' && (
                    <div className="max-w-4xl">
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 p-6">
                             <h3 className="font-bold text-slate-700 mb-4 flex items-center gap-2"><Store size={20}/> 分店清單管理</h3>
                             
                             <div className="flex gap-2 mb-6">
                                <input 
                                    type="text" 
                                    placeholder="輸入新分店名稱..." 
                                    value={newStoreName} 
                                    onChange={e => setNewStoreName(e.target.value)}
                                    className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                                />
                                <button onClick={handleAddStore} className="bg-blue-600 text-white px-6 py-2 rounded-lg font-bold hover:bg-blue-700 flex items-center gap-2">
                                    <Plus size={18}/> 新增
                                </button>
                             </div>

                             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                                 {availableStores.map(store => (
                                     <div key={store.id} className="p-3 border border-gray-200 rounded-lg flex justify-between items-center group hover:border-blue-300 hover:shadow-sm transition-all bg-slate-50">
                                         {editingStoreId === store.id ? (
                                             <div className="flex gap-1 w-full">
                                                 <input 
                                                     autoFocus
                                                     value={editingStoreName}
                                                     onChange={e => setEditingStoreName(e.target.value)}
                                                     className="flex-1 px-2 py-1 text-sm border border-blue-400 rounded outline-none"
                                                 />
                                                 <button onClick={() => handleUpdateStore(store.id!)} className="p-1 text-green-600 bg-green-50 rounded hover:bg-green-100"><Save size={14}/></button>
                                                 <button onClick={() => setEditingStoreId(null)} className="p-1 text-gray-400 hover:bg-gray-200 rounded"><X size={14}/></button>
                                             </div>
                                         ) : (
                                             <>
                                                 <span className="font-bold text-slate-700">{store.name}</span>
                                                 <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                                     <button 
                                                        onClick={() => { setEditingStoreId(store.id!); setEditingStoreName(store.name); }}
                                                        className="p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 rounded"
                                                     >
                                                         <Edit2 size={14}/>
                                                     </button>
                                                     <button 
                                                        onClick={() => handleDeleteStore(store.id!, store.name)}
                                                        className="p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded"
                                                     >
                                                         <Trash2 size={14}/>
                                                     </button>
                                                 </div>
                                             </>
                                         )}
                                     </div>
                                 ))}
                             </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    </div>
  );
};

export default HistoryDashboard;
