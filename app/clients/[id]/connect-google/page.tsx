import Link from "next/link";
import { getClient } from "@/lib/db";
import { googleOAuthConfigured } from "@/lib/google-oauth";
import Picker from "./picker";

export default async function ConnectGooglePage({
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

  if (!googleOAuthConfigured()) {
    return (
      <div className="card p-8 max-w-2xl">
        <h1 className="font-display text-2xl font-semibold">
          Google Ads OAuth isn't configured.
        </h1>
        <p className="text-[color:var(--muted)] mt-2">
          Set <code>GOOGLE_OAUTH_CLIENT_ID</code>,{" "}
          <code>GOOGLE_OAUTH_CLIENT_SECRET</code>, and{" "}
          <code>GOOGLE_ADS_DEVELOPER_TOKEN</code> on the server. Add{" "}
          <code>{`{APP_BASE_URL}/api/google/oauth/callback`}</code> as an
          authorized redirect URI in your Google Cloud OAuth client. See{" "}
          <code>DEPLOY.md</code>.
        </p>
        <Link href={`/clients/${client.id}`} className="btn btn-ghost mt-4 inline-flex">
          Back to client
        </Link>
      </div>
    );
  }

  if (!client.googleOAuth) {
    return (
      <div className="card p-8 max-w-xl">
        <h1 className="font-display text-2xl font-semibold">
          Connect {client.name} to Google Ads
        </h1>
        <p className="text-[color:var(--muted)] mt-2">
          Sign in with the Google account that has access to the client's
          Google Ads customer (or their MCC manager account). We get a
          long-lived refresh token, persist it encrypted, and mint short-lived
          access tokens on demand.
        </p>
        <div className="mt-5 flex gap-3">
          <a
            href={`/api/google/oauth/start?clientId=${client.id}`}
            className="btn btn-primary"
          >
            Connect with Google →
          </a>
          <Link href={`/clients/${client.id}`} className="btn btn-ghost">
            Cancel
          </Link>
        </div>
      </div>
    );
  }

  return <Picker client={client} />;
}
