import { useState, useRef, useEffect } from "react";
import type { ToolCall } from "../hooks/useSession";

interface ToolChipProps {
  tool: ToolCall;
}

export function ToolChip({ tool }: ToolChipProps) {
  const [showPopover, setShowPopover] = useState(false);
  const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 });
  const chipRef = useRef<HTMLSpanElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  const getMainArg = (): string => {
    const args = tool.arguments;
    const priorityKeys = ["file_path", "path", "command", "url", "query", "pattern"];

    for (const key of priorityKeys) {
      if (args[key] && typeof args[key] === "string") {
        const val = args[key] as string;
        if (val.length > 30) {
          return "..." + val.slice(-27);
        }
        return val;
      }
    }

    for (const value of Object.values(args)) {
      if (typeof value === "string" && value.length < 40) {
        return value;
      }
    }

    return "";
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (chipRef.current) {
      const rect = chipRef.current.getBoundingClientRect();
      setPopoverPosition({
        top: rect.bottom + 4,
        left: Math.min(rect.left, window.innerWidth - 420),
      });
    }
    setShowPopover(!showPopover);
  };

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node) &&
        chipRef.current &&
        !chipRef.current.contains(e.target as Node)
      ) {
        setShowPopover(false);
      }
    };

    if (showPopover) {
      document.addEventListener("mousedown", handleClickOutside);
      return () => document.removeEventListener("mousedown", handleClickOutside);
    }
  }, [showPopover]);

  const mainArg = getMainArg();
  const isRunning = tool.state === "running";

  return (
    <>
      <span
        ref={chipRef}
        onClick={handleClick}
        className={`tool-chip ${isRunning ? "running" : ""}`}
      >
        <span className="tool-chip-name">{tool.name}</span>
        {mainArg && <span className="tool-chip-arg">{mainArg}</span>}
      </span>

      {showPopover && (
        <div
          ref={popoverRef}
          className="tool-chip-popover"
          style={{ top: popoverPosition.top, left: popoverPosition.left }}
        >
          <div className="tool-chip-popover-header">
            <span className="tool-chip-popover-title">{tool.name}</span>
            <button
              onClick={() => setShowPopover(false)}
              className="tool-chip-popover-close"
            >
              ×
            </button>
          </div>

          <div className="tool-chip-popover-section">
            <div className="tool-chip-popover-label">Input</div>
            <div className="tool-chip-popover-content">
              {JSON.stringify(tool.arguments, null, 2)}
            </div>
          </div>

          {tool.result && (
            <div className="tool-chip-popover-section">
              <div className="tool-chip-popover-label">Output</div>
              <div className="tool-chip-popover-content">
                {typeof tool.result === "string"
                  ? tool.result
                  : JSON.stringify(tool.result, null, 2)}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
