import { Skeleton } from "@/components/ui/skeleton";

export default function PlannerLoading() {
  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Skeleton className="h-3 w-28" />
        <Skeleton className="h-8 w-80 max-w-full" />
        <Skeleton className="h-3 w-[420px] max-w-full" />
      </div>
      <Skeleton className="h-44 w-full rounded-2xl" />
      {Array.from({ length: 4 }).map((_, index) => (
        <Skeleton key={index} className="h-[136px] w-full rounded-2xl" />
      ))}
    </div>
  );
}
