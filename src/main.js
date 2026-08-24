import "./styles/app.css";
import { App } from "./app.js";

const root = document.querySelector("#app");

if (!root) {
  throw new Error("APP_ROOT_NOT_FOUND");
}

const application = new App(root);


if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
