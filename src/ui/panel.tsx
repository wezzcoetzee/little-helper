import { createRoot } from "react-dom/client";
import { Clipper } from "./Clipper";
import "./styles.css";
createRoot(document.getElementById("root")!).render(
  <div className="workspace-shell">
    <header className="app-header">
      <div className="brand">
        <img src="icons/icon32.png" width="28" height="28" alt="" />
        <span>little-helper</span>
      </div>
      <span className="site-label">Page clipper</span>
    </header>
    <Clipper />
  </div>,
);
