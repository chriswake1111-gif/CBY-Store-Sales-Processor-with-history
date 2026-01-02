import ExcelJS from 'exceljs';
import { saveAs } from 'file-saver';
import { ProcessedData, Stage1Status, StaffRecord } from '../types';
import { recalculateStage1Points } from './processor';

// Helper: Safely get value
const safeVal = (v: any) => (v === undefined || v === null) ? '' : v;
const formatCID = (id: string) => id ? (id.startsWith('00') ? id.substring(2) : id) : '';

export const readExcelFile = async (file: File): Promise<any[]> => {
  const buffer = await file.arrayBuffer();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  
  if (!worksheet) return [];

  const jsonData: any[] = [];
  const headers: string[] = [];
  
  const headerRow = worksheet.getRow(1);
  headerRow.eachCell((cell, colNumber) => {
      let val = cell.value;
      if (typeof val === 'object' && val !== null) {
          if ('text' in val) val = (val as any).text;
          else if ('result' in val) val = (val as any).result;
      }
      headers[colNumber] = String(val || '').trim();
  });

  worksheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      const rowData: any = {};
      let hasData = false;
      row.eachCell((cell, colNumber) => {
           const header = headers[colNumber];
           if (header) {
               let val = cell.value;
               if (typeof val === 'object' && val !== null) {
                   if ('text' in val) val = (val as any).text;
                   else if ('hyperlink' in val) val = (val as any).text; 
                   else if ('result' in val) val = (val as any).result;
               }
               rowData[header] = val;
               hasData = true;
           }
      });
      if (hasData) jsonData.push(rowData);
  });

  return jsonData;
};

export const exportToExcel = async (
  processedData: ProcessedData, 
  filename: string, 
  selectedPersons: Set<string>, 
  staffMasterList: StaffRecord[], 
  reportDate?: string
) => {
  const outWorkbook = new ExcelJS.Workbook();

  const sortedPersons = Array.from(selectedPersons).sort((a, b) => {
       const roleA = processedData[a]?.role || 'SALES';
       const roleB = processedData[b]?.role || 'SALES';
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

  // 1. Individual Sheets
  for (const person of sortedPersons) {
      const data = processedData[person];
      if (!data) continue;

      const sheet = outWorkbook.addWorksheet(person);
      
      sheet.addRow([`銷售人員: ${person}`, `職位: ${data.role === 'PHARMACIST' ? '藥師' : '門市'}`, `日期: ${reportDate || ''}`]);
      sheet.addRow([]);

      sheet.addRow(['--- 點數表 ---']);
      const headerRow1 = sheet.addRow(['分類', '日期', '客戶編號', '客戶名稱', '品項編號', '品名', '數量', '金額', '計算點數', '備註']);
      headerRow1.font = { bold: true };
      
      data.stage1.forEach(row => {
          if (row.status === Stage1Status.DELETE) return;
          sheet.addRow([
              row.category,
              row.date,
              formatCID(row.customerID),
              row.customerName,
              row.itemID,
              row.itemName,
              row.quantity,
              row.amount,
              row.calculatedPoints,
              row.status === Stage1Status.DEVELOP ? '' : row.status
          ]);
      });
      sheet.addRow([]);

      sheet.addRow(['--- 獎勵/調劑 ---']);
      const headerRow2 = sheet.addRow(['分類', '日期', '客戶編號', '品項編號', '品名', '數量', '備註', '獎勵']);
      headerRow2.font = { bold: true };

      data.stage2.forEach(row => {
           if (row.isDeleted) return;
           const rewardVal = row.customReward !== undefined ? row.customReward : (row.format === '禮券' ? `${row.quantity}張` : row.quantity * row.reward);
           sheet.addRow([
               row.category,
               row.displayDate,
               formatCID(row.customerID),
               row.itemID,
               row.itemName,
               row.quantity,
               row.note,
               rewardVal
           ]);
      });
      sheet.addRow([]);

      if (data.role !== 'PHARMACIST') {
           sheet.addRow(['--- 美妝統計 ---']);
           const headerRow3 = sheet.addRow(['品牌', '金額']);
           headerRow3.font = { bold: true };
           data.stage3.rows.forEach(r => {
               sheet.addRow([r.categoryName, r.subTotal]);
           });
           sheet.addRow(['總計', data.stage3.total]);
      }
  }

  // 2. Repurchase Matrix Sheet
  const repSheet = outWorkbook.addWorksheet('回購總表');
  
  const matrixData: Record<string, any[]> = {};
  const developersSet = new Set<string>();

  // Iterate all processed data to find interactions
  Object.entries(processedData).forEach(([sellerName, sellerData]) => {
      // Use logic to find rows relevant to matrix
      sellerData.stage1.forEach(row => {
          const isRepurchase = row.status === Stage1Status.REPURCHASE;
          const isReturnSplit = row.status === Stage1Status.RETURN && row.originalDeveloper && row.originalDeveloper !== '無';
          
          if (isRepurchase || isReturnSplit) {
              const dev = row.originalDeveloper;
              if (dev) {
                  developersSet.add(dev);
                  if (!matrixData[sellerName]) matrixData[sellerName] = [];
                  
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
                  
                  matrixData[sellerName].push({
                      ...row,
                      actualSellerPoints: sellerPoints,
                      devPoints: devPoints
                  });
              }
          }
      });
  });

  // Sort developers based on role/id/name
  const sortedDevs = Array.from(developersSet).sort((a, b) => {
       const staffA = staffMasterList.find(s => s.name === a);
       const staffB = staffMasterList.find(s => s.name === b);
       const idA = staffA?.id || '999999';
       const idB = staffB?.id || '999999';
       if (idA !== idB) return idA.localeCompare(idB, undefined, { numeric: true });
       return a.localeCompare(b, 'zh-TW');
  });

  const headerValues = ['銷售人員', '分類', '日期', '客戶', '品項', '品名', '狀態', '回購點數', ...sortedDevs.map(d => `${d} (開發)`)];
  const headerRow1 = repSheet.addRow(headerValues);
  
  headerRow1.font = { bold: true };
  headerRow1.eachCell((cell) => {
      cell.border = { bottom: { style: 'medium' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFEEEEEE' } };
  });

  const col7 = headerRow1.getCell(8); 
  col7.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } };
  col7.font = { bold: true, color: { argb: 'FFB45309' } };

  // Use sortedPersons to ensure rows are ordered by Role -> ID -> Name
  sortedPersons.forEach(sellerName => {
      const rows = matrixData[sellerName];
      if (!rows) return;

      rows.sort((a, b) => a.date.localeCompare(b.date));

      const totalSeller = rows.reduce((acc, r) => acc + r.actualSellerPoints, 0);
      
      const sectionRowValues: any[] = [sellerName, "Subtotal", "", "", "", "", "", totalSeller];
      sortedDevs.forEach(dev => {
          const devTotal = rows.reduce((acc, r) => r.originalDeveloper === dev ? acc + r.devPoints : acc, 0);
          sectionRowValues.push(devTotal === 0 ? '' : devTotal);
      });

      const sectionRow = repSheet.addRow(sectionRowValues);

      const nameCell = sectionRow.getCell(1);
      nameCell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF1F5F9' } };
      nameCell.font = { bold: true, size: 12 };
      nameCell.border = { top: {style:'medium'}, bottom: {style:'medium'}, right: {style: 'thin'} };

      sectionRow.eachCell((cell, colNum) => {
          if (colNum >= 8) {
              cell.font = { bold: true };
              cell.alignment = { horizontal: 'right' };
              cell.border = { top: {style:'medium'}, bottom: {style:'medium'} };
              if (colNum === 8) { 
                  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } };
                  cell.font = { bold: true, color: { argb: 'FFB45309' } };
              } else if (cell.value) { 
                  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F3FF' } };
                  cell.font = { bold: true, color: { argb: 'FF6D28D9' } };
              }
          }
      });

      rows.forEach(row => {
          const isReturn = row.status === Stage1Status.RETURN;
          const textColor = isReturn ? 'FFDC2626' : 'FF000000'; 
          const rowValues = [
              '', // Indent
              row.category,
              row.date,
              formatCID(row.customerID),
              row.itemID,
              row.itemName,
              safeVal(row.repurchaseType) || row.status,
              row.actualSellerPoints
          ];
          sortedDevs.forEach(dev => rowValues.push(dev === row.originalDeveloper ? row.devPoints : ''));

          const r = repSheet.addRow(rowValues);
          r.eachCell((cell, colNum) => {
              cell.font = { color: { argb: textColor } };
              cell.border = { bottom: { style: 'dotted', color: { argb: 'FFCBD5E1' } } };
              if (colNum === 8) {
                  cell.font = { bold: true, color: { argb: isReturn ? 'FFDC2626' : 'FFB45309' } };
                  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF7ED' } };
              }
              if (colNum > 8) {
                   const devName = sortedDevs[colNum - 9];
                   if (devName === row.originalDeveloper) {
                        cell.font = { bold: true, color: { argb: isReturn ? 'FFDC2626' : 'FF6D28D9' } };
                        cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF5F3FF' } };
                   }
              }
          });
      });
      repSheet.addRow([]);
  });

  const buffer = await outWorkbook.xlsx.writeBuffer();
  saveAs(new Blob([buffer]), `${filename}.xlsx`);
};
