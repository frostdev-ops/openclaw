import { useState } from "react";
import { Card } from "../common/Card";
import { Badge } from "../common/Badge";
import { ChevronDown, ChevronRight, Terminal } from "lucide-react";
import { MarkdownContent } from "./MarkdownContent";
import type { ToolCallData, ToolResultData } from "./types";

export function ToolCallCard({
  toolCall,
  toolResult,
}: {
  toolCall?: ToolCallData;
  toolResult?: ToolResultData;
}) {
  const [expanded, setExpanded] = useState(false);
  const data = toolCall ?? toolResult;
  if (!data) {
    return null;
  }

  const isResult = toolResult != null;
  const label = isResult ? `Tool Result: ${data.name}` : `Tool Call: ${data.name}`;
  const payload = isResult ? toolResult?.output : toolCall?.input;
  const isStringPayload = typeof payload === "string";

  return (
    <Card className="my-1 !p-0 overflow-hidden border border-white/10">
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        className="touch-manipulation flex items-center gap-2 w-full px-3 py-2 min-h-11 text-left text-sm sm:text-xs font-semibold text-neutral-300 hover:bg-white/[0.06] transition-colors"
      >
        {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        <Terminal size={14} className={isResult ? "text-success-400" : "text-info-400"} />
        <span>{label}</span>
        <Badge variant={isResult ? "success" : "info"}>{isResult ? "result" : "call"}</Badge>
      </button>
      {expanded &&
        (isStringPayload && isResult ? (
          <div className="px-3 pb-3 overflow-auto max-h-64">
            <MarkdownContent content={payload} />
          </div>
        ) : (
          <pre className="text-xs text-neutral-400 overflow-auto max-h-64 font-mono bg-neutral-950/55 px-3 pb-3">
            {JSON.stringify(payload, null, 2)}
          </pre>
        ))}
    </Card>
  );
}
