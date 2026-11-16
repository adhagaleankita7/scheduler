"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { disconnectAccount } from "@/lib/actions/accounts";

export function DisconnectAccountButton({
  accountId,
  accountName,
  disabled,
}: {
  accountId: string;
  accountName: string;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, startTransition] = useTransition();

  function disconnect() {
    startTransition(async () => {
      const result = await disconnectAccount(accountId);
      if (result.ok) {
        toast.success(result.message ?? "Account disconnected");
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="text-destructive hover:text-destructive"
      >
        <Unplug className="size-3.5" /> Disconnect
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Disconnect {accountName}?</DialogTitle>
            <DialogDescription>
              LINKFLOW will delete the OAuth tokens from Supabase Vault and remove this account and
              its company pages. Scheduled posts stay in your workspace but cannot publish until you
              reconnect a LinkedIn target.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>
              Keep connected
            </Button>
            <Button variant="destructive" onClick={disconnect} disabled={pending}>
              {pending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Unplug className="size-4" />
              )}
              Disconnect account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
