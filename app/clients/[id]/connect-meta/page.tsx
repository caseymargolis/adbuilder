import Link from "next/link";
import { getClient } from "@/lib/db";
import { metaOAuthConfigured } from "@/lib/meta-oauth";
import Picker from "./picker";

export default async function ConnectMetaPage({
  params,
}: {
  params: { id: string };
}) {
  const client = await getClient(params.id);
  if (!client) {
    return (
      <div className="card p-8">
        <h1 className="font-display text-2xl">Client not found.</h1>
        <Link href="/clients" className="btn btn-primary mt-4 inline-flex">
          Back to clients
        </Link>
      </div>
    );
  }

  if (!metaOAuthConfigured()) {
    return (
      <div className="card p-8 max-w-2xl">
        <h1 className="font-display text-2xl font-semibold">
          Meta OAuth isn't configured.
        </h1>
        <p className="text-[color:var(--muted)] mt-2">
          Set <code>META_APP_ID</code> and <code>META_APP_SECRET</code> on
          the server, plus add{" "}
          <code>{`{APP_BASE_URL}/api/meta/oauth/callback`}</code> to your
          Meta app's "Valid OAuth Redirect URIs". See <code>DEPLOY.md</code>.
        </p>
        <p className="text-[color:var(--muted)] mt-3">
          In the meantime, you can paste the IDs manually on the intake form.
        </p>
        <Link
          href={`/clients/${client.id}`}
          className="btn btn-ghost mt-4 inline-flex"
        >
          Back to client
        </Link>
      </div>
    );
  }

  if (!client.metaOAuth) {
    // Hasn't gone through OAuth yet — show the connect button.
    return (
      <div className="card p-8 max-w-xl">
        <h1 className="font-display text-2xl font-semibold">
          Connect {client.name} to Meta
        </h1>
        <p className="text-[color:var(--muted)] mt-2">
          One-click sign-in via Meta Business Login. We'll request the minimum
          scopes needed to launch and manage ads, then you'll pick which ad
          account and page to use.
        </p>
        <div className="mt-5 flex gap-3">
          <a
            href={`/api/meta/oauth/start?clientId=${client.id}`}
            className="btn btn-primary"
          >
            Connect with Meta →
          </a>
          <Link
            href={`/clients/${client.id}`}
            className="btn btn-ghost"
          >
            Cancel
          </Link>
        </div>
        <ul className="mt-6 text-xs text-[color:var(--muted)] list-disc ml-5">
          <li>You'll be sent to facebook.com to approve.</li>
          <li>The token is encrypted at rest, refreshed before expiry.</li>
          <li>You can disconnect anytime from the workspace.</li>
        </ul>
      </div>
    );
  }

  // Has OAuth — show the picker.
  return <Picker client={client} />;
}
