import { LayoutGrid, List, Search } from "lucide-react";

import type {
  ProjectsFilter,
  ProjectsViewMode,
} from "@/features/projects/lib/projectsViewHelpers";
import { Button } from "@/shared/ui/button";

type ProjectsToolbarProps = {
  filter: ProjectsFilter;
  onFilterChange: (filter: ProjectsFilter) => void;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
};

export function ProjectsViewModeToggle({
  viewMode,
  onViewModeChange,
}: {
  viewMode: ProjectsViewMode;
  onViewModeChange: (viewMode: ProjectsViewMode) => void;
}) {
  return (
    <fieldset className="flex items-center rounded-lg bg-muted/30 p-0.5">
      <legend className="sr-only">Project layout</legend>
      <Button
        aria-label="Grid layout"
        aria-pressed={viewMode === "grid"}
        className="h-7 w-7 px-0"
        onClick={() => onViewModeChange("grid")}
        size="xs"
        type="button"
        variant={viewMode === "grid" ? "secondary" : "ghost"}
      >
        <LayoutGrid className="h-3.5 w-3.5" />
      </Button>
      <Button
        aria-label="List layout"
        aria-pressed={viewMode === "list"}
        className="h-7 w-7 px-0"
        onClick={() => onViewModeChange("list")}
        size="xs"
        type="button"
        variant={viewMode === "list" ? "secondary" : "ghost"}
      >
        <List className="h-3.5 w-3.5" />
      </Button>
    </fieldset>
  );
}

export function ProjectsToolbar({
  filter,
  onFilterChange,
  searchOpen,
  onSearchOpenChange,
}: ProjectsToolbarProps) {
  const filterOptions: Array<{ label: string; value: ProjectsFilter }> = [
    { label: "Overview", value: "all" },
    { label: "Repositories", value: "repositories" },
    { label: "Pull Requests", value: "prs" },
    { label: "Issues", value: "issues" },
    { label: "Mine", value: "mine" },
    { label: "Local", value: "local" },
    { label: "Agents", value: "agents" },
    { label: "Users", value: "users" },
  ];

  return (
    <div
      className="pointer-events-auto flex min-h-[3.25rem] flex-wrap items-center justify-between gap-3 px-4 py-2"
      data-tauri-drag-region
    >
      <div className="flex min-w-0 flex-wrap items-center gap-0.5">
        <Button
          aria-expanded={searchOpen}
          aria-label="Ask an agent about your projects"
          className="h-8 w-8 rounded-full px-0"
          onClick={() => onSearchOpenChange(!searchOpen)}
          size="sm"
          type="button"
          variant={searchOpen ? "secondary" : "ghost"}
        >
          <Search className="h-4 w-4" />
        </Button>
        <fieldset className="flex min-w-0 flex-wrap items-center gap-0.5">
          <legend className="sr-only">Project owner filter</legend>
          {filterOptions.map((option) => (
            <Button
              aria-pressed={filter === option.value}
              className="h-8 gap-1.5 rounded-full px-3 text-sm"
              key={option.value}
              onClick={() => onFilterChange(option.value)}
              size="sm"
              type="button"
              variant={filter === option.value ? "secondary" : "ghost"}
            >
              {option.label}
            </Button>
          ))}
        </fieldset>
      </div>
    </div>
  );
}
