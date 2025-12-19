
import Dexie, { Table } from 'dexie';
import { StoreRecord } from '../types';

export interface HistoryRecord {
  id?: number;
  customerID: string;
  itemID: string;
  date: string; // YYYY-MM-DD or ROC Year (YYYMMDD...)
  quantity: number; // Added quantity field
  storeName?: string; // New field for Branch separation
  salesPerson?: string; // New field for Sales Person
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
}

export interface TemplateRecord {
  id?: number;
  name: string;
  data: ArrayBuffer;
  config?: TemplateMapping; 
  updatedAt: number;
}

// Use direct instantiation
export const db = new Dexie('SalesHistoryDB') as Dexie & {
  history: Table<HistoryRecord>;
  templates: Table<TemplateRecord>;
  stores: Table<StoreRecord>;
};

// Update version to 4 to include stores table
db.version(4).stores({
  history: '++id, [customerID+itemID], customerID, itemID, storeName',
  templates: '++id, name, updatedAt',
  stores: '++id, &name' // Unique name
});

/**
 * Check if a customer has bought an item before (Async)
 * This remains GLOBAL check (across all stores)
 */
export const checkRepurchase = async (customerID: string, itemID: string): Promise<boolean> => {
  if (!customerID || !itemID) return false;
  // We check globally because a member ID is valid across all branches
  const count = await db.history.where({ customerID, itemID }).count();
  return count > 0;
};

/**
 * Get detailed history for a specific customer and item
 * Sorted by Date Descending (Newest first)
 */
export const getItemHistory = async (customerID: string, itemID: string): Promise<HistoryRecord[]> => {
    if (!customerID || !itemID) return [];
    
    // Dexie doesn't support complex sorting directly on compound index easily in one go with raw strings
    // But since data volume per customer/item is small, we can filter then sort in memory or use Collection
    const records = await db.history.where({ customerID, itemID }).toArray();
    
    // Sort by Date Descending
    return records.sort((a, b) => {
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

export const saveTemplate = async (file: File) => {
  const buffer = await file.arrayBuffer();
  // Try to keep existing config if updating file
  const existing = await db.templates.get(1);
  
  await db.templates.put({
    id: 1,
    name: file.name,
    data: buffer,
    config: existing?.config, // Preserve config
    updatedAt: Date.now()
  });
};

export const saveTemplateConfig = async (config: TemplateMapping) => {
  const existing = await db.templates.get(1);
  if (existing) {
    await db.templates.update(1, { config });
  }
};

export const getTemplate = async () => {
  return await db.templates.get(1);
};

export const deleteTemplate = async () => {
  await db.templates.delete(1);
};
