import { useEffect, useState, type FormEvent } from "react";
import { Link, NavLink, Outlet, useLocation, useNavigate } from "react-router";
import { useQuery } from "@tanstack/react-query";
import { Status } from "@chek/core";
import { reader } from "../lib/app.ts";
import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { config } from "../lib/config.ts";
import { Dot, Logo } from "./ui.tsx";
import { BookIcon, CodeIcon, GridIcon, ListIcon, PlusIcon, UserIcon } from "./nav-icons.tsx";

/** Marketing site: header with section links, footer. Only the landing page uses it. */
export function LandingLayout() {
  return (
    <>
      <header className="top">
        <div className="wrap top-inner">
          <Link to="/" className="brand" aria-label="Chek home"><Logo /></Link>
          <nav>
            <a href="#protocol">Protocol</a>
            <a href="#how">How it works</a>
            <a href="#faq">FAQ</a>
            <Link to="/giveaways">Giveaways</Link>
          </nav>
          <div className="connect"><Link className="btn coral small" to="/app">Launch app <span aria-hidden>→</span></Link></div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="foot">
        <div className="wrap">
          <div className="foot-grid">
            <div>
              <Logo />
              <p className="dim small">Provably fair X giveaways on Sui.</p>
              <span className="mono-label ok-label"><Dot tone="ok" /> {config.demo ? "Demo mode" : `${config.network} · live`}</span>
            </div>
            <div>
              <span className="mono-label">App</span>
              <Link to="/app">Overview</Link>
              <Link to="/giveaways">Giveaways</Link>
              <Link to="/create">Create</Link>
            </div>
            <div>
              <span className="mono-label">Proof</span>
              <a href="https://github.com/linoxbt/chek/blob/main/docs/web.md">How Verify works</a>
              <a href="https://github.com/linoxbt/chek/blob/main/docs/contracts.md">Contracts</a>
              <a href="https://github.com/linoxbt/chek/blob/main/docs/rules-reference.md">Rules reference</a>
            </div>
            <div>
              <span className="mono-label">Built on</span>
              <a href="https://sui.io">Sui</a>
              <a href="https://walrus.xyz">Walrus</a>
              <a href="https://github.com/MystenLabs/nautilus">Nautilus</a>
            </div>
          </div>
          <div className="foot-base mono">
            <span>© 2026 Chek · provably fair giveaways</span>
            <a href="https://github.com/linoxbt/chek">github ↗</a>
          </div>
        </div>
      </footer>
    </>
  );
}

const TITLES: [RegExp, string][] = [
  [/^\/app\/?$/, "Overview"],
  [/^\/giveaways/, "Giveaways"],
  [/^\/create/, "New giveaway"],
  [/^\/mine/, "My giveaways"],
  [/^\/g\/[^/]+\/post/, "Post and open"],
  [/^\/g\//, "Verify"],
];

/** The app: sidebar + top bar console shell, no footer. */
export function AppLayout() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => {
    setOpen(false);
    window.scrollTo(0, 0);
  }, [pathname]);
  const title = TITLES.find(([re]) => re.test(pathname))?.[1] ?? "Chek";
  const list = useQuery({ queryKey: ["campaigns"], queryFn: () => reader.campaigns() });
  const openCount = list.data?.filter((c) => c.status === Status.OPEN).length;

  return (
    <div className={`app${open ? " nav-open" : ""}`}>
      <aside className="sidebar" aria-label="App navigation">
        <Link to="/" className="brand side-brand" aria-label="Chek home"><Logo /></Link>
        <nav className="side-nav">
          <span className="mono-label">Workspace</span>
          <NavLink to="/app" end><GridIcon />Overview</NavLink>
          <NavLink to="/giveaways"><ListIcon />Giveaways{openCount ? <span className="nav-badge" title={`${openCount} open`}>{openCount}</span> : null}</NavLink>
          <NavLink to="/create"><PlusIcon />New giveaway</NavLink>
          <span className="mono-label">Organizer</span>
          <NavLink to="/mine"><UserIcon />My giveaways</NavLink>
          <span className="mono-label">Resources</span>
          <a href="https://github.com/linoxbt/chek/blob/main/docs/web.md"><BookIcon />How Verify works</a>
          <a href="https://github.com/linoxbt/chek"><CodeIcon />Source</a>
        </nav>
        <div className="side-status">
          <span className="mono-label ok-label"><Dot tone={config.demo ? "warn" : "ok"} /> {config.demo ? "Demo data" : `Sui ${config.network}`}</span>
          <span className="dim small">{config.demo ? "Checks run for real on sample data." : "Reading the chain and Walrus directly."}</span>
        </div>
      </aside>
      <button type="button" className="scrim" aria-label="Close menu" onClick={() => setOpen(false)} />
      <div className="app-col">
        <header className="app-top">
          <button type="button" className="menu-btn" aria-label="Open menu" aria-expanded={open} onClick={() => setOpen(true)}>
            <span /><span /><span />
          </button>
          <Link to="/" className="brand top-brand" aria-label="Chek home"><Logo /></Link>
          <span className="crumb mono"><span className="dim">chek /</span> {title}</span>
          <GoTo />
          <div className="top-actions">
            {config.demo && <span className="chip mono demo-chip"><Dot tone="warn" /> demo data</span>}
            {!config.demo && <ConnectButton />}
          </div>
        </header>
        <main className="app-main">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/** Paste a giveaway ID or its link (chek…/g/0x…) to jump straight to it. */
function GoTo() {
  const navigate = useNavigate();
  const [v, setV] = useState("");
  const [bad, setBad] = useState(false);
  function submit(e: FormEvent) {
    e.preventDefault();
    const m = /(0x[0-9a-fA-F]{1,64})/.exec(v.trim());
    if (!m) {
      setBad(true);
      return;
    }
    setBad(false);
    setV("");
    navigate(`/g/${m[1]!.toLowerCase()}`);
  }
  return (
    <form className={`goto${bad ? " bad" : ""}`} onSubmit={submit} role="search">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4.2-4.2" /></svg>
      <input value={v} onChange={(e) => { setV(e.target.value); setBad(false); }} placeholder="Go to giveaway: paste an ID or link" aria-label="Go to giveaway by ID or link" />
      <kbd className="mono">↵</kbd>
    </form>
  );
}
