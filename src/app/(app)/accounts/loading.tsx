import { Skeleton } from "@/components/ui/skeleton";

export default function AccountsLoading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-3 w-36" />
        <Skeleton className="h-8 w-80 max-w-full" />
        <Skeleton className="h-3 w-[460px] max-w-full" />
      </div>
      <Skeleton className="h-64 w-full rounded-2xl" />
      <div className="grid gap-4 lg:grid-cols-3">
        <Skeleton className="h-60 rounded-2xl lg:col-span-2" />
        <Skeleton className="h-60 rounded-2xl" />
      </div>
    </div>
  );
}
