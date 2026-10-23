import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";

if ("caches" in window) {
  void window.caches.delete("maxform-api-cache");
}

createRoot(document.getElementById("root")!).render(<App />);
