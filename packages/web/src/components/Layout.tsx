import { Link, NavLink, Outlet } from "react-router";
import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { config } from "../lib/config.ts";
import { Dot, Logo } from "./ui.tsx";

export function Layout() {
  return (
    <>
      {config.demo && (
        <p className="banner mono" role="status">
          <Dot tone="warn" /> Demo data · no wallet needed · every check runs for real
        </p>
      )}
      <header className="top">
        <div className="wrap top-inner">
          <NavLink to="/" className="brand" aria-label="Chek home"><Logo /></NavLink>
          <nav>
            <NavLink to="/" end>Giveaways</NavLink>
            <NavLink to="/create">Create</NavLink>
            <NavLink to="/mine">Mine</NavLink>
            <a href="https://github.com/linoxbt/chek">Source</a>
          </nav>
          <div className="connect">{config.demo ? <Link className="btn dark small" to="/create">Get started <span aria-hidden>→</span></Link> : <ConnectButton />}</div>
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
              <Link to="/">Giveaways</Link>
              <Link to="/create">Create</Link>
              <Link to="/mine">Mine</Link>
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
