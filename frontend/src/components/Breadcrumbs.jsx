import React from 'react';
import { ChevronLeft } from 'lucide-react';

export default function Breadcrumbs({ crumbs, onCrumbClick }) {
  return (
    <div className="flex items-center gap-1 bg-[#002623] text-white px-4 py-2 rounded-xl text-sm max-w-xl overflow-x-auto border border-[#8e7b5b]">
      {crumbs.map((crumb, idx) => (
        <div key={crumb.id} className="flex items-center gap-1 whitespace-nowrap">
          <button 
            onClick={() => onCrumbClick(idx)}
            className={`hover:text-[#988561] transition-colors font-medium ${idx === crumbs.length - 1 ? 'text-[#988561] font-bold' : 'text-gray-300'}`}
          >
            {crumb.name}
          </button>
          {idx < crumbs.length - 1 && <ChevronLeft className="w-4 h-4 text-[#428177]" />}
        </div>
      ))}
    </div>
  );
}