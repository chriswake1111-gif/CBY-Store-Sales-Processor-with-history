
import React, { useState, useEffect } from 'react';
import { X, Save, FolderOpen, Trash2, Store, Clock, AlertCircle, ArrowRight } from 'lucide-react';
import { getSavedSessions, saveSession, deleteSession, SavedSession, getStores } from '../utils/db';
import { AppState } from '../utils/storage';

interface SessionManagerModalProps {
  mode: 'SAVE' | 'LOAD';
  currentState: AppState; // Current state to save
  onLoad: (data: AppState) => void;
  onClose: () => void;
  currentStoreName?: string;
}

const SessionManagerModal: React.FC<SessionManagerModalProps> = ({ mode, currentState, onLoad, onClose, currentStoreName }) => {
  const [sessions, setSessions] = useState<SavedSession[]>([]);
  const [targetStoreName, setTargetStoreName] = useState(currentStoreName || '');
  const [availableStores, setAvailableStores] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  useEffect(() => {
    loadSessions();
    loadAvailableStores();
  }, []);

  const loadSessions = async () => {
    const list = await getSavedSessions();
    // Sort by timestamp desc
    setSessions(list.sort((a, b) => b.timestamp - a.timestamp));
  };

  const loadAvailableStores = async () => {
      const stores = await getStores();
      setAvailableStores(stores.map(s => s.name));
  };

  const handleSave = async (overwriteName?: string) => {
    const name = overwriteName || targetStoreName.trim();
    if (!name) {
        alert("請輸入分店名稱");
        return;
    }

    // Check if overwrite confirmation needed (only if coming from Input field)
    if (!overwriteName && sessions.some(s => s.storeName === name)) {
        if (!window.confirm(`分店「${name}」已有存檔，確定要覆蓋嗎？`)) {
            return;
        }
    }

    setIsProcessing(true);
    try {
        await saveSession(name, currentState);
        alert(`已儲存「${name}」的進度！`);
        onClose();
    } catch (e) {
        alert("儲存失敗");
    } finally {
        setIsProcessing(false);
    }
  };

  const handleLoad = (session: SavedSession) => {
      if (confirm(`確定要讀取「${session.storeName}」的存檔嗎？\n目前的尚未儲存的進度將會遺失。`)) {
          onLoad(session.data);
          onClose();
      }
  };

  const handleDelete = async (e: React.MouseEvent, storeName: string) => {
      e.stopPropagation();
      if (confirm(`確定要刪除「${storeName}」的存檔嗎？`)) {
          await deleteSession(storeName);
          await loadSessions();
      }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[80] p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]">
        <div className="bg-slate-800 text-white px-6 py-4 flex justify-between items-center shrink-0">
          <h3 className="text-lg font-bold flex items-center gap-2">
             {mode === 'SAVE' ? <Save size={20} className="text-emerald-400"/> : <FolderOpen size={20} className="text-amber-400"/>}
             {mode === 'SAVE' ? '儲存分店進度' : '讀取分店進度'}
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={24}/></button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 bg-slate-50">
            
            {mode === 'SAVE' && (
                <div className="mb-6 bg-white p-4 rounded-lg border border-slate-200 shadow-sm">
                    <label className="block text-sm font-bold text-slate-700 mb-2">輸入分店名稱 (儲存目標)</label>
                    <div className="flex gap-2">
                        <div className="relative flex-1">
                            <input 
                                type="text" 
                                list="store-suggestions"
                                value={targetStoreName}
                                onChange={(e) => setTargetStoreName(e.target.value)}
                                placeholder="例如：沙鹿店"
                                className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none font-bold text-slate-800"
                            />
                            <datalist id="store-suggestions">
                                {availableStores.map(s => <option key={s} value={s} />)}
                            </datalist>
                        </div>
                        <button 
                            onClick={() => handleSave()} 
                            disabled={isProcessing}
                            className="bg-emerald-600 text-white px-4 py-2 rounded-lg font-bold hover:bg-emerald-700 disabled:opacity-50 transition-colors flex items-center gap-2"
                        >
                            <Save size={18}/> 儲存
                        </button>
                    </div>
                    <p className="text-xs text-gray-400 mt-2 flex items-center gap-1">
                        <AlertCircle size={12}/> 輸入相同名稱將會自動覆蓋舊檔
                    </p>
                </div>
            )}

            <div className="space-y-3">
                <div className="flex items-center justify-between text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">
                    <span>{mode === 'SAVE' ? '或是選擇現有存檔覆蓋：' : '選擇要讀取的存檔：'}</span>
                    <span>{sessions.length} 個存檔</span>
                </div>
                
                {sessions.length === 0 ? (
                    <div className="text-center py-12 text-gray-400 border-2 border-dashed border-gray-200 rounded-lg">
                        <Store size={48} className="mx-auto mb-2 opacity-20"/>
                        尚無任何分店存檔
                    </div>
                ) : (
                    sessions.map(session => (
                        <div 
                            key={session.storeName}
                            onClick={() => mode === 'LOAD' ? handleLoad(session) : setTargetStoreName(session.storeName)}
                            className={`
                                group bg-white border rounded-lg p-4 cursor-pointer transition-all relative overflow-hidden
                                ${mode === 'SAVE' && targetStoreName === session.storeName ? 'border-emerald-500 ring-1 ring-emerald-500 bg-emerald-50/30' : 'border-gray-200 hover:border-blue-300 hover:shadow-md'}
                            `}
                        >
                            <div className="flex justify-between items-start">
                                <div>
                                    <div className="flex items-center gap-2">
                                        <Store size={16} className="text-blue-500"/>
                                        <h4 className="font-bold text-slate-800 text-base">{session.storeName}</h4>
                                    </div>
                                    <div className="flex items-center gap-4 mt-2 text-xs text-gray-500">
                                        <span className="flex items-center gap-1"><Clock size={12}/> {new Date(session.timestamp).toLocaleString()}</span>
                                        <span className="bg-gray-100 px-2 py-0.5 rounded text-gray-600">
                                            {session.data.rawSalesData?.length || 0} 筆資料
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {mode === 'LOAD' ? (
                                        <button onClick={(e) => { e.stopPropagation(); handleLoad(session); }} className="px-3 py-1.5 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 font-bold text-xs flex items-center gap-1">
                                            讀取 <ArrowRight size={12}/>
                                        </button>
                                    ) : (
                                        <span className="text-xs text-emerald-600 font-bold opacity-0 group-hover:opacity-100 transition-opacity">點擊帶入名稱</span>
                                    )}
                                    <button 
                                        onClick={(e) => handleDelete(e, session.storeName)}
                                        className="p-2 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded transition-colors"
                                    >
                                        <Trash2 size={16}/>
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))
                )}
            </div>
        </div>
      </div>
    </div>
  );
};

export default SessionManagerModal;
