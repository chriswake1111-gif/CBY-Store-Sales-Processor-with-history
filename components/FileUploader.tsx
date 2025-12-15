
import React, { useRef } from 'react';
import { Upload, CheckCircle2, CircleDashed } from 'lucide-react';

interface FileUploaderProps {
  label: string;
  accept?: string;
  onFileSelect: (file: File) => void;
  disabled?: boolean;
  isLoaded?: boolean;
  icon?: string;
}

const FileUploader: React.FC<FileUploaderProps> = ({ label, accept = ".xlsx, .xls, .csv", onFileSelect, disabled, isLoaded }) => {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleClick = () => {
    if (!disabled && inputRef.current) {
      inputRef.current.click();
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      onFileSelect(e.target.files[0]);
    }
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="h-full">
      <input type="file" ref={inputRef} accept={accept} onChange={handleChange} className="hidden" />
      <button
        onClick={handleClick}
        disabled={disabled}
        className={`
          w-full flex items-center gap-3 px-4 py-3 border rounded text-left transition-all h-full
          ${disabled 
            ? 'bg-gray-50 border-gray-200 text-gray-400 cursor-not-allowed' 
            : isLoaded
              ? 'bg-emerald-50 border-emerald-300 text-emerald-800 hover:bg-emerald-100'
              : 'bg-white border-gray-300 text-slate-700 hover:bg-blue-50 hover:border-blue-400 hover:shadow-inner'
          }
        `}
      >
        <div className={`p-1.5 rounded border ${isLoaded ? 'bg-emerald-100 border-emerald-200 text-emerald-600' : 'bg-gray-100 border-gray-200 text-gray-500'}`}>
            {isLoaded ? <CheckCircle2 size={16} /> : <Upload size={16} />}
        </div>
        
        <div className="flex-1">
            <div className="flex justify-between items-center">
                <span className="text-sm font-bold">{label}</span>
                {isLoaded && <span className="text-[10px] bg-emerald-600 text-white px-1.5 py-0.5 rounded-sm">OK</span>}
            </div>
            {!isLoaded && !disabled && <span className="text-xs text-gray-400 font-mono mt-0.5 block">Excel Files Only</span>}
        </div>
      </button>
    </div>
  );
};

export default FileUploader;
