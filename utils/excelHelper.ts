
import * as XLSX from 'xlsx';
import ExcelJS from 'exceljs';
import { ProcessedData, Stage1Status, Stage1Row } from '../types';
import { getTemplate } from './db';
import { recalculateStage1Points } from './processor'; // Import calculator

// Helper for reading input files (Keep using XLSX for reading as it is robust)
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

// --- EXPORT LOGIC WITH EXCELJS ---

export const exportToExcel = async (processedData: ProcessedData, defaultFilename: string, selectedPersons: Set<string>) => {
  // 1. Check for Template
  const templateRecord = await getTemplate();
  const workbook = new ExcelJS.Workbook();
  let useTemplate = false;
  let config = templateRecord?.config;

  if (templateRecord && templateRecord.data) {
    try {
      await workbook.xlsx.load(templateRecord.data);
      useTemplate = true;
    } catch (e) {
      console.error("Failed to load template", e);
      useTemplate = false;
    }
  }

  // Get the Master Sheet (if template exists)
  const masterSheet = useTemplate ? workbook.worksheets[0] : null;
  
  // Sort Logic: SALES (1) -> PHARMACIST (2) -> OTHERS (3), then by Name
  const sortedPersons = Object.keys(processedData).sort((a, b) => {
    const roleA = processedData[a].role;
    const roleB = processedData[b].role;
    const pA = roleA === 'SALES' ? 1 : (roleA === 'PHARMACIST' ? 2 : 3);
    const pB = roleB === 'SALES' ? 1 : (roleB === 'PHARMACIST' ? 2 : 3);
    
    if (pA !== pB) return pA - pB;
    return a.localeCompare(b, 'zh-TW');
  });

  const addedSheets: string[] = [];

  for (const person of sortedPersons) {
    if (!selectedPersons.has(person)) continue;
    const data = processedData[person];
    if (data.role === 'NO_BONUS') continue;

    let sheet: ExcelJS.Worksheet;
    const sheetName = sanitizeSheetName(person);

    if (masterSheet) {
        sheet = workbook.addWorksheet(sheetName);
        
        // Copy Page Setup
        sheet.pageSetup = { ...masterSheet.pageSetup };
        
        // Copy Columns (Widths)
        if (masterSheet.columns) {
            sheet.columns = masterSheet.columns.map(col => ({ 
                header: col.header, key: col.key, width: col.width, style: col.style 
            }));
        }

        // Copy content from master sheet (Header areas)
        const copyLimit = config ? (config.startRow - 1) : (masterSheet.rowCount);

        masterSheet.eachRow({ includeEmpty: true }, (row, rowNumber) => {
            if (rowNumber > copyLimit && config) return; 

            const newRow = sheet.getRow(rowNumber);
            newRow.values = row.values;
            newRow.height = row.height;
            // TS Fix: Cast to any because 'style' property might be missing in type definition but exists at runtime
            (newRow as any).style = (row as any).style;
            
            row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                const newCell = newRow.getCell(colNumber);
                newCell.style = cell.style;
                newCell.value = cell.value;
            });
            newRow.commit();
        });

        // Copy Merges
        const merges = (masterSheet as any)._merges; 
        if (merges) {
            Object.keys(merges).forEach(merge => {
                try { sheet.mergeCells(merge); } catch (e) {}
            });
        }

    } else {
        // No Template: Create basic sheet
        sheet = workbook.addWorksheet(sheetName);
        sheet.columns = [
            { width: 18 }, { width: 12 }, { width: 15 }, { width: 15 }, { width: 30 }, { width: 10 }, { width: 12 }, { width: 25 }, { width: 15 }
        ];
    }
    
    addedSheets.push(sheetName);

    // --- WRITE DATA LOGIC ---
    
    // CASE A: TEMPLATE + MAPPING CONFIG USED
    if (useTemplate && config) {
        let currentRow = config.startRow;
        
        const put = (col: string | undefined, val: any) => {
            if (!col) return;
            const cell = sheet.getCell(`${col}${currentRow}`);
            cell.value = val;
            
            if (masterSheet) {
               const templateCell = masterSheet.getCell(`${col}${config!.startRow}`);
               if (templateCell) {
                   cell.style = { ...templateCell.style };
                   if (templateCell.border) cell.border = templateCell.border;
                   if (templateCell.font) cell.font = templateCell.font;
                   if (templateCell.alignment) cell.alignment = templateCell.alignment;
                   if (templateCell.numFmt) cell.numFmt = templateCell.numFmt;
               }
            }
        };

        // 1. Stage 1 Data
        data.stage1.forEach(row => {
            if (row.status === Stage1Status.DELETE) return;
            
            const note = data.role === 'PHARMACIST' ? (row.category === '調劑點數' ? '' : row.status) : row.status;
            const pts = (data.role !== 'PHARMACIST' && row.category === '現金-小兒銷售') ? '' : row.calculatedPoints;

            put(config.category, safeVal(row.category));
            put(config.date, safeVal(row.date));
            put(config.customerID, safeVal(row.customerID));
            put(config.itemID, safeVal(row.itemID));
            put(config.itemName, safeVal(row.itemName));
            put(config.quantity, safeVal(row.quantity));
            put(config.amount, safeVal(row.amount)); 
            put(config.note, safeVal(note));
            put(config.points, safeVal(pts));
            
            currentRow++;
        });

        // Append Stage 2 below
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
                 addSimpleRow([r.category, r.displayDate, r.customerID, r.itemID, r.itemName, r.quantity, reward]);
             });
             
             if (data.role === 'PHARMACIST') {
                const dispensingQty = data.stage2.find(r => r.itemID === '001727')?.quantity || 0;
                const bonus = Math.max(0, (dispensingQty - 300) * 10);
                addSimpleRow(["", "自費調劑獎金", "", `${bonus}元`]);
             }
        }
        
    } else {
        // CASE B: NO MAPPING (DEFAULT APPEND LOGIC)
        
        let startRow = masterSheet ? (masterSheet.rowCount + 2) : 1;
        const addRow = (values: any[], isHeader = false, isSectionTitle = false) => {
            const row = sheet.getRow(startRow++);
            row.values = values;
            
            if (isSectionTitle) {
                row.font = { bold: true, size: 12, color: { argb: 'FF000000' } };
                row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } }; 
                sheet.mergeCells(startRow - 1, 1, startRow - 1, 9);
            } else if (isHeader) {
                row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
                row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF475569' } };
                row.alignment = { horizontal: 'center' };
            } else {
                row.font = { size: 11 };
                row.border = {
                    top: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                    bottom: { style: 'thin', color: { argb: 'FFCBD5E1' } },
                };
            }
            row.commit();
        };

        const s1Total = data.stage1.reduce((sum, row) => {
            if (row.status === Stage1Status.DEVELOP || row.status === Stage1Status.HALF_YEAR || row.status === Stage1Status.REPURCHASE) {
                return sum + row.calculatedPoints;
            }
            return sum;
        }, 0);

        addRow([`【第一階段：點數表】 總計：${s1Total} 點`], false, true);
        
        const header = data.role === 'PHARMACIST' 
             ? ["分類", "日期", "客戶編號", "品項編號", "品名", "數量", "金額", "備註", "點數"]
             : ["分類", "日期", "客戶編號", "品項編號", "品名", "數量", "金額", "備註", "計算點數"];
        addRow(header, true);

        data.stage1.forEach(row => {
            if (row.status === Stage1Status.DELETE) return;
            const note = data.role === 'PHARMACIST' ? (row.category === '調劑點數' ? '' : row.status) : row.status;
            const pts = (data.role !== 'PHARMACIST' && row.category === '現金-小兒銷售') ? '' : row.calculatedPoints;
            addRow([
                safeVal(row.category), safeVal(row.date), safeVal(row.customerID),
                safeVal(row.itemID), safeVal(row.itemName), safeVal(row.quantity),
                safeVal(row.amount), 
                safeVal(note), safeVal(pts)
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
                    safeVal(row.category), safeVal(row.displayDate), safeVal(row.customerID),
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

  // Handle Repurchase Sheet (Global)
  // Gather data
  const repurchaseMap: Record<string, { role: string, rows: Stage1Row[], totalPoints: number }> = {};
  for (const person of sortedPersons) {
     if (!selectedPersons.has(person)) continue;
     const data = processedData[person];
     data.stage1.forEach(row => {
         if (row.status === Stage1Status.REPURCHASE) {
             if (!repurchaseMap[person]) repurchaseMap[person] = { role: data.role as string, rows: [], totalPoints: 0 };
             repurchaseMap[person].rows.push(row);
             repurchaseMap[person].totalPoints += row.calculatedPoints;
         }
     });
  }

  if (Object.keys(repurchaseMap).length > 0) {
      const repSheet = workbook.addWorksheet("回購總表");
      // Added two extra columns: Original Developer, Developer Points
      repSheet.columns = [
        { width: 25 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 25 }, { width: 8 }, { width: 10 }, { width: 15 }, { width: 10 }
      ];

      let rRow = 1;
      const addRepRow = (values: any[], style: 'header' | 'title' | 'data') => {
          const row = repSheet.getRow(rRow++);
          row.values = values;
          if (style === 'title') {
              row.font = { bold: true, size: 12 };
              row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFEBAF' } };
          } else if (style === 'header') {
              row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
              row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEA580C' } };
          }
      };

      Object.keys(repurchaseMap).sort().forEach(person => {
          const group = repurchaseMap[person];
          addRepRow([`${person}    回購總點數：${group.totalPoints}`], 'title');
          addRepRow(["分類", "日期", "客戶編號", "品項編號", "品名", "數量", "回購點數", "原開發者", "開發點數"], 'header');
          
          group.rows.forEach(row => {
              // 1. Calculate Full Points (as if it was DEVELOP)
              // We use the imported processor logic to handle Milk/Nutrient qty division correctly
              const fullPoints = recalculateStage1Points(
                  { ...row, status: Stage1Status.DEVELOP }, 
                  group.role as any
              );
              
              // 2. Developer Points = Full - Repurchase (Calculated)
              // This naturally handles the "Developer gets the odd point" logic
              // e.g., 11 pts -> Repurchase gets floor(5.5)=5. Dev gets 11-5=6.
              const devPoints = fullPoints - row.calculatedPoints;

              // 3. Determine if we show Developer info
              const showDev = row.originalDeveloper && row.originalDeveloper !== '無';
              
              addRepRow([
                  safeVal(row.category), safeVal(row.date), safeVal(row.customerID),
                  safeVal(row.itemID), safeVal(row.itemName), safeVal(row.quantity),
                  safeVal(row.calculatedPoints),
                  showDev ? safeVal(row.originalDeveloper) : '',
                  showDev ? safeVal(devPoints) : ''
              ], 'data');
          });
          rRow++;
      });
  }

  if (useTemplate && masterSheet && addedSheets.length > 0) {
      workbook.removeWorksheet(masterSheet.id);
  }

  const buffer = await workbook.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = defaultFilename.trim().replace(/\.xlsx$/i, '') + '.xlsx';
  anchor.click();
  window.URL.revokeObjectURL(url);
};
