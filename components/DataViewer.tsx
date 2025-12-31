import React, { useMemo, useState, useRef, useEffect, useLayoutEffect } from 'react';
import { ProcessedData, Stage1Status, RepurchaseOption, StaffRecord, Stage1Row } from '../types';
import { Trash2, RotateCcw, CheckSquare, Square, Minimize2, User, Pill, Coins, Package, ChevronDown, ListPlus, History, Loader2, UserPlus, XCircle, Target, TrendingUp, Undo2, ArrowRightLeft, ArrowUp, ArrowDown, ArrowUpDown, RefreshCcw, Calendar } from 'lucide-react';
import { createPortal } from 'react-dom';
import { getItemHistory, HistoryRecord } from '../utils/db'; 
import { recalculateStage1Points } from '../utils/processor'; 

interface DataViewerProps {
  sortedPeople: string[];
  selectedPersons: Set<string>;
  togglePersonSelection: (person: string, e: React.MouseEvent) => void;
  activePerson: string;
  setActivePerson: (person: string) => void;
  currentData: ProcessedData[string] | null;
  activeTab: 'stage1' | 'stage2' | 'stage3' | 'repurchase'; 
  setActiveTab: (tab: 'stage1' | 'stage2' | 'stage3' | 'repurchase') => void;
  stage1TotalPoints: number;
  handleStatusChangeStage1: (id: string, newStatus: Stage1Status) => void;
  handleToggleDeleteStage2: (id: string) => void;
  handleUpdateStage2CustomReward: (id: string, val: string) => void;
  handleUpdateStage1Action2: (id: string, field: 'originalDeveloper' | 'repurchaseType' | 'returnTarget', val: string) => void;
  repurchaseOptions: RepurchaseOption[];
  allActiveStaff: string[];
  staffRecord?: StaffRecord;
  fullProcessedData?: ProcessedData; 
  reportDate?: string; // New Prop for Date Display
  
  onClose?: () => void;
}

type SortKey = 'date' | 'customerID' | null;
type SortDirection = 'asc' | 'desc';

// Define interface here to ensure visibility
interface RepurchaseRowData extends Stage1Row {
    devPoints: number;
    actualSellerPoints: number;
}

const DataViewer: React.FC<DataViewerProps> = ({
  sortedPeople, selectedPersons, togglePersonSelection, activePerson, setActivePerson,
  currentData, activeTab, setActiveTab, stage1TotalPoints,
  handleStatusChangeStage1, handleToggleDeleteStage2, handleUpdateStage2CustomReward,
  handleUpdateStage1Action2, repurchaseOptions, allActiveStaff, staffRecord, fullProcessedData, reportDate,
  onClose
}) => {
  
  const rootRef = useRef<HTMLDivElement>(null);
  const [popoverState, setPopoverState] = useState<{ rowId: string, x: number, y: number } | null>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const [historyState, setHistoryState] = useState<{ x: number, y: number, records: HistoryRecord[], loading: boolean, targetRowId: string, targetCid: string, targetItemId: string, mode: 'dev' | 'seller' } | null>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const [sortConfig, setSortConfig] = useState<{ key: SortKey, direction: SortDirection }>({ key: null, direction: 'asc' });

  const getContext = () => {
    const doc = rootRef.current?.ownerDocument || document;
    const win = doc.defaultView || window;
    return { doc, win };
  };

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
        setPopoverState(null);
      }
      if (historyRef.current && !historyRef.current.contains(event.target as Node)) {
        setHistoryState(null);
      }
    };
    const { doc } = getContext();
    if (popoverState || historyState) doc.addEventListener('mousedown', handleClickOutside);
    return () => doc.removeEventListener('mousedown', handleClickOutside);
  }, [popoverState, historyState]);

  useLayoutEffect(() => {
    if (popoverState && popoverRef.current) adjustPosition(popoverRef.current, popoverState.x, popoverState.y);
  }, [popoverState]);

  useLayoutEffect(() => {
    if (historyState && historyRef.current) adjustPosition(historyRef.current, historyState.x, historyState.y);
  }, [historyState]);

  useEffect(() => {
      setSortConfig({ key: null, direction: 'asc' });
  }, [activePerson]);

  const adjustPosition = (el: HTMLElement, targetX: number, targetY: number) => {
        const { width, height } = el.getBoundingClientRect();
        const currentWindow = el.ownerDocument.defaultView || window;
        const viewportWidth = currentWindow.innerWidth;
        const viewportHeight = currentWindow.innerHeight;
        let newX = targetX;
        let newY = targetY;
        if (newX + width > viewportWidth) newX = newX - width - 20; 
        if (newY + height > viewportHeight) newY = newY - height - 20; 
        el.style.left = `${newX}px`;
        el.style.top = `${newY}px`;
  };

  const openPopover = (e: React.MouseEvent, rowId: string) => {
    e.stopPropagation();
    setHistoryState(null); 
    setPopoverState({ rowId, x: e.clientX + 10, y: e.clientY + 10 });
  };

  const openHistoryAndSelect = async (e: React.MouseEvent, customerID: string, itemID: string, rowId: string, mode: 'dev' | 'seller') => {
      e.stopPropagation();
      setPopoverState(null); 
      setHistoryState({ 
          x: e.clientX + 10, y: e.clientY + 10, records: [], loading: true, 
          targetRowId: rowId, targetCid: customerID, targetItemId: itemID, mode
      });
      try {
          const records = await getItemHistory(customerID, itemID);
          setHistoryState(prev => prev ? { ...prev, records, loading: false } : null);
      } catch (err) {
          console.error(err);
          setHistoryState(null);
      }
  };

  const handlePopoverSelect = (val: string) => {
    if (popoverState) {
        handleUpdateStage1Action2(popoverState.rowId, 'repurchaseType', val);
        setPopoverState(null);
    }
  };

  const handlePersonSelect = (name: string) => {
    if (historyState && historyState.targetRowId) {
        const field = historyState.mode === 'dev' ? 'originalDeveloper' : 'returnTarget';
        handleUpdateStage1Action2(historyState.targetRowId, field, name);
        setHistoryState(null);
    }
  };

  const handleSort = (key: SortKey) => {
      setSortConfig(current => {
          if (current.key === key) return { key, direction: current.direction === 'asc' ? 'desc' : 'asc' };
          return { key, direction: 'asc' };
      });
  };

  const handleResetSort = () => {
      setSortConfig({ key: null, direction: 'asc' });
  };

  const getSortIcon = (key: SortKey) => {
      if (sortConfig.key !== key) return <ArrowUpDown size={10} className="opacity-30" />;
      return sortConfig.direction === 'asc' ? <ArrowUp size={10} className="text-blue-600"/> : <ArrowDown size={10} className="text-blue-600"/>;
  };

  const getStoreColorClass = (name: string) => {
      const colors = ['bg-red-100 text-red-700','bg-orange-100 text-orange-700','bg-amber-100 text-amber-700','bg-green-100 text-green-700','bg-teal-100 text-teal-700','bg-cyan-100 text-cyan-700','bg-blue-100 text-blue-700','bg-indigo-100 text-indigo-700','bg-violet-100 text-violet-700','bg-fuchsia-100 text-fuchsia-700','bg-pink-100 text-pink-700','bg-rose-100 text-rose-700'];
      let hash = 0;
      const str = String(name || '');
      for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
      return colors[Math.abs(hash) % colors.length];
  };

  const stage2Totals = useMemo(() => {
    if (currentData?.role === 'PHARMACIST') return { cash: 0, vouchers: 0 };
    return currentData?.stage2.reduce((acc, row) => {
      if (row.isDeleted) return acc;
      if (row.format === '禮券') {
        acc.vouchers += row.quantity;
      } else {
        const amount = row.customReward !== undefined ? row.customReward : (row.quantity * row.reward);
        acc.cash += amount;
      }
      return acc;
    }, { cash: 0, vouchers: 0 }) || { cash: 0, vouchers: 0 };
  }, [currentData?.stage2, currentData?.role]);

  const pharmacistBonus = useMemo(() => {
     if (currentData?.role !== 'PHARMACIST') return 0;
     const dispensingRow = currentData.stage2.find(r => r.itemID === '001727'); 
     const qty = dispensingRow ? dispensingRow.quantity : 0;
     return Math.max(0, (qty - 300) * 10);
  }, [currentData?.stage2, currentData?.role]);

  const incomingReturns = useMemo(() => {
      if (!fullProcessedData || !activePerson) return [];
      const incoming: Stage1Row[] = [];
      Object.keys(fullProcessedData).forEach(otherPerson => {
          if (otherPerson === activePerson) return;
          fullProcessedData[otherPerson].stage1.forEach(row => {
              if (row.status === Stage1Status.RETURN && row.returnTarget === activePerson) {
                  incoming.push(row);
              }
          });
      });
      return incoming;
  }, [fullProcessedData, activePerson]);

  const formatCID = (id: string) => {
    if (!id) return '';
    return id.startsWith('00') ? id.substring(2) : id;
  };

  // --- STATISTICS FOR TABS ---
  const pointStats = useMemo(() => {
      if (!currentData || !activePerson || !fullProcessedData) {
          return { dev: 0, rep: 0, tableDev: 0 };
      }

      let dev = 0;
      let rep = 0;

      // 1. Calculate Own Sales (Dev vs Rep)
      currentData.stage1.forEach(row => {
          if (row.status === Stage1Status.DELETE) return;

          if (row.status === Stage1Status.REPURCHASE) {
              rep += row.calculatedPoints;
          } 
          else if (row.status === Stage1Status.DEVELOP || row.status === Stage1Status.HALF_YEAR) {
              dev += row.calculatedPoints;
          }
          else if (row.status === Stage1Status.RETURN) {
              // Only count returns that aren't transferred OUT
              if (!row.returnTarget) {
                  dev += row.calculatedPoints;
              }
          }
      });

      // 2. Add Incoming Returns (Penalties from others) to Dev score
      incomingReturns.forEach(row => {
           const points = recalculateStage1Points(row, currentData.role);
           dev += points;
      });

      // 3. Calculate Table Development (Bonuses from being Original Developer)
      let tableDev = 0;
      Object.values(fullProcessedData).forEach((personData: ProcessedData[string]) => {
          personData.stage1.forEach(row => {
              if (row.originalDeveloper === activePerson) {
                  if (row.status === Stage1Status.REPURCHASE) {
                      // Bonus = Full - Seller's Share
                      const fullPoints = recalculateStage1Points({ ...row, status: Stage1Status.DEVELOP }, personData.role);
                      const sellerPoints = row.calculatedPoints;
                      tableDev += (fullPoints - sellerPoints);
                  } 
                  else if (row.status === Stage1Status.RETURN) {
                       // Penalty Share = Full Deduction - Seller's Share
                       const fullDeduction = recalculateStage1Points({ ...row, originalDeveloper: undefined }, personData.role);
                       const sellerDeduction = recalculateStage1Points(row, personData.role);
                       tableDev += (fullDeduction - sellerDeduction);
                  }
              }
          });
      });

      return { dev, rep, tableDev };
  }, [currentData, activePerson, fullProcessedData, incomingReturns]);

  // --- REPURCHASE SUMMARY MATRIX LOGIC ---
  const repurchaseMatrix = useMemo((): { developers: string[], dataBySeller: Record<string, RepurchaseRowData[]> } => {
      if (!fullProcessedData) return { developers: [], dataBySeller: {} };

      const developersSet = new Set<string>();
      const groupedData: Record<string, RepurchaseRowData[]> = {};

      Object.entries(fullProcessedData).forEach(([sellerName, sellerData]: [string, ProcessedData[string]]) => {
          sellerData.stage1.forEach(row => {
              const isRepurchase = row.status === Stage1Status.REPURCHASE;
              const isReturnSplit = row.status === Stage1Status.RETURN && row.originalDeveloper && row.originalDeveloper !== '無';
              
              if (isRepurchase || isReturnSplit) {
                  const dev = row.originalDeveloper;
                  if (dev) {
                      developersSet.add(dev);
                      if (!groupedData[sellerName]) groupedData[sellerName] = [];
                      
                      let fullPoints = 0;
                      let sellerPoints = row.calculatedPoints;
                      let devPoints = 0;

                      if (isReturnSplit) {
                           fullPoints = recalculateStage1Points({ ...row, originalDeveloper: undefined }, sellerData.role);
                           devPoints = fullPoints - sellerPoints;
                      } else {
                           fullPoints = recalculateStage1Points({ ...row, status: Stage1Status.DEVELOP }, sellerData.role);
                           devPoints = fullPoints - sellerPoints;
                      }
                      
                      groupedData[sellerName].push({
                          ...row,
                          actualSellerPoints: sellerPoints,
                          devPoints: devPoints
                      });
                  }
              }
          });
      });

      const sortedDevelopers = Array.from(developersSet).sort();
      Object.keys(groupedData).forEach(key => {
          groupedData[key].sort((a, b) => a.date.localeCompare(b.date));
      });

      return { developers: sortedDevelopers, dataBySeller: groupedData };

  }, [fullProcessedData]);

  // Calculate count for Repurchase Tab
  const repurchaseRowCount = useMemo(() => {
     if (!repurchaseMatrix?.dataBySeller) return 0;
     return Object.values(repurchaseMatrix.dataBySeller).reduce((acc, rows: RepurchaseRowData[]) => acc + rows.length, 0);
  }, [repurchaseMatrix]);


  if (!currentData) {
    return (
      <div className="flex flex-col h-full bg-white items-center justify-center text-gray-400">
        <Package size={32} className="mb-2 opacity-50"/>
        <p className="text-sm font-mono">NO DATA SELECTED</p>
      </div>
    );
  }

  const isPharm = currentData.role === 'PHARMACIST';
  
  const theme = isPharm 
    ? { accent: 'text-blue-700', bgAccent: 'bg-blue-50', borderAccent: 'border-blue-200', badge: 'bg-blue-100 text-blue-800' }
    : { accent: 'text-emerald-700', bgAccent: 'bg-emerald-50', borderAccent: 'border-emerald-200', badge: 'bg-emerald-100 text-emerald-800' };

  const getStage2Label = () => isPharm ? '當月調劑件數' : '現金獎勵表';

  const tabs = [
    { 
        id: 'stage1', 
        label: '點數表', 
        count: (
           <span className="flex items-center gap-1 font-mono text-[10px] leading-none">
             <span className="text-slate-600 font-bold" title="個人開發點數">{pointStats.dev}</span>
             <span className="text-gray-300">/</span>
             <span className="text-amber-600 font-bold" title="總表回購點數">{pointStats.rep}</span>
             <span className="text-gray-300">/</span>
             <span className="text-purple-600 font-bold" title="總表開發點數">{pointStats.tableDev}</span>
           </span>
        ), 
        icon: <Coins size={12}/> 
    },
    { id: 'stage2', label: getStage2Label(), count: isPharm ? '' : `${currentData.stage2.filter(r => !r.isDeleted).length}`, icon: <Pill size={12}/> },
    ...(isPharm ? [] : [{ id: 'stage3', label: '美妝金額', count: `${currentData.stage3.total.toLocaleString()}`, icon: <Package size={12}/> }]),
    { id: 'repurchase', label: '回購總表', count: repurchaseRowCount > 0 ? `${repurchaseRowCount}` : '', icon: <RefreshCcw size={12}/> }
  ];

  const genOpts = repurchaseOptions.filter(o => o.isEnabled && o.group === 'GENERAL');
  const specOpts = repurchaseOptions.filter(o => o.isEnabled && o.group === 'SPECIAL');

  const combinedStage1 = [...currentData.stage1, ...incomingReturns];

  const sortedStage1 = useMemo(() => {
      if (!sortConfig.key) return combinedStage1;
      return [...combinedStage1].sort((a, b) => {
          let valA: string | number = '';
          let valB: string | number = '';
          if (sortConfig.key === 'date') { valA = a.date; valB = b.date; } 
          else if (sortConfig.key === 'customerID') { valA = a.customerID; valB = b.customerID; }
          if (valA < valB) return sortConfig.direction === 'asc' ? -1 : 1;
          if (valA > valB) return sortConfig.direction === 'asc' ? 1 : -1;
          return 0;
      });
  }, [combinedStage1, sortConfig]);

  return (
    <div ref={rootRef} className="flex flex-col h-full bg-white relative text-sm">
      
      {/* Top Controls (unchanged) */}
      <div className="border-b border-gray-300 bg-gray-50 p-2 shrink-0 flex flex-col gap-2">
         {/* Person Bar */}
         <div className="flex gap-1 overflow-x-auto pb-1 no-scrollbar items-center border-b border-gray-200 mb-1">
            {sortedPeople.map(person => {
              const isSelected = selectedPersons.has(person);
              const isActive = activePerson === person;
              return (
                <div key={person} onClick={() => setActivePerson(person)}
                  className={`
                    group flex items-center gap-1.5 px-2 py-1 border rounded-sm text-xs font-bold cursor-pointer transition-all select-none whitespace-nowrap
                    ${isActive 
                        ? 'bg-slate-700 text-white border-slate-700 shadow-sm' 
                        : 'bg-white text-slate-600 border-gray-300 hover:bg-gray-100'}
                  `}>
                  <button onClick={(e) => togglePersonSelection(person, e)} className={`flex items-center ${isActive ? 'text-white' : 'text-gray-400 hover:text-slate-800'}`}>
                    {isSelected ? <CheckSquare size={12} /> : <Square size={12} />}
                  </button>
                  {person}
                </div>
              );
            })}
         </div>

         {/* Header & Tabs */}
         <div className="flex justify-between items-end">
            <div className="flex items-center gap-4">
                <div className={`w-10 h-10 rounded border flex items-center justify-center ${theme.bgAccent} ${theme.borderAccent} ${theme.accent} shadow-sm`}>
                    <User size={20} />
                </div>
                <div className="flex flex-col">
                    <div className="flex items-center gap-2">
                        <h2 className="text-lg font-black text-slate-800 leading-none">
                            {activePerson}
                        </h2>
                        <span className={`text-[10px] px-1.5 py-0.5 rounded border font-bold ${theme.borderAccent} ${theme.badge} uppercase tracking-wider`}>
                            {isPharm ? 'Pharmacist' : 'Sales'}
                        </span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                        <p className="text-[10px] text-gray-500 font-mono">ID: {staffRecord?.id || currentData.stage1[0]?.salesPerson || 'N/A'}</p>
                        {staffRecord?.branch && (
                            <span className="text-[10px] text-slate-400 flex items-center gap-0.5 border-l border-gray-300 pl-2">
                                <Target size={10}/> {staffRecord.branch}
                            </span>
                        )}
                    </div>
                </div>
                
                {/* Targets & Date Badge */}
                <div className="ml-6 flex items-center gap-3">
                     {staffRecord?.pointsStandard !== undefined && (
                         <div className="bg-white px-2.5 py-1 rounded border border-gray-200 shadow-sm flex flex-col items-center">
                             <div className="text-[8px] text-gray-400 font-black uppercase flex items-center gap-1"><TrendingUp size={8}/> Points Target</div>
                             <div className="text-xs font-mono font-black text-blue-700">{staffRecord.pointsStandard.toLocaleString()}</div>
                         </div>
                     )}
                     {staffRecord?.cosmeticStandard !== undefined && (
                         <div className="bg-white px-2.5 py-1 rounded border border-gray-200 shadow-sm flex flex-col items-center">
                             <div className="text-[8px] text-gray-400 font-black uppercase flex items-center gap-1"><Package size={8}/> Cosmetic Target</div>
                             <div className="text-xs font-mono font-black text-emerald-700">${staffRecord.cosmeticStandard.toLocaleString()}</div>
                         </div>
                     )}
                     {reportDate && (
                         <div className="bg-white px-3 py-1 rounded border border-red-200 shadow-sm flex flex-col items-center justify-center">
                             <div className="text-[8px] text-gray-400 font-black uppercase flex items-center gap-1"><Calendar size={8}/> Period</div>
                             <div className="text-sm font-mono font-black text-slate-800">{reportDate}</div>
                         </div>
                     )}
                </div>
            </div>

            <div className="flex items-end gap-1">
                {tabs.map((tab: any) => {
                    const isActive = activeTab === tab.id;
                    return (
                        <button key={tab.id} onClick={() => setActiveTab(tab.id as any)}
                            className={`
                                flex items-center gap-1.5 px-3 py-1.5 rounded-t-sm text-xs font-bold border-t border-l border-r transition-all relative -mb-[1px]
                                ${isActive 
                                    ? 'bg-white text-slate-900 border-gray-300 border-b-white z-10' 
                                    : 'bg-gray-100 text-gray-500 border-transparent hover:bg-gray-200 border-b-gray-300'}
                            `}
                        >
                            {tab.label}
                            {tab.count !== '' && (
                                <span className={`text-[10px] px-1 py-0.5 rounded-sm font-mono ${isActive ? 'bg-slate-200 text-slate-700' : 'bg-gray-300 text-gray-600'}`}>
                                    {tab.count}
                                </span>
                            )}
                        </button>
                    );
                })}
            </div>
         </div>
      </div>
      
      {onClose && (
        <button onClick={onClose} className="absolute top-2 right-2 text-gray-400 hover:text-red-600 p-1 hover:bg-red-50 rounded border border-transparent hover:border-red-200 transition-colors">
            <Minimize2 size={16} />
        </button>
      )}

      {/* Content Table Area */}
      <div className="flex-1 overflow-auto bg-white border-t border-gray-300">
        
        {/* === STAGE 1 === (Unchanged) */}
        {activeTab === 'stage1' && (
          <>
            <table className="w-full text-sm text-left whitespace-nowrap border-collapse">
              <thead className="bg-slate-100 sticky top-0 z-10 text-slate-700 shadow-sm">
                <tr>
                  <th className="px-2 py-1.5 text-xs font-bold uppercase border border-slate-300 w-24 bg-slate-100">Action</th>
                  <th className="px-2 py-1.5 text-xs font-bold uppercase border border-slate-300 w-48 bg-slate-100">Action 2 (原開發/原銷售)</th>
                  <th onClick={handleResetSort} className="px-2 py-1.5 text-xs font-bold uppercase border border-slate-300 bg-slate-100 cursor-pointer hover:bg-slate-200 transition-colors group">
                    <div className="flex items-center gap-1">分類{sortConfig.key !== null && <Undo2 size={10} className="text-red-500 animate-in fade-in"/>}</div>
                  </th>
                  <th onClick={() => handleSort('date')} className="px-2 py-1.5 text-xs font-bold uppercase border border-slate-300 bg-slate-100 cursor-pointer hover:bg-slate-200 transition-colors select-none">
                    <div className="flex items-center gap-1">日期{getSortIcon('date')}</div>
                  </th>
                  <th onClick={() => handleSort('customerID')} className="px-2 py-1.5 text-xs font-bold uppercase border border-slate-300 bg-slate-100 cursor-pointer hover:bg-slate-200 transition-colors select-none">
                    <div className="flex items-center gap-1">客戶編號{getSortIcon('customerID')}</div>
                  </th>
                  <th className="px-2 py-1.5 text-xs font-bold uppercase border border-slate-300 bg-slate-100">品項編號</th>
                  <th className="px-2 py-1.5 text-xs font-bold uppercase border border-slate-300 bg-slate-100">品名</th>
                  <th className="px-2 py-1.5 text-xs font-bold uppercase border border-slate-300 bg-slate-100 text-right">數量</th>
                  <th className="px-2 py-1.5 text-xs font-bold uppercase border border-slate-300 bg-slate-100 text-right">金額</th>
                  <th className="px-2 py-1.5 text-xs font-bold uppercase border border-slate-300 bg-slate-100 text-right">折扣比</th>
                  <th className="px-2 py-1.5 text-xs font-bold uppercase border border-slate-300 bg-slate-100 text-right">計算點數</th>
                </tr>
              </thead>
              <tbody>
                {sortedStage1.map((row, idx) => {
                  const isIncoming = row.salesPerson !== activePerson;
                  const isDel = row.status === Stage1Status.DELETE;
                  const isRep = row.status === Stage1Status.REPURCHASE;
                  const isRet = row.status === Stage1Status.RETURN;
                  const isDispensing = isPharm && row.category === '調劑點數';
                  const isHiddenPoints = !isRet && row.category === '現金-小兒銷售';
                  const isAction2Active = !isDel && (isRep || isRet || row.status === Stage1Status.DEVELOP || row.status === Stage1Status.HALF_YEAR);
                  const isTransferredOut = !isIncoming && !!row.returnTarget;

                  let rowBg = idx % 2 === 0 ? 'bg-white' : 'bg-slate-50';
                  if (isIncoming) rowBg = 'bg-red-50/50'; 
                  if (isTransferredOut) rowBg = 'bg-gray-100/80';

                  let textClass = 'text-slate-700';
                  if (isDel) textClass = 'text-gray-300 line-through';
                  else if (isTransferredOut) textClass = 'text-gray-400 line-through';
                  else if (isIncoming) textClass = 'text-slate-600 italic';
                  
                  return (
                    <tr key={`${row.id}_${isIncoming ? 'inc' : 'own'}`} className={`group hover:bg-yellow-50 ${rowBg}`}>
                      <td className="px-2 py-1 border border-slate-200 text-center align-top relative">
                         {isIncoming ? (
                             <span className="text-[10px] text-red-500 font-bold flex items-center justify-center gap-1"><ArrowRightLeft size={10}/> 轉入退貨</span>
                         ) : isDispensing ? (
                          <button onClick={() => handleStatusChangeStage1(row.id, isDel ? Stage1Status.DEVELOP : Stage1Status.DELETE)} className={`px-2 py-0.5 rounded text-[10px] font-bold border w-full ${isDel ? 'bg-white border-red-300 text-red-600 hover:bg-red-50' : 'bg-white border-slate-300 text-slate-600 hover:border-red-400 hover:text-red-600'}`}>{isDel ? '復原' : '刪除'}</button>
                        ) : (
                          <select value={row.status} onChange={(e) => handleStatusChangeStage1(row.id, e.target.value as Stage1Status)} className={`w-full border text-[11px] font-bold py-0.5 px-1 rounded-sm focus:outline-none cursor-pointer ${isRep ? 'bg-amber-100 text-amber-800 border-amber-300' : isRet ? 'bg-red-100 text-red-800 border-red-300' : isDel ? 'bg-gray-100 text-gray-400 border-gray-300' : 'bg-white text-slate-700 border-slate-300 hover:border-blue-400'}`}>
                              {row.quantity < 0 ? (<><option value={Stage1Status.RETURN}>退貨</option><option value={Stage1Status.DELETE}>刪除</option></>) : (<><option value={Stage1Status.DEVELOP}>開發</option><option value={Stage1Status.HALF_YEAR}>隔半年</option><option value={Stage1Status.REPURCHASE}>回購</option><option value={Stage1Status.DELETE}>刪除</option></>)}
                          </select>
                        )}
                      </td>
                      <td className="px-2 py-1 border border-slate-200 align-top">
                        <div className={`flex gap-1 ${!isAction2Active || isIncoming ? 'opacity-40 pointer-events-none grayscale' : ''}`}>
                             <div className="relative flex-1">
                                <button onClick={(e) => openHistoryAndSelect(e, row.customerID, row.itemID, row.id, 'dev')} className={`w-full text-[10px] border rounded px-1 py-0.5 text-left flex items-center justify-between ${row.originalDeveloper && row.originalDeveloper !== '無' ? 'bg-purple-50 border-purple-200 text-purple-700 hover:bg-purple-100' : 'bg-white border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600'}`} title="點擊選擇原開發者">
                                    <span className="truncate">{row.originalDeveloper || '選擇開發'}</span>
                                    <UserPlus size={10} className="opacity-50 shrink-0 ml-1"/>
                                </button>
                             </div>
                             {isRet ? (
                                <div className="relative flex-1">
                                    <button onClick={(e) => openHistoryAndSelect(e, row.customerID, row.itemID, row.id, 'seller')} className={`w-full text-[10px] border rounded px-1 py-0.5 text-left flex items-center justify-between ${row.returnTarget ? 'bg-orange-50 border-orange-200 text-orange-700 hover:bg-orange-100' : 'bg-white border-gray-300 text-gray-500 hover:border-red-400 hover:text-red-600'}`} title="選擇原銷售者 (轉出此筆資料)">
                                        <span className="truncate">{row.returnTarget || '轉出對象'}</span>
                                        <ArrowRightLeft size={10} className="opacity-50 shrink-0 ml-1"/>
                                    </button>
                                </div>
                             ) : (
                                <button onClick={(e) => openPopover(e, row.id)} className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] border truncate max-w-[80px] ${row.repurchaseType ? 'bg-blue-50 border-blue-200 text-blue-700' : 'bg-gray-50 border-gray-200 text-gray-400 hover:bg-gray-100'}`}>
                                    <ListPlus size={10} />
                                    <span className="truncate">{row.repurchaseType || '狀態'}</span>
                                </button>
                             )}
                        </div>
                      </td>
                      <td className={`px-2 py-1 border border-slate-200 ${textClass}`}>{row.category}{isIncoming && <div className="text-[9px] text-slate-400">From: {row.salesPerson}</div>}</td>
                      <td className={`px-2 py-1 border border-slate-200 font-mono ${textClass}`}>{row.date}</td>
                      <td className={`px-2 py-1 border border-slate-200 font-mono ${textClass}`}>{formatCID(row.customerID)}</td>
                      <td className={`px-2 py-1 border border-slate-200 font-mono text-[11px] ${textClass} ${!isDel && !isTransferredOut ? 'font-bold' : ''}`}>{row.itemID}</td>
                      <td className={`px-2 py-1 border border-slate-200 ${textClass}`}>{row.itemName}</td>
                      <td className={`px-2 py-1 border border-slate-200 text-right font-mono ${textClass}`}>{row.quantity}</td>
                      <td className={`px-2 py-1 border border-slate-200 text-right font-mono ${textClass}`}>{row.amount}</td>
                      <td className={`px-2 py-1 border border-slate-200 text-right font-mono ${textClass}`}>{row.discountRatio}</td>
                      <td className={`px-2 py-1 border border-slate-200 text-right font-mono font-bold ${isDel || isTransferredOut ? 'text-gray-300' : isRep ? 'text-amber-600' : isRet ? 'text-red-600' : 'text-slate-900'}`}>{isDel || isTransferredOut ? 0 : (isHiddenPoints ? '-' : row.calculatedPoints)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {/* Portals ... (unchanged) */}
            {popoverState && createPortal(
                <div ref={popoverRef} className="fixed z-[100] bg-white rounded-lg shadow-xl border border-slate-200 p-3 w-64 animate-in fade-in zoom-in-95 duration-100" style={{ left: popoverState.x, top: popoverState.y }}>
                    <div className="text-xs font-bold text-gray-500 mb-2 pb-1 border-b">選擇回購狀態</div>
                    <div className="space-y-3">
                        {genOpts.length > 0 && <div className="grid grid-cols-3 gap-1">{genOpts.map(o => <button key={o.id} onClick={() => handlePopoverSelect(o.label)} className="text-[10px] px-1 py-1 bg-blue-50 text-blue-700 rounded hover:bg-blue-100 border border-blue-100 truncate">{o.label}</button>)}</div>}
                        {specOpts.length > 0 && <div className="grid grid-cols-2 gap-1">{specOpts.map(o => <button key={o.id} onClick={() => handlePopoverSelect(o.label)} className="text-[10px] px-1 py-1 bg-purple-50 text-purple-700 rounded hover:bg-purple-100 border border-purple-100 truncate">{o.label}</button>)}</div>}
                        <button onClick={() => handlePopoverSelect('')} className="w-full mt-1 text-[10px] text-gray-400 hover:text-red-500 border border-transparent hover:border-red-100 rounded">清除狀態</button>
                    </div>
                </div>, rootRef.current ? (rootRef.current.ownerDocument.body) : document.body
            )}
            {historyState && createPortal(
                <div ref={historyRef} className="fixed z-[100] bg-white rounded-lg shadow-xl border border-slate-200 w-80 overflow-hidden animate-in fade-in zoom-in-95 duration-100 flex flex-col max-h-[300px]" style={{ left: historyState.x, top: historyState.y }}>
                    <div className="bg-slate-100 px-3 py-2 border-b border-gray-200 flex items-center justify-between shrink-0">
                        <div className="flex flex-col"><span className="text-xs font-bold text-slate-700 flex items-center gap-1"><History size={12} className="text-blue-500"/> {historyState.mode === 'dev' ? '選擇原開發者' : '選擇原銷售者(轉出)'}</span><span className="text-[10px] text-gray-400 font-mono">{historyState.targetItemId}</span></div>
                        <button onClick={() => handlePersonSelect(historyState.mode === 'dev' ? '無' : '')} className="text-[10px] px-2 py-1 bg-white border border-gray-300 text-gray-500 hover:text-red-600 hover:border-red-300 rounded transition-colors flex items-center gap-1"><XCircle size={10}/> {historyState.mode === 'dev' ? '設為無' : '取消轉出'}</button>
                    </div>
                    <div className="overflow-y-auto flex-1 p-0 bg-white">
                        {historyState.loading ? <div className="p-4 flex justify-center text-blue-500"><Loader2 className="animate-spin" size={20}/></div> : historyState.records.length === 0 ? <div className="p-4 text-center"><div className="text-xs text-gray-400 mb-2">查無購買紀錄</div><div className="text-[10px] text-gray-300">請確認是否已匯入歷史資料</div></div> : (
                            <div className="divide-y divide-gray-100">
                                {historyState.records.map((rec, idx) => {
                                    const isActive = rec.salesPerson && allActiveStaff.includes(rec.salesPerson);
                                    return (
                                        <div key={idx} className="px-3 py-2 hover:bg-blue-50/50 flex items-center justify-between text-xs font-mono group">
                                            <div className="flex items-center text-slate-600">
                                                <span className="text-red-600 font-bold">{rec.date}</span>
                                                {rec.displayAlias && <span className="ml-1 text-[10px] text-blue-600 font-bold bg-blue-50 px-1 rounded border border-blue-100">{rec.displayAlias}</span>}
                                                <span className="w-2 inline-block"></span>
                                                <span className="font-bold text-slate-800 text-center">{rec.quantity || '-'}</span>
                                                {rec.unit && <span className="text-[10px] text-gray-400 ml-0.5">{rec.unit}</span>}
                                                <span className="w-2 inline-block"></span>
                                                <span className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${getStoreColorClass(rec.storeName || '')}`}>{(rec.storeName || '未知').substring(0, 2)}</span>
                                                <span className="text-[10px] text-black font-mono ml-1">(${rec.price || 0})</span>
                                            </div>
                                            <button onClick={() => rec.salesPerson && handlePersonSelect(rec.salesPerson)} disabled={!rec.salesPerson} className={`text-[10px] px-2 py-0.5 rounded border whitespace-nowrap transition-all flex items-center gap-1 ${!rec.salesPerson ? 'bg-gray-50 text-gray-300 border-transparent cursor-default' : isActive ? 'bg-purple-50 text-purple-700 border-purple-200 hover:bg-purple-100 hover:border-purple-300 hover:shadow-sm cursor-pointer' : 'bg-gray-100 text-gray-400 border-gray-200 hover:bg-gray-200 hover:text-gray-600 cursor-pointer'}`} title={isActive ? "點擊選取" : "已離職或非現職人員"}>{rec.salesPerson || '無'}{rec.salesPerson && <UserPlus size={8} className="opacity-0 group-hover:opacity-100 transition-opacity"/>}</button>
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                     <div className="p-1 bg-gray-50 text-[9px] text-gray-400 text-center border-t border-gray-100">點擊名字即可帶入</div>
                </div>, rootRef.current ? (rootRef.current.ownerDocument.body) : document.body
            )}
          </>
        )}

        {/* ... (Rest of DataViewer) ... */}
        {activeTab === 'stage2' && (
          // ... (Stage 2 implementation unchanged) ...
          isPharm ? (
            <div className="flex flex-col h-full">
              <div className="bg-white px-4 py-3 border-b border-gray-300 shadow-sm shrink-0">
                  <div className="bg-blue-50 px-4 py-2 rounded border border-blue-200 text-blue-900 font-bold flex justify-between items-center">
                    <span className="text-sm font-mono">自費調劑獎金</span>
                    <span className="text-lg font-mono">${pharmacistBonus.toLocaleString()}元</span>
                  </div>
                  <div className="text-[10px] text-gray-400 mt-1 text-right">
                    規則：(自費調劑數量 - 300) * 10，若不足 300 則為 0
                  </div>
              </div>
              
              <div className="flex-1 overflow-auto">
                  <table className="w-full text-sm text-left whitespace-nowrap border-collapse">
                    <thead className="bg-slate-100 sticky top-0 z-10 text-slate-700">
                      <tr>
                        <th className="px-2 py-1.5 text-xs font-bold uppercase border border-slate-300 bg-slate-100">品項編號</th>
                        <th className="px-2 py-1.5 text-xs font-bold uppercase border border-slate-300 bg-slate-100">品名</th>
                        <th className="px-2 py-1.5 text-xs font-bold uppercase border border-slate-300 bg-slate-100 text-right">數量</th>
                      </tr>
                    </thead>
                    <tbody>
                      {currentData.stage2.map((row, idx) => (
                        <tr key={row.id} className={`hover:bg-blue-50 ${idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}`}>
                          <td className="px-2 py-1 border border-slate-200 text-slate-600 font-mono">{row.itemID}</td>
                          <td className="px-2 py-1 border border-slate-200 font-medium text-slate-800">{row.itemName}</td>
                          <td className="px-2 py-1 border border-slate-200 text-right font-bold font-mono text-slate-900">{row.quantity} <span className="text-xs font-normal text-gray-500">{row.rewardLabel}</span></td>
                        </tr>
                      ))}
                      {currentData.stage2.length === 0 && (
                        <tr><td colSpan={3} className="p-10 text-center text-gray-400 font-mono">NO DATA FOUND</td></tr>
                      )}
                    </tbody>
                  </table>
              </div>
            </div>
          ) : (
            <div className="relative flex flex-col h-full">
              <div className="bg-white px-2 py-2 border-b border-gray-300 flex justify-between items-center shadow-sm shrink-0">
                <span className="text-xs text-gray-500 font-medium flex items-center gap-1"><Trash2 size={12}/> Gray = Temporary Deleted</span>
                <div className="bg-emerald-50 px-3 py-1 rounded border border-emerald-200 text-emerald-900 font-bold flex gap-3 text-xs font-mono">
                  <span>CASH: ${stage2Totals.cash.toLocaleString()}</span>
                  <span className="text-emerald-300">|</span>
                  <span>VOUCHER: {stage2Totals.vouchers}</span>
                </div>
              </div>
              <div className="flex-1 overflow-auto">
                <table className="w-full text-sm text-left whitespace-nowrap border-collapse">
                    <thead className="bg-slate-100 sticky top-0 z-10 text-slate-700">
                    <tr>
                        <th className="px-2 py-1.5 w-10 text-center text-xs font-bold uppercase border border-slate-300 bg-slate-100">Del</th>
                        <th className="px-2 py-1.5 text-xs font-bold uppercase border border-slate-300 bg-slate-100">類別</th>
                        <th className="px-2 py-1.5 text-xs font-bold uppercase border border-slate-300 bg-slate-100">日期</th>
                        <th className="px-2 py-1.5 text-xs font-bold uppercase border border-slate-300 bg-slate-100">客戶編號</th>
                        <th className="px-2 py-1.5 text-xs font-bold uppercase border border-slate-300 bg-slate-100">品項編號</th>
                        <th className="px-2 py-1.5 text-xs font-bold uppercase border border-slate-300 bg-slate-100">品名</th>
                        <th className="px-2 py-1.5 text-right text-xs font-bold uppercase border border-slate-300 bg-slate-100">Qty</th>
                        <th className="px-2 py-1.5 text-xs font-bold uppercase border border-slate-300 bg-slate-100">備註</th>
                        <th className="px-2 py-1.5 text-right text-xs font-bold uppercase border border-slate-300 bg-slate-100">獎勵</th>
                    </tr>
                    </thead>
                    <tbody>
                    {currentData.stage2.map((row, idx) => {
                        const isDel = row.isDeleted;
                        const txtCls = isDel ? 'text-gray-300 line-through' : 'text-slate-700';
                        return (
                        <tr key={row.id} className={`group hover:bg-yellow-50 ${isDel ? 'bg-gray-100' : (idx % 2 === 0 ? 'bg-white' : 'bg-slate-50')}`}>
                            <td className="px-2 py-1 border border-slate-200 text-center">
                            <button onClick={() => handleToggleDeleteStage2(row.id)} className={`p-1 rounded transition-colors ${isDel ? 'text-blue-600 bg-blue-50 border border-blue-200' : 'text-gray-400 hover:text-red-600 hover:bg-red-50'}`}>
                                {isDel ? <RotateCcw size={12} /> : <Trash2 size={12} />}
                            </button>
                            </td>
                            <td className={`px-2 py-1 border border-slate-200 ${txtCls}`}>{row.category}</td>
                            <td className={`px-2 py-1 border border-slate-200 font-mono ${txtCls}`}>{row.displayDate}</td>
                            
                            <td className={`px-2 py-1 border border-slate-200 font-mono ${txtCls}`}>{formatCID(row.customerID)}</td>

                            <td className={`px-2 py-1 border border-slate-200 font-mono text-[11px] ${txtCls}`}>{row.itemID}</td>
                            <td className={`px-2 py-1 border border-slate-200`}>
                                <div className={`font-medium ${isDel ? 'text-gray-300 line-through' : 'text-slate-800'}`}>{row.itemName}</div>
                            </td>

                            <td className={`px-2 py-1 border border-slate-200 text-right font-mono ${txtCls}`}>{row.quantity}</td>
                            <td className={`px-2 py-1 border border-slate-200 text-xs truncate max-w-[120px] ${txtCls}`}>{row.note}</td>
                            <td className={`px-2 py-1 border border-slate-200 text-right font-bold ${txtCls}`}>
                            {row.format === '禮券' ? 
                                <span className="text-purple-700 font-mono">{row.quantity}張 <span className="text-[10px] text-gray-400">{row.rewardLabel}</span></span> 
                                : 
                                <div className="flex justify-end items-center gap-0.5">
                                <span className="text-gray-400 text-[10px]">$</span>
                                <input type="number" disabled={isDel} value={row.customReward ?? (row.quantity * row.reward)}
                                    onChange={(e) => handleUpdateStage2CustomReward(row.id, e.target.value)}
                                    className={`w-14 text-right bg-transparent outline-none font-mono text-sm border-b border-transparent focus:border-blue-500 p-0 ${row.customReward !== undefined ? 'text-emerald-600 font-black' : ''}`} />
                                </div>
                            }
                            </td>
                        </tr>
                        );
                    })}
                    </tbody>
                </table>
              </div>
            </div>
          )
        )}

        {/* ... (Stage 3) ... */}
        {activeTab === 'stage3' && !isPharm && (
          <div className="p-4 flex justify-center h-full items-start bg-slate-50">
             {/* Stage 3 content same as before */}
             <div className="border border-slate-300 bg-white w-full max-w-lg shadow-sm">
                <div className="bg-slate-200 px-4 py-2 border-b border-slate-300 flex justify-between items-center">
                    <h3 className="font-bold text-slate-800 text-sm flex items-center gap-2 uppercase">Cosmetic Analysis</h3>
                    <span className="text-[10px] font-mono text-slate-500">AUTO-SUM</span>
                </div>
                <table className="w-full text-sm border-collapse">
                <thead className="bg-slate-100 text-slate-600">
                    <tr><th className="px-4 py-2 text-left font-bold border-b border-slate-200">Brand</th><th className="px-4 py-2 text-right font-bold border-b border-slate-200">Amount</th></tr>
                </thead>
                <tbody>
                    {currentData.stage3.rows.map(row => (
                    <tr key={row.categoryName} className="hover:bg-slate-50 border-b border-slate-100 last:border-0">
                        <td className="px-4 py-2 text-slate-700 font-medium">{row.categoryName}</td>
                        <td className="px-4 py-2 text-right font-mono text-slate-800">${row.subTotal.toLocaleString()}</td>
                    </tr>
                    ))}
                    <tr className="bg-slate-100 border-t-2 border-slate-300">
                        <td className="px-4 py-2 text-slate-900 font-bold uppercase">Total</td>
                        <td className="px-4 py-2 text-right text-slate-900 font-mono text-lg font-bold">${currentData.stage3.total.toLocaleString()}</td>
                    </tr>
                </tbody>
                </table>
            </div>
          </div>
        )}

        {/* --- REPURCHASE MATRIX (Added) --- */}
        {activeTab === 'repurchase' && (
          <div className="flex flex-col h-full bg-slate-50">
             <div className="flex-1 overflow-auto p-4">
                 {repurchaseMatrix.developers.length === 0 ? (
                     <div className="h-full flex flex-col items-center justify-center text-gray-400">
                         <RefreshCcw size={48} className="mb-4 opacity-20"/>
                         <p className="font-bold">無回購或轉出資料</p>
                         <p className="text-xs">請在點數表中標記「回購」或設定「原開發者」</p>
                     </div>
                 ) : (
                     <div className="bg-white border border-gray-300 shadow-sm overflow-x-auto">
                        <table className="w-full text-xs text-left whitespace-nowrap border-collapse">
                            <thead className="bg-slate-100 text-slate-700 font-bold sticky top-0 z-20 shadow-sm">
                                <tr>
                                    <th className="p-2 border border-slate-300 min-w-[80px] bg-slate-100 sticky left-0 z-30">銷售員</th>
                                    <th className="p-2 border border-slate-300 min-w-[80px] bg-slate-100">日期</th>
                                    <th className="p-2 border border-slate-300 min-w-[80px] bg-slate-100">客戶</th>
                                    <th className="p-2 border border-slate-300 min-w-[80px] bg-slate-100">品項</th>
                                    <th className="p-2 border border-slate-300 min-w-[150px] bg-slate-100">品名</th>
                                    <th className="p-2 border border-slate-300 min-w-[80px] bg-slate-100">狀態</th>
                                    <th className="p-2 border border-slate-300 min-w-[60px] text-right bg-amber-50 text-amber-800 border-b-amber-200">回購點數</th>
                                    {repurchaseMatrix.developers.map(dev => (
                                        <th key={dev} className="p-2 border border-slate-300 min-w-[60px] text-center bg-purple-50 text-purple-800 border-b-purple-200">
                                            {dev}<br/><span className="text-[9px] font-normal opacity-70">開發點數</span>
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {Object.entries(repurchaseMatrix.dataBySeller).map(([seller, rows]: [string, RepurchaseRowData[]]) => {
                                    // Calculate Section Totals
                                    const sellerTotal = rows.reduce((acc, r) => acc + r.actualSellerPoints, 0);
                                    const devTotals = repurchaseMatrix.developers.map(dev => 
                                        rows.reduce((acc, r) => r.originalDeveloper === dev ? acc + r.devPoints : acc, 0)
                                    );

                                    return (
                                        <React.Fragment key={seller}>
                                            {/* Section Header */}
                                            <tr className="bg-slate-50 font-bold border-t-2 border-slate-300">
                                                <td className="p-2 border border-slate-300 sticky left-0 bg-slate-50 z-10 text-slate-800">{seller}</td>
                                                <td colSpan={5} className="p-2 border border-slate-300 text-right text-slate-500 text-[10px] uppercase tracking-wider">Subtotal</td>
                                                <td className="p-2 border border-slate-300 text-right text-amber-700 bg-amber-50/50">{sellerTotal}</td>
                                                {devTotals.map((total, i) => (
                                                    <td key={i} className={`p-2 border border-slate-300 text-center ${total !== 0 ? 'text-purple-700 bg-purple-50/50' : 'text-gray-300'}`}>
                                                        {total !== 0 ? total : '-'}
                                                    </td>
                                                ))}
                                            </tr>
                                            {/* Rows */}
                                            {rows.map((row, rIdx) => {
                                                const isReturn = row.status === Stage1Status.RETURN;
                                                return (
                                                    <tr key={row.id} className="hover:bg-yellow-50 bg-white">
                                                        <td className="p-2 border border-slate-200 sticky left-0 bg-white group-hover:bg-yellow-50 z-10 text-gray-400">{seller}</td>
                                                        <td className="p-2 border border-slate-200 font-mono">{row.date}</td>
                                                        <td className="p-2 border border-slate-200 font-mono">{formatCID(row.customerID)}</td>
                                                        <td className="p-2 border border-slate-200 font-mono text-[11px]">{row.itemID}</td>
                                                        <td className="p-2 border border-slate-200 truncate max-w-[150px]" title={row.itemName}>{row.itemName}</td>
                                                        <td className="p-2 border border-slate-200 truncate max-w-[100px] text-[10px] text-gray-500">{row.repurchaseType || row.status}</td>
                                                        <td className={`p-2 border border-slate-200 text-right font-bold ${isReturn ? 'text-red-600' : 'text-amber-600 bg-amber-50/30'}`}>
                                                            {row.actualSellerPoints}
                                                        </td>
                                                        {repurchaseMatrix.developers.map((dev, dIdx) => {
                                                            const isTarget = row.originalDeveloper === dev;
                                                            return (
                                                                <td key={dIdx} className={`p-2 border border-slate-200 text-center ${isTarget ? (isReturn ? 'text-red-500 font-bold bg-red-50/30' : 'text-purple-600 font-bold bg-purple-50/30') : ''}`}>
                                                                    {isTarget ? row.devPoints : ''}
                                                                </td>
                                                            );
                                                        })}
                                                    </tr>
                                                );
                                            })}
                                        </React.Fragment>
                                    );
                                })}
                            </tbody>
                        </table>
                     </div>
                 )}
             </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DataViewer;