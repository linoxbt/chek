import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { config } from "../lib/config.ts";
import { GiveawayTable } from "../components/GiveawayTable.tsx";
import { reader } from "../lib/app.ts";
import { ErrorBox } from "../components/bits.tsx";
import { Empty, SkeletonRows } from "../components/states.tsx";

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
        <Empty title="Connect a wallet">Giveaways you organize show up here once your wallet is connected.</Empty>
      ) : q.isPending ? (
        <SkeletonRows n={3} />
      ) : q.error ? (
        <ErrorBox error={q.error} />
      ) : (
        <GiveawayTable rows={q.data} draftsToPost empty={{ title: "No giveaways yet", text: "Lock a prize and post it on X in a few minutes.", action: { to: "/create", label: "New giveaway" } }} />
      )}
    </div>
  );
}
