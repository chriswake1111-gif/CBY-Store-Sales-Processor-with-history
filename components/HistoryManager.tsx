
import React, { useState, useEffect } from 'react';
import { Database, Trash2, Upload, AlertTriangle, HardDrive, RefreshCw, X, Store, PieChart, CheckCircle2, Settings, Plus, Save, Edit2, Calendar, ChevronRight } from 'lucide-react';
import { getHistoryCount, clearHistory, bulkAddHistory, HistoryRecord, getHistoryStatsByStore, deleteStoreHistory, getStores, addStore, updateStore, deleteStore, getAvailableYearsByStore, deleteHistoryByYear } from '../utils/db';
import { readExcelFile } from '../utils/excelHelper';
import { COL_HEADERS } from '../constants';
import { StoreRecord } from '../types';

interface HistoryManagerProps {
  onClose: () => void;
}

const CHUNK_SIZE = 2000; 

const HistoryManager: React.FC<HistoryManagerProps> = ({ onClose }) => {
  const [totalCount, setTotalCount] = useState<number>(0);
  const [storeStats, setStoreStats] = useState<{ storeName: string; count: number }[]>([]);
  const [availableStores, setAvailableStores] = useState<StoreRecord[]>([]);
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalRows, setTotalRows] = useState(0);
  const [message, setMessage] = useState<string>('');
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info');
  
  // Import Config
  const [targetStore, setTargetStore] = useState('');

  // Store Management State
  const [showStoreManage, setShowStoreManage] = useState(false);
  const [newStoreName, setNewStoreName] = useState('');
  const [editingStore, setEditingStore] = useState<{id: number, name: string} | null>(null);

  // Years View State
  const [expandedStore, setExpandedStore] = useState<string | null>(null);
  const [storeYears, setStoreYears] = useState<string[]>([]);
  const [loadingYears, setLoadingYears] = useState(false);

  useEffect(() => {
    refreshStats();
    loadStores();
  }, []);

  const refreshStats = async () => {
    try {
      const c = await getHistoryCount();
      setTotalCount(c);
      const stats = await getHistoryStatsByStore();
      setStoreStats(stats);
    } catch (e) {
      console.error(e);
    }
  };

  const loadStores = async () => {
    const stores = await getStores();
    setAvailableStores(stores);
  };

  const handleClearAll = async () => {
    if (!window.confirm("嚴重警告：確定要清空「所有分店」的歷史資料嗎？\n此動作無法復原。")) return;
    await clearHistory();
    await refreshStats();
    setMessage("全域資料庫已清空");
    setMessageType('success');
  };

  const handleDeleteStoreHistory = async (e: React.MouseEvent, storeName: string) => {
    e.stopPropagation(); // Prevent toggling expanded view
    if (!window.confirm(`確定要移除「${storeName}」的所有歷史資料嗎？`)) return;
    setIsProcessing(true);
    try {
        await deleteStoreHistory(storeName);
        if (expandedStore === storeName) setExpandedStore(null);
        await refreshStats();
        setMessage(`已移除 ${storeName} 的資料`);
        setMessageType('success');
    } catch (e) {
        alert("刪除失敗");
    } finally {
        setIsProcessing(false);
    }
  };

  const handleToggleStoreYears = async (storeName: string) => {
    if (expandedStore === storeName) {
      setExpandedStore(null);
      setStoreYears([]);
      return;
    }

    setExpandedStore(storeName);
    setLoadingYears(true);
    try {
      const years = await getAvailableYearsByStore(storeName);
      setStoreYears(years);
    } catch (err) {
      console.error("Failed to load years", err);
    } finally {
      setLoadingYears(false);
    }
  };

  const handleDeleteYear = async (e: React.MouseEvent, storeName: string, year: string) => {
    e.stopPropagation();
    if (!window.confirm(`確定要刪除「${storeName}」在民國 ${year} 年的所有歷史資料嗎？`)) return;
    
    setIsProcessing(true);
    try {
        await deleteHistoryByYear(storeName, year);
        // Refresh local years list
        const updatedYears = await getAvailableYearsByStore(storeName);
        setStoreYears(updatedYears);
        await refreshStats();
        setMessage(`已刪除 ${storeName} ${year} 年資料`);
        setMessageType('success');
    } catch (err) {
        alert("刪除失敗");
    } finally {
        setIsProcessing(false);
    }
  };

  // --- Store Management Handlers ---

  const handleAddStore = async () => {
    if (!newStoreName.trim()) return;
    try {
      await addStore(newStoreName.trim());
      setNewStoreName('');
      await loadStores();
    } catch (e) {
      alert("新增分店失敗，名稱可能重複");
    }
  };

  const handleUpdateStore = async () => {
    if (!editingStore || !editingStore.name.trim()) return;
    try {
      await updateStore(editingStore.id, editingStore.name.trim());
      setEditingStore(null);
      await loadStores();
    } catch (e) {
      alert("更新失敗");
    }
  };

  const handleDeleteStoreRecord = async (id: number, name: string) => {
    if(!window.confirm(`確定要從「分店清單」中移除 ${name} 嗎？\n注意：這不會刪除該分店已匯入的歷史銷售資料。`)) return;
    await deleteStore(id);
    await loadStores();
  };


  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          // Auto-detect store name from filename if possible
          const name = file.name;
          const found = availableStores.find(s => name.includes(s.name));
          if (found) {
              setTargetStore(found.name);
          } else {
              if (!targetStore) setTargetStore("未命名分店");
          }
          
          handleImport(file);
      }
      // Reset input
      e.target.value = '';
  };

  const handleImport = async (file: File) => {
    if (!targetStore.trim()) {
        alert("請先輸入或選擇「目標分店」名稱，以便分類資料。");
        return;
    }

    setIsProcessing(true);
    setProgress(0);
    setMessageType('info');
    setMessage(`正在匯入「${file.name}」至「${targetStore}」...`);

    try {
      const json = await readExcelFile(file);
      setTotalRows(json.length);
      
      let processed = 0;
      let skipped = 0;
      let buffer: HistoryRecord[] = [];
      
      // Get current store name from state reference at start of process
      const storeName = targetStore.trim();

      for (let i = 0; i < json.length; i++) {
        const row = json[i] as any;
        const cid = String(row[COL_HEADERS.CUSTOMER_ID] || '').trim();
        const itemID = String(row[COL_HEADERS.ITEM_ID] || '').trim();
        
        // Validation: Must have Customer ID (not empty, not undefined) and Item ID
        if (cid && itemID && cid !== 'undefined' && itemID !== 'undefined') {
          // Parse Quantity
          const qty = Number(row[COL_HEADERS.QUANTITY]) || 0;
          // Parse Unit Price (New)
          const price = Number(row[COL_HEADERS.UNIT_PRICE] || row['單價'] || 0);
          // Parse Unit
          const unit = String(row[COL_HEADERS.UNIT] || row['單位'] || '').trim();
          
          // Fix: Use Sales Date if available, otherwise fallback to Ticket No ('單號')
          const dateStr = String(row[COL_HEADERS.SALES_DATE] || row[COL_HEADERS.TICKET_NO] || '').trim();
          
          // Get Sales Person
          const salesPerson = String(row[COL_HEADERS.SALES_PERSON] || '').trim();

          buffer.push({
            customerID: cid,
            itemID: itemID,
            date: dateStr,
            quantity: qty,
            price: price, 
            unit: unit, // Add Unit
            storeName: storeName,
            salesPerson: salesPerson
          });
        } else {
            skipped++;
        }

        if (buffer.length >= CHUNK_SIZE || i === json.length - 1) {
            if (buffer.length > 0) {
                await bulkAddHistory(buffer);
                processed += buffer.length;
                buffer = [];
            }
            
            setProgress(Math.round(((i + 1) / json.length) * 100));
            await new Promise(r => setTimeout(r, 0));
        }
      }

      await refreshStats();
      setMessage(`匯入完成！成功：${processed.toLocaleString()} 筆，略過無效/散客資料：${skipped.toLocaleString()} 筆`);
      setMessageType('success');
    } catch (err: any) {
      setMessage(`匯入失敗: ${err.message}`);
      setMessageType('error');
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        <div className="bg-slate-800 text-white px-6 py-4 flex justify-between items-center shrink-0">
            <h3 className="text-lg font-bold flex items-center gap-2">
                <Database size={20} className="text-blue-400"/> 
                歷史資料庫管理
            </h3>
            <button onClick={onClose} disabled={isProcessing} className="text-slate-400 hover:text-white"><X size={24}/></button>
        </div>

        <div className="p-6 overflow-y-auto bg-gray-50 flex-1">
            
            {/* Top Status */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
                 {/* Total Card */}
                 <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="p-3 bg-blue-50 text-blue-600 rounded-full">
                            <HardDrive size={24}/>
                        </div>
                        <div>
                            <div className="text-xs text-slate-500 font-bold uppercase tracking-wider">Total Records</div>
                            <div className="text-2xl font-black text-slate-800 font-mono">{totalCount.toLocaleString()}</div>
                        </div>
                    </div>
                </div>

                {/* Warning / Clear All */}
                <div className="bg-white border border-slate-200 rounded-lg p-4 flex items-center justify-between shadow-sm">
                     <div className="text-xs text-slate-500">
                        <div className="flex items-center gap-1 font-bold text-slate-700 mb-1"><AlertTriangle size={14} className="text-amber-500"/> 資料庫管理</div>
                        所有分店的資料將混合用於回購判斷。
                     </div>
                     {totalCount > 0 && (
                        <button onClick={handleClearAll} disabled={isProcessing} className="px-3 py-1.5 bg-red-50 text-red-600 text-xs font-bold rounded hover:bg-red-100 border border-red-200 transition-colors">
                            全部清空
                        </button>
                     )}
                </div>
            </div>

            {/* Import Section */}
            <div className="bg-white rounded-lg border border-blue-200 shadow-sm p-5 mb-6">
                <div className="flex justify-between items-center mb-4">
                     <h4 className="font-bold text-slate-800 flex items-center gap-2">
                        <Upload size={18} className="text-blue-500"/> 匯入新資料
                    </h4>
                    <button 
                        onClick={() => setShowStoreManage(!showStoreManage)}
                        className="text-xs flex items-center gap-1 px-2 py-1 rounded bg-slate-100 text-slate-600 hover:bg-slate-200 transition-colors"
                    >
                        <Settings size={12}/> {showStoreManage ? '隱藏管理' : '管理分店名單'}
                    </button>
                </div>
               
                {/* Store Management UI */}
                {showStoreManage && (
                    <div className="mb-6 p-4 bg-slate-50 border border-slate-200 rounded-lg animate-in slide-in-from-top-2">
                        <h5 className="text-xs font-bold text-slate-600 mb-3 flex items-center gap-1"><Store size={14}/> 編輯分店清單</h5>
                        
                        {/* Add New */}
                        <div className="flex gap-2 mb-3">
                            <input 
                                type="text" 
                                placeholder="新增分店名稱..." 
                                value={newStoreName}
                                onChange={e => setNewStoreName(e.target.value)}
                                className="flex-1 px-3 py-1.5 text-sm border border-gray-300 rounded focus:ring-2 focus:ring-blue-300 outline-none"
                            />
                            <button onClick={handleAddStore} className="px-3 py-1.5 bg-blue-600 text-white text-xs font-bold rounded hover:bg-blue-700 flex items-center gap-1">
                                <Plus size={14}/> 新增
                            </button>
                        </div>

                        {/* List */}
                        <div className="flex flex-wrap gap-2">
                            {availableStores.map(store => (
                                <div key={store.id} className="flex items-center gap-1 bg-white px-2 py-1 rounded border border-gray-200 shadow-sm text-sm">
                                    {editingStore && editingStore.id === store.id ? (
                                        <>
                                            <input 
                                                autoFocus
                                                value={editingStore.name} 
                                                onChange={e => setEditingStore({ id: editingStore.id, name: e.target.value })}
                                                className="w-20 px-1 py-0 text-xs border-b border-blue-400 outline-none"
                                            />
                                            <button onClick={handleUpdateStore} className="text-green-600"><Save size={14}/></button>
                                            <button onClick={() => setEditingStore(null)} className="text-gray-400"><X size={14}/></button>
                                        </>
                                    ) : (
                                        <>
                                            <span className="text-slate-700">{store.name}</span>
                                            <button onClick={() => setEditingStore({id: store.id!, name: store.name})} className="text-gray-300 hover:text-blue-500 ml-1"><Edit2 size={12}/></button>
                                            <button onClick={() => handleDeleteStoreRecord(store.id!, store.name)} className="text-gray-300 hover:text-red-500"><X size={14}/></button>
                                        </>
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>
                )}
                
                <div className="flex flex-col md:flex-row gap-4 mb-4">
                    <div className="flex-1">
                        <label className="block text-xs font-bold text-slate-500 mb-1">1. 目標分店名稱</label>
                        <div className="relative">
                            <Store className="absolute left-3 top-2.5 text-gray-400" size={16} />
                            <input 
                                type="text" 
                                list="store-suggestions"
                                value={targetStore}
                                onChange={(e) => setTargetStore(e.target.value)}
                                placeholder="請輸入或選擇分店..."
                                className="w-full pl-9 pr-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-blue-200 focus:border-blue-500 outline-none font-bold text-slate-700"
                            />
                            <datalist id="store-suggestions">
                                {availableStores.map(s => <option key={s.id} value={s.name} />)}
                            </datalist>
                        </div>
                    </div>
                    <div className="flex-1">
                         <label className="block text-xs font-bold text-slate-500 mb-1">2. 選擇檔案 (Excel)</label>
                         <label className={`
                            flex items-center justify-center w-full py-2 border-2 border-dashed rounded cursor-pointer transition-all
                            ${isProcessing ? 'bg-gray-100 border-gray-300 text-gray-400' : 'bg-blue-50 border-blue-300 text-blue-600 hover:bg-blue-100'}
                        `}>
                            {isProcessing ? <RefreshCw className="animate-spin mr-2" size={16}/> : <Upload className="mr-2" size={16}/>}
                            <span className="text-sm font-bold">{isProcessing ? '匯入中...' : '選擇 Excel 檔案'}</span>
                            <input type="file" className="hidden" accept=".xlsx, .xls" onChange={handleFileSelect} disabled={isProcessing} />
                        </label>
                    </div>
                </div>

                {isProcessing && (
                    <div className="space-y-1 mb-2">
                        <div className="flex justify-between text-xs font-bold text-slate-600">
                           <span>Progress</span>
                           <span>{progress}% ({totalRows.toLocaleString()} rows)</span>
                        </div>
                        <div className="w-full bg-gray-200 rounded-full h-1.5">
                            <div className="bg-blue-600 h-1.5 rounded-full transition-all duration-300" style={{ width: `${progress}%` }}></div>
                        </div>
                    </div>
                )}

                {message && (
                    <div className={`text-xs p-2 rounded flex items-center gap-2 font-medium
                        ${messageType === 'success' ? 'bg-emerald-50 text-emerald-700 border border-emerald-200' : 
                          messageType === 'error' ? 'bg-red-50 text-red-700 border border-red-200' : 
                          'bg-blue-50 text-blue-700 border border-blue-200'}
                    `}>
                        {messageType === 'success' ? <CheckCircle2 size={16}/> : 
                         messageType === 'error' ? <AlertTriangle size={16}/> : <Database size={16}/>}
                        {message}
                    </div>
                )}
            </div>

            {/* Store Stats List */}
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden flex flex-col">
                <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 font-bold text-sm text-slate-600 flex items-center gap-2 shrink-0">
                    <PieChart size={16}/> 分店資料統計 (點擊分店檢視年份)
                </div>
                <div className="divide-y divide-gray-100 overflow-y-auto">
                    {storeStats.length === 0 ? (
                        <div className="p-4 text-center text-gray-400 text-sm">目前資料庫是空的</div>
                    ) : (
                        storeStats.map((stat) => {
                            const isExpanded = expandedStore === stat.storeName;
                            return (
                                <div key={stat.storeName} className="flex flex-col">
                                    <div 
                                        onClick={() => handleToggleStoreYears(stat.storeName)}
                                        className={`p-3 flex items-center justify-between hover:bg-blue-50 transition-colors cursor-pointer group ${isExpanded ? 'bg-blue-50/50' : ''}`}
                                    >
                                        <div className="flex items-center gap-3">
                                            <div className={`w-1.5 h-8 rounded-full transition-colors ${isExpanded ? 'bg-blue-600' : 'bg-slate-300 group-hover:bg-blue-400'}`}></div>
                                            <div>
                                                <div className="font-bold text-slate-700 text-sm flex items-center gap-1">
                                                  {stat.storeName}
                                                  <ChevronRight size={14} className={`text-slate-400 transition-transform ${isExpanded ? 'rotate-90 text-blue-500' : ''}`} />
                                                </div>
                                                <div className="text-xs text-slate-400 font-mono">{stat.count.toLocaleString()} rows</div>
                                            </div>
                                        </div>
                                        <button 
                                            onClick={(e) => handleDeleteStoreHistory(e, stat.storeName)}
                                            disabled={isProcessing}
                                            className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                            title={`移除 ${stat.storeName} 的所有資料`}
                                        >
                                            <Trash2 size={16} />
                                        </button>
                                    </div>

                                    {/* Expanded Years View */}
                                    {isExpanded && (
                                        <div className="px-12 py-3 bg-white border-b border-gray-100 animate-in slide-in-from-top-2 duration-200">
                                            <div className="flex items-center gap-2 mb-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                                                <Calendar size={12}/> 包含年份 (點擊 X 可清除單一年度)
                                            </div>
                                            {loadingYears ? (
                                                <div className="flex items-center gap-2 text-xs text-blue-500">
                                                    <RefreshCw size={12} className="animate-spin" /> 讀取中...
                                                </div>
                                            ) : storeYears.length > 0 ? (
                                                <div className="flex flex-wrap gap-1.5">
                                                    {storeYears.map(year => (
                                                        <div key={year} className="group/year flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs font-mono font-bold border border-blue-200 shadow-sm">
                                                            <span>{year}</span>
                                                            <button 
                                                                onClick={(e) => handleDeleteYear(e, stat.storeName, year)}
                                                                disabled={isProcessing}
                                                                className="text-blue-400 hover:text-red-600 transition-colors p-0.5 rounded-full hover:bg-red-50"
                                                                title={`刪除 ${year} 年資料`}
                                                            >
                                                                <X size={10} />
                                                            </button>
                                                        </div>
                                                    ))}
                                                </div>
                                            ) : (
                                                <div className="text-xs text-gray-300 italic">無年份資訊</div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            );
                        })
                    )}
                </div>
            </div>

        </div>
      </div>
    </div>
  );
};

export default HistoryManager;
