import * as React from "react";

const TEXT_ENTRY_SELECTOR = 'input, textarea, select, [contenteditable="true"]';

function isTextEntryEvent(event: KeyboardEvent) {
  return (
    event.target instanceof Element &&
    event.target.closest(TEXT_ENTRY_SELECTOR) !== null
  );
}

function isBackquoteKey(event: KeyboardEvent) {
  return event.key === "`" || event.code === "Backquote";
}

export function useQuakeConsoleShortcut({
  isOpen,
  onToggle,
}: {
  isOpen: boolean;
  onToggle: () => void;
}) {
  React.useLayoutEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        !isBackquoteKey(event) ||
        event.altKey ||
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        (isTextEntryEvent(event) && !isOpen)
      ) {
        return;
      }

      event.preventDefault();
      onToggle();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onToggle]);
}
