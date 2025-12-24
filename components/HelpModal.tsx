
import React from 'react';
import { X, CheckCircle2, Filter } from 'lucide-react';

interface HelpModalProps {
  onClose: () => void;
}

const HelpModal: React.FC<HelpModalProps> = ({ onClose }) => {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] p-4 transition-opacity">
      <div className="bg-white w-full max-w-4xl h-[85vh] rounded-2xl shadow-2xl flex flex-col overflow-hidden animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="bg-slate-900 text-white px-6 py-4 flex justify-between items-center shrink-0">
          <h2 className="text-lg font-bold tracking-wide flex items-center gap-2">
            <Filter size={20} className="text-emerald-400"/>
            資料篩選與計算規則
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white transition-colors p-1 rounded-full hover:bg-slate-800">
            <X size={24} />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 md:p-8 bg-gray-50 scroll-smooth">
            <div className="space-y-8 max-w-4xl mx-auto">
              
              {/* Sales Rules */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <div className="bg-emerald-50 px-6 py-4 border-b border-emerald-100 flex items-center gap-2">
                   <div className="p-2 bg-white rounded-full border border-emerald-100 shadow-sm">
                      <span className="font-black text-emerald-600 text-lg leading-none">A</span>
                   </div>
                   <h3 className="text-lg font-bold text-emerald-800">門市人員 (Sales)</h3>
                </div>
                <div className="p-6 space-y-6">
                  <div>
                    <h4 className="font-bold text-slate-800 mb-3 flex items-center gap-2 text-sm uppercase tracking-wider bg-slate-100 w-fit px-2 py-1 rounded">
                        <CheckCircle2 size={14} className="text-slate-500"/> 第一階段：排除與篩選
                    </h4>
                    <ul className="list-disc pl-6 space-y-2 text-slate-600 text-sm marker:text-emerald-300">
                      <li><strong>本次欠款：</strong>必須為 0 (無欠款)。若是「退貨」則不檢查欠款。</li>
                      <li><strong>原始點數：</strong>必須大於 0。</li>
                      <li><strong>單價金額：</strong>必須大於 0 (贈品不計)。</li>
                      <li><strong>排除品項：</strong>
                          <ul className="list-circle pl-4 mt-1 space-y-1 text-slate-500">
                              <li>品類一為 "05-2" (成人奶水) 且單位為 "罐" 或 "瓶" 者。</li>
                              <li>存在於「藥師點數清單」且分類為「調劑點數」者。</li>
                          </ul>
                      </li>
                    </ul>
                  </div>

                  <div className="border-t border-slate-100 pt-4">
                    <h4 className="font-bold text-slate-800 mb-3 flex items-center gap-2 text-sm uppercase tracking-wider bg-slate-100 w-fit px-2 py-1 rounded">
                        <CheckCircle2 size={14} className="text-slate-500"/> 第二階段：點數計算公式
                    </h4>
                    <ul className="list-disc pl-6 space-y-2 text-slate-600 text-sm marker:text-emerald-300">
                      <li><strong>一般品項：</strong>維持原始點數。</li>
                      <li><strong>特定分類除算：</strong>若分類為「成人奶粉」、「成人奶水」或「嬰幼兒米麥精」，點數會除以數量 (無條件捨去)。</li>
                      <li><strong>現金-小兒銷售：</strong>點數強制歸零 (此分類僅計算現金獎勵)。</li>
                      <li><strong>回購懲罰：</strong>若系統或手動標記為「回購」，最終點數減半 (除以 2)。</li>
                      <li><strong>退貨扣點：</strong>若數量為負，則計算出的點數為負值 (若有原開發者，則各負擔一半)。</li>
                    </ul>
                  </div>
                </div>
              </div>

              {/* Pharmacist Rules */}
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden shadow-sm">
                <div className="bg-blue-50 px-6 py-4 border-b border-blue-100 flex items-center gap-2">
                   <div className="p-2 bg-white rounded-full border border-blue-100 shadow-sm">
                      <span className="font-black text-blue-600 text-lg leading-none">B</span>
                   </div>
                   <h3 className="text-lg font-bold text-blue-800">藥師人員 (Pharmacist)</h3>
                </div>
                <div className="p-6 space-y-6">
                   <div>
                    <h4 className="font-bold text-slate-800 mb-3 flex items-center gap-2 text-sm uppercase tracking-wider bg-slate-100 w-fit px-2 py-1 rounded">
                        <CheckCircle2 size={14} className="text-slate-500"/> 第一階段：點數表篩選
                    </h4>
                    <ul className="list-disc pl-6 space-y-2 text-slate-600 text-sm marker:text-blue-300">
                      <li><strong>基本條件：</strong>無欠款、原始點數 &gt; 0 (退貨除外)。</li>
                      <li><strong>優先判定 - 成人奶粉 (05-1)：</strong>只要符合此分類即列入。點數需除以數量。</li>
                      <li><strong>清單判定 - 調劑點數：</strong>若品項在「藥師點數清單」中分類為「調劑點數」，全額計分 (允許無客戶編號)。</li>
                      <li><strong>清單判定 - 其他：</strong>若品項在「藥師點數清單」中分類為「其他」，全額計分。</li>
                      <li><strong>回購判定：</strong>「調劑點數」不判斷回購。其他分類若為回購，點數減半。</li>
                      <li><strong>未符合上述條件者：</strong>不列入計算。</li>
                    </ul>
                  </div>

                  <div className="border-t border-slate-100 pt-4">
                    <h4 className="font-bold text-slate-800 mb-3 flex items-center gap-2 text-sm uppercase tracking-wider bg-slate-100 w-fit px-2 py-1 rounded">
                        <CheckCircle2 size={14} className="text-slate-500"/> 第二階段：調劑件數統計 (不計金額)
                    </h4>
                    <ul className="list-disc pl-6 space-y-2 text-slate-600 text-sm marker:text-blue-300">
                      <li><strong>自費調劑：</strong>統計品項編號為 <code className="bg-gray-100 px-1 rounded border border-gray-200">001727</code> 的總數量 (單位：件)。</li>
                      <li><strong>調劑藥事服務費：</strong>統計品項編號為 <code className="bg-gray-100 px-1 rounded border border-gray-200">001345</code> 的總數量 (單位：組)。</li>
                      <li><strong>調劑獎金：</strong>(自費調劑件數 - 300) * 10，若不足 300 則為 0。</li>
                    </ul>
                  </div>
                </div>
              </div>

            </div>
        </div>

        {/* Footer */}
        <div className="p-4 border-t bg-white flex justify-end">
          <button onClick={onClose} className="px-6 py-2 bg-slate-800 text-white font-bold rounded hover:bg-slate-700 transition-colors shadow-md">
            關閉視窗
          </button>
        </div>

      </div>
    </div>
  );
};

export default HelpModal;
