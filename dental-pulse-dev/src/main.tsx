import { createRoot } from "react-dom/client";
import { HelmetProvider } from 'react-helmet-async';
import dayjs from "dayjs";
import updateLocale from "dayjs/plugin/updateLocale";
import App from "./App.tsx";
import "./index.css";
import { SITE_LOGOS } from "./lib/integrationLogos";

// Make every Ant Design DatePicker (which uses dayjs internally) and any
// other dayjs consumer start the week on Monday.
dayjs.extend(updateLocale);
dayjs.updateLocale("en", { weekStart: 1 });

// Set favicon dynamically from Supabase storage
const faviconEl = document.querySelector("link[rel='icon']") as HTMLLinkElement;
if (faviconEl) faviconEl.href = SITE_LOGOS.favicon;

createRoot(document.getElementById("root")!).render( <HelmetProvider>
    <App />
    </HelmetProvider>
);
