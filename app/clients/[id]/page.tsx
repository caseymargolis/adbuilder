import Link from "next/link";
import { getClient } from "@/lib/db";
import ClientWorkspace from "./workspace";

export default async function ClientPage({ params }: { params: { id: string } }) {
  const client = await getClient(params.id);
  if (!client) {
    return (
      <div className="card p-8">
        <h1 className="font-display text-2xl">We don't know that client.</h1>
        <p className="text-[color:var(--muted)] mt-2">
          Maybe it was deleted, or the URL is wrong.
        </p>
        <Link href="/clients" className="btn btn-primary mt-4 inline-flex">
          Back to clients
        </Link>
      </div>
    );
  }
  return <ClientWorkspace initialClient={client} />;
}
