import { Rows3, SplitSquareVertical } from "lucide-react";
import { useState } from "react";

import { DiffViewer } from "@/features/messages/ui/DiffViewer";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";

type DiffMessageExpandedProps = {
  content: string;
  filePath?: string;
  onClose: () => void;
};

/**
 * The data needed to render an expanded diff modal, lifted out of the row that
 * triggered it. The modal is a Radix `Dialog` portal, so its open state must
 * live ABOVE the virtualized rows — otherwise scrolling the triggering row out
 * of the window unmounts the row and the open modal vanishes. Only one diff can
 * be open at a time (the modal backdrop blocks every other row), so a single
 * value, not a set, is the faithful model.
 */
export type ExpandedDiff = {
  content: string;
  filePath?: string;
};

export default function DiffMessageExpanded({
  content,
  filePath,
  onClose,
}: DiffMessageExpandedProps) {
  const [viewType, setViewType] = useState<"split" | "unified">("unified");

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      open
    >
      <DialogContent className="max-w-5xl w-full h-[80vh] flex flex-col p-0 gap-0">
        <DialogHeader className="shrink-0 border-b border-border/50 px-4 py-3 pr-14">
          <div className="flex flex-wrap items-center gap-2">
            <DialogTitle className="min-w-0 flex-1 truncate font-mono text-sm font-medium">
              {filePath ?? "Diff Viewer"}
            </DialogTitle>
            <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/30 p-1">
              <Button
                className="h-7 px-2"
                onClick={() => {
                  setViewType("unified");
                }}
                size="sm"
                type="button"
                variant={viewType === "unified" ? "secondary" : "ghost"}
              >
                <Rows3 className="h-4 w-4" />
                Unified
              </Button>
              <Button
                className="h-7 px-2"
                onClick={() => {
                  setViewType("split");
                }}
                size="sm"
                type="button"
                variant={viewType === "split" ? "secondary" : "ghost"}
              >
                <SplitSquareVertical className="h-4 w-4" />
                Split
              </Button>
            </div>
          </div>
        </DialogHeader>
        <div className="min-h-0 flex-1 overflow-auto px-4 py-4">
          <DiffViewer
            content={content}
            fallbackFilePath={filePath}
            viewType={viewType}
          />
        </div>
      </DialogContent>
    </Dialog>
  );
}
