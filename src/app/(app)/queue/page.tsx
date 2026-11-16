import type { Metadata } from "next";
import { ListOrdered } from "lucide-react";
import { PageHeader } from "@/components/shared/page-header";
import { QueueView } from "@/components/queue/queue-view";
import { getQueueData } from "@/lib/data/queue";

export const metadata: Metadata = { title: "Queue" };
export const dynamic = "force-dynamic";

export default async function QueuePage() {
  const data = await getQueueData();

  return (
    <div>
      <PageHeader
        eyebrow={
          <>
            <ListOrdered className="size-3.5" />
            {data.settings.timezone}
          </>
        }
        title="Your automatic publishing rhythm"
        description="A live queue of everything left to publish. New posts take the next open slot, and pausing never loses your place."
      />
      <QueueView data={data} />
    </div>
  );
}
