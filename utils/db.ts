
import Dexie, { Table } from 'dexie';
import { StoreRecord, ProductGroup, GroupItem } from '../types';
import { AppState } from './storage'; // Import AppState interface

export interface HistoryRecord {
  id?: number;
  customerID: string;
  itemID: string;
  date: string; // YYYY-MM-DD or ROC Year (YYYMMDD...)
  ticketNo?: string; // New: Store Ticket Number for strict comparison
  quantity: number; 
  unit?: string; 
  price?: number; // Unit Price
  storeName?: string; 
  salesPerson?: string; 
  
  // --- Fields for Analytics ---
  itemName?: string; 
  category?: string; 
  amount?: number;   
  cost?: number;     
  profit?: number;   
  points?: number;   

  displayAlias?: string; 
}

// Lite version for memory caching
export interface HistoryLite {
  itemID: string;
  normItemID: string;
  ticketNo?: string;
  date: string;
  relatedIDs: string[]; // Pre-computed related IDs based on group
}

export interface TemplateMapping {
  startRow: number;
  storeName?: string;
  staffID?: string;
  staffName?: string;
  category: string;
  date: string;
  customerID: string;
  itemID: string;
  itemName: string;
  quantity: string;
  amount: string; 
  note: string;
  points: string;
  reward_category?: string;
  reward_date?: string;
  reward_customerID?: string;
  reward_itemID?: string;
  reward_itemName?: string;
  reward_quantity?: string;
  reward_note?: string;
  reward_amount?: string;
  originalDeveloper?: string;
  devPoints?: string;
  repurchasePoints?: string;
  cell_pointsStd?: string;       
  cell_pointsTotal?: string;     
  cell_pointsDev?: string;       
  cell_pointsTableDev?: string;  
  cell_pointsRep?: string;       
  cell_pointsMilkDev?: string;   
  cell_cosmeticStd?: string;     
  cell_cosmeticTotal?: string;   
  cell_amtLrp?: string;          
  cell_amtCerave?: string;       
  cell_amtDrSatin?: string;      
  cell_amtCetaphil?: string;     
  cell_amtFlora?: string;        
  cell_amtEmployee?: string;     
  cell_rewardCash?: string;      
  cell_rewardMilk?: string;      
  cell_reward711?: string;       
  cell_rewardFamily?: string;    
  cell_rewardPx?: string;        
  cell_pharm_qty_1727?: string;  
  cell_pharm_qty_1345?: string;  
  cell_pharm_bonus?: string;     
  cell_pharm_points_dev?: string;       // New: Pharmacist Personal Points
  cell_pharm_points_table_dev?: string; // New: Pharmacist Table Dev
  cell_pharm_points_rep?: string;       // New: Pharmacist Table Rep
}

export interface TemplateRecord {
  id?: number; 
  name: string;
  data: ArrayBuffer;
  config?: TemplateMapping; 
  updatedAt: number;
}

export interface SavedSession {
  id?: number;
  storeName: string;
  timestamp: number;
  note?: string;
  data: AppState; // Stores the full application state
}

export const TEMPLATE_IDS = {
  SALES: 1,
  PHARMACIST: 2,
  REPURCHASE: 3
};

export const db = new Dexie('SalesHistoryDB') as Dexie & {
  history: Table<HistoryRecord>;
  templates: Table<TemplateRecord>;
  stores: Table<StoreRecord>;
  productGroups: Table<ProductGroup>;
  savedSessions: Table<SavedSession>;
};

// --- PERSISTENCE REQUEST ---
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().then(persistent => {
    if (persistent) {
      console.log("Storage persistence granted.");
    } else {
      console.log("Storage persistence denied.");
    }
  }).catch(err => {
      console.warn("Could not request persistence:", err);
  });
}

// Update to version 9: Add savedSessions
db.version(9).stores({
  history: '++id, [customerID+itemID], customerID, itemID, storeName, date, [storeName+date], ticketNo',
  templates: '++id, name, updatedAt',
  stores: '++id, &name',
  productGroups: '++id, groupName',
  savedSessions: '++id, &storeName, timestamp' // Indexed by storeName (unique) and timestamp
});

// --- Product Group Helpers ---
let groupCache: ProductGroup[] | null = null;
let itemToGroupMap: Map<string, { group: ProductGroup, alias: string }> | null = null;

const normalizeID = (id: string | number): string => {
  return String(id).trim().replace(/^0+/, '');
};

export const refreshGroupCache = async () => {
  const groups = await db.productGroups.toArray();
  groupCache = groups;
  itemToGroupMap = new Map();
  groups.forEach(g => {
    g.items.forEach(item => {
      const normID = normalizeID(item.itemID);
      itemToGroupMap!.set(normID, { group: g, alias: item.alias });
    });
  });
};

const ensureCache = async () => {
  if (!groupCache) await refreshGroupCache();
};

const getRelatedItemsInfo = async (itemID: string) => {
  await ensureCache();
  const normID = normalizeID(itemID);
  const entry = itemToGroupMap?.get(normID);
  if (entry) {
    const relatedIDs = entry.group.items.map(i => normalizeID(i.itemID));
    const aliasMap: Record<string, string> = {};
    entry.group.items.forEach(i => { aliasMap[normalizeID(i.itemID)] = i.alias; });
    return { relatedIDs, aliasMap };
  }
  return { relatedIDs: [normID], aliasMap: { [normID]: '' } };
};

// --- BATCH OPTIMIZATION: Preload History ---
// Instead of querying DB for every single row (which causes 1000+ DB calls),
// we fetch all history for the relevant customers once and process in memory.

export type HistoryCache = Map<string, HistoryLite[]>;

export const preloadHistoryForCustomers = async (customerIDs: string[]): Promise<HistoryCache> => {
    // 1. Ensure Group Cache is ready
    await ensureCache();

    const uniqueCIDs = Array.from(new Set(customerIDs)).filter(c => c && c !== 'undefined');
    const cache = new Map<string, HistoryLite[]>();
    
    // 2. Batch Query (Chunking to avoid query limit)
    const chunkSize = 200;
    for (let i = 0; i < uniqueCIDs.length; i += chunkSize) {
        const chunk = uniqueCIDs.slice(i, i + chunkSize);
        const records = await db.history.where('customerID').anyOf(chunk).toArray();
        
        for (const r of records) {
            if (!cache.has(r.customerID)) cache.set(r.customerID, []);
            
            // Pre-calculate related IDs for this history record to avoid repeated lookups
            const normID = normalizeID(r.itemID);
            let relatedIDs = [normID];
            
            // If this history item is part of a group, expand it
            const groupEntry = itemToGroupMap?.get(normID);
            if (groupEntry) {
                relatedIDs = groupEntry.group.items.map(item => normalizeID(item.itemID));
            }

            cache.get(r.customerID)!.push({
                itemID: r.itemID,
                normItemID: normID,
                ticketNo: r.ticketNo,
                date: r.date,
                relatedIDs
            });
        }
    }
    return cache;
};

// Optimized Synchronous Check using Cache
export const checkRepurchaseSync = (
    cache: HistoryCache, 
    customerID: string, 
    itemID: string, 
    currentTicketNo?: string, 
    currentDate?: string
): boolean => {
    const history = cache.get(customerID);
    if (!history || history.length === 0) return false;

    const currentNormID = normalizeID(itemID);
    
    // Find if current item belongs to a group
    let targetRelatedIDs = [currentNormID];
    const groupEntry = itemToGroupMap?.get(currentNormID);
    if (groupEntry) {
        targetRelatedIDs = groupEntry.group.items.map(i => normalizeID(i.itemID));
    }

    // Check against history
    for (const h of history) {
        // 1. Check Intersection of Product Groups
        // If the history item's group (h.relatedIDs) contains the current item (currentNormID),
        // OR current item's group (targetRelatedIDs) contains the history item (h.normItemID).
        // Since we pre-calc relatedIDs, simple inclusion check is enough.
        
        const isMatch = h.relatedIDs.includes(currentNormID);
        
        if (isMatch) {
             // 2. Strict Filtering (Same as async version)
             
             // Exclude Self (Same Ticket)
             if (currentTicketNo && h.ticketNo === currentTicketNo) continue;
             
             // Exclude Future (if TicketNo exists)
             if (currentTicketNo && h.ticketNo && h.ticketNo > currentTicketNo) continue;
             
             // Fallback Date Check
             if ((!currentTicketNo || !h.ticketNo) && currentDate && h.date > currentDate) continue;

             return true; // Found valid repurchase
        }
    }

    return false;
};

// Legacy Async Check (Single use)
export const checkRepurchase = async (customerID: string, itemID: string, currentTicketNo?: string, currentDate?: string): Promise<boolean> => {
  if (!customerID || !itemID) return false;
  const { relatedIDs } = await getRelatedItemsInfo(itemID);
  
  const candidates = await db.history
    .where('customerID').equals(customerID)
    .filter(rec => relatedIDs.includes(normalizeID(rec.itemID)))
    .toArray();

  const validRepurchases = candidates.filter(h => {
      if (currentTicketNo && h.ticketNo === currentTicketNo) return false;
      if (currentTicketNo && h.ticketNo) {
          if (h.ticketNo > currentTicketNo) return false;
      } else if (currentDate && h.date) {
          if (h.date > currentDate) return false;
      }
      return true;
  });

  return validRepurchases.length > 0;
};

export const getItemHistory = async (customerID: string, itemID: string): Promise<HistoryRecord[]> => {
    if (!customerID || !itemID) return [];
    const { relatedIDs, aliasMap } = await getRelatedItemsInfo(itemID);
    const records = await db.history
        .where('customerID').equals(customerID)
        .filter(rec => relatedIDs.includes(normalizeID(rec.itemID)))
        .toArray();
    return records
      .map(r => ({ ...r, displayAlias: aliasMap[normalizeID(r.itemID)] || '' }))
      .sort((a, b) => b.date.localeCompare(a.date));
};

export const bulkAddHistory = async (records: HistoryRecord[]) => {
  await db.history.bulkAdd(records);
};

export const clearHistory = async () => {
  await db.history.clear();
};

export const getHistoryCount = async () => {
  return await db.history.count();
};

// --- Store Management ---
const DEFAULT_STORES = ["東勢店", "新社店", "卓蘭店", "北苗店", "巨蛋店", "後龍店", "沙鹿店", "清水店"];
export const seedDefaultStores = async () => {
  const count = await db.stores.count();
  if (count === 0) await db.stores.bulkAdd(DEFAULT_STORES.map(name => ({ name, isActive: true })));
};

export const getStores = async (): Promise<StoreRecord[]> => {
  return await db.stores.toArray();
};

export const addStore = async (name: string) => {
  await db.stores.add({ name, isActive: true });
};

export const updateStore = async (id: number, name: string) => {
  await db.stores.update(id, { name });
};

export const deleteStore = async (id: number) => {
  await db.stores.delete(id);
};

export const getHistoryStatsByStore = async (): Promise<{ storeName: string; count: number }[]> => {
  const stats: Record<string, number> = {};
  const storeNames = await db.history.orderBy('storeName').uniqueKeys() as string[];
  for (const name of storeNames) {
      stats[name || '未分類'] = await db.history.where('storeName').equals(name).count();
  }
  return Object.entries(stats)
    .map(([storeName, count]) => ({ storeName, count }))
    .sort((a, b) => b.count - a.count);
};

export const getAvailableYearsByStore = async (storeName: string): Promise<string[]> => {
  const years = new Set<string>();
  const name = storeName === '未分類 (舊資料)' ? "" : storeName;

  await db.history
    .where('[storeName+date]')
    .between([name, Dexie.minKey], [name, Dexie.maxKey])
    .eachUniqueKey(key => {
        const dateStr = String((key as any)[1]);
        let year = '';
        if (dateStr.includes('-')) year = dateStr.split('-')[0];
        else if (dateStr.length >= 7) year = dateStr.substring(0, 3);
        else if (dateStr.length === 6) year = dateStr.substring(0, 2);
        if (year) years.add(year);
    });

  return Array.from(years).sort((a, b) => b.localeCompare(a));
};

export const getMonthlyStatsByStoreAndYear = async (storeName: string, year: string): Promise<{ month: string; count: number }[]> => {
    const stats: Record<string, number> = {};
    const name = storeName === '未分類 (舊資料)' ? "" : storeName;

    let start = `${year}0000`;
    let end = `${year}9999`;
    if (year.length === 4) {
        start = `${year}-01-01`;
        end = `${year}-12-31`;
    }

    await db.history
        .where('[storeName+date]')
        .between([name, start], [name, end])
        .each(record => {
            const dateStr = record.date;
            let month = '';
            if (dateStr.includes('-')) month = dateStr.split('-')[1];
            else if (dateStr.length >= 5) {
                if (dateStr.length >= 7) month = dateStr.substring(3, 5);
                else if (dateStr.length === 6) month = dateStr.substring(2, 4);
                else month = dateStr.substring(3, 5);
            }
            if (month) stats[month] = (stats[month] || 0) + 1;
        });

    return Object.entries(stats)
        .map(([month, count]) => ({ month, count }))
        .sort((a, b) => b.month.localeCompare(a.month));
};

export const getHistoryByMonth = async (storeName: string, year: string, month: string, offset = 0, limit = 100): Promise<HistoryRecord[]> => {
    const name = storeName === '未分類 (舊資料)' ? "" : storeName;
    const start = year.length === 4 ? `${year}-${month}-01` : `${year}${month}00`;
    const end = year.length === 4 ? `${year}-${month}-31` : `${year}${month}99`;

    return await db.history
        .where('[storeName+date]')
        .between([name, start], [name, end])
        .offset(offset)
        .limit(limit)
        .toArray();
};

export const deleteHistoryByYear = async (storeName: string, year: string) => {
  const name = storeName === '未分類 (舊資料)' ? "" : storeName;
  const start = year.length === 4 ? `${year}-01-01` : `${year}0000`;
  const end = year.length === 4 ? `${year}-12-31` : `${year}9999`;
  await db.history.where('[storeName+date]').between([name, start], [name, end]).delete();
};

export const deleteHistoryByMonth = async (storeName: string, year: string, month: string) => {
    const name = storeName === '未分類 (舊資料)' ? "" : storeName;
    const start = year.length === 4 ? `${year}-${month}-01` : `${year}${month}00`;
    const end = year.length === 4 ? `${year}-${month}-31` : `${year}${month}99`;
    await db.history.where('[storeName+date]').between([name, start], [name, end]).delete();
};

export const deleteStoreHistory = async (storeName: string) => {
  const name = storeName === '未分類 (舊資料)' ? "" : storeName;
  await db.history.where('storeName').equals(name).delete();
};

// --- Template Methods ---
export const saveTemplate = async (file: File, templateId: number = 1) => {
  const buffer = await file.arrayBuffer();
  const existing = await db.templates.get(templateId);
  await db.templates.put({
    id: templateId,
    name: file.name,
    data: buffer,
    config: existing?.config,
    updatedAt: Date.now()
  });
};

export const saveTemplateConfig = async (config: TemplateMapping, templateId: number = 1) => {
  const existing = await db.templates.get(templateId);
  if (existing) await db.templates.update(templateId, { config });
};

export const getTemplate = async (templateId: number = 1) => {
  return await db.templates.get(templateId);
};

export const deleteTemplate = async (templateId: number = 1) => {
  await db.templates.delete(templateId);
};

// --- Product Group Methods ---
export const getProductGroups = async (): Promise<ProductGroup[]> => {
  await ensureCache();
  return groupCache || [];
};

export const addProductGroup = async (group: Omit<ProductGroup, 'id'>) => {
  await db.productGroups.add(group);
  await refreshGroupCache();
};

export const updateProductGroup = async (id: number, group: Omit<ProductGroup, 'id'>) => {
  await db.productGroups.update(id, group);
  await refreshGroupCache();
};

export const deleteProductGroup = async (id: number) => {
  await db.productGroups.delete(id);
  await refreshGroupCache();
};

// --- SESSION MANAGEMENT (Branch Specific Saves) ---

export const saveSession = async (storeName: string, appState: AppState, note: string = '') => {
    // Check if exists to determine insert or update (though put handles both if key matches)
    // We want unique storeName for sessions.
    
    // We strip sensitive/large binary data or redundant cache if needed, but AppState is mostly JSON data.
    // Ensure we are not saving the 'timestamp' from AppState as the session timestamp, but create a new one.
    
    const payload: SavedSession = {
        storeName: storeName.trim(),
        timestamp: Date.now(),
        note: note,
        data: appState
    };

    // Use put to overwrite based on storeName index if unique, but Dexie default index isn't unique unless defined.
    // We defined `&storeName` in schema, so it is unique.
    await db.savedSessions.put(payload);
};

export const getSavedSessions = async (): Promise<SavedSession[]> => {
    return await db.savedSessions.toArray();
};

export const deleteSession = async (storeName: string) => {
    await db.savedSessions.where('storeName').equals(storeName).delete();
};

export const loadSession = async (storeName: string): Promise<SavedSession | undefined> => {
    return await db.savedSessions.get({ storeName });
};


// --- DATABASE BACKUP / RESTORE (OPTIMIZED FOR LARGE DATASETS) ---

export const exportDatabaseToJson = async (): Promise<Blob> => {
    const chunks: string[] = [];
    chunks.push('{"version":1,"timestamp":' + Date.now() + ',"tables":{');
    
    // 1. Export History (Streamed)
    chunks.push('"history":[');
    let count = 0;
    const BATCH_SIZE = 1000;
    let buffer: string[] = [];
    
    await db.history.each(record => {
        buffer.push(JSON.stringify(record));
        count++;
        if (buffer.length >= BATCH_SIZE) {
            if (count > BATCH_SIZE) chunks.push(',');
            chunks.push(buffer.join(','));
            buffer = [];
        }
    });
    if (buffer.length > 0) {
        if (count > buffer.length) chunks.push(',');
        chunks.push(buffer.join(','));
    }
    chunks.push('],');

    // 2. Export Stores
    const stores = await db.stores.toArray();
    chunks.push('"stores":' + JSON.stringify(stores) + ',');

    // 3. Export Groups
    const productGroups = await db.productGroups.toArray();
    chunks.push('"productGroups":' + JSON.stringify(productGroups) + ',');

    // 4. Export Templates
    const templatesRaw = await db.templates.toArray();
    const bufferToBase64 = (buffer: ArrayBuffer) => {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    };
    const templates = templatesRaw.map(t => ({
        ...t,
        data: bufferToBase64(t.data)
    }));
    chunks.push('"templates":' + JSON.stringify(templates));
    chunks.push('}}');

    return new Blob(chunks, { type: "application/json" });
};

export const importDatabaseFromJson = async (jsonString: string): Promise<number> => {
    try {
        const data = JSON.parse(jsonString);
        if (!data.tables) throw new Error("無效的備份檔案格式");

        const base64ToBuffer = (base64: string) => {
            const binary_string = window.atob(base64);
            const len = binary_string.length;
            const bytes = new Uint8Array(len);
            for (let i = 0; i < len; i++) {
                bytes[i] = binary_string.charCodeAt(i);
            }
            return bytes.buffer;
        };

        await db.transaction('rw', db.history, db.stores, db.productGroups, db.templates, async () => {
            await db.history.clear();
            await db.stores.clear();
            await db.productGroups.clear();
            await db.templates.clear();

            if (data.tables.history && data.tables.history.length > 0) {
                const chunkSize = 2000;
                for (let i = 0; i < data.tables.history.length; i += chunkSize) {
                    await db.history.bulkAdd(data.tables.history.slice(i, i + chunkSize));
                }
            }
            if (data.tables.stores) await db.stores.bulkAdd(data.tables.stores);
            if (data.tables.productGroups) await db.productGroups.bulkAdd(data.tables.productGroups);
            if (data.tables.templates) {
                const processedTemplates = data.tables.templates.map((t: any) => ({
                    ...t,
                    data: base64ToBuffer(t.data)
                }));
                await db.templates.bulkAdd(processedTemplates);
            }
        });
        
        await refreshGroupCache();
        return data.tables.history ? data.tables.history.length : 0;
    } catch (e) {
        console.error(e);
        throw new Error("還原失敗，檔案可能損毀或記憶體不足");
    }
};
