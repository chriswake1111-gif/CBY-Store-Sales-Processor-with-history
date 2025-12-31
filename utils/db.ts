
import Dexie, { Table } from 'dexie';
import { StoreRecord, ProductGroup, GroupItem } from '../types';

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
}

export interface TemplateRecord {
  id?: number; 
  name: string;
  data: ArrayBuffer;
  config?: TemplateMapping; 
  updatedAt: number;
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
};

// --- PERSISTENCE REQUEST ---
// Try to persist storage to prevent browser from clearing it under pressure
if (navigator.storage && navigator.storage.persist) {
  navigator.storage.persist().then(persistent => {
    if (persistent) {
      console.log("Storage persistence granted: Data will not be cleared automatically.");
    } else {
      console.log("Storage persistence denied: Data may be cleared by browser under storage pressure.");
    }
  }).catch(err => {
      console.warn("Could not request persistence:", err);
  });
}

// Update to version 8: Add ticketNo to index
db.version(8).stores({
  history: '++id, [customerID+itemID], customerID, itemID, storeName, date, [storeName+date], ticketNo',
  templates: '++id, name, updatedAt',
  stores: '++id, &name',
  productGroups: '++id, groupName'
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

export const checkRepurchase = async (customerID: string, itemID: string, currentTicketNo?: string, currentDate?: string): Promise<boolean> => {
  if (!customerID || !itemID) return false;
  
  const { relatedIDs } = await getRelatedItemsInfo(itemID);
  
  const candidates = await db.history
    .where('customerID').equals(customerID)
    .filter(rec => relatedIDs.includes(normalizeID(rec.itemID)))
    .toArray();

  // Strict filtering to support same-month imports
  const validRepurchases = candidates.filter(h => {
      // 1. Exclude Self (Exact Ticket Match)
      if (currentTicketNo && h.ticketNo === currentTicketNo) {
          return false;
      }

      // 2. Exclude Future Transactions (in case of full month import)
      // If we have ticket numbers, use them for precise ordering
      if (currentTicketNo && h.ticketNo) {
          // If history ticket is larger (later) than current, it's not a repurchase *yet*
          if (h.ticketNo > currentTicketNo) return false;
      } else if (currentDate && h.date) {
          // Fallback to Date comparison if ticket missing
          // If history date is LATER than current, ignore
          if (h.date > currentDate) return false;
          // If same date but we don't have tickets to compare, we assume New to be safe (or User preference)
          // Ideally TicketNo should be present for same-month logic
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

/**
 * Fetch records for a specific month with pagination
 */
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

// --- DATABASE BACKUP / RESTORE ---

export const exportDatabaseToJson = async (): Promise<string> => {
    // We only export essential tables: history, stores, productGroups
    // Templates are heavy (ArrayBuffer) and optional, we can include them if needed but might bloat the JSON.
    // Let's include everything to be safe.
    
    // We need to convert ArrayBuffers in templates to Base64 for JSON storage
    const bufferToBase64 = (buffer: ArrayBuffer) => {
        let binary = '';
        const bytes = new Uint8Array(buffer);
        const len = bytes.byteLength;
        for (let i = 0; i < len; i++) {
            binary += String.fromCharCode(bytes[i]);
        }
        return window.btoa(binary);
    };

    const history = await db.history.toArray();
    const stores = await db.stores.toArray();
    const productGroups = await db.productGroups.toArray();
    const templatesRaw = await db.templates.toArray();
    
    const templates = templatesRaw.map(t => ({
        ...t,
        data: bufferToBase64(t.data) // Convert to string
    }));

    const exportData = {
        version: 1,
        timestamp: Date.now(),
        tables: {
            history,
            stores,
            productGroups,
            templates
        }
    };

    return JSON.stringify(exportData);
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

        // Use transaction to ensure integrity
        await db.transaction('rw', db.history, db.stores, db.productGroups, db.templates, async () => {
            // 1. Clear existing
            await db.history.clear();
            await db.stores.clear();
            await db.productGroups.clear();
            await db.templates.clear();

            // 2. Import History
            if (data.tables.history && data.tables.history.length > 0) {
                // Chunk insert to avoid memory issues
                const chunkSize = 2000;
                for (let i = 0; i < data.tables.history.length; i += chunkSize) {
                    await db.history.bulkAdd(data.tables.history.slice(i, i + chunkSize));
                }
            }

            // 3. Import Stores
            if (data.tables.stores) await db.stores.bulkAdd(data.tables.stores);

            // 4. Import Groups
            if (data.tables.productGroups) await db.productGroups.bulkAdd(data.tables.productGroups);

            // 5. Import Templates
            if (data.tables.templates) {
                const processedTemplates = data.tables.templates.map((t: any) => ({
                    ...t,
                    data: base64ToBuffer(t.data)
                }));
                await db.templates.bulkAdd(processedTemplates);
            }
        });
        
        await refreshGroupCache(); // Refresh memory cache
        return data.tables.history.length;
    } catch (e) {
        console.error(e);
        throw new Error("還原失敗，檔案可能損毀或格式不符");
    }
};
