
import React, { useState, useEffect } from 'react';
import { Database, Trash2, Upload, AlertTriangle, HardDrive, RefreshCw, X, Store, PieChart, CheckCircle2 } from 'lucide-react';
import { getHistoryCount, clearHistory, bulkAddHistory, HistoryRecord, getHistoryStatsByStore, deleteStoreHistory } from '../utils/db';
import { readExcelFile } from '../utils/excelHelper';
import { COL_HEADERS } from '../constants';

interface HistoryManagerProps {
  onClose: () => void;
}

const CHUNK_SIZE = 2000; 

// Common store names to help user (can be customized)
const SUGGESTED_STORES = ["台北總店", "台中分店", "高雄分店", "網路商店", "其他"];

const HistoryManager: React.FC<HistoryManagerProps> = ({ onClose }) => {
  const [totalCount, setTotalCount] = useState<number>(0);
  const [storeStats, setStoreStats] = useState<{ storeName: string; count: number }[]>([]);
  
  const [isProcessing, setIsProcessing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [totalRows, setTotalRows] = useState(0);
  const [message, setMessage] = useState<string>('');
  const [messageType, setMessageType] = useState<'success' | 'error' | 'info'>('info');
  
  // Import Config
  const [targetStore, setTargetStore] = useState('');

  useEffect(() => {
    refreshStats();
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

  const handleClearAll = async () => {
    if (!window.confirm("嚴重警告：確定要清空「所有分店」的歷史資料嗎？\n此動作無法復原。")) return;
    await clearHistory();
    await refreshStats();
    setMessage("全域資料庫已清空");
    setMessageType('success');
  };

  const handleDeleteStore = async (storeName: string) => {
    if (!window.confirm(`確定要移除「${storeName}」的所有歷史資料嗎？`)) return;
    setIsProcessing(true);
    try {
        await deleteStoreHistory(storeName);
        await refreshStats();
        setMessage(`已移除 ${storeName} 的資料`);
        setMessageType('success');
    } catch (e) {
        alert("刪除失敗");
    } finally {
        setIsProcessing(false);
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files[0]) {
          const file = e.target.files[0];
          // Auto-detect store name from filename if possible
          const name = file.name;
          const found = SUGGESTED_STORES.find(s => name.includes(s));
          if (found) {
              setTargetStore(found);
          } else {
              // Try to be smart? Or just leave it blank/default
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
    setMessage(`正在讀取檔案並匯入至「${targetStore}」...`);

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
          
          // Fix: Use Sales Date if available, otherwise fallback to Ticket No ('單號')
          const dateStr = String(row[COL_HEADERS.SALES_DATE] || row[COL_HEADERS.TICKET_NO] || '').trim();

          buffer.push({
            customerID: cid,
            itemID: itemID,
            date: dateStr,
            quantity: qty,
            storeName: storeName
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
                <h4 className="font-bold text-slate-800 flex items-center gap-2 mb-4">
                    <Upload size={18} className="text-blue-500"/> 匯入新資料
                </h4>
                
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
                                {SUGGESTED_STORES.map(s => <option key={s} value={s} />)}
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
            <div className="bg-white rounded-lg border border-slate-200 shadow-sm overflow-hidden">
                <div className="bg-slate-50 px-4 py-2 border-b border-slate-200 font-bold text-sm text-slate-600 flex items-center gap-2">
                    <PieChart size={16}/> 分店資料統計
                </div>
                <div className="divide-y divide-gray-100">
                    {storeStats.length === 0 ? (
                        <div className="p-4 text-center text-gray-400 text-sm">目前資料庫是空的</div>
                    ) : (
                        storeStats.map((stat) => (
                            <div key={stat.storeName} className="p-3 flex items-center justify-between hover:bg-gray-50 group">
                                <div className="flex items-center gap-3">
                                    <div className="w-2 h-8 bg-blue-400 rounded-sm"></div>
                                    <div>
                                        <div className="font-bold text-slate-700 text-sm">{stat.storeName}</div>
                                        <div className="text-xs text-slate-400 font-mono">{stat.count.toLocaleString()} rows</div>
                                    </div>
                                </div>
                                <button 
                                    onClick={() => handleDeleteStore(stat.storeName)}
                                    disabled={isProcessing}
                                    className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors opacity-0 group-hover:opacity-100"
                                    title={`移除 ${stat.storeName} 的資料`}
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        ))
                    )}
                </div>
            </div>

        </div>
      </div>
    </div>
  );
};

export default HistoryManager;
