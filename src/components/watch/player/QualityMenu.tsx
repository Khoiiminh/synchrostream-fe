import React from "react";
import { Settings } from "lucide-react";
import { QualityLevel } from "@/core/sync/ISyncAdapter";

interface QualityMenuProps {
  qualityLevels: QualityLevel[];
  currentQuality: string;
  qualityMenuOpen: boolean;
  onToggle: () => void;
  onClose: () => void;
  onQualityChange: (levelIndex: number | "auto") => void;
}

export default function QualityMenu({
  qualityLevels,
  currentQuality,
  qualityMenuOpen,
  onToggle,
  onClose,
  onQualityChange,
}: QualityMenuProps) {
  return (
    <div className="relative">
      <button
        onClick={onToggle}
        className="text-white hover:text-zinc-300 transition-colors focus:outline-hidden cursor-pointer flex items-center gap-1 text-xs font-semibold px-2 py-1 bg-zinc-800/60 rounded-sm border border-zinc-700/40 select-none"
        title="Stream Quality"
      >
        <Settings size={14} />
        <span>{currentQuality}</span>
      </button>

      {qualityMenuOpen && (
        <>
          <div
            className="fixed inset-0 z-40 cursor-default"
            onClick={onClose}
          />

          <div className="absolute bottom-full right-0 mb-2 w-32 bg-zinc-900 border border-zinc-700 rounded-sm shadow-md p-1 flex flex-col z-50 animate-fade-in">
            <div className="text-zinc-500 text-[10px] font-bold tracking-wider px-2 py-1 select-none">
              RESOLUTIONS
            </div>

            <button
              onClick={() => {
                onQualityChange("auto");
                onClose();
              }}
              className={`w-full text-left text-xs px-2 py-1.5 rounded-xs transition-colors hover:bg-zinc-800 cursor-pointer ${
                currentQuality === "Auto"
                  ? "text-blue-400 font-bold"
                  : "text-zinc-300"
              }`}
            >
              Auto (ABR)
            </button>

            {qualityLevels.map((level) => {
              const levelName = `${level.height}p`;

              return (
                <button
                  key={level.index}
                  onClick={() => {
                    onQualityChange(level.index);
                    onClose();
                  }}
                  className={`w-full text-left text-xs px-2 py-1.5 rounded-xs transition-colors hover:bg-zinc-800 cursor-pointer ${
                    currentQuality === levelName
                      ? "text-blue-400 font-bold"
                      : "text-zinc-300"
                  }`}
                >
                  {levelName}
                </button>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}