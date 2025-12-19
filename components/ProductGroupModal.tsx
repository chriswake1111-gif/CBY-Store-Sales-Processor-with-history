
import React, { useState, useEffect } from 'react';
import { X, Plus, Trash2, Layers, Save, Edit2, AlertCircle, FileSpreadsheet } from 'lucide-react';
import { ProductGroup, GroupItem } from '../types';
import { getProductGroups, addProductGroup, updateProductGroup, deleteProductGroup } from '../utils/db';
import { readExcelFile } from '../utils/excelHelper';

interface ProductGroupModalProps {
  onClose: () => void;
}

const ProductGroupModal: React.FC<ProductGroupModalProps> = ({ onClose }) => {
  const [groups, setGroups] = useState<ProductGroup[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  
  // Form State
  const [groupName, setGroupName] = useState('');
  const [items, setItems] = useState<GroupItem[]>([{ itemID: '', alias: '' }]);

  useEffect(() => {
    loadGroups();
  }, []);

  const loadGroups = async () => {
    const list = await getProductGroups();
    setGroups(list);
  };

  const resetForm = () => {
    setEditingId(null);
    setGroupName('');
    setItems([{ itemID: '', alias: '' }]);
  };

  const handleEdit = (group: ProductGroup) => {
    setEditingId(group.id!);
    setGroupName(group.groupName);
    // Deep copy to avoid reference issues
    setItems(JSON.parse(JSON.stringify(group.items)));
  };

  const handleDelete = async (id: number) => {
    if (!window.confirm("確定要刪除此群組嗎？")) return;
    await deleteProductGroup(id);
    await loadGroups();
    if (editingId === id) resetForm();
  };

  const handleSave = async () => {
    if (!groupName.trim()) {
        alert("請輸入群組名稱");
        return;
    }

    const validItems = items.filter(i => i.itemID.trim() !== '');
    if (validItems.length < 1) {
        alert("至少需要輸入一個品項編號");
        return;
    }

    // Check Alias
    for (const item of validItems) {
        if (!item.alias.trim()) {
            alert(`品項 ${item.itemID} 缺少簡稱`);
            return;
        }
    }

    const payload = {
        groupName: groupName.trim(),
        items: validItems.map(i => ({ itemID: i.itemID.trim(), alias: i.alias.trim() }))
    };

    try {
        if (editingId) {
            await updateProductGroup(editingId, payload);
        } else {
            await addProductGroup(payload);
        }
        await loadGroups();
        resetForm();
    } catch (e) {
        alert("儲存失敗");
    }
  };

  const updateItemField = (idx: number, field: keyof GroupItem, value: string) => {
    const newItems = [...items];
    newItems[idx] = { ...newItems[idx], [field]: value };
    setItems(newItems);
  };

  const addItemRow = () => {
    setItems([...items, { itemID: '', alias: '' }]);
  };

  const removeItemRow = (idx: number) => {
    if (items.length === 1) return;
    setItems(items.filter((_, i) => i !== idx));
  };

  const handleImportExcel = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || !e.target.files[0]) return;
    const file = e.target.files[0];
    
    try {
        const json = await readExcelFile(file);
        
        // Grouping logic: Map<GroupName, GroupItem[]>
        const importData: Record<string, GroupItem[]> = {};
        let count = 0;

        json.forEach((row: any) => {
            const gName = String(row['群組名稱'] || row['Group Name'] || '').trim();
            const itemId = String(row['品項編號'] || row['Item ID'] || '').trim();
            const alias = String(row['簡稱'] || row['Alias'] || '').trim();

            if (gName && itemId && alias) {
                if (!importData[gName]) {
                    importData[gName] = [];
                }
                // Avoid duplicates within the same import file
                if (!importData[gName].find(i => i.itemID === itemId)) {
                    importData[gName].push({ itemID: itemId, alias: alias });
                    count++;
                }
            }
        });

        if (count === 0) {
            alert("找不到有效資料。請確認 Excel 包含「群組名稱」、「品項編號」、「簡稱」欄位。");
            return;
        }

        // Save to DB
        // Check existing groups to decide whether to update or create
        const currentGroups = await getProductGroups();
        
        for (const [gName, newItems] of Object.entries(importData)) {
            const existingGroup = currentGroups.find(g => g.groupName === gName);
            
            if (existingGroup) {
                // Merge items: Add only if itemID doesn't exist in the existing group
                const mergedItems = [...existingGroup.items];
                let modified = false;
                
                newItems.forEach(newItem => {
                    const exists = mergedItems.find(existing => existing.itemID === newItem.itemID);
                    if (exists) {
                        // Optional: Update alias if changed? Let's verify alias consistency
                        if (exists.alias !== newItem.alias) {
                            exists.alias = newItem.alias;
                            modified = true;
                        }
                    } else {
                        mergedItems.push(newItem);
                        modified = true;
                    }
                });

                if (modified) {
                    await updateProductGroup(existingGroup.id!, { groupName: gName, items: mergedItems });
                }
            } else {
                // Create new group
                await addProductGroup({ groupName: gName, items: newItems });
            }
        }

        await loadGroups();
        alert(`匯入成功！處理了 ${Object.keys(importData).length} 個群組，共 ${count} 個品項。`);
        
    } catch (err) {
        console.error(err);
        alert("匯入失敗，請檢查檔案格式。");
    } finally {
        e.target.value = ''; // Reset input
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[70] p-4 animate-in fade-in duration-200">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-4xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="bg-slate-800 text-white px-6 py-4 flex justify-between items-center shrink-0">
          <h3 className="text-lg font-bold flex items-center gap-2"><Layers size={20} className="text-purple-400"/> 商品關聯群組設定</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white"><X size={24}/></button>
        </div>

        <div className="flex-1 overflow-hidden flex flex-col md:flex-row">
            {/* Left: List */}
            <div className="w-full md:w-1/3 border-r border-gray-200 bg-gray-50 flex flex-col overflow-hidden">
                <div className="p-3 border-b border-gray-200 flex flex-col gap-2 bg-white shrink-0">
                    <div className="flex justify-between items-center">
                        <span className="font-bold text-slate-700 text-sm">已建立群組 ({groups.length})</span>
                        <button onClick={resetForm} className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded border border-blue-200 hover:bg-blue-100 font-bold flex items-center gap-1">
                            <Plus size={12}/> 新增
                        </button>
                    </div>
                    <label className="flex items-center justify-center gap-1 w-full py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded cursor-pointer hover:bg-emerald-100 text-xs font-bold transition-colors">
                        <FileSpreadsheet size={14} /> 匯入 Excel 設定
                        <input type="file" className="hidden" accept=".xlsx, .xls" onChange={handleImportExcel} />
                    </label>
                </div>
                <div className="overflow-y-auto flex-1 p-2 space-y-2">
                    {groups.map(g => (
                        <div 
                            key={g.id} 
                            onClick={() => handleEdit(g)}
                            className={`p-3 rounded-lg border cursor-pointer transition-all ${editingId === g.id ? 'bg-purple-50 border-purple-300 ring-1 ring-purple-300' : 'bg-white border-gray-200 hover:border-blue-300 hover:shadow-sm'}`}
                        >
                            <div className="flex justify-between items-start mb-1">
                                <h4 className={`font-bold text-sm ${editingId === g.id ? 'text-purple-800' : 'text-slate-700'}`}>{g.groupName}</h4>
                                <button 
                                    onClick={(e) => { e.stopPropagation(); handleDelete(g.id!); }}
                                    className="text-gray-300 hover:text-red-500 transition-colors"
                                >
                                    <Trash2 size={14}/>
                                </button>
                            </div>
                            <div className="flex flex-wrap gap-1">
                                {g.items.map((item, i) => (
                                    <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 border border-gray-200">
                                        {item.alias}:{item.itemID}
                                    </span>
                                ))}
                            </div>
                        </div>
                    ))}
                    {groups.length === 0 && (
                        <div className="text-center py-8 text-gray-400 text-xs">
                            <Layers size={32} className="mx-auto mb-2 opacity-30"/>
                            尚無群組資料
                        </div>
                    )}
                </div>
            </div>

            {/* Right: Form */}
            <div className="flex-1 bg-white p-6 flex flex-col overflow-y-auto">
                <div className="mb-6">
                    <h4 className="text-base font-bold text-slate-800 mb-4 flex items-center gap-2">
                        {editingId ? <Edit2 size={16} className="text-purple-600"/> : <Plus size={16} className="text-blue-600"/>}
                        {editingId ? '編輯群組' : '新增群組'}
                    </h4>
                    
                    <div className="space-y-4">
                        <div>
                            <label className="block text-xs font-bold text-slate-500 mb-1">群組名稱 (方便辨識用)</label>
                            <input 
                                type="text" 
                                value={groupName} 
                                onChange={e => setGroupName(e.target.value)}
                                placeholder="例如：某某保健品系列"
                                className="w-full px-3 py-2 border border-gray-300 rounded focus:ring-2 focus:ring-purple-200 focus:border-purple-500 outline-none font-bold text-slate-700"
                            />
                        </div>

                        <div>
                            <div className="flex justify-between items-end mb-1">
                                <label className="block text-xs font-bold text-slate-500">關聯品項列表</label>
                                <span className="text-[10px] text-gray-400 bg-gray-100 px-2 py-0.5 rounded">
                                    同一群組內的品項將視為相同產品進行回購判定
                                </span>
                            </div>
                            
                            <div className="border border-gray-200 rounded-lg overflow-hidden">
                                <div className="bg-slate-50 px-3 py-2 grid grid-cols-12 gap-2 text-xs font-bold text-slate-600 border-b border-gray-200">
                                    <div className="col-span-5">品項編號</div>
                                    <div className="col-span-6">顯示簡稱 (例如：大、小、調)</div>
                                    <div className="col-span-1 text-center">刪除</div>
                                </div>
                                <div className="divide-y divide-gray-100 bg-white">
                                    {items.map((item, idx) => (
                                        <div key={idx} className="px-3 py-2 grid grid-cols-12 gap-2 items-center group">
                                            <div className="col-span-5">
                                                <input 
                                                    type="text" 
                                                    value={item.itemID} 
                                                    onChange={e => updateItemField(idx, 'itemID', e.target.value)}
                                                    placeholder="輸入 Item ID"
                                                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm font-mono focus:border-blue-500 outline-none"
                                                />
                                            </div>
                                            <div className="col-span-6">
                                                <input 
                                                    type="text" 
                                                    value={item.alias} 
                                                    onChange={e => updateItemField(idx, 'alias', e.target.value)}
                                                    placeholder="簡稱"
                                                    className="w-full px-2 py-1 border border-gray-300 rounded text-sm text-center font-bold focus:border-blue-500 outline-none text-blue-700 bg-blue-50/50"
                                                />
                                            </div>
                                            <div className="col-span-1 text-center">
                                                <button onClick={() => removeItemRow(idx)} className="text-gray-300 hover:text-red-500 p-1">
                                                    <Trash2 size={14}/>
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                                <div className="p-2 bg-gray-50 border-t border-gray-200">
                                    <button onClick={addItemRow} className="w-full py-1.5 border-2 border-dashed border-gray-300 rounded text-gray-400 text-xs font-bold hover:border-blue-300 hover:text-blue-500 hover:bg-blue-50 transition-colors flex items-center justify-center gap-1">
                                        <Plus size={14}/> 增加品項
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="bg-amber-50 border border-amber-200 rounded p-3 flex gap-2">
                             <AlertCircle size={16} className="text-amber-500 shrink-0 mt-0.5"/>
                             <div className="text-xs text-amber-800 leading-relaxed">
                                 <strong>設定說明：</strong><br/>
                                 1. 當客戶曾購買群組內任一品項，再購買群組內其他品項時，系統會判定為「回購」。<br/>
                                 2. 在「選擇開發者」的歷史清單中，日期旁會顯示此處設定的「簡稱」，方便辨識規格。
                             </div>
                        </div>
                    </div>
                </div>

                <div className="mt-auto pt-4 border-t border-gray-100 flex justify-end gap-3">
                     {editingId && (
                         <button onClick={resetForm} className="mr-auto text-gray-400 hover:text-gray-600 text-sm">放棄編輯</button>
                     )}
                     <button onClick={handleSave} className="flex items-center gap-2 px-6 py-2.5 bg-slate-800 text-white font-bold rounded hover:bg-slate-700 shadow-lg shadow-slate-200 transition-all">
                        <Save size={16}/> {editingId ? '儲存變更' : '建立群組'}
                     </button>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default ProductGroupModal;
