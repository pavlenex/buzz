import { invokeTauri } from "@/shared/api/tauri";
import type {
  AgentTeam,
  CreateTeamInput,
  UpdateTeamInput,
} from "@/shared/api/types";

type RawTeam = {
  id: string;
  name: string;
  description: string | null;
  instructions?: string | null;
  persona_ids: string[];
  is_builtin?: boolean;
  source_dir?: string | null;
  is_symlink?: boolean;
  symlink_target?: string | null;
  version?: string | null;
  created_at: string;
  updated_at: string;
};

function fromRawTeam(team: RawTeam): AgentTeam {
  return {
    id: team.id,
    name: team.name,
    description: team.description,
    instructions: team.instructions ?? null,
    personaIds: team.persona_ids,
    isBuiltin: team.is_builtin ?? false,
    sourceDir: team.source_dir ?? null,
    isSymlink: team.is_symlink ?? false,
    symlinkTarget: team.symlink_target ?? null,
    version: team.version ?? null,
    createdAt: team.created_at,
    updatedAt: team.updated_at,
  };
}

export async function listTeams(): Promise<AgentTeam[]> {
  return (await invokeTauri<RawTeam[]>("list_teams")).map(fromRawTeam);
}

export async function createTeam(input: CreateTeamInput): Promise<AgentTeam> {
  return fromRawTeam(
    await invokeTauri<RawTeam>("create_team", {
      input: {
        name: input.name,
        description: input.description,
        instructions: input.instructions,
        personaIds: input.personaIds,
      },
    }),
  );
}

export async function updateTeam(input: UpdateTeamInput): Promise<AgentTeam> {
  return fromRawTeam(
    await invokeTauri<RawTeam>("update_team", {
      input: {
        id: input.id,
        name: input.name,
        description: input.description,
        instructions: input.instructions,
        personaIds: input.personaIds,
      },
    }),
  );
}

export async function deleteTeam(id: string): Promise<void> {
  await invokeTauri("delete_team", { id });
}
