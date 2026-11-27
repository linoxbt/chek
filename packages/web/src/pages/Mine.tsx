import { Link } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { useCurrentAccount } from "@mysten/dapp-kit-react";
import { Status } from "@chek/core";
import { config } from "../lib/config.ts";
import { reader } from "../lib/app.ts";
import { ErrorBox, Loading, prizeText, StatusBadge, when } from "../components/bits.tsx";

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
  if (!owner) return <p className="wrap section-sm">Connect a wallet to see the giveaways you created.</p>;
  if (q.isPending) return <div className="wrap section-sm"><Loading what="your giveaways" /></div>;
  if (q.error) return <div className="wrap section-sm"><ErrorBox error={q.error} /></div>;
  return (
    <div className="wrap section-sm">
      <p className="eyebrow">Organizer</p>
      <h1 className="page-title">My giveaways</h1>
      {q.data.length === 0 && <p className="muted">None yet. <Link to="/create">Create one</Link>.</p>}
      <ul className="cards">
        {q.data.map((c) => (
          <li key={c.id}>
            <div className="card">
              <div className="row"><StatusBadge status={c.status} /></div>
              <strong className="card-prize">{prizeText(c)}</strong>
              <span className="muted small">Closes {when(c.closesAt)}</span>
              <div className="row">
                {c.status === Status.DRAFT ? <Link className="pill lime small" to={`/g/${c.id}/post`}>Post and open</Link> : <Link className="pill outline small" to={`/g/${c.id}`}>View</Link>}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
