
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { ProcessedData, Stage1Status, Stage1Row, StaffRecord } from '../types';
import { getTemplate, TEMPLATE_IDS, TemplateRecord, TemplateMapping } from './db';
import { recalculateStage1Points } from './processor';

// Helper for reading input files
export const readExcelFile = (file: File): Promise<any[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        if (!data || !(data instanceof ArrayBuffer)) throw new Error("File read failed");
        const workbook = XLSX.read(data, { type: 'array', cellFormula: false, cellHTML: false });
        if (!workbook.SheetNames.length) throw new Error("Excel file is empty");
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        resolve(XLSX.utils.sheet_to_json(sheet));
      } catch (err: any) {
        if (err.message && (err.message.includes("Record") || err.message.includes("0x"))) {
            reject("無法讀取此舊版 Excel (.xls) 格式。請將檔案另存為 .xlsx 格式後再試一次。");
        } else {
            reject(`讀取失敗: ${err.message || "未知錯誤"}`);
        }
      }
    };
    reader.onerror = () => reject("檔案讀取錯誤");
    reader.readAsArrayBuffer(file);
  });
};

const safeVal = (val: any) => (val === undefined || val === null) ? "" : val;
const sanitizeSheetName = (name: string): string => name.replace(/[\[\]\:\*\?\/\\\\]/g, '_').substring(0, 31) || "Unknown";

// Helper to format Customer ID (strip leading '00')
const formatCID = (val: any) => {
  const str = String(safeVal(val));
  return str.startsWith('00') ? str.substring(2) : str;
};

// --- EXPORT LOGIC WITH EXCELJS ---

export const exportToExcel = async (
    processedData: ProcessedData, 
    defaultFilename: string, 
    selectedPersons: Set<string>,
    staffMasterList: StaffRecord[] = [],
    reportDate?: string // New Parameter for Year/Month string
) => {
  // 1. Load All Templates
  const salesTmpl = await getTemplate(TEMPLATE_IDS.SALES);
  const pharmTmpl = await getTemplate(TEMPLATE_IDS.PHARMACIST);
  // Note: We ignore Repurchase Template for Matrix View as it's dynamic
  
  // Pre-load Template Workbooks
  const loadTmplWB = async (tmpl: TemplateRecord | undefined) => {
      if (!tmpl || !tmpl.data) return null;
      try {
          const wb = new ExcelJS.Workbook();
          await wb.xlsx.load(tmpl.data);
          return wb;
      } catch (e) { console.error("Tmpl load fail", e); return null; }
  };

  const salesWB = await loadTmplWB(salesTmpl);
  const pharmWB = await loadTmplWB(pharmTmpl);
  
  const outWorkbook = new ExcelJS.Workbook();

  // Sort Logic: SALES (1) -> PHARMACIST (2) -> OTHERS (3), then by ID asc
  const sortedPersons = Object.keys(processedData).sort((a, b) => {
    const roleA = processedData[a].role;
    const roleB = processedData[b].role;
    const pA = roleA === 'SALES' ? 1 : (roleA === 'PHARMACIST' ? 2 : 3);
    const pB = roleB === 'SALES' ? 1 : (roleB === 'PHARMACIST' ? 2 : 3);
    
    if (pA !== pB) return pA - pB;

    const staffA = staffMasterList.find(s => s.name === a);
    const staffB = staffMasterList.find(s => s.name === b);
    const idA = staffA?.id || '999999';
    const idB = staffB?.id || '999999';

    if (idA !== idB) return idA.localeCompare(idB, undefined, { numeric: true });

    return a.localeCompare(b, 'zh-TW');
  });

  // --- 1. STAFF SHEETS ---
  for (const person of sortedPersons) {
    if (!selectedPersons.has(person)) continue;
    const data = processedData[person];
    if (data.role === 'NO_BONUS') continue;

    const sheetName = sanitizeSheetName(person);
    
    // Determine which template to use
    let tmplRecord: TemplateRecord | undefined;
    let tmplSourceSheet: ExcelJS.Worksheet | undefined;

    if (data.role === 'PHARMACIST') {
        tmplRecord = pharmTmpl;
        tmplSourceSheet = pharmWB?.worksheets[0];
    } else {
        tmplRecord = salesTmpl;
        tmplSourceSheet = salesWB?.worksheets[0];
    }

    // Extract config early to determine header limit
    const config = tmplRecord?.config;
    let sheet: ExcelJS.Worksheet;

    if (tmplSourceSheet) {
        // Create sheet and attempt to copy styles
        sheet = outWorkbook.addWorksheet(sheetName);
        // Copy headers up to startRow (default 20 if not set)
        copySheetModel(tmplSourceSheet, sheet, config?.startRow || 20);
        
        // Write Report Date to A1 if available
        if (reportDate) {
            const cell = sheet.getCell('A1');
            cell.value = reportDate;
            // Style is already copied by copySheetModel logic
        }

    } else {
        // No Template: Create basic sheet
        sheet = outWorkbook.addWorksheet(sheetName);
        sheet.columns = [
            { width: 18 }, { width: 12 }, { width: 15 }, { width: 15 }, { width: 30 }, { width: 10 }, { width: 12 }, { width: 25 }, { width: 15 }
        ];
        if (reportDate) {
            sheet.mergeCells('A1:I1');
            sheet.getCell('A1').value = reportDate;
            sheet.getCell('A1').alignment = { horizontal: 'center' };
            sheet.getCell('A1').font = { bold: true, size: 14 };
        }
    }
    
    // GATHER DATA: COMBINE OWN DATA WITH INCOMING RETURNS
    // 1. Filter Own Data: Exclude Deleted AND Outgoing Returns
    const finalStage1 = data.stage1.filter(row => {
         if (row.status === Stage1Status.DELETE) return false;
         // Exclude outgoing returns (where I am source, but target is set)
         if (row.status === Stage1Status.RETURN && row.returnTarget) return false;
         return true;
    });

    // 2. Add Incoming Returns (From Others)
    Object.keys(processedData).forEach(otherPerson => {
        if (otherPerson === person) return;
        processedData[otherPerson].stage1.forEach(row => {
            if (row.status === Stage1Status.RETURN && row.returnTarget === person) {
                finalStage1.push(row);
            }
        });
    });


    // --- WRITE DATA (Logic branching for Template vs No Template) ---
    if (config) {
        // TEMPLATE MODE
        
        // Lookup staff info early for both Stats and List Rows
        const staffInfo = staffMasterList.find(s => s.name === person);

        // Define generic helper to write to a cell coordinate
        const writeToCell = (addr: string | undefined, val: any) => {
            if (addr && /^[A-Z]+[0-9]+$/.test(addr)) {
                 try { sheet.getCell(addr).value = val; } catch {}
            }
        };

        // --- WRITE BASIC INFO (Single Cell) ---
        writeToCell(config.storeName, safeVal(staffInfo?.branch));
        writeToCell(config.staffID, safeVal(staffInfo?.id));
        writeToCell(config.staffName, person);

        // 1. STATS FILLING (Only for Sales / Template Mode)
        if (data.role !== 'PHARMACIST') {
            
            // Calculate Stats based on FINAL STAGE 1 (including injected returns)
            // A. Points
            const pointsDev = finalStage1.reduce((acc, row) => {
                // "個人開發" = Develop + Half Year + Return (Calculated points already handled)
                if (row.status === Stage1Status.DEVELOP || row.status === Stage1Status.HALF_YEAR || row.status === Stage1Status.RETURN) {
                    const pts = recalculateStage1Points(row, data.role);
                    return acc + pts;
                }
                return acc;
            }, 0);

            const pointsRep = finalStage1.reduce((acc, row) => {
                // "總表回購" = Repurchase Only (Points for self from self)
                if (row.status === Stage1Status.REPURCHASE) {
                    return acc + row.calculatedPoints;
                }
                return acc;
            }, 0);

            // "總表開發" logic
            let pointsTableDev = 0;
            for (const otherPerson of Object.keys(processedData)) {
                if (otherPerson === person) continue; 
                const otherData = processedData[otherPerson];
                otherData.stage1.forEach(row => {
                    // Standard Repurchase Logic
                    if (row.originalDeveloper === person && row.status === Stage1Status.REPURCHASE) {
                         const fullPoints = recalculateStage1Points({ ...row, status: Stage1Status.DEVELOP }, otherData.role);
                         const actualRepurchasePoints = row.calculatedPoints; // This is 50%
                         pointsTableDev += (fullPoints - actualRepurchasePoints);
                    }
                    
                    // Return Splitting Logic
                    if (row.status === Stage1Status.RETURN && row.originalDeveloper === person) {
                        const fullPoints = recalculateStage1Points({ ...row, originalDeveloper: undefined }, otherData.role); 
                        const sellerShare = recalculateStage1Points(row, otherData.role); 
                        const devShare = fullPoints - sellerShare; 
                        pointsTableDev += devShare;
                    }
                });
            }

            // B. Cosmetics
            const getAmt = (key: string) => {
                const row = data.stage3.rows.find(r => r.categoryName.includes(key));
                return row ? row.subTotal : 0;
            };
            const amtLrp = getAmt('理膚');
            const amtCerave = getAmt('適樂膚');
            const amtDrSatin = getAmt('Dr.Satin');
            const amtCetaphil = getAmt('舒特膚');
            const amtFlora = getAmt('芙樂思');
            const cosmeticTotal = data.stage3.total;

            // C. Rewards
            let rewardCash = 0;
            let reward711 = 0;
            let rewardFamily = 0;
            let rewardPx = 0;

            data.stage2.forEach(row => {
                if (row.isDeleted) return;
                if (row.format === '禮券') {
                    const label = (row.rewardLabel || '').toLowerCase();
                    if (label.includes('7-11') || label.includes('seven')) reward711 += row.quantity;
                    else if (label.includes('全家')) rewardFamily += row.quantity;
                    else if (label.includes('全聯')) rewardPx += row.quantity;
                } else {
                    rewardCash += (row.customReward !== undefined ? row.customReward : (row.quantity * row.reward));
                }
            });

            // Points Section
            writeToCell(config.cell_pointsStd, staffInfo?.pointsStandard || ''); 
            writeToCell(config.cell_pointsTotal, ''); 
            writeToCell(config.cell_pointsDev, pointsDev); 
            writeToCell(config.cell_pointsRep, pointsRep); 
            writeToCell(config.cell_pointsTableDev, pointsTableDev); 
            writeToCell(config.cell_pointsMilkDev, ''); 

            // Cosmetic Section
            writeToCell(config.cell_cosmeticStd, staffInfo?.cosmeticStandard || ''); 
            writeToCell(config.cell_cosmeticTotal, cosmeticTotal);
            writeToCell(config.cell_amtLrp, amtLrp);
            writeToCell(config.cell_amtCerave, amtCerave);
            writeToCell(config.cell_amtDrSatin, amtDrSatin);
            writeToCell(config.cell_amtCetaphil, amtCetaphil);
            writeToCell(config.cell_amtFlora, amtFlora);
            writeToCell(config.cell_amtEmployee, '');

            // Rewards Section
            writeToCell(config.cell_rewardCash, rewardCash);
            writeToCell(config.cell_rewardMilk, '');
            writeToCell(config.cell_reward711, reward711);
            writeToCell(config.cell_rewardFamily, rewardFamily);
            writeToCell(config.cell_rewardPx, rewardPx);
        }

        // 2. LIST DATA WRITING
        let currentRow = config.startRow || 2;
        
        const put = (col: string | undefined, val: any) => {
            if (!col) return;
            const cell = sheet.getCell(`${col}${currentRow}`);
            cell.value = val;
            
            if (tmplSourceSheet) {
               const tmplRowIdx = config.startRow || 2;
               const templateCell = tmplSourceSheet.getCell(`${col}${tmplRowIdx}`);
               if (templateCell) {
                   applyCellStyle(cell, templateCell);
               }
            }
        };

        // 1. Stage 1 Data (List)
        finalStage1.forEach(row => {
            // Determine Note content based on Role and Category
            let note: string = row.status; // Default to basic status

            if (data.role === 'PHARMACIST') {
                if (row.category === '調劑點數') {
                    note = `${row.quantity}份`;
                } else {
                    // For '其他' or standard items
                    if (row.status === Stage1Status.REPURCHASE && row.repurchaseType) {
                        note = row.repurchaseType;
                    }
                }
            } else {
                // SALES
                if (row.category === '現金-小兒銷售') {
                    note = `${row.quantity}罐`;
                } else {
                    // Standard Categories
                    if (row.status === Stage1Status.REPURCHASE && row.repurchaseType) {
                        note = row.repurchaseType;
                    }
                }
            }

            let pts = 0;
            if (data.role !== 'PHARMACIST' && row.category === '現金-小兒銷售') {
                pts = 0;
            } else {
                pts = recalculateStage1Points(row, data.role);
            }
            const ptsDisplay = (data.role !== 'PHARMACIST' && row.category === '現金-小兒銷售') ? '' : pts;

            put(config.category, safeVal(row.category));
            put(config.date, safeVal(row.date));
            put(config.customerID, formatCID(row.customerID)); 
            put(config.itemID, safeVal(row.itemID));
            put(config.itemName, safeVal(row.itemName));
            put(config.quantity, data.role === 'PHARMACIST' ? safeVal(row.quantity) : '');
            put(config.amount, safeVal(row.amount)); 
            put(config.note, safeVal(note));
            put(config.points, safeVal(ptsDisplay));
            currentRow++;
        });

        // Stage 2 Logic
        // For Pharmacist in Template Mode: Use Fixed Cells if configured
        if (data.role === 'PHARMACIST') {
            // 1. Calculate Pharmacist Point Stats
            const pointsDev = finalStage1.reduce((acc, row) => {
                if (row.status === Stage1Status.DEVELOP || row.status === Stage1Status.HALF_YEAR || row.status === Stage1Status.RETURN) {
                    return acc + recalculateStage1Points(row, data.role);
                }
                return acc;
            }, 0);

            const pointsRep = finalStage1.reduce((acc, row) => {
                if (row.status === Stage1Status.REPURCHASE) return acc + row.calculatedPoints;
                return acc;
            }, 0);

            let pointsTableDev = 0;
            for (const otherPerson of Object.keys(processedData)) {
                if (otherPerson === person) continue; 
                const otherData = processedData[otherPerson];
                otherData.stage1.forEach(row => {
                    if (row.originalDeveloper === person && row.status === Stage1Status.REPURCHASE) {
                         const fullPoints = recalculateStage1Points({ ...row, status: Stage1Status.DEVELOP }, otherData.role);
                         const actualRepurchasePoints = row.calculatedPoints; 
                         pointsTableDev += (fullPoints - actualRepurchasePoints);
                    }
                    if (row.status === Stage1Status.RETURN && row.originalDeveloper === person) {
                        const fullPoints = recalculateStage1Points({ ...row, originalDeveloper: undefined }, otherData.role); 
                        const sellerShare = recalculateStage1Points(row, otherData.role); 
                        const devShare = fullPoints - sellerShare; 
                        pointsTableDev += devShare;
                    }
                });
            }

            // Write Pharmacist Points
            writeToCell(config.cell_pharm_points_dev, pointsDev);
            writeToCell(config.cell_pharm_points_rep, pointsRep);
            writeToCell(config.cell_pharm_points_table_dev, pointsTableDev);

            // 2. Dispensing Stats
            const qty1727 = data.stage2.find(r => r.itemID === '001727')?.quantity || 0;
            const qty1345 = data.stage2.find(r => r.itemID === '001345')?.quantity || 0;
            const bonus = Math.max(0, (qty1727 - 300) * 10);

            writeToCell(config.cell_pharm_qty_1727, qty1727);
            writeToCell(config.cell_pharm_qty_1345, qty1345);
            writeToCell(config.cell_pharm_bonus, bonus);
            
            // DO NOT append list rows for Pharmacist in template mode
        } else {
            // For Sales (or other), append Stage 2 list below Stage 1
            currentRow += 2;
            
            const addSimpleRow = (vals: any[]) => {
                 const r = sheet.getRow(currentRow++);
                 r.values = vals;
                 r.commit();
            };

            if (data.stage2.length > 0) {
                 addSimpleRow(["--- 第二階段：獎勵/調劑 ---"]);
                 
                 data.stage2.forEach(r => {
                     if (r.isDeleted) return;
                     let reward = r.format === '禮券' ? `${r.quantity}張` : `${r.customReward ?? (r.quantity * r.reward)}元`;
                     
                     put(config.reward_category || config.category, r.category);
                     put(config.reward_date || config.date, r.displayDate);
                     put(config.reward_customerID || config.customerID, formatCID(r.customerID));
                     put(config.reward_itemID || config.itemID, r.itemID);
                     put(config.reward_itemName || config.itemName, r.itemName);
                     put(config.reward_quantity || config.quantity, r.quantity);
                     put(config.reward_note || 'G', r.note); 
                     put(config.reward_amount || 'H', reward); 
                     currentRow++;
                 });
            }
        }
    } else {
        // NO TEMPLATE MODE (Fallback)
        let startRow = 1;
        
        // Use a slightly different start row since we merged A1 for title
        if (reportDate) startRow = 2;

        const addRow = (values: any[], isHeader = false, isSectionTitle = false) => {
            const row = sheet.getRow(startRow++);
            row.values = values;
            if (isSectionTitle) {
                row.font = { bold: true, size: 12, color: { argb: 'FF000000' } };
                row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }; 
            } else if (isHeader) {
                row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF475569' } };
                row.alignment = { horizontal: 'center' };
            }
            row.commit();
        };

        const s1Total = finalStage1.reduce((sum, row) => {
            if (row.status === Stage1Status.DEVELOP || row.status === Stage1Status.HALF_YEAR || row.status === Stage1Status.REPURCHASE || row.status === Stage1Status.RETURN) {
                return sum + recalculateStage1Points(row, data.role);
            }
            return sum;
        }, 0);

        addRow([`【第一階段：點數表】 總計：${s1Total} 點`], false, true);
        
        const header = data.role === 'PHARMACIST' 
             ? ["分類", "日期", "客戶編號", "品項編號", "品名", "數量", "金額", "備註", "點數"]
             : ["分類", "日期", "客戶編號", "品項編號", "品名", "數量", "金額", "備註", "計算點數"];
        addRow(header, true);

        finalStage1.forEach(row => {
            // Determine Note content based on Role and Category
            let note: string = row.status; // Default to basic status

            if (data.role === 'PHARMACIST') {
                if (row.category === '調劑點數') {
                    note = `${row.quantity}份`;
                } else {
                    // For '其他' or standard items
                    if (row.status === Stage1Status.REPURCHASE && row.repurchaseType) {
                        note = row.repurchaseType;
                    }
                }
            } else {
                // SALES
                if (row.category === '現金-小兒銷售') {
                    note = `${row.quantity}罐`;
                } else {
                    // Standard Categories
                    if (row.status === Stage1Status.REPURCHASE && row.repurchaseType) {
                        note = row.repurchaseType;
                    }
                }
            }

            const pts = (data.role !== 'PHARMACIST' && row.category === '現金-小兒銷售') ? '' : recalculateStage1Points(row, data.role);
            addRow([
                safeVal(row.category), safeVal(row.date), formatCID(row.customerID), 
                safeVal(row.itemID), safeVal(row.itemName), safeVal(row.quantity),
                safeVal(row.amount), safeVal(note), safeVal(pts)
            ]);
        });
        
        startRow++; 

        // STAGE 2 & 3
        if (data.role === 'PHARMACIST') {
            addRow([`【第二階段：當月調劑件數】`], false, true);
            addRow(["品項編號", "品名", "數量"], true);
            data.stage2.forEach(row => {
                const label = row.itemID === '001727' ? '件' : '組';
                addRow([safeVal(row.itemID), safeVal(row.itemName), `${safeVal(row.quantity)}${label}`]);
            });
            const dispensingQty = data.stage2.find(r => r.itemID === '001727')?.quantity || 0;
            const bonus = Math.max(0, (dispensingQty - 300) * 10);
            addRow(["自費調劑獎金", "", `${bonus}元`]);

        } else {
            const s2Totals = data.stage2.reduce((acc, row) => {
                if (row.isDeleted) return acc;
                if (row.format === '禮券') acc.vouchers += row.quantity;
                else {
                    const amount = row.customReward !== undefined ? row.customReward : (row.quantity * row.reward);
                    acc.cash += amount;
                }
                return acc;
            }, { cash: 0, vouchers: 0 });

            addRow([`【第二階段：現金獎勵表】 現金$${s2Totals.cash.toLocaleString()} 禮券${s2Totals.vouchers}張`], false, true);
            addRow(["類別", "日期", "客戶編號", "品項編號", "品名", "數量", "備註", "獎勵"], true);
            data.stage2.forEach(row => {
                if (row.isDeleted) return;
                let rewardDisplay = "";
                if (row.format === '禮券') rewardDisplay = `${row.quantity}張${safeVal(row.rewardLabel)}`;
                else {
                    const amount = row.customReward !== undefined ? row.customReward : (row.quantity * row.reward);
                    rewardDisplay = `${amount}元`;
                }
                addRow([
                    safeVal(row.category), safeVal(row.displayDate), formatCID(row.customerID),
                    safeVal(row.itemID), safeVal(row.itemName), safeVal(row.quantity),
                    safeVal(row.note), safeVal(rewardDisplay)
                ]);
            });

            startRow++;
            addRow(["【第三階段：美妝金額】"], false, true);
            addRow(["品牌分類", "金額"], true);
            data.stage3.rows.forEach(row => addRow([safeVal(row.categoryName), safeVal(row.subTotal)]));
            const totalRow = sheet.getRow(startRow++);
            totalRow.values = ["總金額", safeVal(data.stage3.total)];
            totalRow.font = { bold: true };
        }
    }
  }

  // --- 2. REPURCHASE SHEET (MATRIX VIEW) ---
  // Step 1: Gather Matrix Data
  interface RepurchaseRowData extends Stage1Row {
      actualSellerPoints: number;
      devPoints: number;
  }
  
  const matrixData: Record<string, RepurchaseRowData[]> = {};
  const developersSet = new Set<string>();

  for (const sellerName of sortedPersons) {
      if (!selectedPersons.has(sellerName)) continue;

      const sellerData = processedData[sellerName];
      const rows: RepurchaseRowData[] = [];

      sellerData.stage1.forEach(row => {
          const isRepurchase = row.status === Stage1Status.REPURCHASE;
          const isReturnSplit = row.status === Stage1Status.RETURN && row.originalDeveloper && row.originalDeveloper !== '無';
          
          if (isRepurchase || isReturnSplit) {
              const dev = row.originalDeveloper;
              if (dev) {
                  developersSet.add(dev);

                  // Calculate Points
                  let fullPoints = 0;
                  let sellerPoints = row.calculatedPoints;
                  let devPoints = 0;

                  if (isReturnSplit) {
                       fullPoints = recalculateStage1Points({ ...row, originalDeveloper: undefined }, sellerData.role);
                       devPoints = fullPoints - sellerPoints;
                  } else {
                       fullPoints = recalculateStage1Points({ ...row, status: Stage1Status.DEVELOP }, sellerData.role);
                       devPoints = fullPoints - sellerPoints;
                  }
                  
                  rows.push({
                      ...row,
                      actualSellerPoints: sellerPoints,
                      devPoints: devPoints
                  });
              }
          }
      });
      
      if (rows.length > 0) {
          matrixData[sellerName] = rows.sort((a, b) => a.date.localeCompare(b.date));
      }
  }

  // Create Sheet if data exists
  if (Object.keys(matrixData).length > 0) {
      const repSheet = outWorkbook.addWorksheet("回購總表");
      
      // Sort Developers by Role -> ID -> Name
      const sortedDevs = Array.from(developersSet).sort((a, b) => {
          // Determine Role from Processed Data if available, fallback to master list
          const roleA = processedData[a]?.role || staffMasterList.find(s => s.name === a)?.role || 'SALES';
          const roleB = processedData[b]?.role || staffMasterList.find(s => s.name === b)?.role || 'SALES';
          
          const pA = roleA === 'SALES' ? 1 : (roleA === 'PHARMACIST' ? 2 : 3);
          const pB = roleB === 'SALES' ? 1 : (roleB === 'PHARMACIST' ? 2 : 3);
          
          if (pA !== pB) return pA - pB;

          // Compare ID
          const staffA = staffMasterList.find(s => s.name === a);
          const staffB = staffMasterList.find(s => s.name === b);
          const idA = staffA?.id || '999999';
          const idB = staffB?.id || '999999';

          if (idA !== idB) return idA.localeCompare(idB, undefined, { numeric: true });

          return a.localeCompare(b, 'zh-TW');
      });

      // Define Columns Widths
      // Base: 7 cols (A-G) + Developers
      const cols: Partial<ExcelJS.Column>[] = [
          { width: 20 }, // Category (Seller Name header goes here)
          { width: 12 }, // Date
          { width: 15 }, // CustomerID
          { width: 15 }, // ItemID
          { width: 30 }, // ItemName
          { width: 15 }, // Note
          { width: 12 }, // Seller Points
      ];
      // Add Dev Columns
      sortedDevs.forEach(() => cols.push({ width: 12 }));
      repSheet.columns = cols;

      // --- TITLE ROW (NEW) ---
      // If reportDate exists, insert it at row 1 and push headers down.
      if (reportDate) {
          const titleRow = repSheet.addRow([reportDate]);
          const lastColIdx = 7 + sortedDevs.length; // A-G + Devs
          // Merge from A1 to the last column
          repSheet.mergeCells(titleRow.number, 1, titleRow.number, lastColIdx);
          
          const cell = titleRow.getCell(1);
          cell.alignment = { horizontal: 'center', vertical: 'middle' };
          cell.font = { bold: true, size: 14 };
          // Fill background for Title (Optional, matching image style loosely)
          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFBE7C6' } }; // Light Orange/Gold
          cell.border = { top: {style:'thin'}, bottom: {style:'thin'}, left: {style:'thin'}, right: {style:'thin'} };
          
          titleRow.height = 30; 
      }

      // --- HEADER ROWS ---
      // Fixed Headers + "Original Developer" Merged Header
      const headerRow1 = repSheet.addRow([
          "分類", "日期", "客戶編號", "品項編號", "品名", "備註", "回購點數", "原開發者 (開發點數)"
      ]);
      
      // Merge "Original Developer" across all dev columns
      if (sortedDevs.length > 0) {
          const startCol = 8; // Column H
          const endCol = 8 + sortedDevs.length - 1;
          if (endCol >= startCol) {
              repSheet.mergeCells(headerRow1.number, startCol, headerRow1.number, endCol);
          }
      }

      // Dev Names Sub-header
      const headerRow2Values = ["", "", "", "", "", "", ""]; // Spacers for A-G
      sortedDevs.forEach(dev => headerRow2Values.push(dev));
      const headerRow2 = repSheet.addRow(headerRow2Values);

      // Styling Headers
      [headerRow1, headerRow2].forEach(row => {
          row.font = { bold: true };
          row.alignment = { horizontal: 'center', vertical: 'middle' };
          row.eachCell((cell, colNum) => {
              if (colNum <= 7) {
                  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFE2E8F0' } }; // Slate-200
              } else {
                  // Dev header background
                  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFDDD6FE' } }; // Purple-100
              }
              cell.border = { top: {style:'thin'}, left: {style:'thin'}, bottom: {style:'thin'}, right: {style:'thin'} };
          });
      });
      // Specific style for "Repurchase Points" header (Col 7) in the main header row
      headerRow1.getCell(7).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } }; // Amber-50
      headerRow1.getCell(7).font = { bold: true, color: { argb: 'FFB45309' } }; // Amber-700
      
      // --- DATA ROWS ---
      Object.keys(matrixData).sort().forEach(sellerName => {
          const rows = matrixData[sellerName];
          // Calculate Totals for Header Row
          const totalSeller = rows.reduce((acc, r) => acc + r.actualSellerPoints, 0);
          
          // Construct Section Header (Combined with Totals)
          // [Seller Name (Merged A-F), TotalSeller (G), ...DevTotals (H+)]
          const sectionRowValues: any[] = [sellerName, "", "", "", "", "", totalSeller];
          sortedDevs.forEach(dev => {
              const devTotal = rows.reduce((acc, r) => r.originalDeveloper === dev ? acc + r.devPoints : acc, 0);
              sectionRowValues.push(devTotal === 0 ? '' : devTotal);
          });

          // Section Header Row
          const sectionRow = repSheet.addRow(sectionRowValues);
          
          // Merge Name Cell (A-F = 1-6)
          repSheet.mergeCells(sectionRow.number, 1, sectionRow.number, 6);
          
          // Style Name Cell
          const nameCell = sectionRow.getCell(1);
          nameCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }; // Slate-100
          nameCell.font = { bold: true, size: 12 };
          nameCell.border = { top: {style:'medium'}, bottom: {style:'medium'}, right: {style: 'thin'} };

          // Style Total Cells (Starting from G=7)
          sectionRow.eachCell((cell, colNum) => {
              if (colNum >= 7) {
                  cell.font = { bold: true };
                  cell.alignment = { horizontal: 'right' };
                  cell.border = { top: {style:'medium'}, bottom: {style:'medium'} };
                  
                  if (colNum === 7) { // Seller Total
                      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } }; // Amber-50
                      cell.font = { bold: true, color: { argb: 'FFB45309' } };
                  } else { // Dev Totals
                      if (cell.value) { // Only highlight if value > 0
                          cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F3FF' } }; // Purple-50
                          cell.font = { bold: true, color: { argb: 'FF6D28D9' } };
                      }
                  }
              }
          });

          // Iterate Items
          rows.forEach(row => {
              const isReturn = row.status === Stage1Status.RETURN;
              const textColor = isReturn ? 'FFDC2626' : 'FF000000'; // Red : Black

              const rowValues = [
                  row.category,
                  row.date,
                  formatCID(row.customerID),
                  row.itemID,
                  row.itemName,
                  safeVal(row.repurchaseType),
                  row.actualSellerPoints
              ];

              // Add Dev Points cells
              sortedDevs.forEach(dev => {
                  if (dev === row.originalDeveloper) {
                      rowValues.push(row.devPoints);
                  } else {
                      rowValues.push('');
                  }
              });

              const r = repSheet.addRow(rowValues);
              
              // Styling Row
              r.eachCell((cell, colNum) => {
                  cell.font = { color: { argb: textColor } };
                  cell.border = { bottom: { style: 'dotted', color: { argb: 'FFCBD5E1' } } };
                  
                  // Highlight Seller Points (Col 7)
                  if (colNum === 7) {
                      cell.font = { bold: true, color: { argb: isReturn ? 'FFDC2626' : 'FFB45309' } };
                      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } };
                  }
                  
                  // Highlight Target Dev Point Cell
                  if (colNum > 7) {
                       const devName = sortedDevs[colNum - 8];
                       if (devName === row.originalDeveloper) {
                            cell.font = { bold: true, color: { argb: isReturn ? 'FFDC2626' : 'FF6D28D9' } }; // Purple-700
                            cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F3FF' } }; // Purple-50
                       }
                  }
              });
          });
          
          // Spacer Row
          repSheet.addRow([]);
      });
  }

  const buffer = await outWorkbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = defaultFilename.trim().replace(/\.xlsx$/i, '') + '.xlsx';
  anchor.click();
  window.URL.revokeObjectURL(url);
};

// Helper: Get ARGB color from string hash
function getStoreColorARGB(name: string): string {
    return 'FF334155';
}

// Helper: Copy Sheet Structure
function copySheetModel(source: ExcelJS.Worksheet, target: ExcelJS.Worksheet, maxRow: number = 20) {
    if (source.columns) {
        target.columns = source.columns.map(col => ({ 
            header: col.header, key: col.key, width: col.width, style: col.style 
        }));
    }
    
    target.pageSetup = { ...source.pageSetup };

    if (source.properties) {
        target.properties = JSON.parse(JSON.stringify(source.properties));
    }
    
    if (source.views) {
        target.views = JSON.parse(JSON.stringify(source.views));
    }
    
    source.eachRow({ includeEmpty: true }, (row, rowNumber) => {
        const newRow = target.getRow(rowNumber);
        
        if (row.height) newRow.height = row.height;
        newRow.hidden = row.hidden;
        
        row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
             const newCell = newRow.getCell(colNumber);
             
             // ALWAYS copy the style (font, border, fill, etc.) from the template
             // This ensures fixed cells (e.g. at row 50) retain their bold/large formatting
             applyCellStyle(newCell, cell);

             // ONLY copy the value if it's in the "Header" area (above the list start)
             // This prevents dummy data in the template list area from appearing in the export
             if (rowNumber < maxRow) {
                 newCell.value = cell.value;
             }
        });
    });

    const model = (source as any).model;
    if (model && model.merges) {
        (model.merges as string[]).forEach(merge => {
            try { target.mergeCells(merge); } catch (e) {}
        });
    } else {
        const merges = (source as any)._merges;
        if (merges) {
            Object.keys(merges).forEach(merge => {
                try { target.mergeCells(merge); } catch (e) {}
            });
        }
    }
}

function applyCellStyle(target: ExcelJS.Cell, source: ExcelJS.Cell) {
   target.style = { ...source.style };
   if (source.border) target.border = JSON.parse(JSON.stringify(source.border));
   if (source.font) target.font = JSON.parse(JSON.stringify(source.font));
   if (source.alignment) target.alignment = JSON.parse(JSON.stringify(source.alignment));
   if (source.fill) target.fill = JSON.parse(JSON.stringify(source.fill));
   if (source.numFmt) target.numFmt = source.numFmt;
}
