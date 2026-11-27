import { Link, NavLink, Outlet } from "react-router";
import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { config } from "../lib/config.ts";

export function Wordmark() {
  return (
    <span className="wordmark">
      chek<span className="tick" aria-hidden>✓</span>
    </span>
  );
}

export function Layout() {
  return (
    <>
      {config.demo && (
        <p className="banner" role="status">
          Demo data · no wallet needed · the checks run for real
        </p>
      )}
      <header className="top">
        <div className="wrap top-inner">
          <NavLink to="/" className="brand" aria-label="Chek home"><Wordmark /></NavLink>
          <nav>
            <NavLink to="/" end>Giveaways</NavLink>
            <NavLink to="/create">Create</NavLink>
            <NavLink to="/mine">Mine</NavLink>
          </nav>
          <div className="connect">{config.demo ? <Link className="pill lime small" to="/create">Create</Link> : <ConnectButton />}</div>
        </div>
      </header>
      <main>
        <Outlet />
      </main>
      <footer className="foot">
        <div className="wrap foot-inner">
          <Wordmark />
          <span className="muted small">Provably fair X giveaways on Sui · <a href="https://github.com/linoxbt/chek">Source</a></span>
        </div>
      </footer>
    </>
  );
}
