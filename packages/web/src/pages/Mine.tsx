import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { config } from "../lib/config.ts";
import { GiveawayTable } from "../components/GiveawayTable.tsx";
import { reader } from "../lib/app.ts";
import { ErrorBox, Loading } from "../components/bits.tsx";

export function Mine() {
  const account = useCurrentAccount();
  const owner = config.demo ? "demo" : account?.address;
  const q = useQuery({
    queryKey: ["mine", owner],
    enabled: !!owner,
    queryFn: async () => {
      const caps = await reader.organizerCaps(owner!);
      const all = await reader.campaigns();
      return all.filter((c) => caps.has(c.id));
    },
  });
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1 className="app-title">My giveaways</h1>
          <p className="dim">Giveaways your wallet organizes. Drafts open on the post step.</p>
        </div>
        <Link className="btn coral small" to="/create">New giveaway <span aria-hidden>→</span></Link>
      </div>
      {!owner ? (
        <p className="dim">Connect a wallet to see the giveaways you created.</p>
      ) : q.isPending ? (
        <Loading what="your giveaways" />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <GiveawayTable rows={q.data} draftsToPost empty="None yet. Create one to get started." />
      )}
    </div>
  );
}
