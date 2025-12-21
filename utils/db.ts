
import Dexie, { Table } from 'dexie';
import { StoreRecord, ProductGroup, GroupItem } from '../types';

export interface HistoryRecord {
  id?: number;
  customerID: string;
  itemID: string;
  date: string; // YYYY-MM-DD or ROC Year (YYYMMDD...)
  quantity: number; // Added quantity field
  storeName?: string; // New field for Branch separation
  salesPerson?: string; // New field for Sales Person
  // Optional field for display purposes (not stored in DB, but returned by queries)
  displayAlias?: string; 
}

export interface TemplateMapping {
  startRow: number;
  
  // New: Staff Info Columns (Repeated per row)
  storeName?: string;
  staffID?: string;
  staffName?: string;

  // Stage 1: List Columns
  category: string;
  date: string;
  customerID: string;
  itemID: string;
  itemName: string;
  quantity: string;
  amount: string; 
  note: string;
  points: string;
  
  // Stage 2: Reward List Columns (New)
  reward_category?: string;
  reward_date?: string;
  reward_customerID?: string;
  reward_itemID?: string;
  reward_itemName?: string;
  reward_quantity?: string;
  reward_note?: string;
  reward_amount?: string;

  // Repurchase List Columns
  originalDeveloper?: string;
  devPoints?: string;
  repurchasePoints?: string;
  
  // --- New Statistical Cells (Coordinates like "A1", "D5") ---
  // Points Section
  cell_pointsStd?: string;       // 點數標準
  cell_pointsTotal?: string;     // 總計 (Blank)
  cell_pointsDev?: string;       // 個人開發
  cell_pointsTableDev?: string;  // 總表開發
  cell_pointsRep?: string;       // 總表回購
  cell_pointsMilkDev?: string;   // 奶粉開發 (Blank)

  // Cosmetic Section
  cell_cosmeticStd?: string;     // 美妝標準
  cell_cosmeticTotal?: string;   // 美妝總計
  cell_amtLrp?: string;          // 理膚
  cell_amtCerave?: string;       // 適樂膚
  cell_amtDrSatin?: string;      // Dr.Satin
  cell_amtCetaphil?: string;     // 舒特膚
  cell_amtFlora?: string;        // 芙樂思
  cell_amtEmployee?: string;     // 員購 (Blank)

  // Rewards Section
  cell_rewardCash?: string;      // 現金獎勵
  cell_rewardMilk?: string;      // 小兒奶粉 (Blank)
  cell_reward711?: string;       // 7-11 禮卷
  cell_rewardFamily?: string;    // 全家 禮卷
  cell_rewardPx?: string;        // 全聯 禮卷
}

export interface TemplateRecord {
  id?: number; // 1: Sales, 2: Pharmacist, 3: Repurchase
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

// Use direct instantiation
export const db = new Dexie('SalesHistoryDB') as Dexie & {
  history: Table<HistoryRecord>;
  templates: Table<TemplateRecord>;
  stores: Table<StoreRecord>;
  productGroups: Table<ProductGroup>;
};

// Update version to 5 to include productGroups table
db.version(5).stores({
  history: '++id, [customerID+itemID], customerID, itemID, storeName',
  templates: '++id, name, updatedAt',
  stores: '++id, &name',
  productGroups: '++id, groupName'
});

// --- Product Group Helpers (In-Memory Cache for Performance) ---
let groupCache: ProductGroup[] | null = null;
// Maps Normalized ID -> Group Info
let itemToGroupMap: Map<string, { group: ProductGroup, alias: string }> | null = null;

/**
 * Remove leading zeros from an ID string.
 * e.g., "00123" -> "123", "123" -> "123", "00A1" -> "A1"
 */
const normalizeID = (id: string | number): string => {
  return String(id).trim().replace(/^0+/, '');
};

export const refreshGroupCache = async () => {
  const groups = await db.productGroups.toArray();
  groupCache = groups;
  itemToGroupMap = new Map();
  
  groups.forEach(g => {
    g.items.forEach(item => {
      // Key by Normalized ID to support 00123 vs 123 matching
      const normID = normalizeID(item.itemID);
      itemToGroupMap!.set(normID, { group: g, alias: item.alias });
    });
  });
};

const ensureCache = async () => {
  if (!groupCache) {
    await refreshGroupCache();
  }
};

/**
 * Get all related Normalized ItemIDs for a given ItemID.
 * Also returns the alias map for these items (keyed by Normalized ID).
 */
const getRelatedItemsInfo = async (itemID: string) => {
  await ensureCache();
  const normID = normalizeID(itemID);
  const entry = itemToGroupMap?.get(normID);
  
  if (entry) {
    // It belongs to a group, return all Normalized IDs in that group
    const relatedIDs = entry.group.items.map(i => normalizeID(i.itemID));
    const aliasMap: Record<string, string> = {};
    entry.group.items.forEach(i => {
        aliasMap[normalizeID(i.itemID)] = i.alias;
    });
    return { relatedIDs, aliasMap };
  }
  
  // No group, just return itself (normalized)
  return { relatedIDs: [normID], aliasMap: { [normID]: '' } };
};

/**
 * Check if a customer has bought an item (or its related group items) before
 */
export const checkRepurchase = async (customerID: string, itemID: string): Promise<boolean> => {
  if (!customerID || !itemID) return false;
  
  const { relatedIDs } = await getRelatedItemsInfo(itemID);

  // We query by CustomerID first (indexed, fast)
  // Then we filter in memory by normalizing the DB record's ItemID
  const count = await db.history
    .where('customerID').equals(customerID)
    .filter(rec => relatedIDs.includes(normalizeID(rec.itemID)))
    .count();
    
  return count > 0;
};

/**
 * Get detailed history for a specific customer and item (AND related items in group)
 * Sorted by Date Descending (Newest first)
 */
export const getItemHistory = async (customerID: string, itemID: string): Promise<HistoryRecord[]> => {
    if (!customerID || !itemID) return [];
    
    const { relatedIDs, aliasMap } = await getRelatedItemsInfo(itemID);
    
    // Query by CustomerID
    const records = await db.history
        .where('customerID').equals(customerID)
        .filter(rec => relatedIDs.includes(normalizeID(rec.itemID)))
        .toArray();
    
    // Sort by Date Descending and Attach Alias
    return records
      .map(r => ({
          ...r,
          // Use normalized ID to lookup alias
          displayAlias: aliasMap[normalizeID(r.itemID)] || '' 
      }))
      .sort((a, b) => {
        if (a.date < b.date) return 1;
        if (a.date > b.date) return -1;
        return 0;
    });
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

// --- Store Management Methods ---

const DEFAULT_STORES = ["東勢店", "新社店", "卓蘭店", "北苗店", "巨蛋店", "後龍店", "沙鹿店", "清水店"];

export const seedDefaultStores = async () => {
  const count = await db.stores.count();
  if (count === 0) {
    await db.stores.bulkAdd(DEFAULT_STORES.map(name => ({ name, isActive: true })));
    console.log("Default stores seeded");
  }
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
  const all = await db.history.toArray();
  const stats: Record<string, number> = {};
  
  for (const row of all) {
    const name = row.storeName || '未分類 (舊資料)';
    stats[name] = (stats[name] || 0) + 1;
  }

  return Object.entries(stats)
    .map(([storeName, count]) => ({ storeName, count }))
    .sort((a, b) => b.count - a.count); // Sort by count desc
};

/**
 * Get unique years for a specific store's historical records
 * Updated to support ROC Year format (first 3 digits)
 */
export const getAvailableYearsByStore = async (storeName: string): Promise<string[]> => {
  let records: HistoryRecord[];
  if (storeName === '未分類 (舊資料)') {
    records = await db.history.filter(r => !r.storeName).toArray();
  } else {
    records = await db.history.where('storeName').equals(storeName).toArray();
  }

  const years = new Set<string>();
  records.forEach(r => {
    const year = r.date ? String(r.date).substring(0, 3) : null;
    if (year && /^\d{3}$/.test(year)) {
      years.add(year);
    }
  });

  return Array.from(years).sort((a, b) => b.localeCompare(a)); // Newest years first
};

/**
 * Delete specific year's data for a store
 */
export const deleteHistoryByYear = async (storeName: string, year: string) => {
  if (storeName === '未分類 (舊資料)') {
    await db.history.filter(r => !r.storeName && String(r.date).substring(0, 3) === year).delete();
  } else {
    // Note: where('storeName') is indexed, then we filter by year logic
    await db.history.where('storeName').equals(storeName)
      .filter(r => String(r.date).substring(0, 3) === year)
      .delete();
  }
};

export const deleteStoreHistory = async (storeName: string) => {
  if (storeName === '未分類 (舊資料)') {
    await db.history.filter(node => !node.storeName).delete();
  } else {
    await db.history.where('storeName').equals(storeName).delete();
  }
};


// --- Template Methods ---

/**
 * Save template by specific ID (1: Sales, 2: Pharm, 3: Repurchase)
 */
export const saveTemplate = async (file: File, templateId: number = 1) => {
  const buffer = await file.arrayBuffer();
  // Try to keep existing config if updating file
  const existing = await db.templates.get(templateId);
  
  await db.templates.put({
    id: templateId,
    name: file.name,
    data: buffer,
    config: existing?.config, // Preserve config
    updatedAt: Date.now()
  });
};

export const saveTemplateConfig = async (config: TemplateMapping, templateId: number = 1) => {
  const existing = await db.templates.get(templateId);
  if (existing) {
    await db.templates.update(templateId, { config });
  }
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
