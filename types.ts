
export interface RawRow { [key: string]: any; }

export interface ExclusionItem { itemID: string; category: string; }

export interface RewardRule {
  itemID: string; note: string; category: string; reward: number; rewardLabel: string; format: string;
}

export enum Stage1Status { DEVELOP = '開發', HALF_YEAR = '隔半年', REPURCHASE = '回購', DELETE = '刪除' }

export type StaffRole = 'SALES' | 'PHARMACIST' | 'NO_BONUS';

export interface Stage1Row {
  id: string; salesPerson: string; date: string; customerID: string; customerName: string;
  itemID: string; itemName: string; quantity: number; originalPoints: number; calculatedPoints: number;
  amount: number; discountRatio: string;
  // New Fields for Repurchase Logic
  originalDeveloper?: string; 
  repurchaseType?: string;
  
  category: string; status: Stage1Status; raw: RawRow;
}

export interface Stage2Row {
  id: string; salesPerson: string; displayDate: string; sortDate: any; customerID: string; customerName: string;
  itemID: string; itemName: string; quantity: number; category: string; note: string;
  reward: number; rewardLabel: string; customReward?: number; format: string; isDeleted: boolean;
}

export interface Stage3Row { categoryName: string; subTotal: number; }

export interface Stage3Summary { salesPerson: string; rows: Stage3Row[]; total: number; }

export interface ProcessedData {
  [salesPerson: string]: { 
    role: StaffRole;
    stage1: Stage1Row[]; 
    stage2: Stage2Row[]; 
    stage3: Stage3Summary; 
  };
}

// New Types for Configuration
export interface RepurchaseOption {
  id: string;
  label: string;
  group: 'GENERAL' | 'SPECIAL';
  isEnabled: boolean;
}

export interface StaffRecord {
  id: string; // Employee ID if available, otherwise UUID or Name
  name: string;
  role: StaffRole;
}
