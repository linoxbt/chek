import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentAccount, useDAppKit } from "@mysten/dapp-kit-react";
import { Status } from "@chek/core";
import { config } from "../lib/config.ts";
import { cancelTx, openTx } from "../lib/organizer.ts";
import { giveawayLink, parsePostUrl, postTimeMs } from "../lib/post.ts";
import { chainIds, reader } from "../lib/app.ts";
import { Copy, ErrorBox, Field, Loading, prizeText, when } from "../components/bits.tsx";

export function Post() {
  const { id = "" } = useParams();
  const account = useCurrentAccount();
  const dAppKit = useDAppKit();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const owner = config.demo ? "demo" : account?.address;
  const q = useQuery({
    queryKey: ["post", id, owner],
    queryFn: async () => ({ c: await reader.campaign(id), cap: owner ? (await reader.organizerCaps(owner)).get(id) : undefined }),
  });
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  if (q.isPending) return <Loading what="the giveaway" />;
  if (q.error) return <ErrorBox error={q.error} />;
  const { c, cap } = q.data;
  if (c.status !== Status.DRAFT) {
    return <p>This giveaway is already open. <Link to={`/g/${id}`}>View it</Link>.</p>;
  }

  const link = giveawayLink(config.linkOrigin, c.id);
  const text = `🎁 Giveaway: ${prizeText(c)} for ${c.k} winner${c.k === 1 ? "" : "s"}!\n\nReply with your Sui address or SuiNS name before ${when(c.closesAt)}.\n\nRules, entrants and proof of a fair draw: ${link}`;
  const postId = parsePostUrl(url);
  let urlProblem: string | null = null;
  if (url && !postId) urlProblem = "That isn't a link to an X post.";
  else if (postId && postTimeMs(postId) < c.createdAt) urlProblem = "That post is older than this giveaway. Post a new one with the link above.";
  else if (postId && postTimeMs(postId) > Date.now() + 60_000) urlProblem = "That post ID is in the future.";

  async function run(kind: "open" | "cancel") {
    setError(null);
    if (!cap) return;
    setBusy(true);
    try {
      const tx = kind === "open" ? openTx(chainIds, c.id, c.coinType, cap, postId!) : cancelTx(chainIds, c.id, c.coinType, cap);
      const res = await dAppKit.signAndExecuteTransaction({ transaction: tx });
      if (res.$kind === "FailedTransaction") throw new Error(res.FailedTransaction.status.error?.message ?? "The transaction failed.");
      await qc.invalidateQueries();
      navigate(`/g/${c.id}`);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="post">
      <h1>Post it on X</h1>
      <p>The prize is locked. Now post the giveaway from your X account. The post must contain this link, so anyone can tell this giveaway is the one it announced.</p>
      <Field label="Your giveaway link">
        <div className="copyrow"><code>{link}</code><Copy text={link} /></div>
      </Field>
      <Field label="Suggested post">
        <textarea readOnly rows={6} value={text} />
      </Field>
      <div className="row">
        <Copy text={text} label="Copy text" />
        <a className="button" href={`https://x.com/intent/post?text=${encodeURIComponent(text)}`} target="_blank" rel="noreferrer">Post on X</a>
      </div>

      <h2>Then paste the post's link</h2>
      <Field label="Post link" hint="Opening starts the giveaway. Replies to this post count until it closes.">
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://x.com/you/status/…" />
      </Field>
      {urlProblem && <p className="error">{urlProblem}</p>}
      {error !== null && <ErrorBox error={error} />}
      {config.demo ? (
        <p className="muted">Opening is off in demo mode.</p>
      ) : !cap ? (
        <p>Only the organizer's wallet can open this giveaway. Connect it to continue.</p>
      ) : (
        <div className="row">
          <button type="button" disabled={!postId || !!urlProblem || busy} onClick={() => void run("open")}>Open giveaway</button>
          <button type="button" className="ghost" disabled={busy} onClick={() => void run("cancel")}>Cancel and refund</button>
        </div>
      )}
    </article>
  );
}
