import { useEffect, useState } from "react";
import { CheckCircle2, Download, Share, Smartphone } from "lucide-react";
import { SectionCard } from "./SectionCard.jsx";

const isStandalone = () =>
  typeof window !== "undefined" &&
  (window.matchMedia?.("(display-mode: standalone)")?.matches || window.navigator.standalone === true);

const isIos = () =>
  typeof navigator !== "undefined" && /iphone|ipad|ipod/i.test(navigator.userAgent);

export function StudentAppCard() {
  const [prompt, setPrompt] = useState(null);
  const [installed, setInstalled] = useState(isStandalone);
  const [message, setMessage] = useState("");

  useEffect(() => {
    const onPrompt = (event) => {
      event.preventDefault();
      setPrompt(event);
    };
    const onInstalled = () => {
      setInstalled(true);
      setPrompt(null);
      setMessage("Installed. Open Coaching from your home screen.");
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  async function install() {
    if (!prompt) return;
    await prompt.prompt();
    const choice = await prompt.userChoice;
    if (choice.outcome === "accepted") {
      setInstalled(true);
      setMessage("Installed. Open Coaching from your home screen.");
    } else {
      setMessage("Install cancelled. Use the browser menu when you are ready.");
    }
    setPrompt(null);
  }

  return (
    <SectionCard title="Student mobile app" subtitle="Install this portal on your phone">
      <div className="stack" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
          <span className="empty__icon" aria-hidden="true">
            <Smartphone size={18} />
          </span>
          <div className="grow">
            <p className="small">
              The student app opens at your Home screen, keeps the navigation on your phone and uses a
              cached shell when the network drops. Lessons, tests and fees still need a connection.
            </p>
            <p className="help" style={{ marginTop: 4 }}>
              Works with Chrome on Android and Safari on iPhone. No app store or paid service.
            </p>
          </div>
        </div>

        {installed ? (
          <div className="alert alert--success" role="status">
            <CheckCircle2 size={16} aria-hidden="true" />
            <span>Installed on this device.</span>
          </div>
        ) : prompt ? (
          <button type="button" className="btn btn--primary btn--sm" onClick={install}>
            <Download size={15} aria-hidden="true" /> Install student app
          </button>
        ) : isIos() ? (
          <div className="alert alert--info" role="status">
            <Share size={16} aria-hidden="true" />
            <span>
              In Safari, tap Share, then <strong>Add to Home Screen</strong>.
            </span>
          </div>
        ) : (
          <p className="small muted">
            Open your browser menu and choose <strong>Install app</strong> or{" "}
            <strong>Add to Home screen</strong>.
          </p>
        )}

        {message ? (
          <p className="small" role="status">
            {message}
          </p>
        ) : null}
      </div>
    </SectionCard>
  );
}
