import { NavLink, Outlet } from "react-router";
import { ConnectButton } from "@mysten/dapp-kit-react/ui";
import { config } from "../lib/config.ts";

export function Layout() {
  return (
    <>
      <header className="top">
        <NavLink to="/" className="brand" aria-label="Chek home">
          <span className="mark" aria-hidden>✓</span>Chek
        </NavLink>
        <nav>
          <NavLink to="/" end>Giveaways</NavLink>
          <NavLink to="/create">Create</NavLink>
          <NavLink to="/mine">Mine</NavLink>
        </nav>
        <div className="connect">{!config.demo && <ConnectButton />}</div>
      </header>
      {config.demo && (
        <p className="banner" role="status">
          Demo mode: sample data, no wallet needed. The checks on each giveaway page run for real on that data.
        </p>
      )}
      <main>
        <Outlet />
      </main>
      <footer>
        Provably fair X giveaways on Sui · <a href="https://github.com/linoxbt/chek">Source</a>
      </footer>
    </>
  );
}
