import { useEffect, useState } from "react";
import { Link, NavLink, Outlet, useLocation } from "react-router";
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

  return (
    <div className={`app${open ? " nav-open" : ""}`}>
      <aside className="sidebar" aria-label="App navigation">
        <Link to="/" className="brand side-brand" aria-label="Chek home"><Logo /></Link>
        <nav className="side-nav">
          <span className="mono-label">Workspace</span>
          <NavLink to="/app" end><GridIcon />Overview</NavLink>
          <NavLink to="/giveaways"><ListIcon />Giveaways</NavLink>
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
