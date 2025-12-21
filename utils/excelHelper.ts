
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
    staffMasterList: StaffRecord[] = []
) => {
  // 1. Load All Templates
  const salesTmpl = await getTemplate(TEMPLATE_IDS.SALES);
  const pharmTmpl = await getTemplate(TEMPLATE_IDS.PHARMACIST);
  const repTmpl = await getTemplate(TEMPLATE_IDS.REPURCHASE);

  // Pre-load Template Workbooks to access their sheets later
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
  const repWB = await loadTmplWB(repTmpl);

  const outWorkbook = new ExcelJS.Workbook();

  // Sort Logic: SALES (1) -> PHARMACIST (2) -> OTHERS (3), then by Name
  const sortedPersons = Object.keys(processedData).sort((a, b) => {
    const roleA = processedData[a].role;
    const roleB = processedData[b].role;
    const pA = roleA === 'SALES' ? 1 : (roleA === 'PHARMACIST' ? 2 : 3);
    const pB = roleB === 'SALES' ? 1 : (roleB === 'PHARMACIST' ? 2 : 3);
    
    if (pA !== pB) return pA - pB;
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
    } else {
        // No Template: Create basic sheet
        sheet = outWorkbook.addWorksheet(sheetName);
        sheet.columns = [
            { width: 18 }, { width: 12 }, { width: 15 }, { width: 15 }, { width: 30 }, { width: 10 }, { width: 12 }, { width: 25 }, { width: 15 }
        ];
    }

    // --- WRITE DATA (Logic branching for Template vs No Template) ---
    if (config) {
        // TEMPLATE MODE
        
        // Lookup staff info early for both Stats and List Rows
        const staffInfo = staffMasterList.find(s => s.name === person);

        // 1. STATS FILLING (Only for Sales / Template Mode)
        // Check if we have specific cell mappings and process them first (Fixed Layout)
        if (data.role !== 'PHARMACIST') {
            
            // Calculate Stats
            // A. Points
            const pointsDev = data.stage1.reduce((acc, row) => {
                // "個人開發" = Develop + Half Year (Excluding Repurchase, Excluding Delete)
                if (row.status === Stage1Status.DEVELOP || row.status === Stage1Status.HALF_YEAR) {
                    return acc + row.calculatedPoints;
                }
                return acc;
            }, 0);

            const pointsRep = data.stage1.reduce((acc, row) => {
                // "總表回購" = Repurchase Only (Points for self from self)
                if (row.status === Stage1Status.REPURCHASE) {
                    return acc + row.calculatedPoints;
                }
                return acc;
            }, 0);

            // "總表開發" = Sum of (Full Points - Repurchase Points) where Current Person is the "Original Developer" in *OTHER PEOPLE'S* data.
            let pointsTableDev = 0;
            // Iterate all other persons
            for (const otherPerson of Object.keys(processedData)) {
                if (otherPerson === person) continue; // Skip self
                const otherData = processedData[otherPerson];
                otherData.stage1.forEach(row => {
                    if (row.originalDeveloper === person && row.status === Stage1Status.REPURCHASE) {
                         // Re-calculate full points (as if DEVELOP)
                         const fullPoints = recalculateStage1Points({ ...row, status: Stage1Status.DEVELOP }, otherData.role);
                         const actualRepurchasePoints = row.calculatedPoints; // This is 50%
                         // Dev points is the delta
                         pointsTableDev += (fullPoints - actualRepurchasePoints);
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
                    // Fuzzy match for voucher types
                    const label = (row.rewardLabel || '').toLowerCase();
                    if (label.includes('7-11') || label.includes('seven')) reward711 += row.quantity;
                    else if (label.includes('全家')) rewardFamily += row.quantity;
                    else if (label.includes('全聯')) rewardPx += row.quantity;
                } else {
                    rewardCash += (row.customReward !== undefined ? row.customReward : (row.quantity * row.reward));
                }
            });

            // WRITE STATS TO SPECIFIC CELLS
            const writeCell = (addr: string | undefined, val: any) => {
                if (addr && /^[A-Z]+[0-9]+$/.test(addr)) {
                     try { sheet.getCell(addr).value = val; } catch {}
                }
            };

            // Points Section
            writeCell(config.cell_pointsStd, staffInfo?.pointsStandard || ''); // 點數標準
            writeCell(config.cell_pointsTotal, ''); // 總計 (User requested blank)
            writeCell(config.cell_pointsDev, pointsDev); // 個人開發
            writeCell(config.cell_pointsRep, pointsRep); // 總表回購
            writeCell(config.cell_pointsTableDev, pointsTableDev); // 總表開發
            writeCell(config.cell_pointsMilkDev, ''); // 奶粉開發 (User requested blank)

            // Cosmetic Section
            writeCell(config.cell_cosmeticStd, staffInfo?.cosmeticStandard || ''); // 美妝標準
            writeCell(config.cell_cosmeticTotal, cosmeticTotal);
            writeCell(config.cell_amtLrp, amtLrp);
            writeCell(config.cell_amtCerave, amtCerave);
            writeCell(config.cell_amtDrSatin, amtDrSatin);
            writeCell(config.cell_amtCetaphil, amtCetaphil);
            writeCell(config.cell_amtFlora, amtFlora);
            writeCell(config.cell_amtEmployee, ''); // 員購 (User requested blank)

            // Rewards Section
            writeCell(config.cell_rewardCash, rewardCash);
            writeCell(config.cell_rewardMilk, ''); // 小兒奶粉 (User requested blank)
            writeCell(config.cell_reward711, reward711);
            writeCell(config.cell_rewardFamily, rewardFamily);
            writeCell(config.cell_rewardPx, rewardPx);
        }

        // 2. LIST DATA WRITING
        let currentRow = config.startRow || 2;
        
        const put = (col: string | undefined, val: any) => {
            if (!col) return;
            const cell = sheet.getCell(`${col}${currentRow}`);
            cell.value = val;
            
            // Re-apply style from template row if exists (helps if adding many rows)
            if (tmplSourceSheet) {
               const tmplRowIdx = config.startRow || 2;
               const templateCell = tmplSourceSheet.getCell(`${col}${tmplRowIdx}`);
               if (templateCell) {
                   applyCellStyle(cell, templateCell);
               }
            }
        };

        // 1. Stage 1 Data
        data.stage1.forEach(row => {
            if (row.status === Stage1Status.DELETE) return;
            
            const note = data.role === 'PHARMACIST' ? (row.category === '調劑點數' ? '' : row.status) : row.status;
            const pts = (data.role !== 'PHARMACIST' && row.category === '現金-小兒銷售') ? '' : row.calculatedPoints;

            // Write Global Staff Info (Repeated per row)
            put(config.storeName, safeVal(staffInfo?.branch));
            put(config.staffID, safeVal(staffInfo?.id));
            put(config.staffName, person);

            put(config.category, safeVal(row.category));
            put(config.date, safeVal(row.date));
            put(config.customerID, formatCID(row.customerID)); // Use formatCID
            put(config.itemID, safeVal(row.itemID));
            put(config.itemName, safeVal(row.itemName));
            
            // MODIFIED: Only export Quantity for PHARMACIST, exclude for SALES
            put(config.quantity, data.role === 'PHARMACIST' ? safeVal(row.quantity) : '');
            
            put(config.amount, safeVal(row.amount)); 
            put(config.note, safeVal(note));
            put(config.points, safeVal(pts));
            
            currentRow++;
        });

        // Append Stage 2 below
        currentRow += 2;
        
        // Helper for Stage 2 Simple Row (Title)
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
                 
                 // Write Global Staff Info (Repeated per row) for Stage 2 as well
                 put(config.storeName, safeVal(staffInfo?.branch));
                 put(config.staffID, safeVal(staffInfo?.id));
                 put(config.staffName, person);

                 // Use Specific Reward Mapping
                 // Default Fallbacks: Map to similar columns as Stage 1 if config is missing (for safety)
                 put(config.reward_category || config.category, r.category);
                 put(config.reward_date || config.date, r.displayDate);
                 put(config.reward_customerID || config.customerID, formatCID(r.customerID)); // Use formatCID
                 put(config.reward_itemID || config.itemID, r.itemID);
                 put(config.reward_itemName || config.itemName, r.itemName);
                 put(config.reward_quantity || config.quantity, r.quantity);
                 put(config.reward_note || 'G', r.note); // Note often in G or H
                 put(config.reward_amount || 'H', reward); 
                 
                 currentRow++;
             });
             
             if (data.role === 'PHARMACIST') {
                const dispensingQty = data.stage2.find(r => r.itemID === '001727')?.quantity || 0;
                const bonus = Math.max(0, (dispensingQty - 300) * 10);
                addSimpleRow(["", "自費調劑獎金", "", `${bonus}元`]);
             }
        }
    } else {
        // NO TEMPLATE MODE (Default Layout) - Unchanged
        let startRow = 1;
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
                safeVal(row.category), safeVal(row.date), formatCID(row.customerID), // Use formatCID
                safeVal(row.itemID), safeVal(row.itemName), safeVal(row.quantity),
                safeVal(row.amount), safeVal(note), safeVal(pts)
            ]);
        });
        
        startRow++; 

        // STAGE 2 & 3 (Same legacy logic...)
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
                    safeVal(row.category), safeVal(row.displayDate), formatCID(row.customerID), // Use formatCID
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

  // --- 2. REPURCHASE SHEET (GLOBAL) ---
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
      const repSheetName = "回購總表";
      let repSheet: ExcelJS.Worksheet;
      const repSourceSheet = repWB?.worksheets[0];
      const repConfig = repTmpl?.config;

      if (repSourceSheet) {
          repSheet = outWorkbook.addWorksheet(repSheetName);
          copySheetModel(repSourceSheet, repSheet, repConfig?.startRow || 20);
      } else {
          repSheet = outWorkbook.addWorksheet(repSheetName);
          repSheet.columns = [
            { width: 25 }, { width: 10 }, { width: 12 }, { width: 12 }, { width: 25 }, { width: 8 }, { width: 10 }, { width: 15 }, { width: 10 }
          ];
      }

      // WRITE REPURCHASE DATA
      if (repConfig) {
          // Template Mode
          let currentRow = repConfig.startRow || 2;
          
          Object.keys(repurchaseMap).sort().forEach(person => {
              const group = repurchaseMap[person];
              
              group.rows.forEach(row => {
                 const fullPoints = recalculateStage1Points({ ...row, status: Stage1Status.DEVELOP }, group.role as any);
                 const devPoints = fullPoints - row.calculatedPoints;
                 const showDev = row.originalDeveloper && row.originalDeveloper !== '無';
                 
                 const put = (col: string | undefined, val: any) => {
                    if (!col) return;
                    const cell = repSheet.getCell(`${col}${currentRow}`);
                    cell.value = val;
                    if (repSourceSheet) {
                        const templateCell = repSourceSheet.getCell(`${col}${repConfig.startRow || 2}`);
                        if (templateCell) applyCellStyle(cell, templateCell);
                    }
                 };

                 put(repConfig.category, person); // Reuse Category Col for Sales Person Name
                 put(repConfig.date, safeVal(row.date));
                 put(repConfig.customerID, formatCID(row.customerID)); // Use formatCID
                 put(repConfig.itemID, safeVal(row.itemID));
                 put(repConfig.itemName, safeVal(row.itemName));
                 put(repConfig.quantity, safeVal(row.quantity));
                 put(repConfig.repurchasePoints, safeVal(row.calculatedPoints));
                 put(repConfig.originalDeveloper, showDev ? safeVal(row.originalDeveloper) : '');
                 put(repConfig.devPoints, showDev ? safeVal(devPoints) : '');
                 
                 currentRow++;
              });
              // Add spacer row?
              currentRow++;
          });
      } else {
          // Default Mode
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
                  const fullPoints = recalculateStage1Points({ ...row, status: Stage1Status.DEVELOP }, group.role as any);
                  const devPoints = fullPoints - row.calculatedPoints;
                  const showDev = row.originalDeveloper && row.originalDeveloper !== '無';
                  
                  addRepRow([
                      safeVal(row.category), safeVal(row.date), formatCID(row.customerID), // Use formatCID
                      safeVal(row.itemID), safeVal(row.itemName), safeVal(row.quantity),
                      safeVal(row.calculatedPoints),
                      showDev ? safeVal(row.originalDeveloper) : '',
                      showDev ? safeVal(devPoints) : ''
                  ], 'data');
              });
              rRow++;
          });
      }
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

// Helper: Copy Sheet Structure (Columns, Merges, Styles)
function copySheetModel(source: ExcelJS.Worksheet, target: ExcelJS.Worksheet, maxRow: number = 20) {
    if (source.columns) {
        target.columns = source.columns.map(col => ({ 
            header: col.header, key: col.key, width: col.width, style: col.style 
        }));
    }
    
    // Copy Page Setup
    target.pageSetup = { ...source.pageSetup };

    // Copy Worksheet Properties (e.g. default row height, fit to page)
    if (source.properties) {
        target.properties = JSON.parse(JSON.stringify(source.properties));
    }
    
    // Copy Views (e.g. Frozen Rows/Cols)
    if (source.views) {
        target.views = JSON.parse(JSON.stringify(source.views));
    }
    
    // Iterate ALL rows in source to preserve heights/hidden status
    source.eachRow({ includeEmpty: true }, (row, rowNumber) => {
        const newRow = target.getRow(rowNumber);
        
        // Always copy row dimension properties
        if (row.height) newRow.height = row.height;
        newRow.hidden = row.hidden;
        
        // Only copy cell content/styles if within the header range (before startRow)
        if (rowNumber < maxRow) {
             row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
                 const newCell = newRow.getCell(colNumber);
                 newCell.value = cell.value;
                 applyCellStyle(newCell, cell);
            });
        }
    });

    // Copy Merges (Robust method)
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
