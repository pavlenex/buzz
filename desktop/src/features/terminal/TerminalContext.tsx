import * as React from "react";

type TerminalContextValue = {
  isOpen: boolean;
  toggle: () => void;
  close: () => void;
};

const TerminalContext = React.createContext<TerminalContextValue>({
  isOpen: false,
  toggle: () => {},
  close: () => {},
});

export function TerminalProvider({ children }: { children: React.ReactNode }) {
  const [isOpen, setIsOpen] = React.useState(false);

  const toggle = React.useCallback(() => {
    setIsOpen((prev) => !prev);
  }, []);

  const close = React.useCallback(() => {
    setIsOpen(false);
  }, []);

  // Listen for the global toggle event dispatched by the keyboard shortcut handler.
  React.useEffect(() => {
    function handleToggle() {
      setIsOpen((prev) => !prev);
    }

    document.addEventListener("sprout:toggle-terminal", handleToggle);
    return () => {
      document.removeEventListener("sprout:toggle-terminal", handleToggle);
    };
  }, []);

  const value = React.useMemo(
    () => ({ isOpen, toggle, close }),
    [isOpen, toggle, close],
  );

  return (
    <TerminalContext.Provider value={value}>
      {children}
    </TerminalContext.Provider>
  );
}

export function useTerminal(): TerminalContextValue {
  return React.useContext(TerminalContext);
}
