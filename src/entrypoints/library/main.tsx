import App from "@/ui/App";
import { listenForLibraryFocusRequests } from "@/utils/openLibraryTab";
import React from "react";
import ReactDOM from "react-dom/client";

listenForLibraryFocusRequests();

ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
        <App variant="page" />
    </React.StrictMode>,
);
