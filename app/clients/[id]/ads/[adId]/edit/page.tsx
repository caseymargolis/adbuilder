import Link from "next/link";
import { getClient } from "@/lib/db";
import VideoEditor from "./editor";

export default async function EditPage({
  params,
}: {
  params: { id: string; adId: string };
}) {
  const client = await getClient(params.id);
  const ad = client?.ads.find((a) => a.id === params.adId);
  if (!client || !ad) {
    return (
      <div className="card p-8">
        <h1 className="font-display text-2xl">Ad not found.</h1>
        <Link href={`/clients/${params.id}`} className="btn btn-primary mt-4 inline-flex">
          Back to client
        </Link>
      </div>
    );
  }
  return <VideoEditor client={client} ad={ad} />;
}
