"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Crown, Loader2, Mail, Trash2, UserPlus, Users } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  cancelWorkspaceInvite,
  inviteWorkspaceMember,
  removeWorkspaceMember,
  updateWorkspaceMemberRole,
} from "@/lib/actions/workspaces";
import type { Workspace, WorkspaceInvite, WorkspaceMember } from "@/lib/types";
import { initials } from "@/lib/utils";

type Props = {
  workspace: Workspace;
  members: WorkspaceMember[];
  invites: WorkspaceInvite[];
  currentUserId: string;
  demo: boolean;
};

export function MembersCard({
  workspace,
  members,
  invites,
  currentUserId,
  demo,
}: Props) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"editor" | "viewer">("editor");
  const [pending, startTransition] = useTransition();
  const isOwner = workspace.role === "owner";

  function invite() {
    if (!email.trim()) {
      toast.error("Enter an email address.");
      return;
    }
    startTransition(async () => {
      const result = await inviteWorkspaceMember({ email: email.trim(), role });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Invite sent");
      setEmail("");
      router.refresh();
    });
  }

  function changeRole(userId: string, next: "editor" | "viewer") {
    startTransition(async () => {
      const result = await updateWorkspaceMemberRole({ userId, role: next });
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Role updated");
      router.refresh();
    });
  }

  function remove(userId: string, name: string | null) {
    startTransition(async () => {
      const result = await removeWorkspaceMember(userId);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(`${name ?? "Member"} removed`);
      router.refresh();
    });
  }

  function cancelInvite(id: string) {
    startTransition(async () => {
      const result = await cancelWorkspaceInvite(id);
      if (!result.ok) {
        toast.error(result.error);
        return;
      }
      toast.success(result.message ?? "Invite cancelled");
      router.refresh();
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Users className="size-4 text-primary" /> Members &amp; collaborators
        </CardTitle>
        <CardDescription>
          Everyone here works in <span className="font-medium text-foreground">{workspace.name}</span>.
          Editors see every account, plan, post and report, and can publish too. Viewers can look but
          not change anything.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isOwner && (
          <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
            <Label htmlFor="invite-email" className="mb-2 block">
              Invite a teammate
            </Label>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="invite-email"
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="teammate@company.com"
                disabled={demo || pending}
                className="flex-1"
              />
              <Select
                value={role}
                onValueChange={(value) => setRole(value as "editor" | "viewer")}
                disabled={demo || pending}
              >
                <SelectTrigger className="sm:w-32" aria-label="Invite role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="editor">Editor</SelectItem>
                  <SelectItem value="viewer">Viewer</SelectItem>
                </SelectContent>
              </Select>
              <Button onClick={invite} disabled={demo || pending} variant="gradient">
                {pending ? <Loader2 className="size-4 animate-spin" /> : <UserPlus className="size-4" />}
                Invite
              </Button>
            </div>
            <p className="text-muted-foreground mt-2 text-[10.5px] leading-relaxed">
              Existing LINKFLOW users join instantly. New emails are accepted automatically when they
              sign up with that address.
            </p>
          </div>
        )}

        <div className="space-y-1.5">
          {members.map((member) => {
            const isCurrentUser = member.user_id === currentUserId;
            const isWorkspaceOwner = member.role === "owner";
            return (
              <div
                key={member.user_id}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-border/70 px-3 py-2.5"
              >
                <Avatar className="size-8">
                  {member.avatar_url ? <AvatarImage src={member.avatar_url} alt="" /> : null}
                  <AvatarFallback className="brand-gradient text-[10px] font-bold text-white">
                    {initials(member.full_name ?? member.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-semibold">
                    {member.full_name ?? member.email ?? "Teammate"}
                    {isCurrentUser && (
                      <span className="text-muted-foreground ml-1.5 text-[10px] font-normal">(you)</span>
                    )}
                  </p>
                  <p className="text-muted-foreground truncate text-[10.5px]">
                    {member.email ?? "No email on file"}
                  </p>
                </div>
                {isWorkspaceOwner ? (
                  <Badge variant="outline" className="gap-1">
                    <Crown className="size-3" /> Owner
                  </Badge>
                ) : isOwner ? (
                  <div className="flex items-center gap-1.5">
                    <Select
                      value={member.role}
                      onValueChange={(value) => changeRole(member.user_id, value as "editor" | "viewer")}
                      disabled={demo || pending}
                    >
                      <SelectTrigger className="h-7 w-[100px] text-[11px]" aria-label="Member role">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="editor">Editor</SelectItem>
                        <SelectItem value="viewer">Viewer</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="size-7 text-muted-foreground hover:text-destructive"
                      onClick={() => remove(member.user_id, member.full_name)}
                      disabled={demo || pending}
                      aria-label={`Remove ${member.full_name ?? member.email ?? "member"}`}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                ) : (
                  <Badge variant="outline" className="capitalize">
                    {member.role}
                  </Badge>
                )}
              </div>
            );
          })}
        </div>

        {isOwner && invites.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-muted-foreground text-[10.5px] font-semibold tracking-wider uppercase">
              Pending invites
            </p>
            {invites.map((invite) => (
              <div
                key={invite.id}
                className="flex items-center gap-3 rounded-xl border border-dashed border-border px-3 py-2.5"
              >
                <span className="grid size-8 place-items-center rounded-full bg-muted text-muted-foreground">
                  <Mail className="size-3.5" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[12.5px] font-medium">{invite.email}</p>
                  <p className="text-muted-foreground text-[10.5px] capitalize">
                    {invite.role} · joins on signup
                  </p>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  className="size-7 text-muted-foreground hover:text-destructive"
                  onClick={() => cancelInvite(invite.id)}
                  disabled={demo || pending}
                  aria-label={`Cancel invite for ${invite.email}`}
                >
                  <Trash2 className="size-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
