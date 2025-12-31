
import { RawRow, ExclusionItem, RewardRule, Stage1Row, Stage2Row, Stage3Summary, Stage1Status, Stage3Row, StaffRole } from '../types';
import { COL_HEADERS, CAT_MAPPING, COSMETIC_CODES, STAGE1_SORT_ORDER, COSMETIC_DISPLAY_ORDER } from '../constants';
import { v4 as uuidv4 } from 'uuid';
import { checkRepurchase } from './db';

// Helper: Safely get values
const getVal = (row: RawRow, key: string): any => row[key];
const getStr = (row: RawRow, key: string): string => String(row[key] || '').trim();
const getNum = (row: RawRow, key: string): number => Number(row[key]) || 0;

// --- Helper: Determine Category based on Raw Data ---
export const determineCategory = (row: RawRow): string => {
    const cat1 = getStr(row, COL_HEADERS.CAT_1);
    const itemName = getVal(row, COL_HEADERS.ITEM_NAME) || getVal(row, '品名') || '';
    
    let category = CAT_MAPPING[cat1] || '其他';
    if (cat1 === '05-3') {
        const nameStr = String(itemName);
        if (nameStr.includes('麥精') || nameStr.includes('米精')) {
            category = '嬰幼兒米麥精';
        }
    }
    return category;
};

// --- STAGE 1: Points Table (Dispatcher) ---
// Now Async
export const processStage1 = async (rawData: RawRow[], exclusionList: ExclusionItem[], role: StaffRole): Promise<Stage1Row[]> => {
  if (role === 'PHARMACIST') {
    return await processStage1Pharmacist(rawData, exclusionList);
  }
  return await processStage1Sales(rawData, exclusionList);
};

// Logic for Sales Person (Store)
const processStage1Sales = async (rawData: RawRow[], exclusionList: ExclusionItem[]): Promise<Stage1Row[]> => {
  const dispensingItemIDs = new Set(
    exclusionList
      .filter(item => item.category === '調劑點數')
      .map(i => String(i.itemID).trim())
  );

  const processed: Stage1Row[] = [];

  for (const row of rawData) {
    // 1. Basic Data Integrity
    const cid = getVal(row, COL_HEADERS.CUSTOMER_ID);
    if (!cid || cid === 'undefined') continue;

    // 2. Zero Value Checks (Must happen before Return logic)
    // If unit price is 0, it's likely a gift or system error -> Skip
    if (getNum(row, COL_HEADERS.UNIT_PRICE) === 0) continue;

    // If original points are 0, there is no bonus to give OR take away -> Skip
    const points = getNum(row, COL_HEADERS.POINTS) || getNum(row, '點數');
    if (points === 0) continue;

    // 3. Exclusion List Checks
    const cat1 = getStr(row, COL_HEADERS.CAT_1);
    const unit = getStr(row, COL_HEADERS.UNIT);
    // Exclude Specific Milk Cans
    if (cat1 === '05-2' && (unit === '罐' || unit === '瓶')) continue;

    const itemID = getStr(row, COL_HEADERS.ITEM_ID);
    // Exclude Pharmacist Items
    if (dispensingItemIDs.has(itemID)) continue;

    // 4. Debt Check (Contextual)
    const qty = getNum(row, COL_HEADERS.QUANTITY);
    const debt = getNum(row, COL_HEADERS.DEBT);
    const isReturn = qty < 0;

    // If it's a SALE (qty > 0) and has DEBT, skip it (No points for debt).
    // If it's a RETURN (qty < 0), we ignore the debt column (allow it to pass to deduct points).
    if (!isReturn && debt > 0) continue;

    // --- DATA PREPARATION ---
    const rawPoints = points;
    const amount = getNum(row, COL_HEADERS.SUBTOTAL);
    const discountRatio = getStr(row, COL_HEADERS.DISCOUNT_RATIO);
    const itemName = getVal(row, COL_HEADERS.ITEM_NAME) || getVal(row, '品名') || '';
    const ticketNo = getStr(row, COL_HEADERS.TICKET_NO);
    const dateStr = ticketNo.length >= 7 ? ticketNo.substring(5, 7) : '??';
    
    // Extract full date for repurchase checking
    const fullDate = String(row[COL_HEADERS.SALES_DATE] || ticketNo || '').trim();

    // Determine Base Category
    let category = determineCategory(row);
    let calculatedPoints = 0;
    let status = Stage1Status.DEVELOP;

    // --- 5. FINAL CLASSIFICATION (Return vs Sale) ---
    
    if (isReturn) {
        // --- RETURN LOGIC ---
        status = Stage1Status.RETURN;
        
        // IMPORTANT: Only override category to '退換貨' if a return target is ALREADY set (e.g. from history re-processing).
        // Otherwise, keep the product category (e.g., '成人奶粉') so it sorts with similar items.
        // We will handle the category switch in the UI when the user selects a target.
        if (row.returnTarget) {
            category = '退換貨';
        }

        // Logic for Points Calculation
        if (category === '現金-小兒銷售') {
            calculatedPoints = 0;
        } else {
            const isDividedByQty = category === '成人奶粉' || category === '成人奶水' || category === '嬰幼兒米麥精';
            if (isDividedByQty) {
                 const absPts = Math.abs(rawPoints);
                 const absQty = Math.abs(qty || 1);
                 // Calculate unit point then negation
                 const ptsPerItem = Math.floor(absPts / absQty);
                 calculatedPoints = -ptsPerItem;
            } else {
                 calculatedPoints = rawPoints;
            }
        }

    } else {
        // --- SALES LOGIC ---
        
        // Calculate Initial Points
        if (category === '現金-小兒銷售') {
            calculatedPoints = 0;
        } else {
            const isDividedByQty = category === '成人奶粉' || category === '成人奶水' || category === '嬰幼兒米麥精';
            if (isDividedByQty) {
                 calculatedPoints = Math.floor(rawPoints / (qty || 1));
            } else {
                 calculatedPoints = rawPoints;
            }
        }

        // Check Repurchase (Async)
        // Only check if it carries points or is specific tracking category
        if (calculatedPoints > 0 || category === '現金-小兒銷售') {
           // Pass ticketNo and fullDate for robust checking against same-month imports
           const isRepurchase = await checkRepurchase(cid, itemID, ticketNo, fullDate);
           if (isRepurchase) {
              status = Stage1Status.REPURCHASE;
              // Apply repurchase penalty
              if (calculatedPoints > 0) {
                 calculatedPoints = Math.floor(calculatedPoints / 2);
              }
           }
        }
    }

    processed.push({
      id: uuidv4(),
      salesPerson: String(getVal(row, COL_HEADERS.SALES_PERSON) || 'Unknown'),
      date: dateStr,
      customerID: cid,
      customerName: getVal(row, COL_HEADERS.CUSTOMER_NAME),
      itemID,
      itemName,
      quantity: qty,
      amount,
      discountRatio,
      originalPoints: rawPoints,
      calculatedPoints,
      category,
      status, 
      raw: row
    });
  }
  return sortStage1(processed);
};

// Logic for Pharmacist
const processStage1Pharmacist = async (rawData: RawRow[], exclusionList: ExclusionItem[]): Promise<Stage1Row[]> => {
  const pharmListMap = new Map<string, string>(); 
  exclusionList.forEach(i => pharmListMap.set(String(i.itemID).trim(), i.category));

  const processed: Stage1Row[] = [];

  for (const row of rawData) {
    const qty = getNum(row, COL_HEADERS.QUANTITY);
    const isReturn = qty < 0;
    const debt = getNum(row, COL_HEADERS.DEBT);

    if (!isReturn && debt > 0) continue;

    const points = getNum(row, COL_HEADERS.POINTS) || getNum(row, '點數');
    if (points === 0 && !isReturn) continue;

    const itemID = getStr(row, COL_HEADERS.ITEM_ID);
    const cat1 = getStr(row, COL_HEADERS.CAT_1);
    const itemName = getVal(row, COL_HEADERS.ITEM_NAME) || getVal(row, '品名') || '';
    const ticketNo = getStr(row, COL_HEADERS.TICKET_NO);
    const dateStr = ticketNo.length >= 7 ? ticketNo.substring(5, 7) : '??';
    
    // Extract full date for repurchase checking
    const fullDate = String(row[COL_HEADERS.SALES_DATE] || ticketNo || '').trim();

    // Extract new fields
    const amount = getNum(row, COL_HEADERS.SUBTOTAL);
    const discountRatio = getStr(row, COL_HEADERS.DISCOUNT_RATIO);

    // 2. Determine Category First
    let isMatch = false;
    let category = '';
    let calculatedPoints = points;

    if (cat1 === '05-1') {
      isMatch = true;
      category = '成人奶粉';
      if (isReturn) {
         const absPts = Math.abs(points);
         const absQty = Math.abs(qty || 1);
         calculatedPoints = -Math.floor(absPts / absQty);
      } else {
         calculatedPoints = Math.floor(points / (qty || 1));
      }
    }
    else if (pharmListMap.has(itemID)) {
      const listCat = pharmListMap.get(itemID);
      if (listCat === '調劑點數') {
        isMatch = true;
        category = '調劑點數';
        calculatedPoints = points;
      } else {
        isMatch = true;
        category = '其他';
        calculatedPoints = points;
      }
    }

    if (!isMatch) continue;

    // For Pharmacist, returns usually go to specific bucket or '退換貨'
    if (isReturn) category = '退換貨';

    // 3. Conditional CID Filter based on Category
    const rawCid = getVal(row, COL_HEADERS.CUSTOMER_ID);
    const hasCid = rawCid && rawCid !== 'undefined' && String(rawCid).trim() !== '';

    // Rule: '調劑點數' keeps empty CID. Others ('成人奶粉', '其他') must have CID.
    if (category !== '調劑點數' && category !== '退換貨' && !hasCid) {
        continue;
    }
    // Return requires CID usually? Let's assume yes unless it was dispensing
    if (category === '退換貨' && !hasCid) {
         // Relaxed check for returns, but ideally returns have CIDs
    }

    const cid = hasCid ? rawCid : ''; 

    // --- ASYNC HISTORY CHECK ---
    let status = Stage1Status.DEVELOP;
    
    if (isReturn) {
        status = Stage1Status.RETURN;
    } else if (hasCid && category !== '調劑點數') {
        // Pass ticketNo and fullDate
        const isRepurchase = await checkRepurchase(cid, itemID, ticketNo, fullDate);
        if (isRepurchase) {
            status = Stage1Status.REPURCHASE;
            if (calculatedPoints > 0) {
                calculatedPoints = Math.floor(calculatedPoints / 2);
            }
        }
    }

    processed.push({
        id: uuidv4(),
        salesPerson: String(getVal(row, COL_HEADERS.SALES_PERSON) || 'Unknown'),
        date: dateStr,
        customerID: cid,
        customerName: getVal(row, COL_HEADERS.CUSTOMER_NAME),
        itemID,
        itemName,
        quantity: qty,
        amount,
        discountRatio,
        originalPoints: points,
        calculatedPoints,
        category,
        status,
        raw: row
    });
  }

  const sortOrder: Record<string, number> = { '成人奶粉': 1, '其他': 2, '調劑點數': 3, '退換貨': 999 };
  
  return processed.sort((a, b) => {
    const oa = sortOrder[a.category] ?? 99;
    const ob = sortOrder[b.category] ?? 99;
    if (oa !== ob) return oa - ob;
    return a.date.localeCompare(b.date);
  });
};

export const sortStage1 = (rows: Stage1Row[]): Stage1Row[] => {
  return rows.sort((a, b) => {
    const orderA = STAGE1_SORT_ORDER[a.category] ?? 99;
    const orderB = STAGE1_SORT_ORDER[b.category] ?? 99;
    if (orderA !== orderB) return orderA - orderB;
    return a.date.localeCompare(b.date);
  });
};

export const recalculateStage1Points = (row: Stage1Row, role: StaffRole = 'SALES'): number => {
  if (row.status === Stage1Status.DELETE) return 0;

  let base = row.originalPoints;
  if (base === undefined || base === null) {
      base = Number(row.raw?.[COL_HEADERS.POINTS] || row.raw?.['點數'] || 0);
  }

  // Handle Return Logic
  if (row.status === Stage1Status.RETURN) {
      // Logic:
      // 1. If no Original Developer is selected: Original Seller takes full hit.
      // 2. If Original Developer IS selected: 
      //    - Points split 50/50.
      //    - If Odd, Developer takes the extra -1.
      
      const hasDev = row.originalDeveloper && row.originalDeveloper !== '無';
      const isNegative = base < 0; // Should be true for returns
      
      // Calculate Base Value for Single Unit logic (same as normal)
      // Note: We use row.category which might be '退換貨'.
      // If it is '退換貨', we can't easily know if it was '成人奶粉' for division logic without re-checking raw data.
      // BUT, 'processStage1' handles the division and stores it in 'calculatedPoints' initially.
      // 'recalculateStage1Points' is called on updates. 
      // We should check natural category to decide division logic.
      const naturalCategory = determineCategory(row.raw);

      let calculatedBase = base;
      const isDividedByQty = 
          (role === 'PHARMACIST' && naturalCategory === '成人奶粉') ||
          (role === 'SALES' && (naturalCategory === '成人奶粉' || naturalCategory === '成人奶水' || naturalCategory === '嬰幼兒米麥精'));

      if (isDividedByQty) {
           const absBase = Math.abs(base);
           const absQty = Math.abs(row.quantity || 1);
           calculatedBase = isNegative ? -Math.floor(absBase / absQty) : Math.floor(absBase / absQty);
      }
      
      if (!hasDev) {
          return calculatedBase; // Full deduction
      } else {
          // Shared deduction
          return Math.ceil(calculatedBase / 2);
      }
  }

  // Normal Logic
  if (role === 'PHARMACIST') {
    if (row.category === '調劑點數') return base; 
    
    if (row.category === '成人奶粉') {
       base = Math.floor(base / (row.quantity || 1));
    }
    
    if (row.status === Stage1Status.REPURCHASE) {
      return Math.floor(base / 2);
    }
    return base;
  }
  
  if (row.category === '現金-小兒銷售') return 0;

  const isDividedByQty = row.category === '成人奶粉' || row.category === '成人奶水' || row.category === '嬰幼兒米麥精';
  
  if (isDividedByQty) {
     base = Math.floor(base / (row.quantity || 1));
  }
  
  return row.status === Stage1Status.REPURCHASE ? Math.floor(base / 2) : base;
};

// --- STAGE 2: Rewards ---
// (No change needed for Stage 2 as it doesn't use history, but kept sync)
export const processStage2 = (rawData: RawRow[], rewardRules: RewardRule[], role: StaffRole = 'SALES'): Stage2Row[] => {
  if (role === 'PHARMACIST') {
    return processStage2Pharmacist(rawData);
  }
  return processStage2Sales(rawData, rewardRules);
};

const processStage2Sales = (rawData: RawRow[], rewardRules: RewardRule[]): Stage2Row[] => {
  const ruleMap = new Map(rewardRules.map(r => [String(r.itemID).trim(), r]));
  const processed: Stage2Row[] = [];

  for (const row of rawData) {
    const itemID = getStr(row, COL_HEADERS.ITEM_ID);
    const rule = ruleMap.get(itemID);
    
    if (!rule) continue;

    const cid = getVal(row, COL_HEADERS.CUSTOMER_ID);
    if (!cid || cid === 'undefined') continue;
    if (getNum(row, COL_HEADERS.UNIT_PRICE) === 0) continue;
    
    // Allow returns in Stage 2 (negative quantity)
    const qty = getNum(row, COL_HEADERS.QUANTITY);
    const debt = getNum(row, COL_HEADERS.DEBT);
    if (qty >= 0 && debt > 0) continue;

    const cat1 = getStr(row, COL_HEADERS.CAT_1);
    const unit = getStr(row, COL_HEADERS.UNIT);
    if (cat1 === '05-2' && (unit === '罐' || unit === '瓶')) continue;

    const ticketNo = getStr(row, COL_HEADERS.TICKET_NO);
    const displayDate = ticketNo.length >= 7 ? ticketNo.substring(5, 7) : '??';

    processed.push({
      id: uuidv4(),
      salesPerson: String(getVal(row, COL_HEADERS.SALES_PERSON) || 'Unknown'),
      displayDate,
      sortDate: getVal(row, COL_HEADERS.SALES_DATE),
      customerID: cid,
      customerName: getVal(row, COL_HEADERS.CUSTOMER_NAME),
      itemID,
      itemName: getVal(row, COL_HEADERS.ITEM_NAME) || getVal(row, '品名') || '',
      quantity: qty,
      category: rule.category,
      note: rule.note,
      reward: rule.reward,
      rewardLabel: rule.rewardLabel,
      format: rule.format,
      isDeleted: false
    });
  }

  return processed.sort((a, b) => {
    if (a.category !== b.category) return a.category.localeCompare(b.category);
    return a.displayDate.localeCompare(b.displayDate);
  });
};

const processStage2Pharmacist = (rawData: RawRow[]): Stage2Row[] => {
  let qty1727 = 0;
  let qty1345 = 0;
  let person = 'Unknown';

  for (const row of rawData) {
    person = String(getVal(row, COL_HEADERS.SALES_PERSON) || person);
    const itemID = getStr(row, COL_HEADERS.ITEM_ID);
    const qty = getNum(row, COL_HEADERS.QUANTITY);

    if (itemID === '001727') {
      qty1727 += qty;
    } else if (itemID === '001345') {
      qty1345 += qty;
    }
  }

  const results: Stage2Row[] = [];
  
  if (qty1727 > 0 || qty1727 < 0) { // Allow negative
    results.push({
      id: uuidv4(),
      salesPerson: person,
      displayDate: '',
      sortDate: '',
      customerID: '',
      customerName: '',
      itemID: '001727',
      itemName: '自費調劑',
      quantity: qty1727,
      category: '調劑',
      note: '',
      reward: 0,
      rewardLabel: '件',
      format: '統計',
      isDeleted: false
    });
  }

  if (qty1345 > 0 || qty1345 < 0) {
    results.push({
      id: uuidv4(),
      salesPerson: person,
      displayDate: '',
      sortDate: '',
      customerID: '',
      customerName: '',
      itemID: '001345',
      itemName: '調劑藥事服務費',
      quantity: qty1345,
      category: '調劑',
      note: '',
      reward: 0,
      rewardLabel: '組',
      format: '統計',
      isDeleted: false
    });
  }

  return results;
};

// --- STAGE 3: Cosmetics ---
export const processStage3 = (rawData: RawRow[]): Stage3Summary[] => {
  const byPerson: Record<string, Record<string, number>> = {};

  for (const row of rawData) {
    const cat2 = getStr(row, COL_HEADERS.CAT_2);
    if (!COSMETIC_CODES[cat2]) continue;

    const person = String(getVal(row, COL_HEADERS.SALES_PERSON) || 'Unknown');
    const brandName = COSMETIC_CODES[cat2];
    const subTotal = getNum(row, COL_HEADERS.SUBTOTAL);

    if (!byPerson[person]) byPerson[person] = {};
    byPerson[person][brandName] = (byPerson[person][brandName] || 0) + subTotal;
  }

  return Object.keys(byPerson).map(person => {
    const brandTotals = byPerson[person];
    const rows = COSMETIC_DISPLAY_ORDER.map(brand => ({
      categoryName: brand,
      subTotal: brandTotals[brand] || 0
    }));
    return {
      salesPerson: person,
      rows,
      total: rows.reduce((acc, curr) => acc + curr.subTotal, 0)
    };
  });
};

export const generateEmptyStage3Rows = (): Stage3Row[] => {
  return COSMETIC_DISPLAY_ORDER.map(brand => ({ categoryName: brand, subTotal: 0 }));
};
