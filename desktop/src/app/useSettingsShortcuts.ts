import * as React from "react";

import { hasPrimaryShortcutModifier } from "@/shared/lib/platform";

const EDITABLE_SHORTCUT_TARGET_SELECTOR =
  'input, textarea, select, [contenteditable="true"]';

type SettingsMode = "profile" | "preferences";

type UseSettingsShortcutsOptions = {
  mode: SettingsMode;
  onClose: () => void;
  onOpenSettings: (section?: "profile") => void;
  open: boolean;
};

function isEditableShortcutTarget(event: KeyboardEvent) {
  const target = event.target;
  return (
    target instanceof Element &&
    target.closest(EDITABLE_SHORTCUT_TARGET_SELECTOR)
  );
}

export function useSettingsShortcuts({
  mode,
  onClose,
  onOpenSettings,
  open,
}: UseSettingsShortcutsOptions) {
  React.useLayoutEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      const hasSettingsShortcutModifiers =
        hasPrimaryShortcutModifier(event) && !event.altKey && !event.shiftKey;
      const isSettingsShortcut =
        hasSettingsShortcutModifiers &&
        (event.key === "," || event.code === "Comma");
      const isProfileShortcut =
        hasSettingsShortcutModifiers &&
        event.key.toLowerCase() === "u" &&
        !isEditableShortcutTarget(event);

      if (!isSettingsShortcut && !isProfileShortcut) {
        return;
      }

      event.preventDefault();
      if (open && (!isProfileShortcut || mode === "profile")) {
        onClose();
        return;
      }

      if (isProfileShortcut) {
        onOpenSettings("profile");
        return;
      }

      onOpenSettings();
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [mode, onClose, onOpenSettings, open]);
}
