
import React, { useState, useMemo, useEffect, useRef } from 'react';
import { RawRow, ExclusionItem, RewardRule, ProcessedData, Stage1Status, StaffRole, Stage3Summary, RepurchaseOption, StaffRecord } from './types';
import { readExcelFile, exportToExcel } from './utils/excelHelper';
import { processStage1, processStage2, processStage3, recalculateStage1Points, generateEmptyStage3Rows } from './utils/processor';
import { saveToLocal, loadFromLocal, checkSavedData } from './utils/storage';
import { seedDefaultStores } from './utils/db'; 
import FileUploader from './components/FileUploader';
import PopoutWindow from './components/PopoutWindow';
import DataViewer from './components/DataViewer';
import StaffClassificationModal from './components/StaffClassificationModal';
import HelpModal from './components/HelpModal';
import HistoryManager from './components/HistoryManager';
import ExportSettingsModal from './components/ExportSettingsModal';
import RepurchaseSettingsModal from './components/RepurchaseSettingsModal'; 
import StaffManagerModal from './components/StaffManagerModal'; 
import ProductGroupModal from './components/ProductGroupModal';
import { Download, Maximize2, AlertCircle, RefreshCcw, Save, FolderOpen, Activity, FileSpreadsheet, HelpCircle, Database, Loader2, Settings, Users, ClipboardList, Layers } from 'lucide-react';
import { COL_HEADERS } from './constants';

const DEFAULT_REPURCHASE_OPTIONS: RepurchaseOption[] = [
  { id: 'g1', label: '3+1', group: 'GENERAL', isEnabled: true },
  { id: 'g2', label: '8+3', group: 'GENERAL', isEnabled: true },
  { id: 'g3', label: '12+5', group: 'GENERAL', isEnabled: true },
  { id: 'g4', label: '補2+1', group: 'GENERAL', isEnabled: true },
  { id: 'g5', label: '補7+3', group: 'GENERAL', isEnabled: true },
  { id: 'g6', label: '補11+5', group: 'GENERAL', isEnabled: true },
  { id: 'g7', label: '4+1', group: 'GENERAL', isEnabled: true },
  { id: 'g8', label: '10+3', group: 'GENERAL', isEnabled: true },
  { id: 'g9', label: '20+8', group: 'GENERAL', isEnabled: true },
  { id: 'g10', label: '補3+1', group: 'GENERAL', isEnabled: true },
  { id: 'g11', label: '補9+3', group: 'GENERAL', isEnabled: true },
  { id: 'g12', label: '補19+8', group: 'GENERAL', isEnabled: true },
  { id: 'g13', label: '小盒開發', group: 'GENERAL', isEnabled: true },
  { id: 'g14', label: '大盒開發', group: 'GENERAL', isEnabled: true },
  { id: 'g15', label: '調劑開發', group: 'GENERAL', isEnabled: true },
  { id: 's1', label: '', group: 'SPECIAL', isEnabled: false }, 
  { id: 's2', label: '過年2件', group: 'SPECIAL', isEnabled: true },
  { id: 's3', label: '', group: 'SPECIAL', isEnabled: false }, 
  { id: 's4', label: '快閃2件', group: 'SPECIAL', isEnabled: true },
  { id: 's5', label: '', group: 'SPECIAL', isEnabled: false }, 
  { id: 's6', label: '母親節2件', group: 'SPECIAL', isEnabled: true },
  { id: 's7', label: '', group: 'SPECIAL', isEnabled: false }, 
  { id: 's8', label: '父親節2件', group: 'SPECIAL', isEnabled: true },
];

const App: React.FC = () => {
  const [exclusionList, setExclusionList] = useState<ExclusionItem[]>([]);
  const [rewardRules, setRewardRules] = useState<RewardRule[]>([]);
  const [rawSalesData, setRawSalesData] = useState<RawRow[]>([]);
  const [processedData, setProcessedData] = useState<ProcessedData>({});
  
  const [repurchaseOptions, setRepurchaseOptions] = useState<RepurchaseOption[]>(DEFAULT_REPURCHASE_OPTIONS);
  const [staffMasterList, setStaffMasterList] = useState<StaffRecord[]>([]);

  const [staffRoles, setStaffRoles] = useState<Record<string, StaffRole>>({});
  const [isClassifying, setIsClassifying] = useState(false);
  const [pendingRawData, setPendingRawData] = useState<RawRow[] | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  
  const [activePerson, setActivePerson] = useState<string>('');
  const [selectedPersons, setSelectedPersons] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState<'stage1' | 'stage2' | 'stage3' | 'repurchase'>('stage1');
  const [isPopOut, setIsPopOut] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  const [showHelp, setShowHelp] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showExportSettings, setShowExportSettings] = useState(false);
  const [showRepurchaseSettings, setShowRepurchaseSettings] = useState(false); 
  const [showStaffManager, setShowStaffManager] = useState(false); 
  const [showProductGroups, setShowProductGroups] = useState(false);

  const [lastSaveTime, setLastSaveTime] = useState<number | null>(null);
  const [hasSavedData, setHasSavedData] = useState<boolean>(false);
  
  const stateRef = useRef({ exclusionList, rewardRules, rawSalesData, processedData, activePerson, selectedPersons, staffRoles, repurchaseOptions, staffMasterList });

  useEffect(() => {
    seedDefaultStores();
    const ts = checkSavedData();
    if (ts) { setHasSavedData(true); setLastSaveTime(ts); }
    const saved = loadFromLocal();
    if (saved) {
        if(saved.repurchaseOptions) setRepurchaseOptions(saved.repurchaseOptions);
        if(saved.staffMasterList) setStaffMasterList(saved.staffMasterList);
    }
  }, []);

  useEffect(() => {
    stateRef.current = { exclusionList, rewardRules, rawSalesData, processedData, activePerson, selectedPersons, staffRoles, repurchaseOptions, staffMasterList };
  }, [exclusionList, rewardRules, rawSalesData, processedData, activePerson, selectedPersons, staffRoles, repurchaseOptions, staffMasterList]);

  const handleForceRefresh = () => {
    if (window.confirm("確定要強制刷新程式嗎？這會清除瀏覽器快取並重新載入，未儲存的進度將會遺失。")) {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.getRegistrations().then(registrations => {
          for (let registration of registrations) {
            registration.unregister();
          }
          window.location.reload();
        });
      } else {
        window.location.reload();
      }
    }
  };

  const handleManualSave = () => {
    const ts = saveToLocal(stateRef.current);
    if (ts) {
        setLastSaveTime(ts);
        setHasSavedData(true);
        alert(`已儲存進度 (${new Date(ts).toLocaleTimeString()})`);
    } else {
        alert("儲存失敗");
    }
  };

  const handleLoadSave = () => {
    const saved = loadFromLocal();
    if (saved) {
      if (rawSalesData.length > 0 && !window.confirm("讀取存檔將覆蓋目前資料，確定要讀取嗎？")) return;
      setExclusionList(saved.exclusionList); setRewardRules(saved.rewardRules);
      setRawSalesData(saved.rawSalesData); setProcessedData(saved.processedData);
      setActivePerson(saved.activePerson); setSelectedPersons(new Set(saved.selectedPersons));
      setStaffRoles(saved.staffRoles || {});
      setRepurchaseOptions(saved.repurchaseOptions || DEFAULT_REPURCHASE_OPTIONS);
      setStaffMasterList(saved.staffMasterList || []);
      setLastSaveTime(saved.timestamp);
      setHasSavedData(true);
      alert(`已還原 ${new Date(saved.timestamp).toLocaleString()} 的存檔`);
    }
  };

  const handleImportExclusion = async (file: File) => {
    try {
      const json = await readExcelFile(file);
      setExclusionList(json.map((row: any) => ({ 
        itemID: String(row['品項編號'] || row['Item ID'] || Object.values(row)[0]).trim(),
        category: String(row['分類'] || row['類別'] || '').trim() 
      })));
    } catch (e) { alert("匯入失敗: " + e); }
  };

  const handleImportRewards = async (file: File) => {
    try {
      const json = await readExcelFile(file);
      setRewardRules(json.map((row: any) => ({
        itemID: String(row['品項編號']).trim(), note: row['備註'], category: row['類別'],
        reward: Number(row['獎勵金額'] || row['獎勵'] || row['金額'] || 0),
        rewardLabel: String(row['獎勵金額'] || row['獎勵'] || row['金額'] || ''),
        format: row['形式'] || '現金'
      })));
    } catch (e) { alert("匯入失敗: " + e); }
  };

  const handleImportSales = async (file: File) => {
    if (!exclusionList.length || !rewardRules.length) return alert("請先匯入藥師點數與獎勵清單！");
    if (rawSalesData.length > 0) {
      if (!window.confirm("匯入新報表將清除目前篩選進度，確定嗎？")) return;
    }
    setErrorMsg(null);
    try {
      const json = await readExcelFile(file);
      const people = new Set<string>();
      json.forEach((row: any) => {
        const p = row[COL_HEADERS.SALES_PERSON];
        if (p) people.add(String(p));
      });
      if (people.size === 0) return alert("找不到銷售人員資料");
      const newRoles: Record<string, StaffRole> = {};
      const unknownPeople: string[] = [];
      people.forEach(personName => {
         const master = staffMasterList.find(s => s.name === personName);
         if (master) newRoles[personName] = master.role;
         else unknownPeople.push(personName);
      });
      setRawSalesData([]); setProcessedData({}); setActivePerson(''); setSelectedPersons(new Set());
      setPendingRawData(json); setStaffRoles(newRoles);
      if (unknownPeople.length > 0) setIsClassifying(true);
      else handleConfirmClassification(newRoles);
    } catch (e) { setErrorMsg("處理失敗: " + e); }
  };

  const handleConfirmClassification = async (updatedRoles: Record<string, StaffRole>) => {
    if (!pendingRawData) return;
    setIsClassifying(false); setIsProcessing(true);
    const finalRoles = { ...staffRoles, ...updatedRoles };
    setStaffRoles(finalRoles);
    setTimeout(async () => {
        try {
          const grouped: ProcessedData = {};
          const peopleSet = new Set(Object.keys(finalRoles)); 
          const rowsByPerson: Record<string, RawRow[]> = {};
          pendingRawData.forEach(row => {
            const p = String(row[COL_HEADERS.SALES_PERSON] || '');
            if (p && peopleSet.has(p)) {
              if (!rowsByPerson[p]) rowsByPerson[p] = [];
              rowsByPerson[p].push(row);
            }
          });
          for (const person of Object.keys(rowsByPerson)) {
            const role = finalRoles[person] || 'SALES';
            if (role === 'NO_BONUS') continue;
            const personRows = rowsByPerson[person];
            const pStage1 = await processStage1(personRows, exclusionList, role);
            const pStage2 = processStage2(personRows, rewardRules, role);
            let pStage3: Stage3Summary;
            if (role === 'PHARMACIST') pStage3 = { salesPerson: person, rows: [], total: 0 };
            else {
              const s3Summary = processStage3(personRows);
              pStage3 = s3Summary.length > 0 ? s3Summary[0] : { salesPerson: person, rows: generateEmptyStage3Rows(), total: 0 };
            }
            grouped[person] = { role, stage1: pStage1, stage2: pStage2, stage3: pStage3 };
          }
          setRawSalesData(pendingRawData); setProcessedData(grouped);
          setSelectedPersons(new Set(Object.keys(grouped)));
          const sortedKeys = Object.keys(grouped).sort((a, b) => {
            const roleA = grouped[a].role; const roleB = grouped[b].role;
            const pA = roleA === 'SALES' ? 1 : (roleA === 'PHARMACIST' ? 2 : 3);
            const pB = roleB === 'SALES' ? 1 : (roleB === 'PHARMACIST' ? 2 : 3);
            if (pA !== pB) return pA - pB;
            return a.localeCompare(b, 'zh-TW');
          });
          if (sortedKeys.length > 0) setActivePerson(sortedKeys[0]);
          setPendingRawData(null);
        } catch (e) { setErrorMsg("處理失敗: " + e); setPendingRawData(null); } finally { setIsProcessing(false); }
    }, 100);
  };

  const handleCancelClassification = () => { setIsClassifying(false); setPendingRawData(null); };

  const handleExportClick = async () => {
    if (!selectedPersons.size) return alert("請選擇銷售人員");
    const defaultFilename = `獎金計算報表_${new Date().toISOString().slice(0,10)}`;
    await exportToExcel(processedData, defaultFilename, selectedPersons, staffMasterList);
  };

  const setPersonData = (personId: string, transform: (p: ProcessedData[string]) => ProcessedData[string]) => {
    setProcessedData(prev => {
      const personData = prev[personId]; if (!personData) return prev;
      return { ...prev, [personId]: transform(personData) };
    });
  };

  const handleStatusChangeStage1 = (id: string, s: Stage1Status) => {
    if (!activePerson) return;
    setPersonData(activePerson, (data) => ({
      ...data,
      stage1: data.stage1.map(row => 
        row.id === id 
          ? { ...row, status: s, calculatedPoints: recalculateStage1Points({ ...row, status: s }, data.role) }
          : row
      )
    }));
  };
  
  // Updated to include 'returnTarget'
  const handleUpdateStage1Action2 = (id: string, field: 'originalDeveloper' | 'repurchaseType' | 'returnTarget', val: string) => {
      if (!activePerson) return;
      setPersonData(activePerson, (data) => ({
          ...data,
          stage1: data.stage1.map(row => {
             if (row.id !== id) return row;
             const updated = { ...row, [field]: val };
             // If changing return target or developer, recalculate points
             updated.calculatedPoints = recalculateStage1Points(updated, data.role);
             return updated;
          })
      }));
  };

  const handleToggleDeleteStage2 = (id: string) => {
    if (!activePerson) return;
    setPersonData(activePerson, (data) => ({
      ...data,
      stage2: data.stage2.map(row => row.id === id ? { ...row, isDeleted: !row.isDeleted } : row)
    }));
  };

  const handleUpdateStage2CustomReward = (id: string, val: string) => {
    if (!activePerson) return;
    setPersonData(activePerson, (data) => ({
      ...data,
      stage2: data.stage2.map(row => row.id === id ? { ...row, customReward: val === '' ? undefined : Number(val) } : row)
    }));
  };

  const sortedPeople = useMemo(() => {
    return Object.keys(processedData).sort((a, b) => {
       const roleA = processedData[a].role; const roleB = processedData[b].role;
       const pA = roleA === 'SALES' ? 1 : (roleA === 'PHARMACIST' ? 2 : 3);
       const pB = roleB === 'SALES' ? 1 : (roleB === 'PHARMACIST' ? 2 : 3);
       if (pA !== pB) return pA - pB;
       return a.localeCompare(b, 'zh-TW');
    });
  }, [processedData]);

  const allActiveStaff = useMemo(() => {
     return Object.keys(processedData).filter(p => processedData[p].role !== 'NO_BONUS').sort();
  }, [processedData]);

  const activeStaffRecord = useMemo(() => staffMasterList.find(s => s.name === activePerson), [staffMasterList, activePerson]);
  const currentData = useMemo(() => activePerson ? processedData[activePerson] : null, [processedData, activePerson]);
  
  // Modified Stage 1 Total Points to handle "Incoming" and "Outgoing" returns
  const stage1TotalPoints = useMemo(() => {
    if (!currentData || !activePerson) return 0;
    
    // 1. Calculate Own Points (Excluding Outgoing Returns)
    const ownPoints = currentData.stage1.reduce((sum, r) => {
      // If marked as RETURN and has a target OTHER than self (should theoretically not happen as we don't move records), 
      // but conceptually: if returnTarget is set, it means it's "transferred out"
      if (r.status === Stage1Status.RETURN && r.returnTarget) {
          return sum; // Exclude from local sum
      }
      
      if (r.status === Stage1Status.DEVELOP || r.status === Stage1Status.HALF_YEAR || r.status === Stage1Status.REPURCHASE || r.status === Stage1Status.RETURN) {
         return sum + r.calculatedPoints;
      }
      return sum;
    }, 0);

    // 2. Add Incoming Returns (From other people targeting me)
    let incomingPoints = 0;
    Object.keys(processedData).forEach(otherPerson => {
        if (otherPerson === activePerson) return;
        processedData[otherPerson].stage1.forEach(r => {
            if (r.status === Stage1Status.RETURN && r.returnTarget === activePerson) {
                // Re-calculate context for ME (the target)
                // If I am the target, I take the hit. Logic is handled in recalculateStage1Points context usually.
                // But recalculateStage1Points returns the deduction for the *row owner*.
                // If row owner (Original Seller) is ME (target), the logic holds. 
                // Wait, the row owner currently is the 'Processor' (otherPerson).
                // We need the value that *I* should deduct.
                // If I am the Original Seller (returnTarget), I take the full hit or 50% depending on Developer.
                
                // Reuse logic:
                // If dev is selected, split. If dev is me? If dev is 3rd party?
                // Standard Logic: Original Seller (Me) gets 50% or 100%.
                const points = recalculateStage1Points(r, processedData[otherPerson].role);
                incomingPoints += points;
            }
        });
    });

    return ownPoints + incomingPoints;
  }, [currentData, processedData, activePerson]);

  const dvProps = {
    sortedPeople, selectedPersons, togglePersonSelection: (p: string, e: any) => { e.stopPropagation(); const s = new Set(selectedPersons); s.has(p) ? s.delete(p) : s.add(p); setSelectedPersons(s); },
    activePerson, setActivePerson, currentData, activeTab, setActiveTab, stage1TotalPoints,
    handleStatusChangeStage1, handleToggleDeleteStage2, handleUpdateStage2CustomReward, onClose: isPopOut ? () => setIsPopOut(false) : undefined,
    handleUpdateStage1Action2, repurchaseOptions, allActiveStaff, staffRecord: activeStaffRecord,
    // Pass full data for "Incoming Return" calculation in DataViewer
    fullProcessedData: processedData 
  };
  
  const classificationNames = useMemo(() => {
    if (!pendingRawData) return [];
    const s = new Set<string>();
    pendingRawData.forEach(r => { const p = r[COL_HEADERS.SALES_PERSON]; if(p) s.add(String(p)); });
    return Array.from(s).sort();
  }, [pendingRawData]);

  return (
    <>
      <div className="flex flex-col h-screen bg-slate-100 font-sans text-slate-900">
        <div className="bg-slate-900 border-b border-slate-700 px-6 py-3 flex justify-between items-center shrink-0 z-40 text-white shadow-md">
          <div className="flex items-center gap-3">
             <div className="p-1.5 bg-blue-600 rounded text-white shadow-sm"><Activity size={18} /></div>
             <div>
                <h1 className="text-lg font-bold tracking-wide flex items-center gap-2">
                  分店獎金計算系統 
                  <div className="flex items-center gap-1.5 ml-1">
                    <button onClick={() => setShowHelp(true)} className="text-slate-400 hover:text-white transition-colors" title="使用說明">
                      <HelpCircle size={18} />
                    </button>
                    <button onClick={() => setShowHistory(true)} className="text-blue-300 hover:text-white transition-colors" title="歷史資料庫">
                      <Database size={18} />
                    </button>
                    <button onClick={handleForceRefresh} className="text-red-300 hover:text-white transition-colors" title="強制重新整理 (清除快取)">
                      <RefreshCcw size={16}/>
                    </button>
                  </div>
                </h1>
                <div className="flex items-center gap-2 text-xs text-slate-400 font-mono">
                    <span className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded">v1.1.0</span>
                    {lastSaveTime && <span className="flex items-center gap-1 border-l border-slate-700 pl-2"><Save size={10}/> {new Date(lastSaveTime).toLocaleTimeString()}</span>}
                </div>
             </div>
          </div>
          <div className="flex gap-2">
             <button onClick={() => setShowProductGroups(true)} className="flex items-center gap-2 px-3 py-1.5 text-xs text-purple-200 bg-slate-800 border border-slate-700 hover:bg-slate-700 hover:text-white transition-colors font-medium rounded-sm">
                <Layers size={14}/> 商品群組
             </button>
             <button onClick={() => setShowRepurchaseSettings(true)} className="flex items-center gap-2 px-3 py-1.5 text-xs text-purple-200 bg-slate-800 border border-slate-700 hover:bg-slate-700 hover:text-white transition-colors font-medium rounded-sm">
                <ClipboardList size={14}/> 回購狀態表
             </button>
             <button onClick={() => setShowStaffManager(true)} className="flex items-center gap-2 px-3 py-1.5 text-xs text-blue-200 bg-slate-800 border border-slate-700 hover:bg-slate-700 hover:text-white transition-colors font-medium rounded-sm">
                <Users size={14}/> 員工職位設定
             </button>
             <button onClick={handleManualSave} disabled={!rawSalesData.length || isProcessing} className="flex items-center gap-2 px-3 py-1.5 text-xs text-emerald-300 bg-slate-800 border border-emerald-800/50 hover:bg-slate-700 hover:text-emerald-200 transition-colors font-medium rounded-sm disabled:opacity-30">
               <Save size={14}/> 儲存
             </button>
             {hasSavedData && (
                <button onClick={handleLoadSave} disabled={isProcessing} className="flex items-center gap-2 px-3 py-1.5 text-xs text-amber-300 bg-slate-800 border border-amber-800/50 hover:bg-slate-700 hover:text-amber-200 transition-colors font-medium rounded-sm disabled:opacity-30">
                  <FolderOpen size={14} /> 讀取
                </button>
             )}
             <button onClick={() => setShowExportSettings(true)} className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 bg-slate-800 border border-slate-700 hover:bg-slate-700 hover:text-white transition-colors font-medium rounded-sm">
               <Settings size={14}/> 匯出設定
             </button>
             <button onClick={() => setIsPopOut(true)} disabled={!Object.keys(processedData).length} className="flex items-center gap-2 px-3 py-1.5 text-xs text-gray-300 bg-slate-800 border border-slate-700 hover:bg-slate-700 hover:text-white transition-colors font-medium rounded-sm disabled:opacity-30"><Maximize2 size={14}/> 視窗</button>
             <button onClick={handleExportClick} disabled={!Object.keys(processedData).length} className="flex items-center gap-2 px-4 py-1.5 text-xs bg-blue-700 text-white border border-blue-600 hover:bg-blue-600 hover:border-blue-500 rounded-sm disabled:bg-slate-800 transition-colors font-bold shadow-sm"><Download size={14} /> 匯出報表</button>
          </div>
        </div>
        <div className="px-4 py-3 grid grid-cols-1 md:grid-cols-3 gap-3 shrink-0 w-full border-b border-gray-200 bg-white">
            <FileUploader label="1. 藥師點數清單" onFileSelect={handleImportExclusion} isLoaded={exclusionList.length > 0} icon="list" disabled={isProcessing} />
            <FileUploader label="2. 現金獎勵表" onFileSelect={handleImportRewards} isLoaded={rewardRules.length > 0} icon="dollar" disabled={isProcessing} />
            <FileUploader label="3. 銷售報表" onFileSelect={handleImportSales} disabled={!exclusionList.length || !rewardRules.length || isProcessing} isLoaded={rawSalesData.length > 0} icon="file" />
        </div>
        {errorMsg && (
            <div className="mx-4 mt-2 p-2 bg-red-100 border border-red-300 text-red-800 flex items-center gap-2 text-sm font-bold">
                <AlertCircle size={16} /> <span>{errorMsg}</span>
            </div>
        )}
        {isProcessing ? (
           <div className="flex-1 flex flex-col items-center justify-center text-blue-600 bg-white">
               <Loader2 size={48} className="animate-spin mb-4" />
               <p className="text-lg font-bold">正在比對歷史資料...</p>
           </div>
        ) : sortedPeople.length > 0 ? (
           <div className="flex-1 overflow-hidden p-4">
             <div className="h-full bg-white border border-slate-300 shadow-sm flex flex-col">
                <DataViewer {...dvProps} />
             </div>
           </div>
        ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-slate-300 bg-slate-50">
                <FileSpreadsheet size={64} className="mb-4 text-slate-200" />
                <p className="text-lg font-bold text-slate-400">等待資料匯入...</p>
                <div className="flex gap-4 mt-8">
                     <button onClick={() => setShowHistory(true)} className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-500 rounded hover:bg-slate-200 font-bold text-sm">
                        <Database size={16}/> 管理歷史資料庫
                     </button>
                     <button onClick={() => setShowStaffManager(true)} className="flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-500 rounded hover:bg-slate-200 font-bold text-sm">
                        <Users size={16}/> 預設員工職位
                     </button>
                </div>
            </div>
        )}
      </div>
      {isPopOut && <PopoutWindow title="結果預覽" onClose={() => setIsPopOut(false)}><DataViewer {...dvProps} /></PopoutWindow>}
      {isClassifying && <StaffClassificationModal names={classificationNames} initialRoles={staffRoles} onConfirm={handleConfirmClassification} onCancel={handleCancelClassification} />}
      {showHelp && <HelpModal onClose={() => setShowHelp(false)} />}
      {showHistory && <HistoryManager onClose={() => setShowHistory(false)} />}
      {showExportSettings && <ExportSettingsModal onClose={() => setShowExportSettings(false)} />}
      {showRepurchaseSettings && <RepurchaseSettingsModal options={repurchaseOptions} onSave={(opts) => { setRepurchaseOptions(opts); setShowRepurchaseSettings(false); }} onClose={() => setShowRepurchaseSettings(false)} />}
      {showStaffManager && <StaffManagerModal staffList={staffMasterList} onSave={(list) => { setStaffMasterList(list); setShowStaffManager(false); }} onClose={() => setShowStaffManager(false)} />}
      {showProductGroups && <ProductGroupModal onClose={() => setShowProductGroups(false)} />}
    </>
  );
};
export default App;
