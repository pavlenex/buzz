import * as React from "react";
import { toast } from "sonner";

import {
  useAcpRuntimesQuery,
  useCreatePersonaMutation,
} from "@/features/agents/hooks";
import type {
  CreatePersonaInput,
  ManagedAgent,
  UpdatePersonaInput,
} from "@/shared/api/types";
import {
  saveAsPersonaTemplateDialogState,
  type PersonaDialogState,
} from "./personaDialogState";

/**
 * Self-contained "Save as persona template" flow for surfaces outside the
 * Agents page (e.g. the sidebar agent profile) that don't already host
 * `usePersonaActions`. Opens the shared `PersonaDialog` prefilled from an
 * agent and creates a backend persona on submit — no new backend or IPC.
 *
 * "Persona template" is the UI name for what the backend calls a `persona`
 * (kind:30175); this hook produces a `CreatePersonaInput`.
 */
export function useSaveAsPersonaTemplate() {
  const [dialogState, setDialogState] =
    React.useState<PersonaDialogState | null>(null);
  // Only fetch runtimes once the user actually opens the dialog.
  const [shouldLoadRuntimes, setShouldLoadRuntimes] = React.useState(false);
  const acpRuntimesQuery = useAcpRuntimesQuery({ enabled: shouldLoadRuntimes });
  const createPersonaMutation = useCreatePersonaMutation();

  const open = React.useCallback(
    (agent: ManagedAgent) => {
      setShouldLoadRuntimes(true);
      setDialogState(
        saveAsPersonaTemplateDialogState(agent, acpRuntimesQuery.data ?? []),
      );
    },
    [acpRuntimesQuery.data],
  );

  const close = React.useCallback(() => {
    setDialogState(null);
  }, []);

  const handleSubmit = React.useCallback(
    async (input: CreatePersonaInput | UpdatePersonaInput) => {
      // The save-as flow only ever produces a create input.
      if ("id" in input) return;
      try {
        await createPersonaMutation.mutateAsync(input);
        toast.success(`Saved ${input.displayName} as a persona template.`);
        setDialogState(null);
      } catch (error) {
        toast.error(
          error instanceof Error
            ? error.message
            : "Failed to save persona template.",
        );
      }
    },
    [createPersonaMutation],
  );

  return {
    open,
    dialogState,
    dialogProps: {
      open: dialogState !== null,
      title: dialogState?.title ?? "",
      description: dialogState?.description ?? "",
      submitLabel: dialogState?.submitLabel ?? "",
      initialValues: dialogState?.initialValues ?? null,
      error:
        createPersonaMutation.error instanceof Error
          ? createPersonaMutation.error
          : null,
      isPending: createPersonaMutation.isPending,
      runtimes: acpRuntimesQuery.data ?? [],
      runtimesLoading: acpRuntimesQuery.isLoading,
      onOpenChange: (next: boolean) => {
        if (!next) close();
      },
      onSubmit: handleSubmit,
    },
  };
}
