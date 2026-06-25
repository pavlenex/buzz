import { SecretRevealDialog } from "@/features/agents/ui/SecretRevealDialog";
import type { CreateManagedAgentResponse } from "@/shared/api/types";
import React from "react";

export function useCreatedAgentSecretReveal() {
  const [createdAgent, setCreatedAgent] =
    React.useState<CreateManagedAgentResponse | null>(null);

  return {
    createdAgentSecretDialog: createdAgent ? (
      <SecretRevealDialog
        created={createdAgent}
        onOpenChange={(open) => {
          if (!open) {
            setCreatedAgent(null);
          }
        }}
      />
    ) : null,
    setCreatedAgent,
  };
}
