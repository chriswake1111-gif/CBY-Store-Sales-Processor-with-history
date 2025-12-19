
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
  category: string;
  date: string;
  customerID: string;
  itemID: string;
  itemName: string;
  quantity: string;
  amount: string; 
  note: string;
  points: string;
  // New fields for Repurchase Summary
  originalDeveloper?: string;
  devPoints?: string;
  repurchasePoints?: string;
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
let itemToGroupMap: Map<string, { group: ProductGroup, alias: string }> | null = null;

export const refreshGroupCache = async () => {
  const groups = await db.productGroups.toArray();
  groupCache = groups;
  itemToGroupMap = new Map();
  
  groups.forEach(g => {
    g.items.forEach(item => {
      // Key by trimmed ItemID
      itemToGroupMap!.set(item.itemID.trim(), { group: g, alias: item.alias });
    });
  });
};

const ensureCache = async () => {
  if (!groupCache) {
    await refreshGroupCache();
  }
};

/**
 * Get all related ItemIDs for a given ItemID (including itself).
 * Also returns the alias map for these items.
 */
const getRelatedItemsInfo = async (itemID: string) => {
  await ensureCache();
  const cleanID = itemID.trim();
  const entry = itemToGroupMap?.get(cleanID);
  
  if (entry) {
    // It belongs to a group, return all IDs in that group
    const relatedIDs = entry.group.items.map(i => i.itemID);
    const aliasMap: Record<string, string> = {};
    entry.group.items.forEach(i => aliasMap[i.itemID] = i.alias);
    return { relatedIDs, aliasMap };
  }
  
  // No group, just return itself
  return { relatedIDs: [cleanID], aliasMap: { [cleanID]: '' } };
};

/**
 * Check if a customer has bought an item (or its related group items) before
 */
export const checkRepurchase = async (customerID: string, itemID: string): Promise<boolean> => {
  if (!customerID || !itemID) return false;
  
  const { relatedIDs } = await getRelatedItemsInfo(itemID);

  // If we have multiple IDs to check
  if (relatedIDs.length > 1) {
     // Check if customer bought ANY of these items
     // Since history is indexed by customerID, we filter by it first
     const count = await db.history
        .where('customerID').equals(customerID)
        .filter(rec => relatedIDs.includes(rec.itemID))
        .count();
     return count > 0;
  } else {
     // Standard single item check (Fastest)
     const count = await db.history.where({ customerID, itemID }).count();
     return count > 0;
  }
};

/**
 * Get detailed history for a specific customer and item (AND related items in group)
 * Sorted by Date Descending (Newest first)
 */
export const getItemHistory = async (customerID: string, itemID: string): Promise<HistoryRecord[]> => {
    if (!customerID || !itemID) return [];
    
    const { relatedIDs, aliasMap } = await getRelatedItemsInfo(itemID);
    
    let records: HistoryRecord[] = [];

    if (relatedIDs.length > 1) {
        // Query all related items for this customer
        records = await db.history
            .where('customerID').equals(customerID)
            .filter(rec => relatedIDs.includes(rec.itemID))
            .toArray();
    } else {
        records = await db.history.where({ customerID, itemID }).toArray();
    }
    
    // Sort by Date Descending and Attach Alias
    return records
      .map(r => ({
          ...r,
          displayAlias: aliasMap[r.itemID] || '' // Attach the alias
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
