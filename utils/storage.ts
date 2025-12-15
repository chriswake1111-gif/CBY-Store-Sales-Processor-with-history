
import { ExclusionItem, RewardRule, RawRow, ProcessedData, StaffRole, RepurchaseOption, StaffRecord } from '../types';

export const STORAGE_KEY = 'store_sales_autosave';

export interface AppState {
  exclusionList: ExclusionItem[];
  rewardRules: RewardRule[];
  rawSalesData: RawRow[];
  processedData: ProcessedData;
  activePerson: string;
  selectedPersons: string[]; // Converted from Set
  staffRoles: Record<string, StaffRole>;
  // New Config Persistence
  repurchaseOptions: RepurchaseOption[];
  staffMasterList: StaffRecord[];
  
  timestamp: number;
}

export const saveToLocal = (data: Omit<AppState, 'timestamp' | 'selectedPersons'> & { selectedPersons: Set<string> }) => {
  try {
    const payload: AppState = {
      ...data,
      selectedPersons: Array.from(data.selectedPersons),
      timestamp: Date.now()
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
    return payload.timestamp;
  } catch (e) {
    console.error("Auto-save failed (Storage might be full)", e);
    return null;
  }
};

export const loadFromLocal = (): AppState | null => {
  try {
    const str = localStorage.getItem(STORAGE_KEY);
    if (!str) return null;
    return JSON.parse(str);
  } catch (e) {
    console.error("Load save failed", e);
    return null;
  }
};

export const checkSavedData = (): number | null => {
  try {
    const str = localStorage.getItem(STORAGE_KEY);
    if (!str) return null;
    const data = JSON.parse(str);
    return data.timestamp || null;
  } catch {
    return null;
  }
};
