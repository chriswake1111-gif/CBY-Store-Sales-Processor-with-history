
import React, { useState, useEffect, useRef } from 'react';
import { 
  LayoutDashboard, Database, Upload, Store, Settings, 
  ArrowLeft, HardDrive, PieChart, RefreshCw, Trash2, 
  Plus, Save, Edit2, X, FolderOpen, Calendar, ChevronRight, 
  ChevronDown, FileText, CheckCircle2, AlertTriangle, Search, Play, List, FileSpreadsheet
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

// Queue Item Interface
interface ImportQueueItem {
    id: string;
    file: File;
    targetStore: string;
    status: 'pending' | 'processing' | 'success' | 'error';
    progress: number;
    message?: string;
}

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

  // Import Queue State (New)
  const [importQueue, setImportQueue] = useState<ImportQueueItem[]>([]);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  // --- BATCH IMPORT LOGIC ---
  
  const handleFilesSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
          const newItems: ImportQueueItem[] = Array.from(e.target.files).map((file: File) => {
              // Auto-detect store from filename
              const foundStore = availableStores.find(s => file.name.includes(s.name));
              return {
                  id: Math.random().toString(36).substr(2, 9),
                  file: file,
                  targetStore: foundStore ? foundStore.name : '',
                  status: 'pending',
                  progress: 0
              };
          });
          setImportQueue(prev => [...prev, ...newItems]);
      }
      if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const updateQueueItemStore = (id: string, storeName: string) => {
      setImportQueue(prev => prev.map(item => item.id === id ? { ...item, targetStore: storeName } : item));
  };

  const removeQueueItem = (id: string) => {
      setImportQueue(prev => prev.filter(item => item.id !== id));
  };

  const clearCompletedQueue = () => {
      setImportQueue(prev => prev.filter(item => item.status !== 'success'));
  };

  // Core Processing Function for a single file
  const processSingleFile = async (item: ImportQueueItem, updateProgress: (pct: number) => void) => {
      if (!item.targetStore) throw new Error("未指定目標分店");
      
      const json = await readExcelFile(item.file);
      const storeName = item.targetStore;
      
      let processed = 0;
      let buffer: HistoryRecord[] = [];

      for (let i = 0; i < json.length; i++) {
          const row = json[i] as any;
          const cid = String(row[COL_HEADERS.CUSTOMER_ID] || '').trim();
          const itemID = String(row[COL_HEADERS.ITEM_ID] || '').trim();

          if (cid && itemID && cid !== 'undefined' && itemID !== 'undefined') {
                const qty = Number(row[COL_HEADERS.QUANTITY]) || 0;
                const price = Number(row[COL_HEADERS.UNIT_PRICE] || row['單價'] || 0);
                const unit = String(row[COL_HEADERS.UNIT] || row['單位'] || '').trim();
                const dateStr = String(row[COL_HEADERS.SALES_DATE] || row[COL_HEADERS.TICKET_NO] || '').trim();
                const salesPerson = String(row[COL_HEADERS.SALES_PERSON] || '').trim();

                const itemName = String(row[COL_HEADERS.ITEM_NAME] || row['品項名稱'] || row['品名'] || '').trim();
                const cost = Number(row['成本'] || row['Cost'] || 0);
                const profit = Number(row['毛利'] || row['Profit'] || 0);
                const amount = Number(row[COL_HEADERS.SUBTOTAL] || row['小計'] || row['Amount'] || 0);
                const category = String(row[COL_HEADERS.CAT_1] || row['品類一'] || row['Category'] || '').trim();
                const points = Number(row[COL_HEADERS.POINTS] || row['點數'] || row['Points'] || 0);

                buffer.push({
                    customerID: cid, itemID, date: dateStr, quantity: qty,
                    price, unit, storeName, salesPerson,
                    itemName, cost, profit, amount, category, points
                });
          }

          if (buffer.length >= CHUNK_SIZE || i === json.length - 1) {
              if (buffer.length > 0) {
                  await bulkAddHistory(buffer);
                  processed += buffer.length;
                  buffer = [];
              }
              const pct = Math.round(((i+1) / json.length) * 100);
              updateProgress(pct);
              await new Promise(r => setTimeout(r, 0)); // Yield to UI
          }
      }
      return processed;
  };

  const startBatchImport = async () => {
      const pendingItems = importQueue.filter(i => i.status === 'pending');
      if (pendingItems.length === 0) return;
      if (pendingItems.some(i => !i.targetStore)) {
          alert("請確保所有待處理檔案都已選擇目標分店！");
          return;
      }

      setIsBatchRunning(true);
      setIsProcessing(true); // Global indicator

      // Iterate through current queue state (we use a loop to process sequentially)
      // Note: We access the current queue via a snapshot but we update the state via functional updates
      for (const item of pendingItems) {
          // 1. Mark as processing
          setImportQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'processing', progress: 0 } : q));
          
          try {
              // 2. Process
              const processedCount = await processSingleFile(item, (pct) => {
                  setImportQueue(prev => prev.map(q => q.id === item.id ? { ...q, progress: pct } : q));
              });

              // 3. Mark as success
              setImportQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'success', progress: 100, message: `成功 (${processedCount} 筆)` } : q));
          } catch (err: any) {
              // 4. Mark as error
              setImportQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'error', message: err.message } : q));
          }
      }

      setIsBatchRunning(false);
      setIsProcessing(false);
      await refreshGlobalStats();
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
                            {activeView === 'IMPORT' && '排程匯入工具'}
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

                {/* --- IMPORT (BATCH QUEUE) --- */}
                {activeView === 'IMPORT' && (
                    <div className="max-w-4xl mx-auto space-y-4">
                        
                        {/* 1. Control Panel */}
                        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-200">
                            <h3 className="text-lg font-bold text-slate-800 mb-2 flex items-center gap-2">
                                <List className="text-blue-500"/> 排程匯入清單 (Queue)
                            </h3>
                            <p className="text-sm text-slate-500 mb-6">您可以一次選取多個檔案，系統將自動排程依序匯入，避免瀏覽器過載。</p>
                            
                            <div className="flex gap-4 items-center">
                                <label className={`
                                    flex items-center gap-2 px-6 py-3 rounded-lg cursor-pointer transition-all font-bold shadow-sm
                                    ${isBatchRunning ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100'}
                                `}>
                                    <Plus size={18}/> 加入檔案 (可多選)
                                    <input 
                                        type="file" 
                                        ref={fileInputRef}
                                        className="hidden" 
                                        accept=".xlsx, .xls" 
                                        multiple 
                                        onChange={handleFilesSelect} 
                                        disabled={isBatchRunning} 
                                    />
                                </label>

                                <div className="h-8 w-px bg-gray-300 mx-2"></div>

                                <button 
                                    onClick={startBatchImport}
                                    disabled={isBatchRunning || importQueue.filter(i => i.status === 'pending').length === 0}
                                    className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 disabled:bg-gray-300 disabled:text-gray-500 shadow-md transition-all"
                                >
                                    {isBatchRunning ? <RefreshCw className="animate-spin" size={18}/> : <Play size={18}/>}
                                    {isBatchRunning ? '正在處理排程...' : '開始排程匯入'}
                                </button>
                                
                                {importQueue.some(i => i.status === 'success') && !isBatchRunning && (
                                    <button onClick={clearCompletedQueue} className="ml-auto text-sm text-gray-400 hover:text-gray-600 flex items-center gap-1">
                                        <Trash2 size={14}/> 清除已完成項目
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* 2. Queue List */}
                        <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden min-h-[300px]">
                            <div className="bg-slate-50 px-6 py-3 border-b border-gray-200 grid grid-cols-12 gap-4 text-xs font-bold text-slate-500 uppercase tracking-wider">
                                <div className="col-span-5">檔案名稱</div>
                                <div className="col-span-3">目標分店 (自動偵測)</div>
                                <div className="col-span-3">狀態 / 進度</div>
                                <div className="col-span-1 text-center">操作</div>
                            </div>
                            
                            <div className="divide-y divide-gray-100">
                                {importQueue.length === 0 ? (
                                    <div className="p-12 text-center text-gray-300 flex flex-col items-center">
                                        <FileSpreadsheet size={48} className="mb-4 opacity-30"/>
                                        <p>目前清單是空的，請點擊上方按鈕加入 Excel 檔案。</p>
                                    </div>
                                ) : (
                                    importQueue.map(item => (
                                        <div key={item.id} className={`grid grid-cols-12 gap-4 px-6 py-3 items-center hover:bg-slate-50 transition-colors ${item.status === 'processing' ? 'bg-blue-50/50' : ''}`}>
                                            <div className="col-span-5 flex items-center gap-3 overflow-hidden">
                                                <div className={`p-2 rounded-lg shrink-0 ${item.status === 'success' ? 'bg-emerald-100 text-emerald-600' : item.status === 'error' ? 'bg-red-100 text-red-600' : 'bg-gray-100 text-gray-500'}`}>
                                                    <FileText size={16}/>
                                                </div>
                                                <div className="truncate font-medium text-slate-700 text-sm" title={item.file.name}>{item.file.name}</div>
                                            </div>
                                            
                                            <div className="col-span-3">
                                                {item.status === 'pending' ? (
                                                    <div className="relative">
                                                        <select 
                                                            value={item.targetStore}
                                                            onChange={(e) => updateQueueItemStore(item.id, e.target.value)}
                                                            className={`w-full text-xs font-bold py-1.5 pl-2 pr-6 rounded border appearance-none outline-none focus:ring-2 focus:ring-blue-300 ${!item.targetStore ? 'border-red-300 bg-red-50 text-red-700' : 'border-gray-300 text-slate-700'}`}
                                                        >
                                                            <option value="">請選擇分店...</option>
                                                            {availableStores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                                                        </select>
                                                        <ChevronDown className="absolute right-2 top-2 text-gray-400 pointer-events-none" size={14}/>
                                                    </div>
                                                ) : (
                                                    <span className="text-xs font-bold text-slate-600 px-2 py-1 bg-gray-100 rounded border border-gray-200">{item.targetStore}</span>
                                                )}
                                            </div>

                                            <div className="col-span-3">
                                                {item.status === 'pending' && <span className="text-xs text-gray-400 font-mono">等待中...</span>}
                                                {item.status === 'processing' && (
                                                    <div className="w-full">
                                                        <div className="flex justify-between text-[10px] text-blue-600 font-bold mb-1">
                                                            <span>匯入中...</span>
                                                            <span>{item.progress}%</span>
                                                        </div>
                                                        <div className="h-1.5 bg-blue-100 rounded-full overflow-hidden">
                                                            <div className="h-full bg-blue-500 transition-all duration-300" style={{ width: `${item.progress}%` }}></div>
                                                        </div>
                                                    </div>
                                                )}
                                                {item.status === 'success' && (
                                                    <div className="text-xs text-emerald-600 font-bold flex items-center gap-1">
                                                        <CheckCircle2 size={14}/> {item.message || '完成'}
                                                    </div>
                                                )}
                                                {item.status === 'error' && (
                                                    <div className="text-xs text-red-600 font-bold flex items-center gap-1" title={item.message}>
                                                        <AlertTriangle size={14}/> 失敗
                                                    </div>
                                                )}
                                            </div>

                                            <div className="col-span-1 text-center">
                                                {item.status === 'pending' || item.status === 'error' ? (
                                                    <button onClick={() => removeQueueItem(item.id)} className="text-gray-300 hover:text-red-500 p-1.5 rounded hover:bg-red-50 transition-colors">
                                                        <X size={16}/>
                                                    </button>
                                                ) : (
                                                    <span className="text-gray-200">-</span>
                                                )}
                                            </div>
                                        </div>
                                    ))
                                )}
                            </div>
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
