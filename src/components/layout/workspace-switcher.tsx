"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Loader2 } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
} from "@/components/ui/select";
import { switchWorkspace } from "@/lib/actions/workspaces";
import type { Workspace } from "@/lib/types";

type Props = {
  workspaces: Workspace[];
  activeId: string;
  demo: boolean;
};

function roleLabel(workspace: Workspace) {
  if (workspace.role === "owner") return "Owner";
  return workspace.role === "editor" ? "Editor" : "Viewer";
}

export function WorkspaceSwitcher({ workspaces, activeId, demo }: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const active = workspaces.find((workspace) => workspace.id === activeId) ?? workspaces[0];

  function change(next: string) {
    if (next === activeId) return;
    startTransition(async () => {
      const result = await switchWorkspace(next);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Workspace switched");
      router.refresh();
    });
  }

  if (!active) return null;

  if (workspaces.length <= 1) {
    return (
      <div className="mb-4 flex items-center gap-2.5 rounded-xl border border-sidebar-border bg-muted/40 px-3 py-2.5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
          <Building2 className="size-4" />
        </span>
        <div className="min-w-0">
          <p className="truncate text-[12px] font-semibold">{active.name}</p>
          <p className="text-muted-foreground text-[10px]">{roleLabel(active)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="mb-4">
      <p className="text-muted-foreground mb-1.5 px-1 text-[9.5px] font-semibold tracking-wider uppercase">
        Workspace
      </p>
      <Select value={activeId} onValueChange={change} disabled={demo || pending}>
        <SelectTrigger className="h-auto w-full gap-2 rounded-xl px-3 py-2.5 text-left">
          <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary">
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Building2 className="size-4" />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-semibold">{active.name}</span>
            <span className="text-muted-foreground block text-[10px]">{roleLabel(active)}</span>
          </span>
        </SelectTrigger>
        <SelectContent>
          {workspaces.map((workspace) => (
            <SelectItem key={workspace.id} value={workspace.id}>
              <span className="flex w-full items-center gap-2">
                <span className="truncate">{workspace.name}</span>
                <span className="text-muted-foreground text-[10px]">{roleLabel(workspace)}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
