
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  LayoutDashboard, Database, Upload, Store, ArrowLeft, HardDrive, 
  PieChart, RefreshCw, Trash2, Plus, Save, Edit2, X, FolderOpen, 
  Calendar, ChevronRight, ChevronDown, FileText, CheckCircle2, 
  AlertTriangle, Search, Play, List, FileSpreadsheet, StopCircle, 
  Table as TableIcon, ArrowDownCircle, Download, ArchiveRestore,
  Settings
} from 'lucide-react';
import { 
  getHistoryCount, clearHistory, bulkAddHistory, HistoryRecord, 
  getHistoryStatsByStore, deleteStoreHistory, getStores, 
  addStore, updateStore, deleteStore, getAvailableYearsByStore, 
  deleteHistoryByYear, getMonthlyStatsByStoreAndYear, deleteHistoryByMonth,
  getHistoryByMonth, exportDatabaseToJson, importDatabaseFromJson, seedDefaultStores
} from '../utils/db';
import { readExcelFile } from '../utils/excelHelper';
import { COL_HEADERS } from '../constants';
import { StoreRecord } from '../types';

interface HistoryDashboardProps {
  onBack: () => void;
}

const CHUNK_SIZE = 2000;
const PAGE_SIZE = 100;

type DashboardView = 'OVERVIEW' | 'EXPLORER' | 'IMPORT' | 'STORES';

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
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [monthlyStats, setMonthlyStats] = useState<{ month: string, count: number }[]>([]);
  const [explorerRecords, setExplorerRecords] = useState<HistoryRecord[]>([]);
  const [isLoadingRecords, setIsLoadingRecords] = useState(false);
  const [explorerOffset, setExplorerOffset] = useState(0);
  const [explorerSearch, setExplorerSearch] = useState('');

  // Import Queue State
  const [importQueue, setImportQueue] = useState<ImportQueueItem[]>([]);
  const [isBatchRunning, setIsBatchRunning] = useState(false);
  const stopBatchRef = useRef(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const backupInputRef = useRef<HTMLInputElement>(null); // For Restore

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
         setSelectedMonth(null);
         setExplorerRecords([]);
     }
  }, [selectedStore]);

  useEffect(() => {
      if (selectedStore && expandedYear) {
          loadMonthlyStats(selectedStore, expandedYear);
          setSelectedMonth(null);
          setExplorerRecords([]);
      }
  }, [selectedStore, expandedYear]);

  const refreshGlobalStats = async () => {
    const total = await getHistoryCount();
    const stats = await getHistoryStatsByStore();
    setTotalRecords(total);
    setStoreStats(stats);
  };

  const loadStores = async () => {
    let list = await getStores();
    if (list.length === 0) {
        // Self-heal: If empty, try seeding defaults again
        await seedDefaultStores();
        list = await getStores();
    }
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

  const loadRecords = async (month: string, append = false) => {
      if (!selectedStore || !expandedYear) return;
      setIsLoadingRecords(true);
      const offset = append ? explorerOffset + PAGE_SIZE : 0;
      const data = await getHistoryByMonth(selectedStore, expandedYear, month, offset, PAGE_SIZE);
      
      if (append) setExplorerRecords(prev => [...prev, ...data]);
      else setExplorerRecords(data);
      
      setExplorerOffset(offset);
      setSelectedMonth(month);
      setIsLoadingRecords(false);
  };

  // --- ACTIONS ---

  const handleDeleteStoreData = async (storeName: string) => {
      if (!window.confirm(`確定要刪除「${storeName}」的所有歷史資料嗎？`)) return;
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

  const handleClearAll = async () => {
      const confirmStr = prompt("警告：此操作將清空整個資料庫！若確定請輸入「DELETE」");
      if (confirmStr !== 'DELETE') return;
      setIsProcessing(true);
      await clearHistory();
      await refreshGlobalStats();
      setSelectedStore(null);
      setIsProcessing(false);
  };

  const handleAddStore = async () => {
    if (!newStoreName.trim()) return;
    try {
      await addStore(newStoreName.trim());
      setNewStoreName('');
      await loadStores();
    } catch (e) {
      console.error(e);
      alert("新增分店失敗，名稱可能重複或資料庫異常");
    }
  };

  const handleUpdateStoreLocal = async () => {
    if (editingStoreId && editingStoreName.trim()) {
      await updateStore(editingStoreId, editingStoreName.trim());
      setEditingStoreId(null);
      await loadStores();
    }
  };

  const handleDeleteStoreLocal = async (id: number, name: string) => {
    if (confirm(`確定移除 ${name}？`)) {
      await deleteStore(id);
      await loadStores();
    }
  };

  // --- BACKUP & RESTORE ---
  
  const handleBackup = async () => {
      setIsProcessing(true);
      try {
          const json = await exportDatabaseToJson();
          const blob = new Blob([json], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const link = document.createElement('a');
          link.href = url;
          const dateStr = new Date().toISOString().slice(0, 10).replace(/-/g, '');
          link.download = `StoreSales_Backup_${dateStr}.json`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          URL.revokeObjectURL(url);
      } catch (e) {
          alert("備份失敗: " + e);
      } finally {
          setIsProcessing(false);
      }
  };

  const handleRestoreClick = () => {
      if (backupInputRef.current) backupInputRef.current.click();
  };

  const handleRestoreFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files || !e.target.files[0]) return;
      if (!confirm("警告：還原操作將會「完全覆蓋」並清除目前的資料庫。\n\n確定要繼續嗎？")) {
          e.target.value = '';
          return;
      }

      setIsProcessing(true);
      const file = e.target.files[0];
      const reader = new FileReader();
      
      reader.onload = async (ev) => {
          try {
              const jsonStr = ev.target?.result as string;
              const count = await importDatabaseFromJson(jsonStr);
              await refreshGlobalStats();
              await loadStores(); // Reload stores after import
              alert(`還原成功！已恢復 ${count.toLocaleString()} 筆歷史資料。`);
          } catch (err: any) {
              alert("還原失敗：" + err.message);
          } finally {
              setIsProcessing(false);
              if (backupInputRef.current) backupInputRef.current.value = '';
          }
      };
      
      reader.readAsText(file);
  };

  // --- BATCH IMPORT LOGIC ---
  
  const handleFilesSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
          const newItems: ImportQueueItem[] = Array.from(e.target.files).map((file: File) => {
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

  const startBatchImport = async () => {
      const pendingItems = importQueue.filter(i => i.status === 'pending');
      if (pendingItems.length === 0) return;
      if (pendingItems.some(i => !i.targetStore)) {
          alert("請確保所有待處理檔案都已選擇目標分店！");
          return;
      }

      setIsBatchRunning(true);
      setIsProcessing(true);
      stopBatchRef.current = false;

      for (const item of pendingItems) {
          if (stopBatchRef.current) break;

          setImportQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'processing', progress: 0 } : q));
          
          try {
              const processedCount = await processSingleFile(item);
              setImportQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'success', progress: 100, message: `成功 (${processedCount} 筆)` } : q));
          } catch (err: any) {
              setImportQueue(prev => prev.map(q => q.id === item.id ? { ...q, status: 'error', message: err.message } : q));
          }
          await new Promise(r => setTimeout(r, 100)); // Cool down
      }

      setIsBatchRunning(false);
      setIsProcessing(false);
      await refreshGlobalStats();
  };

  const processSingleFile = async (item: ImportQueueItem) => {
      const json = await readExcelFile(item.file);
      const storeName = item.targetStore;
      let processed = 0;
      let buffer: HistoryRecord[] = [];

      for (let i = 0; i < json.length; i++) {
          const row = json[i] as any;
          const cid = String(row[COL_HEADERS.CUSTOMER_ID] || '').trim();
          const itemID = String(row[COL_HEADERS.ITEM_ID] || '').trim();

          if (cid && itemID && cid !== 'undefined' && itemID !== 'undefined') {
                const ticketNo = String(row[COL_HEADERS.TICKET_NO] || '').trim();
                
                buffer.push({
                    customerID: cid, 
                    itemID,
                    ticketNo: ticketNo, // Store Ticket No for strict filtering
                    date: String(row[COL_HEADERS.SALES_DATE] || ticketNo || '').trim(), 
                    quantity: Number(row[COL_HEADERS.QUANTITY]) || 0,
                    price: Number(row[COL_HEADERS.UNIT_PRICE] || row['單價'] || 0), 
                    unit: String(row[COL_HEADERS.UNIT] || row['單位'] || '').trim(), 
                    storeName, 
                    salesPerson: String(row[COL_HEADERS.SALES_PERSON] || '').trim(),
                    itemName: String(row[COL_HEADERS.ITEM_NAME] || row['品名'] || '').trim(),
                    amount: Number(row[COL_HEADERS.SUBTOTAL] || 0),
                    category: String(row[COL_HEADERS.CAT_1] || '').trim()
                });
          }

          if (buffer.length >= CHUNK_SIZE || i === json.length - 1) {
              if (buffer.length > 0) {
                  await bulkAddHistory(buffer);
                  processed += buffer.length;
                  buffer = [];
              }
              const pct = Math.round(((i+1) / json.length) * 100);
              setImportQueue(prev => prev.map(q => q.id === item.id ? { ...q, progress: pct } : q));
              await new Promise(r => setTimeout(r, 0));
          }
      }
      return processed;
  };

  const totalBatchProgress = useMemo(() => {
    if (importQueue.length === 0) return 0;
    const completed = importQueue.filter(i => i.status === 'success').length;
    const processing = importQueue.find(i => i.status === 'processing');
    const procProgress = processing ? (processing.progress / 100) : 0;
    return Math.round(((completed + procProgress) / importQueue.length) * 100);
  }, [importQueue]);

  // --- FILTERED EXPLORER RECORDS ---
  const filteredRecords = useMemo(() => {
      if (!explorerSearch) return explorerRecords;
      const s = explorerSearch.toLowerCase();
      return explorerRecords.filter(r => 
        r.customerID.toLowerCase().includes(s) || 
        r.itemID.toLowerCase().includes(s) || 
        (r.itemName || '').toLowerCase().includes(s)
      );
  }, [explorerRecords, explorerSearch]);

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

  return (
    <div className="flex h-screen bg-slate-100 overflow-hidden font-sans">
        {/* Sidebar */}
        <div className="w-64 bg-slate-900 text-slate-300 flex flex-col shrink-0">
            <div className="p-6 border-b border-slate-800">
                <h1 className="text-white font-black text-xl tracking-tight flex items-center gap-2">
                    <Database className="text-blue-500"/> 資料管理中心
                </h1>
            </div>
            <div className="flex-1 p-4 space-y-2 overflow-y-auto">
                <SidebarItem view="OVERVIEW" label="總覽儀表板" icon={LayoutDashboard} />
                <SidebarItem view="EXPLORER" label="資料瀏覽器" icon={FolderOpen} />
                <SidebarItem view="IMPORT" label="排程匯入工具" icon={Upload} />
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
            <div className="max-w-7xl mx-auto">
                <div className="mb-8 flex justify-between items-center">
                    <div>
                        <h2 className="text-2xl font-black text-slate-800">
                            {activeView === 'OVERVIEW' && '總覽儀表板'}
                            {activeView === 'EXPLORER' && '資料瀏覽器'}
                            {activeView === 'IMPORT' && '排程匯入工具'}
                            {activeView === 'STORES' && '分店設定'}
                        </h2>
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
                        {/* Stats Cards */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4 hover:shadow-md transition-shadow">
                                <div className="p-4 bg-blue-50 text-blue-600 rounded-full">
                                    <HardDrive size={24} />
                                </div>
                                <div>
                                    <div className="text-sm text-slate-500 font-bold uppercase tracking-wider">歷史資料總筆數</div>
                                    <div className="text-3xl font-black text-slate-800 font-mono">{totalRecords.toLocaleString()}</div>
                                </div>
                            </div>
                            
                            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4 hover:shadow-md transition-shadow">
                                <div className="p-4 bg-emerald-50 text-emerald-600 rounded-full">
                                    <Store size={24} />
                                </div>
                                <div>
                                    <div className="text-sm text-slate-500 font-bold uppercase tracking-wider">建檔分店數</div>
                                    <div className="text-3xl font-black text-slate-800 font-mono">{availableStores.length}</div>
                                </div>
                            </div>

                            <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200 flex items-center gap-4 hover:shadow-md transition-shadow">
                                <div className="p-4 bg-purple-50 text-purple-600 rounded-full">
                                    <Database size={24} />
                                </div>
                                <div>
                                    <div className="text-sm text-slate-500 font-bold uppercase tracking-wider">系統狀態</div>
                                    <div className="text-sm font-bold text-slate-700 mt-1">
                                         <div className="flex items-center gap-2">
                                            <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span> 運作正常
                                         </div>
                                    </div>
                                     <div className="text-xs text-slate-400 mt-0.5">IndexedDB Ready</div>
                                </div>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                            {/* Store Distribution */}
                            <div className="lg:col-span-2 bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                                <div className="flex justify-between items-center mb-6">
                                    <h3 className="text-lg font-black text-slate-800 flex items-center gap-2">
                                        <PieChart size={20} className="text-blue-500"/> 資料分佈概況
                                    </h3>
                                    <div className="text-xs text-slate-400 font-mono">Top {Math.min(storeStats.length, 10)} Stores</div>
                                </div>
                                <div className="space-y-4 max-h-[400px] overflow-y-auto pr-2">
                                    {storeStats.length === 0 ? (
                                        <div className="text-center text-gray-400 py-10 flex flex-col items-center">
                                            <Database size={48} className="mb-2 opacity-20"/>
                                            <span>尚無資料</span>
                                            <button onClick={() => setActiveView('IMPORT')} className="mt-4 text-blue-600 text-sm font-bold hover:underline">前往匯入資料</button>
                                        </div>
                                    ) : (
                                        storeStats.map((stat, idx) => {
                                            const percent = totalRecords > 0 ? (stat.count / totalRecords) * 100 : 0;
                                            return (
                                                <div key={stat.storeName} className="space-y-1">
                                                    <div className="flex justify-between text-sm font-bold text-slate-700">
                                                        <span>{idx + 1}. {stat.storeName}</span>
                                                        <span className="font-mono text-slate-500">{stat.count.toLocaleString()} <span className="text-xs text-slate-400 ml-1">({percent.toFixed(1)}%)</span></span>
                                                    </div>
                                                    <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
                                                        <div 
                                                            className="h-full bg-blue-500 rounded-full transition-all duration-1000 ease-out shadow-sm" 
                                                            style={{ width: `${percent}%`, opacity: Math.max(0.4, percent/100 + 0.2) }}
                                                        ></div>
                                                    </div>
                                                </div>
                                            )
                                        })
                                    )}
                                </div>
                            </div>

                            {/* Quick Actions & Tips */}
                            <div className="space-y-6">
                                <div className="bg-white p-6 rounded-xl shadow-sm border border-slate-200">
                                    <h3 className="text-sm font-black text-slate-800 mb-4 uppercase tracking-wider flex items-center gap-2">
                                        <Settings size={16} className="text-slate-400"/> 快速操作
                                    </h3>
                                    <div className="space-y-3">
                                        <button onClick={() => setActiveView('IMPORT')} className="w-full py-3 px-4 bg-blue-50 text-blue-700 font-bold rounded-lg border border-blue-100 hover:bg-blue-100 transition-colors flex items-center justify-between group">
                                            <span className="flex items-center gap-2"><Upload size={18}/> 匯入資料</span>
                                            <ChevronRight size={16} className="opacity-0 group-hover:opacity-100 transition-opacity"/>
                                        </button>
                                        <button onClick={handleBackup} disabled={isProcessing} className="w-full py-3 px-4 bg-emerald-50 text-emerald-700 font-bold rounded-lg border border-emerald-100 hover:bg-emerald-100 transition-colors flex items-center justify-between group">
                                            <span className="flex items-center gap-2"><Download size={18}/> 備份資料庫 (JSON)</span>
                                            <ChevronRight size={16} className="opacity-0 group-hover:opacity-100 transition-opacity"/>
                                        </button>
                                        <button onClick={handleRestoreClick} disabled={isProcessing} className="w-full py-3 px-4 bg-amber-50 text-amber-700 font-bold rounded-lg border border-amber-100 hover:bg-amber-100 transition-colors flex items-center justify-between group">
                                            <span className="flex items-center gap-2"><ArchiveRestore size={18}/> 還原資料庫</span>
                                            <ChevronRight size={16} className="opacity-0 group-hover:opacity-100 transition-opacity"/>
                                        </button>
                                        <input type="file" ref={backupInputRef} onChange={handleRestoreFile} className="hidden" accept=".json" />
                                        
                                        {totalRecords > 0 && (
                                            <button onClick={handleClearAll} className="w-full py-3 px-4 bg-red-50 text-red-600 font-bold rounded-lg border border-red-100 hover:bg-red-100 transition-colors flex items-center justify-between group mt-4">
                                                <span className="flex items-center gap-2"><Trash2 size={18}/> 清空所有資料</span>
                                            </button>
                                        )}
                                    </div>
                                </div>

                                <div className="bg-blue-50 border border-blue-100 rounded-xl p-5">
                                    <h4 className="text-blue-800 font-bold flex items-center gap-2 mb-2 text-sm"><AlertTriangle size={16}/> 效能與維護提示</h4>
                                    <div className="text-xs text-blue-700 leading-relaxed space-y-2">
                                        <p>本系統使用高效能資料庫 (IndexedDB)，可承載數十萬筆以上的歷史資料。</p>
                                        <ul className="list-disc pl-4 space-y-1 opacity-80">
                                            <li>建議定期備份資料庫 (.json 檔) 以防遺失。</li>
                                            <li>若單一分店資料超過 5 年以上，可至「資料瀏覽器」移除過舊年份。</li>
                                            <li>備份大於 50萬筆資料時可能會耗時較久，請耐心等候。</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* --- EXPLORER --- */}
                {activeView === 'EXPLORER' && (
                    <div className="flex h-[700px] bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
                        {/* Col 1: Stores */}
                        <div className="w-56 border-r border-gray-200 flex flex-col bg-slate-50/50">
                            <div className="p-4 border-b font-black text-xs text-slate-400 uppercase tracking-widest bg-white">1. 分店</div>
                            <div className="flex-1 overflow-y-auto">
                                {storeStats.map(s => (
                                    <button key={s.storeName} onClick={() => setSelectedStore(s.storeName)}
                                        className={`w-full text-left px-4 py-3 border-b border-gray-50 flex justify-between items-center transition-all ${selectedStore === s.storeName ? 'bg-blue-600 text-white font-bold' : 'text-slate-600 hover:bg-slate-100'}`}>
                                        <span className="truncate">{s.storeName}</span>
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded ${selectedStore === s.storeName ? 'bg-blue-500 text-white' : 'bg-slate-200 text-slate-500'}`}>{s.count.toLocaleString()}</span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        {/* Col 2: Calendar */}
                        <div className="w-64 border-r border-gray-200 flex flex-col bg-slate-50/30">
                            <div className="p-4 border-b font-black text-xs text-slate-400 uppercase tracking-widest bg-white">2. 年月份</div>
                            <div className="flex-1 overflow-y-auto">
                                {!selectedStore ? <div className="p-8 text-center text-slate-400 text-xs italic">請先選擇分店</div> : 
                                    explorerYears.map(year => (
                                        <div key={year} className="border-b border-gray-100">
                                            <div onClick={() => setExpandedYear(expandedYear === year ? null : year)} className={`px-4 py-3 cursor-pointer flex justify-between items-center hover:bg-slate-100 ${expandedYear === year ? 'bg-white font-bold' : ''}`}>
                                                <div className="flex items-center gap-2"><Calendar size={14} className="text-blue-500"/> {year}年</div>
                                                <ChevronRight size={14} className={`transition-transform ${expandedYear === year ? 'rotate-90' : ''}`}/>
                                            </div>
                                            {expandedYear === year && (
                                                <div className="bg-white px-4 pb-2 space-y-1">
                                                    <div className="flex justify-end mb-1">
                                                        <button onClick={() => handleDeleteYearData(selectedStore, year)} className="text-[10px] text-red-400 hover:text-red-600 hover:underline px-1">刪除整年</button>
                                                    </div>
                                                    {monthlyStats.map(m => (
                                                        <button key={m.month} onClick={() => loadRecords(m.month)} className={`w-full flex justify-between items-center p-2 rounded text-xs transition-colors ${selectedMonth === m.month ? 'bg-blue-50 text-blue-700 font-bold border border-blue-200' : 'text-slate-600 hover:bg-slate-50'}`}>
                                                            <span>{m.month}月</span>
                                                            <span className="font-mono opacity-60">{m.count} 筆</span>
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    ))
                                }
                            </div>
                        </div>

                        {/* Col 3: Data Table */}
                        <div className="flex-1 flex flex-col bg-white">
                            <div className="p-4 border-b flex justify-between items-center gap-4">
                                <div className="relative flex-1">
                                    <Search className="absolute left-3 top-2.5 text-gray-400" size={16}/>
                                    <input type="text" placeholder="搜尋客戶編號、品項編號或名稱..." value={explorerSearch} onChange={e => setExplorerSearch(e.target.value)}
                                        className="w-full pl-10 pr-4 py-2 bg-slate-100 border-none rounded-lg text-sm focus:ring-2 focus:ring-blue-500 transition-all"/>
                                </div>
                                <div className="text-[10px] font-black text-slate-400 uppercase tracking-widest shrink-0">
                                    {selectedMonth ? `${selectedStore} - ${expandedYear} / ${selectedMonth}` : '未選取月份'}
                                </div>
                            </div>
                            <div className="flex-1 overflow-auto">
                                {isLoadingRecords ? <div className="h-full flex items-center justify-center text-blue-500"><RefreshCw className="animate-spin" size={32}/></div> : 
                                 !selectedMonth ? <div className="h-full flex flex-col items-center justify-center text-slate-300"><TableIcon size={64} className="mb-4 opacity-20"/><p>點選左側年月份載入資料</p></div> :
                                 <table className="w-full text-xs text-left border-collapse">
                                     <thead className="bg-slate-50 sticky top-0 font-bold text-slate-500 border-b border-gray-200">
                                         <tr>
                                             <th className="px-4 py-3">日期</th>
                                             <th className="px-4 py-3">客戶</th>
                                             <th className="px-4 py-3">品項</th>
                                             <th className="px-4 py-3">名稱</th>
                                             <th className="px-4 py-3 text-right">數量</th>
                                             <th className="px-4 py-3 text-right">金額</th>
                                         </tr>
                                     </thead>
                                     <tbody className="divide-y divide-gray-100">
                                         {filteredRecords.map((r, i) => (
                                             <tr key={i} className="hover:bg-slate-50 transition-colors">
                                                 <td className="px-4 py-2 font-mono">{r.date}</td>
                                                 <td className="px-4 py-2 font-bold text-blue-600">{r.customerID}</td>
                                                 <td className="px-4 py-2 font-mono text-slate-500">{r.itemID}</td>
                                                 <td className="px-4 py-2 truncate max-w-[150px]">{r.itemName}</td>
                                                 <td className="px-4 py-2 text-right font-mono">{r.quantity}</td>
                                                 <td className="px-4 py-2 text-right font-mono font-bold">${r.amount?.toLocaleString()}</td>
                                             </tr>
                                         ))}
                                     </tbody>
                                 </table>
                                }
                                {selectedMonth && explorerRecords.length >= PAGE_SIZE && !explorerSearch && (
                                     <div className="p-4 text-center">
                                         <button onClick={() => loadRecords(selectedMonth, true)} className="px-6 py-2 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-full font-bold text-xs flex items-center gap-2 mx-auto">
                                             <ArrowDownCircle size={14}/> 載入更多資料...
                                         </button>
                                     </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* --- IMPORT --- */}
                {activeView === 'IMPORT' && (
                    <div className="max-w-4xl mx-auto space-y-6">
                        <div className="bg-white p-6 rounded-xl shadow-lg border border-gray-200">
                            <h3 className="text-lg font-black text-slate-800 mb-4 flex items-center gap-2"><List className="text-blue-500"/> 排程匯入任務</h3>
                            
                            <div className="flex gap-4 items-center p-4 bg-slate-50 rounded-lg border border-dashed border-gray-300">
                                <label className={`flex items-center gap-2 px-6 py-3 rounded-lg cursor-pointer transition-all font-bold shadow-md ${isBatchRunning ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}>
                                    <Plus size={18}/> 選擇多個檔案匯入
                                    <input type="file" ref={fileInputRef} className="hidden" accept=".xlsx, .xls" multiple onChange={handleFilesSelect} disabled={isBatchRunning} />
                                </label>
                                <div className="h-10 w-px bg-gray-300 mx-2"></div>
                                <button onClick={startBatchImport} disabled={isBatchRunning || importQueue.filter(i => i.status === 'pending').length === 0}
                                    className="flex items-center gap-2 px-6 py-3 bg-emerald-600 text-white font-bold rounded-lg hover:bg-emerald-700 disabled:bg-gray-200 disabled:text-gray-400 shadow-md transition-all">
                                    {isBatchRunning ? <RefreshCw className="animate-spin" size={18}/> : <Play size={18}/>}
                                    {isBatchRunning ? '佇列處理中...' : '開始執行排程'}
                                </button>
                                {isBatchRunning && (
                                    <button onClick={() => stopBatchRef.current = true} className="flex items-center gap-2 px-4 py-3 bg-red-50 text-red-600 font-bold rounded-lg hover:bg-red-100 border border-red-200">
                                        <StopCircle size={18}/> 停止
                                    </button>
                                )}
                            </div>

                            {isBatchRunning && (
                                <div className="mt-6 p-4 bg-blue-50 rounded-lg border border-blue-100">
                                    <div className="flex justify-between text-xs font-black text-blue-700 mb-2 uppercase tracking-widest">
                                        <span>總體匯入進度</span>
                                        <span>{totalBatchProgress}%</span>
                                    </div>
                                    <div className="h-4 bg-blue-200 rounded-full overflow-hidden shadow-inner">
                                        <div className="h-full bg-blue-600 transition-all duration-500 shadow-lg" style={{ width: `${totalBatchProgress}%` }}></div>
                                    </div>
                                </div>
                            )}
                        </div>

                        <div className="bg-white rounded-xl shadow-lg border border-gray-200 overflow-hidden">
                            <div className="px-6 py-4 border-b bg-slate-50 flex justify-between items-center">
                                <span className="font-black text-xs text-slate-400 uppercase tracking-widest">任務清單 ({importQueue.length})</span>
                                {importQueue.some(i => i.status === 'success') && !isBatchRunning && (
                                    <button onClick={() => setImportQueue(prev => prev.filter(i => i.status !== 'success'))} className="text-xs text-blue-600 hover:underline">移除已完成項目</button>
                                )}
                            </div>
                            <div className="divide-y divide-gray-100 max-h-[500px] overflow-y-auto">
                                {importQueue.length === 0 ? <div className="p-12 text-center text-slate-300 italic">尚未加入任何檔案</div> :
                                    importQueue.map(item => (
                                        <div key={item.id} className={`grid grid-cols-12 gap-4 px-6 py-4 items-center transition-colors ${item.status === 'processing' ? 'bg-blue-50/50' : ''}`}>
                                            <div className="col-span-5 flex items-center gap-3">
                                                <FileSpreadsheet className={item.status === 'success' ? 'text-emerald-500' : 'text-slate-400'} size={20}/>
                                                <div className="truncate text-sm font-bold text-slate-700" title={item.file.name}>{item.file.name}</div>
                                            </div>
                                            <div className="col-span-3">
                                                {item.status === 'pending' ? (
                                                    <select value={item.targetStore} onChange={e => setImportQueue(prev => prev.map(q => q.id === item.id ? {...q, targetStore: e.target.value} : q))}
                                                        className="w-full text-xs font-bold p-1.5 rounded border border-gray-300 outline-none focus:ring-2 focus:ring-blue-500">
                                                        <option value="">選擇分店...</option>
                                                        {availableStores.map(s => <option key={s.id} value={s.name}>{s.name}</option>)}
                                                    </select>
                                                ) : <span className="text-xs font-black px-2 py-1 bg-slate-100 rounded text-slate-500 border">{item.targetStore}</span>}
                                            </div>
                                            <div className="col-span-3">
                                                {item.status === 'processing' ? (
                                                    <div className="w-full">
                                                        <div className="flex justify-between text-[10px] font-bold text-blue-600 mb-1"><span>讀取中...</span><span>{item.progress}%</span></div>
                                                        <div className="h-1.5 bg-blue-100 rounded-full overflow-hidden"><div className="h-full bg-blue-500" style={{ width: `${item.progress}%` }}></div></div>
                                                    </div>
                                                ) : item.status === 'success' ? <span className="text-xs font-bold text-emerald-600 flex items-center gap-1"><CheckCircle2 size={14}/> {item.message}</span> :
                                                    item.status === 'error' ? <span className="text-xs font-bold text-red-600 flex items-center gap-1"><AlertTriangle size={14}/> 失敗</span> :
                                                    <span className="text-xs text-slate-300 font-bold italic">等待排程...</span>
                                                }
                                            </div>
                                            <div className="col-span-1 text-right">
                                                {!isBatchRunning && (item.status === 'pending' || item.status === 'error') && (
                                                    <button onClick={() => setImportQueue(prev => prev.filter(q => q.id !== item.id))} className="p-1 text-slate-300 hover:text-red-500 transition-colors"><X size={16}/></button>
                                                )}
                                            </div>
                                        </div>
                                    ))
                                }
                            </div>
                        </div>
                    </div>
                )}

                {/* --- STORES --- */}
                {activeView === 'STORES' && (
                    <div className="max-w-4xl">
                        <div className="bg-white rounded-2xl shadow-lg border border-gray-200 p-8">
                             <h3 className="font-black text-slate-800 mb-6 flex items-center gap-2"><Store size={24}/> 分店清單管理</h3>
                             <div className="flex gap-4 mb-8">
                                <input type="text" placeholder="輸入新分店名稱..." value={newStoreName} onChange={e => setNewStoreName(e.target.value)}
                                    className="flex-1 px-6 py-3 border border-gray-300 rounded-xl focus:ring-4 focus:ring-blue-100 focus:border-blue-500 outline-none font-bold text-slate-700 transition-all"/>
                                <button onClick={handleAddStore} className="bg-blue-600 text-white px-8 py-3 rounded-xl font-black hover:bg-blue-700 shadow-lg shadow-blue-200 transition-all flex items-center gap-2">
                                    <Plus size={20}/> 新增分店
                                </button>
                             </div>
                             <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                                 {availableStores.map(store => (
                                     <div key={store.id} className="p-4 border border-gray-200 rounded-2xl flex justify-between items-center group hover:border-blue-400 hover:bg-blue-50/30 transition-all">
                                         {editingStoreId === store.id ? (
                                             <div className="flex gap-1 w-full">
                                                 <input autoFocus value={editingStoreName} onChange={e => setEditingStoreName(e.target.value)} className="flex-1 px-3 py-1 text-sm border-b-2 border-blue-500 bg-transparent outline-none font-bold"/>
                                                 <button onClick={handleUpdateStoreLocal} className="p-2 text-emerald-600"><Save size={18}/></button>
                                                 <button onClick={() => setEditingStoreId(null)} className="p-2 text-slate-400"><X size={18}/></button>
                                             </div>
                                         ) : (
                                             <>
                                                 <span className="font-black text-slate-700">{store.name}</span>
                                                 <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                                     <button onClick={() => { setEditingStoreId(store.id!); setEditingStoreName(store.name); }} className="p-2 text-slate-400 hover:text-blue-600"><Edit2 size={16}/></button>
                                                     <button onClick={() => handleDeleteStoreLocal(store.id!, store.name)} className="p-2 text-slate-400 hover:text-red-600"><Trash2 size={16}/></button>
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
