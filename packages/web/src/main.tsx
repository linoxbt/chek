import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { DAppKitProvider } from "@mysten/dapp-kit-react";
import { dAppKit } from "./lib/app.ts";
import { Layout } from "./components/Layout.tsx";
import { Home } from "./pages/Home.tsx";
import { Create } from "./pages/Create.tsx";
import { Post } from "./pages/Post.tsx";
import { Verify } from "./pages/Verify.tsx";
import { Mine } from "./pages/Mine.tsx";
import "@fontsource-variable/inter";
import "./styles.css";

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: <Home /> },
      { path: "/create", element: <Create /> },
      { path: "/mine", element: <Mine /> },
      { path: "/g/:id", element: <Verify /> },
      { path: "/g/:id/post", element: <Post /> },
      { path: "*", element: <p>Page not found.</p> },
    ],
  },
]);

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <DAppKitProvider dAppKit={dAppKit}>
        <RouterProvider router={router} />
      </DAppKitProvider>
    </QueryClientProvider>
  </StrictMode>,
);
