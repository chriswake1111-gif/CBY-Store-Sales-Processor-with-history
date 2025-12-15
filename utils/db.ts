
import Dexie, { Table } from 'dexie';

export interface HistoryRecord {
  id?: number;
  customerID: string;
  itemID: string;
  date: string; // YYYY-MM-DD
  quantity: number; // Added quantity field
  storeName?: string; // New field for Branch separation
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
};

// Update version to 3 to include storeName in index
// Note: We don't strictly need to index 'quantity', so version remains compatible or bumps if needed for other reasons.
// Dexie handles non-indexed fields automatically.
db.version(3).stores({
  history: '++id, [customerID+itemID], customerID, itemID, storeName',
  templates: '++id, name, updatedAt'
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

export const deleteStoreHistory = async (storeName: string) => {
  if (storeName === '未分類 (舊資料)') {
    // Delete where storeName is undefined or null or empty
    // Dexie doesn't query undefined easily with equals, so we iterate or use collection
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
